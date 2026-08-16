//! Gorsel (CLIP) embedding veri katmani — Faz 5.3 + **cok-bolge** (migration 0022).
//!
//! AYRI vec0 tablosu `asset_image_region_vectors FLOAT[512]` (migration 0022; 0010'un cok-bolge
//! halefi); metin (MiniLM 384) tablosundan bagimsiz — CLIP gorsel+metin AYNI 512-boyut uzaya
//! projekte eder (cosine kIyaslanabilir). **Cok-bolge:** her gorsel `IMAGE_REGION_COUNT` uzamsal
//! bolge olarak embedlenir; vec0 tek-anahtar kisiti → PK-KODLAMASI `id = asset_id*STRIDE + region`
//! (region 0..4). Metin→gorsel aramada asset basina **BOLGE-MAX cosine** (kompozisyon: "cami VE
//! bulut birlikte"). Embedding URETIMI bu katmanda DEGIL (`archivist-db` ONNX'ten bagimsiz kalir):
//! ust katman (src-tauri) CLIP ile 5 bolge uretir, burada `set_image_region_vectors` ile yazar. Bu
//! modul: bekleyenleri listele (thumbnail'i olan ama tam-bolge-seti olmayan) · bolge-vektorleri yaz
//! · **metin→gorsel** arama (`image_search`/`image_search_scored`, BOLGE-MAX) · **gorsel→gorsel**
//! ("benzer gorseller", `similar_images`; global bolge). Her arama kNN + ORTAK `FILTER_FRAG`
//! (cop/facet dislama → semantik metin arama ile ayni guvence).

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};

use crate::error::DbError;
use crate::index_skips::IndexStage;
use crate::query::{
    map_asset_row, AssetPage, AssetRow, FilterBinds, ListOpts, AI_A, AI_GORSEL_TURU_EXPR, COLS_A,
    DOMINANT_COLORS_EXPR, FAV_A, FILTER_FRAG,
};
use crate::semantic::{clamp_k, vec_to_blob, FETCH_CAP, FETCH_MULT};
use crate::Db;

/// CLIP ViT-B/32 gorsel/metin embedding boyutu — `asset_image_region_vectors FLOAT[512]`
/// (migration 0022) ile AYNI olmali. `archivist-embed::IMAGE_EMBED_DIM` ile esit
/// (burada tekrar tanimli: db ONNX'e bagli degil).
pub const IMAGE_EMBED_DIM: usize = 512;

/// "AI analizi DENENDI ama sonuc kullanilamadi" isaretinin EAV anahtari (deger sabit `"1"`).
/// TEK dogruluk kaynagi: Rust yazar (`mark_analysis_attempt_failed`), frontend AYNI anahtarla
/// genel metadata faceti uzerinden filtreler/sayar (`src/features/facets` — anahtar orada da
/// sabittir; ikisi degisirse birlikte degismeli).
pub const AI_ATTEMPT_FAILED_KEY: &str = "ai_attempt_failed";

/// Cok-bolge CLIP: bir gorsel `IMAGE_REGION_COUNT` uzamsal BOLGE olarak embedlenir (global +
/// center + top-left + top-right + bottom-center). Metin→gorsel aramada asset basina BOLGE-MAX
/// cosine → kompozisyon ("cami VE bulut birlikte") global-tek-vektorden cok daha iyi calisir
/// (gokyuzu bolgesi "bulut"a, yapi bolgesi "cami"ye AYRI eslesir). `archivist-embed::
/// IMAGE_REGION_COUNT` ile esit. H2 `generateImageEmbeddingsMulti` porti.
pub const IMAGE_REGION_COUNT: usize = 5;

/// vec0'da KANITLI tek anahtar `INTEGER PRIMARY KEY` (metadata-kolon destegine GUVENILMEZ) → asset
/// basina COK bolge satirini PK-KODLAMASIYLA ayir: `id = asset_id*STRIDE + region` (region 0..4).
/// Okurken `asset_id = id/STRIDE`, `region = id%STRIDE`. STRIDE=8: bolge sayisindan (5) buyuk (ileride
/// bolge eklense de cakismaz) + 2'nin kuvveti (hizli tam-bol/mod). SQLite tamsayi `/` ve `%` kullanilir.
pub const IMAGE_REGION_STRIDE: i64 = 8;

/// LE f32 blob → vektor (vec_to_blob'un tersi; depolanmis embedding'i geri okur).
fn blob_to_vec(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// Iki vektorun cosine benzerligi (dot / (|a|·|b|)). Vektorler birim olmasa bile dogru →
/// vec0 mesafe-metriginden BAGIMSIZ alaka olcusu (gorsel-fallback alaka esigi icin).
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let (mut dot, mut na, mut nb) = (0f32, 0f32, 0f32);
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

/// Gorsel embedlenmeyi bekleyen asset: id + thumbnail baytlari. CLIP gorsel kodlayici
/// **thumbnail'i** embedler → gercek goruntu *ve* PDF/DWG/Office on-izleme uniform
/// kapsanir ("gorseller + thumbnail'lar" kapsami).
#[derive(Debug, Clone)]
pub struct PendingImageEmbed {
    pub id: i64,
    pub file_name: String,
    /// asset_thumbnails.bytes — kodlanmis (genelde JPEG) thumbnail.
    pub thumb_bytes: Vec<u8>,
}

/// AI vision-analizi bekleyen asset: id + kaynak yolu + thumbnail baytlari (Ollama vision modeline
/// yollanir). `PendingImageEmbed`'e benzer; ayri tip (farkli is — betimleme vs embedding).
#[derive(Debug, Clone)]
pub struct PendingAnalysis {
    pub id: i64,
    pub file_name: String,
    /// Kaynak dosyanin tam yolu — analiz aninda daha yuksek-cozunurluk (~768px) onizleme uretmek
    /// icin (raster degil / dosya yok / decode olmaz ise cagiran `thumb_bytes`'a geri-duser).
    pub path: String,
    pub thumb_bytes: Vec<u8>,
}

/// AI vision-analiz KAPSAMI (Part B) — hangi asset kumesinin analiz edilecegini sinirlar.
/// Olcek gerekcesi: arsiv milyonlara cikacak → "hepsini analiz et" pahali; kullanici yalniz
/// bir SECIM veya FILTRE (klasor/proje/uzanti...) analiz edebilsin. Blanket kosullar (thumbnail
/// var · analizsiz · skip'siz · cop disi) HER kapsamda korunur; kapsam bunun USTUNE daraltir.
///
/// - `All`    → ek kosul yok (mevcut blanket davranis; `pending_analysis_count` bunu delege eder).
/// - `Ids`    → yalniz verilen asset id'leri (secim). Bos liste → hicbir sonuc.
/// - `Filter` → facet filtresine (`FILTER_FRAG`: ext/tag/collection/favori/tarih/onay/proje/
///   yol-onek) uyanlar. FTS tam-metin `query` alani YOK SAYILIR (extract deseni; kapsam facet-tabanli).
#[derive(Debug, Clone)]
pub enum AnalysisScope {
    /// Tum uygun asset'ler (blanket).
    All,
    /// Yalniz verilen id'ler (secim). Bos → hicbir sonuc.
    Ids(Vec<i64>),
    /// Facet filtresine uyanlar (`FILTER_FRAG`; FTS `query` yok sayilir). `ListOpts` buyuk
    /// (296B) → `Box` (clippy large_enum_variant; kucuk `All`/`Ids` variantlarini sismesin).
    Filter(Box<ListOpts>),
}

impl AnalysisScope {
    /// Blanket WHERE'e AND'lenecek kapsam SQL parcasi. `Ids` → i64 inline `IN (...)` (kendi
    /// i64'lerimiz → enjeksiyon yok; image_search_scored deseni). `Filter` → `FILTER_FRAG`
    /// (adli param; degerler `FilterBinds` ile baglanir). `All` → bos. `Ids([])` cagiran
    /// tarafinda ERKEN donuldugu icin (bos `IN ()` = SQL hatasi) burada non-empty varsayilir.
    fn where_frag(&self) -> String {
        match self {
            AnalysisScope::All => String::new(),
            AnalysisScope::Ids(ids) => {
                let list = ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
                format!("AND a.id IN ({list})")
            }
            AnalysisScope::Filter(_) => format!("AND {FILTER_FRAG}"),
        }
    }

    /// Bos `Ids` kapsami mi? (bos `IN ()` SQL hatasi olurdu → cagiran erken doner.)
    fn is_empty_ids(&self) -> bool {
        matches!(self, AnalysisScope::Ids(ids) if ids.is_empty())
    }

    /// `Filter` ise filtre baglarini uret (aksi halde None). Cagiran bunu locale baglar → params()
    /// referanslari sorgu boyu yasar. Yalniz `Filter` durumunda `FILTER_FRAG` SQL'e girdiginden
    /// yalniz o durumda adli param saglanir (kullanilmayan adli param rusqlite'ta hata verir).
    fn filter_binds(&self) -> Option<FilterBinds> {
        match self {
            AnalysisScope::Filter(opts) => Some(FilterBinds::new(opts)),
            _ => None,
        }
    }
}

impl Db {
    /// Gorsel embedlenmeyi bekleyen (thumbnail'i OLAN ama TAM bolge seti olmayan, cope atilmamis)
    /// asset sayisi. "Gorseller + thumbnail'lar" kapsami: gorsel-vektor thumbnail uzerinden uretilir
    /// → thumbnail yoksa embedlenecek gorsel de yok. **Tam-bolge olcutu:** embed TUM bolgeleri
    /// atomik yazar (`set_image_region_vectors`) → SON bolge (region IMAGE_REGION_COUNT-1) varsa
    /// hepsi vardir. Migration 0022 yalniz region 0'i tasidi → son bolge YOK → yeniden embed'lenir
    /// (1-4 bolgeleri eklenir; kompozisyon kazanci).
    pub fn pending_image_embed_count(&self) -> Result<i64, DbError> {
        let last = IMAGE_REGION_COUNT as i64 - 1; // son bolge indeksi (tam-set kaniti)
        let sql = format!(
            "SELECT count(*) FROM assets a
             WHERE a.deleted_at IS NULL
               AND EXISTS (SELECT 1 FROM asset_thumbnails th WHERE th.asset_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM asset_image_region_vectors v
                               WHERE v.id = a.id * {IMAGE_REGION_STRIDE} + {last})
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = ?1)"
        );
        Ok(self.conn.query_row(&sql, params![IndexStage::Image.as_str()], |r| r.get(0))?)
    }

    /// Toplam gorsel-vektor (embedlenmis asset) sayisi — DISTINCT asset (id/STRIDE), bolge satiri
    /// DEGIL (asset basina 5 satir olabilir).
    pub fn image_vector_count(&self) -> Result<i64, DbError> {
        let sql = format!(
            "SELECT count(DISTINCT id / {IMAGE_REGION_STRIDE}) FROM asset_image_region_vectors"
        );
        Ok(self.conn.query_row(&sql, [], |r| r.get(0))?)
    }

    /// Bir asset'in AI vision-analiz sonucunu `ai_*` EAV metadata olarak yaz (idempotent: eski
    /// ai_ alanlarini ONCE siler) + `ai_analyzed=1` marker (bos analiz de "denendi" sayilir →
    /// sonsuz dongu yok). `ai_*` jenerik EAV → `build_metadata_text` metadata chunk'ina koyar →
    /// re-index sonrasi GORSEL-icerik metin aramasiyla bulunur. Re-ingest bu alanlari KORUR
    /// (write.rs DELETE'i `ai_` haric tutar).
    pub fn set_ai_metadata(&self, asset_id: i64, fields: &[(&str, String)]) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;
        // `ai_gorsel_turu` HARIC — o, betim (vision) analizinden DEGIL, deterministik heuristikten
        // (image_kind/backfill.rs) gelen bir MEDYA-turu alani. Betim analizi (set_ai_metadata) tum
        // `ai_%`'yi silip yazarken bu etiketi de silmemeli (yoksa her yeniden-analiz Katman 1
        // siniflandirmasini yok eder).
        tx.execute(
            r"DELETE FROM asset_metadata WHERE asset_id = ?1 AND key LIKE 'ai\_%' ESCAPE '\'
              AND key <> 'ai_gorsel_turu'",
            params![asset_id],
        )?;
        {
            let mut ins = tx.prepare(
                "INSERT INTO asset_metadata(asset_id, key, value_text, value_num)
                 VALUES (?1, ?2, ?3, NULL)",
            )?;
            for (k, v) in fields {
                ins.execute(params![asset_id, k, v])?;
            }
            ins.execute(params![asset_id, "ai_analyzed", "1"])?;
        }
        // Ana-kutu FTS koprusu (migration 0021): betim value'lerini `assets_fts.ai` kolonuna yaz.
        // Bu olmadan analizli gorsel ana aramada (list_assets → assets_fts MATCH) GORUNMEZ (body
        // bir gorselde ~= bos). Idempotent: fields her seferinde taze → ai uzerine yazilir.
        // `ai_analyzed` marker'i fields'ta YOK (ayri eklenir) → yalniz betim metni aranabilir olur.
        //
        // KAYNAK-IZI HARIC: `ai_model` (or. "llava:13b") ve `ai_analyzed_at` (epoch-ms) EAV olarak
        // asset_metadata'ya YAZILIR (asagidaki INSERT dongusu) ama aranabilir govdeye (assets_fts.ai)
        // GIRMEZ — model adi/tarih arama sonucu kirletmesin (STATUS: "AI FTS'ini KIRLETMEDEN ayri EAV").
        // Diger tum ai_* alanlar (aciklama/cizim_turu/metin...) FTS'e girmeye DEVAM eder.
        const AI_FTS_EXCLUDED: &[&str] = &["ai_model", "ai_analyzed_at"];
        let ai_text = fields
            .iter()
            .filter(|(k, _)| !AI_FTS_EXCLUDED.contains(k))
            .map(|(_, v)| v.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        tx.execute(
            "UPDATE assets_fts SET ai = ?1 WHERE asset_id = ?2",
            params![ai_text, asset_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Bugunku cop-korumasi esigini GECEMEYECEK, gecmiste yazilmis analizlerin asset id'leri.
    ///
    /// **Neden gerekli?** Cop-korumasi (`is_usable`) 2026-08-07'de eklendi. ONCESINDE yetersiz bir
    /// modelin (olculdu: `llava`) etiketsiz serbest metni `ai_aciklama` olarak YAZILIYOR, ustune
    /// `ai_analyzed=1` damgasi basiliyordu. Damgali varlik `pending_analysis_count`'ta GORUNMEZ →
    /// calisan bir modelle bir daha ASLA denenmez. Bu metod o kayitlari bulur; `clear_ai_analysis`
    /// onlari yeniden **bekleyen** yapar.
    ///
    /// Olcut, uretim kuralinin (`is_usable`) DB'de olculebilen yarisidir: yazilmis ICERIK alani
    /// (`content_keys`, bkz `VISION_EAV_KEYS`) sayisi `min_fields`in ALTINDA. Kuralin diger yarisi
    /// (`structured` bayragi) kayitlarda tutulmaz — ama ihtiyac da yok: fallback dali yalnizca
    /// `ai_aciklama` yazabilir (tek alan), dolayisiyla "2+ alan" ⟹ en az bir etiket ayristirilmis
    /// demektir. Iki kosul geriye donuk CAKISIR.
    ///
    /// ⚠️ **Muhafazakar yon:** esik altinda kalan ama aslinda iyi olan bir kayit sifirlanirsa
    /// kayip YOKTUR (yeniden analiz edilir); esik ustunde kalan cop ise oldugu gibi kalir. Yani
    /// hata payi veri KAYBI degil, fazladan is yonundedir.
    pub fn unusable_analysis_ids(
        &self,
        content_keys: &[&str],
        min_fields: usize,
    ) -> Result<Vec<i64>, DbError> {
        let ph = vec!["?"; content_keys.len()].join(",");
        let sql = format!(
            "SELECT a.id FROM assets a
             JOIN asset_metadata mm ON mm.asset_id = a.id AND mm.key = 'ai_analyzed'
             WHERE a.deleted_at IS NULL
               AND (SELECT count(*) FROM asset_metadata m
                    WHERE m.asset_id = a.id AND m.key IN ({ph})) < ?
             ORDER BY a.id"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(content_keys.len() + 1);
        for k in content_keys {
            params.push(k);
        }
        let min = min_fields as i64;
        params.push(&min);
        let rows = stmt.query_map(params.as_slice(), |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    /// Analizli varliklarin **model kirilimi**: `(model, toplam, esik_alti)` — coktan aza.
    ///
    /// **Neden model kirilimi?** (kullanici itirazi 2026-08-08) Program cok farkli ofislerde cok
    /// farkli DB'lerle kosacak; tek bir makinede olusmus "N kayit sifirlanacak" sayisi baska bir
    /// arsiv hakkinda bir sey SOYLEMEZ. Kirilim her yoneticiye kendi tablosunu gosterir: analizleri
    /// hangi model yazmis, o modelin olculmus kalitesi ne (siniflandirmayi cagiran ekler —
    /// `ollama::vision_quality`), ve kacinin bicim esiginin ALTINDA kaldigi.
    ///
    /// Ozellikle **kor noktayi** gorunur kilar: bicim esigini GECEN ama olculmus-kotu bir modelle
    /// yazilmis kayitlar (`toplam - esik_alti`). Bunlar sifirlama kapsamina GIRMEZ (bugunku
    /// cop-korumasi da onlari gecirirdi — o bicime bakar, icerige degil), ama yonetici en azindan
    /// varliklarindan haberdar olur.
    ///
    /// `ai_model` yazilmamis eski kayitlar bos ad (`""`) altinda toplanir — cagiran onu "bilinmiyor"
    /// diye gosterir (sessizce dusurmez: sayilar toplami `analyzed_count` ile tutmalidir).
    pub fn analysis_breakdown_by_model(
        &self,
        content_keys: &[&str],
        min_fields: usize,
    ) -> Result<Vec<(String, i64, i64)>, DbError> {
        let ph = vec!["?"; content_keys.len()].join(",");
        let sql = format!(
            "SELECT COALESCE(mo.value_text, '') AS model,
                    count(*) AS total,
                    sum(CASE WHEN (SELECT count(*) FROM asset_metadata m
                                   WHERE m.asset_id = a.id AND m.key IN ({ph})) < ?
                             THEN 1 ELSE 0 END) AS sub_threshold
             FROM assets a
             JOIN asset_metadata mm ON mm.asset_id = a.id AND mm.key = 'ai_analyzed'
             LEFT JOIN asset_metadata mo ON mo.asset_id = a.id AND mo.key = 'ai_model'
             WHERE a.deleted_at IS NULL
             GROUP BY model
             ORDER BY total DESC, model"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(content_keys.len() + 1);
        for k in content_keys {
            params.push(k);
        }
        let min = min_fields as i64;
        params.push(&min);
        let rows = stmt.query_map(params.as_slice(), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    /// Bir asset'in AI betim-analizini SIL → varlik yeniden **bekleyen** olur (resumable).
    /// [`Self::set_ai_metadata`]'nin tam aynasi: ayni `ai\_%` DELETE'i (yine `ai_gorsel_turu`
    /// HARIC — o betimden degil `image_kind` heuristiginden gelir) + `assets_fts.ai` bosaltilir
    /// (yoksa cop metin ana aramada MATCH etmeye devam eder). Tek TX.
    ///
    /// ⚠️ Cagiran, bundan SONRA asset'i yeniden chunk'lamalidir (`pending_chunk_for` + `index_one`):
    /// metadata chunk'i hala eski `AI_ACIKLAMA: ...` metnini tasir, RAG onu bulmaya devam eder.
    pub fn clear_ai_analysis(&self, asset_id: i64) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            r"DELETE FROM asset_metadata WHERE asset_id = ?1 AND key LIKE 'ai\_%' ESCAPE '\'
              AND key <> 'ai_gorsel_turu'",
            params![asset_id],
        )?;
        tx.execute("UPDATE assets_fts SET ai = '' WHERE asset_id = ?1", params![asset_id])?;
        tx.commit()?;
        Ok(())
    }

    /// **BASARISIZ analiz denemesi** isareti (cop-korumasi eledi) — `ai_analyzed` damgasi YOK.
    ///
    /// Gerekce (kullanici itirazi 2026-08-15): cop-korumasi elenen varligi sessizce "bekleyen"
    /// birakiyordu. Kullanicinin ekraninda 83.675 analizsiz varlik varken elenen 5 tanesi o yigina
    /// karisiyor → "bekliyor" teknik olarak dogru ama kullanici ONLARI bir daha BULAMIYOR, dolayisi
    /// ile "ne yaparsam duzelir"in cevabi yoktu. Bu isaret onlari GORUNUR ve SECILEBILIR yapar
    /// (genel metadata faceti; `ai_attempt_failed` anahtari → sifir ek Rust filtre kodu).
    ///
    /// **`ai_analyzed` YAZILMAZ** (kasitli): varlik bekleyen kalmaya devam eder → daha yetenekli bir
    /// modelle yeniden analiz edilebilir. Isaret yalnizca "denendi, sonuc alinamadi" bilgisidir.
    ///
    /// **FTS'e girmez**: aranabilir govde (`assets_fts.ai`) DOKUNULMAZ — bir basarisizlik kaydi arama
    /// sonucunu kirletmemeli. Anahtarlar `ai_` on-ekli oldugundan (a) basarili bir analiz geldiginde
    /// `set_ai_metadata`'nin `ai\_%` DELETE'i bunlari otomatik temizler, (b) re-ingest korur
    /// (write.rs `ai_` haric tutar). Idempotent: onceki deneme kaydi ustune yazilir.
    pub fn mark_analysis_attempt_failed(
        &self,
        asset_id: i64,
        kind: &str,
        model: &str,
        at_ms: i64,
    ) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            r"DELETE FROM asset_metadata WHERE asset_id = ?1 AND key LIKE 'ai\_attempt\_%' ESCAPE '\'",
            params![asset_id],
        )?;
        let mut ins = tx.prepare(
            "INSERT INTO asset_metadata(asset_id, key, value_text, value_num) VALUES (?1, ?2, ?3, NULL)",
        )?;
        // Marker degeri sabit "1" (facet TEK satir gosterir); NEDEN ayri anahtarda durur → facet
        // sayisi siniflara bolunmez ama teknik iz (hangi sinif/model/ne zaman) kaybolmaz.
        ins.execute(params![asset_id, AI_ATTEMPT_FAILED_KEY, "1"])?;
        ins.execute(params![asset_id, "ai_attempt_kind", kind])?;
        ins.execute(params![asset_id, "ai_attempt_model", model])?;
        ins.execute(params![asset_id, "ai_attempt_at", at_ms.to_string()])?;
        drop(ins);
        tx.commit()?;
        Ok(())
    }

    /// "Denendi, sonuc alinamadi" aktif asset sayisi (isaret VAR, `ai_analyzed` YOK).
    /// `ai_analyzed` dislamasi savunma amaclidir: basarili analiz zaten isareti siler, ama eski/yarim
    /// kayitlarda ikisi bir arada bulunursa varlik "analizli" sayilmali (sayim cift gosterilmemeli).
    pub fn failed_attempt_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM asset_metadata m
             JOIN assets a ON a.id = m.asset_id AND a.deleted_at IS NULL
             WHERE m.key = ?1
               AND NOT EXISTS (SELECT 1 FROM asset_metadata m2
                               WHERE m2.asset_id = a.id AND m2.key = 'ai_analyzed')",
            params![AI_ATTEMPT_FAILED_KEY],
            |r| r.get(0),
        )?)
    }

    /// AI-analizi olan (en az `ai_analyzed`) aktif asset sayisi.
    pub fn analyzed_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM asset_metadata m
             JOIN assets a ON a.id = m.asset_id AND a.deleted_at IS NULL
             WHERE m.key = 'ai_analyzed'",
            [],
            |r| r.get(0),
        )?)
    }

    /// Thumbnail'i OLAN ama AI-analizi OLMAYAN (cope disi) aktif asset sayisi (kalan is).
    /// Blanket (`AnalysisScope::All`) — `pending_analysis_count_scoped`'a ince delege (kod tekrari
    /// yok; eski API imzasi KORUNUR → mevcut cagiranlar kirilmaz).
    pub fn pending_analysis_count(&self) -> Result<i64, DbError> {
        self.pending_analysis_count_scoped(&AnalysisScope::All)
    }

    /// AI-analizi bekleyen (thumbnail'i OLAN, analiz edilmemis, `after_id`'den buyuk) ilk `limit`
    /// asset — thumbnail baytlariyla (resumable cursor). Blanket delege (`AnalysisScope::All`).
    pub fn assets_without_analysis(
        &self,
        after_id: i64,
        limit: i64,
    ) -> Result<Vec<PendingAnalysis>, DbError> {
        self.assets_without_analysis_scoped(&AnalysisScope::All, after_id, limit)
    }

    /// **Kapsamli** (Part B) analiz-bekleyen sayisi: blanket kosullar (thumbnail var · analizsiz ·
    /// vision-skip'siz · cop disi) + `scope` daraltmasi. `Ids([])` → 0 (bos `IN ()` SQL hatasi
    /// olurdu → erken don). `Filter` FTS `query`'yi yok sayar (facet-tabanli kapsam). `count ==
    /// `assets_without_analysis_scoped` batch enumerasyonu` (ayni WHERE → tutarli).
    pub fn pending_analysis_count_scoped(&self, scope: &AnalysisScope) -> Result<i64, DbError> {
        self.pending_count_with(scope, None, false)
    }

    /// **Secilip de analiz edilemeyecek** asset sayisi: kullanicinin ACIKCA sectigi id'lerden
    /// analiz sonucu OLMAYAN *ve* bekleyen kumeye de GIRMEYENler — yani onizlemesi (thumbnail)
    /// olmayan ya da vision adiminda kalici atlanmis dosyalar.
    ///
    /// **Neden var (kullanici bulgusu 2026-08-16).** Kullanici mp4 dosyalarini secip "AI ile tara"
    /// dedi; kosu bitti, bildirim "0 analiz edildi, 0 basarisiz" diyerek BASARI tonunda kapandi ve
    /// kartlarda hicbir sey degismedi. Cunku analiz kuyrugu (`assets_without_analysis_scoped`)
    /// thumbnail'i olan dosyalari cekiyor; onizlemesi olmayan secim SESSIZCE dusuyordu. Sessiz
    /// dusme, kullaniciya "yapildi" demenin en kotu bicimidir. Bu sayac raporun icine girer →
    /// UI "N dosya analiz edilemedi: onizlemesi yok" diyebilir.
    ///
    /// ⚠️ Yalniz ACIK SECIM (id listesi) icin anlamlidir: "tumu"/filtre kapsaminda kullanici zaten
    /// "analiz edilebilecekleri" kastediyordur, orada her PDF'i saymak gurultu olurdu.
    /// Zaten analizli secimler bu sayiya GIRMEZ (onlar atlanir ama bu bir kayip degildir).
    pub fn not_analyzable_selection_count(&self, ids: &[i64]) -> Result<i64, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let stage = IndexStage::Vision.as_str();
        let json = serde_json::to_string(ids).map_err(|e| DbError::Invalid(e.to_string()))?;
        Ok(self.conn.query_row(
            "SELECT count(*) FROM assets a
             WHERE a.deleted_at IS NULL
               AND a.id IN (SELECT value FROM json_each(?1))
               AND NOT EXISTS (SELECT 1 FROM asset_metadata m
                               WHERE m.asset_id = a.id AND m.key = 'ai_analyzed')
               AND (NOT EXISTS (SELECT 1 FROM asset_thumbnails th WHERE th.asset_id = a.id)
                    OR EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = ?2))",
            params![json, stage],
            |r| r.get(0),
        )?)
    }

    /// Bekleyenlerin **hic denenmemis** kismi: `pending` eksi `ai_attempt_failed` isaretliler.
    ///
    /// **Neden ayri sayac (kullanici itirazi 2026-08-16).** Sidebar'daki "Analiz edilmemis" satiri
    /// `total - analyzed` ile hesaplaniyordu; bu hem denenip elenmisleri hem de hic thumbnail'i
    /// olmayan (asla gorsel-analize giremeyecek) PDF/DWG gibi dosyalari iceriyordu. Satirin vaadi
    /// "hic analize girmemis gorseller"dir → sayi da tam onu olcmeli. CIKARMA ile turetilmez
    /// (`pending - attempt_failed`): `failed_attempt_count` thumbnail/vision-skip kosulu aramaz,
    /// dolayisiyla aradaki fark negatife kayabilir ve sayi kendi filtresiyle tutmazdi. Bu sayac,
    /// `FILTER_FRAG`'in `:ai_analyzed = 0` dalinin dondurdugu kumeyle BIREBIR ayni kosullari kurar.
    pub fn pending_never_attempted_count(&self) -> Result<i64, DbError> {
        self.pending_count_with(&AnalysisScope::All, None, true)
    }

    /// Bekleyen kumenin **kucuk-dosya** kismi: `size_bytes < max_bytes`.
    ///
    /// **Neden var (kullanici karari, STATUS 3. madde).** Gercek arsivde bekleyen 28.048 gorselin
    /// %90,6'si 20 KB altiydi — ikon, logo, ekran goruntusu, malzeme dokusu. Bu makinede analiz
    /// basina ~2,5 dk harcaniyor; kullanici "kac dosya bekliyor" sayisina bakip kosuyu planliyor
    /// ama o sayinin neredeyse tamami mimari icerik DEGIL. 2026-08-10'da olculdu: bir Carrera
    /// mermer DOKUSU analiz edildiginde model olmayan bir bina betimliyor ("tarihi yapi, kubbe,
    /// avlu") ve bu uydurma metin aranabilir govdeye (`assets_fts.ai`) yaziliyor.
    ///
    /// ⚠️ Bu sayac **ELEMEZ** — yalnizca GORUNUR kilar. Kullanici direktifi acikti: kisisel
    /// arsivinde bu dosyalarin bulunmasi normaldir, dogru yol klasor elemek degil kapsamli/secili
    /// kosu + gorunur kirilim. Neyin analiz edilecegine kullanici karar verir; sayi ona bakar.
    pub fn pending_analysis_small_count(
        &self,
        scope: &AnalysisScope,
        max_bytes: i64,
    ) -> Result<i64, DbError> {
        self.pending_count_with(scope, Some(max_bytes), false)
    }

    /// Uc sayacin ORTAK govdesi. Tek yerde durur cunku "bekleyen" tanimi (thumbnail var ·
    /// analizsiz · vision-skip'siz · cop disi) ucunde de AYNI olmali; ayri yazilsalardi biri
    /// degisince kirilim toplami tutmaz, kullaniciya celiskili iki sayi gosterirdik.
    ///
    /// `never_attempted` = true iken kume `ai_attempt_failed` isaretlilerden de arindirilir
    /// (bkz `pending_never_attempted_count`) → "hic analize girmemis" alt kumesi.
    fn pending_count_with(
        &self,
        scope: &AnalysisScope,
        max_bytes: Option<i64>,
        never_attempted: bool,
    ) -> Result<i64, DbError> {
        if scope.is_empty_ids() {
            return Ok(0);
        }
        let stage = IndexStage::Vision.as_str();
        let frag = scope.where_frag();
        // Boyut suzgeci opsiyonel; NULL boyut "kucuk" SAYILMAZ (bilinmeyeni kucuk varsaymak
        // kirilimi oldugundan iyimser gosterirdi).
        let size_frag = if max_bytes.is_some() {
            "AND a.size_bytes IS NOT NULL AND a.size_bytes < :max_bytes"
        } else {
            ""
        };
        // Anahtar listesi SABITTEN gelir (kullanici girdisi degil) → gomulmesi guvenli; `IN` ile
        // asset_metadata PK'si (asset_id, key) tek aramada calisir.
        let blocking_keys = if never_attempted {
            format!("'ai_analyzed', '{AI_ATTEMPT_FAILED_KEY}'")
        } else {
            "'ai_analyzed'".to_string()
        };
        let sql = format!(
            "SELECT count(*) FROM assets a
             WHERE a.deleted_at IS NULL
               AND EXISTS (SELECT 1 FROM asset_thumbnails th WHERE th.asset_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM asset_metadata m
                               WHERE m.asset_id = a.id AND m.key IN ({blocking_keys}))
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = :stage)
               {size_frag}
               {frag}"
        );
        // Filter kapsaminda FILTER_FRAG adli param'lari; binds sorgu boyu yasamali (local).
        let binds = scope.filter_binds();
        let mut named: Vec<(&str, &dyn rusqlite::ToSql)> = vec![(":stage", &stage)];
        if let Some(m) = &max_bytes {
            named.push((":max_bytes", m));
        }
        if let Some(b) = &binds {
            named.extend(b.params());
        }
        Ok(self.conn.query_row(&sql, named.as_slice(), |r| r.get(0))?)
    }

    /// **Kapsamli** (Part B) analiz-bekleyen batch getirici: blanket kosullar + `scope` + cursor
    /// (`a.id > after_id`, `ORDER BY a.id LIMIT limit`; resumable → basarisiz analiz ayni kosuda
    /// tekrar gelmez). `Ids([])` → bos. Blanket metod (`assets_without_analysis`) buna delege eder.
    pub fn assets_without_analysis_scoped(
        &self,
        scope: &AnalysisScope,
        after_id: i64,
        limit: i64,
    ) -> Result<Vec<PendingAnalysis>, DbError> {
        if scope.is_empty_ids() {
            return Ok(Vec::new());
        }
        let stage = IndexStage::Vision.as_str();
        let frag = scope.where_frag();
        let sql = format!(
            "SELECT a.id, a.file_name, a.path, th.bytes
             FROM assets a
             JOIN asset_thumbnails th ON th.asset_id = a.id
             WHERE a.deleted_at IS NULL
               AND a.id > :after
               AND NOT EXISTS (SELECT 1 FROM asset_metadata m
                               WHERE m.asset_id = a.id AND m.key = 'ai_analyzed')
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = :stage)
               {frag}
             ORDER BY a.id
             LIMIT :limit"
        );
        let binds = scope.filter_binds();
        let mut named: Vec<(&str, &dyn rusqlite::ToSql)> =
            vec![(":stage", &stage), (":after", &after_id), (":limit", &limit)];
        if let Some(b) = &binds {
            named.extend(b.params());
        }
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(named.as_slice(), |r| {
            Ok(PendingAnalysis {
                id: r.get(0)?,
                file_name: r.get(1)?,
                path: r.get(2)?,
                thumb_bytes: r.get(3)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    /// Gorsel-vektoru olmayan, thumbnail'i OLAN, `after_id`'den buyuk id'li ilk `limit`
    /// asset'i thumbnail baytlariyla getir (resumable batch; semantic.rs cursor deseni →
    /// embed'i basarisiz olan asset ayni kosuda tekrar getirilmez, sonsuz dongu onlenir).
    pub fn assets_without_image_vectors(
        &self,
        after_id: i64,
        limit: i64,
    ) -> Result<Vec<PendingImageEmbed>, DbError> {
        // Tam-bolge olcutu: SON bolge (region IMAGE_REGION_COUNT-1) yoksa bolge seti eksik →
        // yeniden embed'le (embed tum bolgeleri atomik yazar → son bolge = tam-set kaniti).
        let last = IMAGE_REGION_COUNT as i64 - 1;
        let sql = format!(
            "SELECT a.id, a.file_name, th.bytes
             FROM assets a
             JOIN asset_thumbnails th ON th.asset_id = a.id
             WHERE a.deleted_at IS NULL
               AND a.id > ?1
               AND NOT EXISTS (SELECT 1 FROM asset_image_region_vectors v
                               WHERE v.id = a.id * {IMAGE_REGION_STRIDE} + {last})
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = ?2)
             ORDER BY a.id
             LIMIT ?3"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![after_id, IndexStage::Image.as_str(), limit], |r| {
            Ok(PendingImageEmbed {
                id: r.get(0)?,
                file_name: r.get(1)?,
                thumb_bytes: r.get(2)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    /// Bir asset'in TUM gorsel BOLGE vektorlerini yaz (atomik yeniden-yaz). Her cift `(region, vec)`
    /// → PK-kodlamali satir `id = asset_id*STRIDE + region`. `vec.len()` 512 (IMAGE_EMBED_DIM) +
    /// `region < STRIDE` dogrulanir. vec0 UPSERT YOK → asset'in TUM bolge satirlari ONCE silinir
    /// (`id` [asset_id*STRIDE, asset_id*STRIDE+STRIDE) araligi), sonra INSERT — tek TX. Boylece
    /// yeniden-embed eski bolgeleri (or. daha az bolge uretmis eski kosu) birakmaz + SON bolge
    /// varligi "tam set" olcutunu (pending sorgulari) atomik kilar.
    pub fn set_image_region_vectors(
        &self,
        asset_id: i64,
        regions: &[(usize, Vec<f32>)],
    ) -> Result<(), DbError> {
        for (region, vec) in regions {
            if *region as i64 >= IMAGE_REGION_STRIDE {
                return Err(DbError::Invalid(format!(
                    "gecersiz bolge indeksi {region} >= STRIDE {IMAGE_REGION_STRIDE}"
                )));
            }
            if vec.len() != IMAGE_EMBED_DIM {
                return Err(DbError::Invalid(format!(
                    "gorsel bolge {region} vektor boyutu {} != {IMAGE_EMBED_DIM}",
                    vec.len()
                )));
            }
        }
        let base = asset_id * IMAGE_REGION_STRIDE;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM asset_image_region_vectors WHERE id >= ?1 AND id < ?2",
            params![base, base + IMAGE_REGION_STRIDE],
        )?;
        {
            let mut ins = tx.prepare(
                "INSERT INTO asset_image_region_vectors(id, embedding) VALUES (?1, ?2)",
            )?;
            for (region, vec) in regions {
                ins.execute(params![base + *region as i64, vec_to_blob(vec)])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// **Metin→gorsel** arama: CLIP metin vektorune en yakin `k` gorsel-asset (mesafe
    /// artan). Filtreler ortak FILTER_FRAG ile kNN sonrasi. Sorgu metni CLIP metin
    /// kodlayici ile embedlenir (ust katman); burada hazir 512-vektor alinir.
    pub fn image_search(&self, query_vec: &[f32], opts: &ListOpts) -> Result<AssetPage, DbError> {
        if query_vec.len() != IMAGE_EMBED_DIM {
            return Err(DbError::Invalid(format!(
                "sorgu vektoru boyutu {} != {IMAGE_EMBED_DIM}",
                query_vec.len()
            )));
        }
        self.image_knn(&vec_to_blob(query_vec), opts, None)
    }

    /// **Metin→gorsel + GERCEK COSINE SKORU (BOLGE-MAX)** (Gorsel Arama + sohbet gorsel-fallback):
    /// kNN bolge-adaylarinin GERCEK cosine'i (vektorler okunup hesaplanir → vec0 mesafe-metriginden
    /// BAGIMSIZ, birim-norm varsayimi yok) alinir, sonra **asset basina EN YUKSEK bolge cosine'i**
    /// skor olur (kompozisyon: gokyuzu bolgesi "bulut"a, yapi bolgesi "cami"ye ayri eslesir → tek
    /// bolge bile yakinsa asset yukseklerde). En yakin `k` asset **(AssetRow, cosine)** olarak (cosine
    /// AZALAN) doner. ESIK YOK — alaka esigi + mesaj ust katmanin (rag_chat) isi (skor gorunur →
    /// kor-kalibrasyon yerine "en yakin %X" seffafligi + dogru "bulunamadi"). Aday yoksa bos.
    pub fn image_search_scored(
        &self,
        query_vec: &[f32],
        opts: &ListOpts,
    ) -> Result<Vec<(AssetRow, f32)>, DbError> {
        if query_vec.len() != IMAGE_EMBED_DIM {
            return Err(DbError::Invalid(format!(
                "sorgu vektoru boyutu {} != {IMAGE_EMBED_DIM}",
                query_vec.len()
            )));
        }
        let k = clamp_k(opts.page_size);
        let regions = IMAGE_REGION_COUNT as i64;
        // Asset basina 5 bolge → 5x aday cek (aksi halde filtre+asset-daralmasi k'yi doldurmayabilir).
        let fetch = (k * FETCH_MULT * regions).min(FETCH_CAP * regions);
        let qblob = vec_to_blob(query_vec);

        // 1) kNN aday BOLGE-id'leri (mesafe artan). id = asset_id*STRIDE + region (kodlanmis).
        let cand_region_ids: Vec<i64> = {
            let mut knn = self.conn.prepare(&format!(
                "SELECT id FROM asset_image_region_vectors
                 WHERE embedding MATCH ?1 ORDER BY distance LIMIT {fetch}"
            ))?;
            let ids = knn
                .query_map(params![qblob], |r| r.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            ids
        };
        if cand_region_ids.is_empty() {
            return Ok(Vec::new());
        }

        // 2) Aday bolge-id'lerini asset'e coz (id/STRIDE) → o asset'lerin TUM bolge id'lerini uret →
        //    her bolgenin GERCEK cosine'i (vektorler okunur; vec0 mesafe-metriginden bagimsiz) →
        //    asset basina **MAX cosine** (BOLGE-MAX: bir bolge bile yakinsa asset yakalanir →
        //    kompozisyon). Var olmayan bolge (or. yalniz region 0 migrate edilmis) IN'de dogal atlanir.
        let mut asset_ids: Vec<i64> =
            cand_region_ids.iter().map(|id| id / IMAGE_REGION_STRIDE).collect();
        asset_ids.sort_unstable();
        asset_ids.dedup();
        let mut all_region_ids: Vec<i64> =
            Vec::with_capacity(asset_ids.len() * IMAGE_REGION_COUNT);
        for a in &asset_ids {
            for r in 0..regions {
                all_region_ids.push(a * IMAGE_REGION_STRIDE + r);
            }
        }
        let id_list = all_region_ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
        let mut max_cos: HashMap<i64, f32> = HashMap::with_capacity(asset_ids.len());
        {
            let mut stmt = self.conn.prepare(&format!(
                "SELECT id, embedding FROM asset_image_region_vectors WHERE id IN ({id_list})"
            ))?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)))?;
            for row in rows {
                let (id, blob) = row?;
                let asset = id / IMAGE_REGION_STRIDE;
                let cos = cosine(query_vec, &blob_to_vec(&blob));
                max_cos
                    .entry(asset)
                    .and_modify(|m| {
                        if cos > *m {
                            *m = cos;
                        }
                    })
                    .or_insert(cos);
            }
        }
        let mut scored: Vec<(i64, f32)> = max_cos.into_iter().collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // 3) Filtreyle (FILTER_FRAG: cop/facet) hidratla + cosine sirasinda ilk k (skoruyla).
        let surv_ids = scored.iter().map(|(id, _)| id.to_string()).collect::<Vec<_>>().join(",");
        let binds = FilterBinds::new(opts);
        let common = binds.params();
        let sql = format!(
            "SELECT {COLS_A}, {FAV_A}, NULL, {AI_A}, {AI_GORSEL_TURU_EXPR}, {DOMINANT_COLORS_EXPR} FROM assets a
             WHERE a.id IN ({surv_ids}) AND {FILTER_FRAG}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut by_id: HashMap<i64, AssetRow> = HashMap::new();
        let rows = stmt.query_map(common.as_slice(), map_asset_row)?;
        for row in rows {
            let row = row?;
            by_id.insert(row.id, row);
        }
        let mut out: Vec<(AssetRow, f32)> = Vec::with_capacity(k as usize);
        for (id, cos) in &scored {
            if let Some(row) = by_id.remove(id) {
                out.push((row, *cos));
                if out.len() >= k as usize {
                    break;
                }
            }
        }
        Ok(out)
    }

    /// **Gorsel→gorsel** ("benzer gorseller"): `asset_id`'nin GLOBAL (region 0; id=asset_id*STRIDE)
    /// bolge vektorune en yakin asset'ler (kendisi — TUM bolgeleri — HARIC). Global bolge = tum-sahne
    /// temsili → benzerlik butun-gorsel duzeyinde (bolge-parcasi degil). Asset'in gorsel-vektoru
    /// yoksa bos sayfa.
    pub fn similar_images(&self, asset_id: i64, opts: &ListOpts) -> Result<AssetPage, DbError> {
        let global_id = asset_id * IMAGE_REGION_STRIDE; // region 0 = global
        let blob: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT embedding FROM asset_image_region_vectors WHERE id = ?1",
                params![global_id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(blob) = blob else {
            return Ok(AssetPage { total: 0, items: Vec::new() });
        };
        self.image_knn(&blob, opts, Some(asset_id))
    }

    /// Ortak BOLGE-MAX kNN + FILTER_FRAG hidratlama (image_search + similar_images paylasir;
    /// semantic.rs `semantic_search` ile ayni 3-adim desen + region-cozumu). kNN bolge tablosunda
    /// calisir; her asset icin EN YAKIN bolge (min mesafe) alinir (BOLGE-MAX distance uzayinda).
    /// `exclude_asset`: similar_images'ta sorgu asset'inin KENDISINI (TUM bolgelerini) eler.
    fn image_knn(
        &self,
        qblob: &[u8],
        opts: &ListOpts,
        exclude_asset: Option<i64>,
    ) -> Result<AssetPage, DbError> {
        let k = clamp_k(opts.page_size);
        let regions = IMAGE_REGION_COUNT as i64;
        // exclude varsa +1 asset (kendisi elenecek → k sonuç garanti); asset basina 5 bolge → 5x.
        let extra = i64::from(exclude_asset.is_some());
        let fetch = ((k + extra) * FETCH_MULT * regions).min(FETCH_CAP * regions);

        // 1) kNN bolge-adaylari (mesafe artan). id = asset_id*STRIDE + region.
        let mut knn = self.conn.prepare(&format!(
            "SELECT id, distance FROM asset_image_region_vectors
             WHERE embedding MATCH ?1 ORDER BY distance LIMIT {fetch}"
        ))?;
        let cand: Vec<(i64, f64)> = knn
            .query_map(params![qblob], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if cand.is_empty() {
            return Ok(AssetPage { total: 0, items: Vec::new() });
        }

        // 2) Bolge-id → asset (id/STRIDE); asset basina EN YAKIN bolge = kNN mesafe-artan geldigi
        //    icin ILK gorulen. `order` boylece asset'leri en-yakin-bolge mesafesine gore ARTAN tutar
        //    (BOLGE-MAX distance uzayinda). exclude_asset'in TUM bolgeleri atlanir.
        let mut seen: HashMap<i64, ()> = HashMap::new();
        let mut order: Vec<i64> = Vec::new();
        for (id, _dist) in &cand {
            let asset = id / IMAGE_REGION_STRIDE;
            if Some(asset) == exclude_asset {
                continue;
            }
            if seen.insert(asset, ()).is_none() {
                order.push(asset);
            }
        }
        if order.is_empty() {
            return Ok(AssetPage { total: 0, items: Vec::new() });
        }

        // 3) Filtreyle hidratla (semantic_search ile birebir: id IN inline + adli filtre).
        let id_list = order.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
        let binds = FilterBinds::new(opts);
        let common = binds.params();
        let sql = format!(
            "SELECT {COLS_A}, {FAV_A}, NULL, {AI_A}, {AI_GORSEL_TURU_EXPR}, {DOMINANT_COLORS_EXPR} FROM assets a
             WHERE a.id IN ({id_list}) AND {FILTER_FRAG}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut by_id: HashMap<i64, AssetRow> = HashMap::new();
        let rows = stmt.query_map(common.as_slice(), map_asset_row)?;
        for row in rows {
            let row = row?;
            by_id.insert(row.id, row);
        }

        // 4) En-yakin-bolge sirasinda hayatta kalanlari ilk k al.
        let mut items = Vec::with_capacity(k as usize);
        for asset in &order {
            if let Some(row) = by_id.remove(asset) {
                items.push(row);
                if items.len() >= k as usize {
                    break;
                }
            }
        }
        let total = items.len() as i64;
        Ok(AssetPage { total, items })
    }
}
