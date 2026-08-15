// IPC alan modulu: AI sohbet/vision — Ollama kesif/durum/yapilandirma, RAG sohbet
// (token-token akis) ve AI gorsel-analiz (vision pipeline).
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { ListOpts } from "./assets";

/** AI vision-analiz KAPSAMI (sunucu `AnalysisScopeDto`; serde tagged enum, tag = `kind`, camelCase).
 *  Frontend NE'yi analiz edecegini bununla belirtir → olcek icin blanket'ten kacinma:
 *  - `{ kind: "all" }`                    → tum uygun (thumbnail'li, analiz-bekleyen) asset'ler (pahali).
 *  - `{ kind: "ids", ids }`               → yalniz secili asset id'leri (BatchToolbar grid secimi; bos → hic).
 *  - `{ kind: "filter", filter }`         → aktif facet filtresine uyanlar (`buildListOpts` CIKTISI —
 *    ListOpts snake_case; FTS `query`/sayfalama alanlari backend'ce YOK SAYILIR, zararsiz). */
export type AnalysisScope =
  | { kind: "all" }
  | { kind: "ids"; ids: number[] }
  | { kind: "filter"; filter: ListOpts };

/** AI gorsel-analiz durumu (vision pipeline; sunucu `ImageAnalysisStatusDto`, camelCase).
 *  `analyzed` AI-betimi olan asset, `pending` thumbnail'i olup analiz edilmemis, `embedReady`
 *  MiniLM (re-chunk) modeli hazir mi. Vision model varligi AYRI (`ollamaVisionModels`). */
export interface ImageAnalysisStatus {
  analyzed: number;
  pending: number;
  /** Bekleyenlerin `smallFileBytes` altinda kalan kismi — ikon/logo/doku/ekran goruntusu olma
   *  ihtimali yuksek dosyalar. GORUNURLUK icin; hicbir sey elenmez, kosuyu kullanici planlar. */
  pendingSmall: number;
  /** `pendingSmall` esigi (bayt). Metin sunucudan gelir → esik degisirse ekran kendiliginden uyar. */
  smallFileBytes: number;
  total: number;
  /** **Denendi, sonuc alinamadi**: cop-korumasinin eledigi ve `ai_attempt_failed` ile isaretlenen
   *  asset sayisi. `pending`in ALT KUMESI (bu varliklar hala bekleyendir) → `total`a EKLENMEZ.
   *  Sidebar'daki dorduncu AI-durum satirinin sayisi budur. */
  attemptFailed: number;
  embedReady: boolean;
  active: boolean;
  progress: ImageAnalysisProgress | null;
}

/** Gorsel-analiz canli ilerlemesi (Channel; embed/rag ile ayni sekil). */
export interface ImageAnalysisProgress {
  processed: number;
  total: number;
  currentPath: string;
}

/** Gorsel-analiz raporu (`runImageAnalysis` sonucu). */
export interface ImageAnalysisReport {
  analyzed: number;
  failed: number;
  elapsedMs: number;
  /** İlk basarisizligin nedeni (`dosya: hata`); failed>0 ise UI gosterir (sessiz takilma yerine). */
  sampleError?: string | null;
  /** Kullanici "Durdur" ile mi bitti (iptal). true → kalan is bekleyen kalir (resumable; tekrar
   *  kosulunca kaldigi yerden). false → kapsam tumuyle tarandi (dogal bitis). */
  stopped: boolean;
  /** İlk basarisizligin KARARLI sinif kodu — UI bunu i18n ile ANLASILIR bir cumleye cevirir
   *  (`sampleError` ham teknik detay olarak kalir). Bilinmeyen kod → `other` metnine duser. */
  errorKind?: VisionErrorKind | string | null;
  /** Devre kesici: ard arda bu kadar hata olunca kosu KENDILIGINDEN durduysa dolu. `null`/yok →
   *  devre kesici devreye girmedi. */
  abortedAfterConsecutiveFailures?: number | null;
  /** `failed` icinden cop-korumasinin eledigi (`unusable_output`) sayisi: model yanit verdi ama
   *  sonuc kullanilamadi → dosya YAZILMADI, bekleyen kaldi ve `ai_attempt_failed` ile isaretlendi.
   *  Rapor cumlesi bunu "kaydedilenler"le oranlar; diger hatalar (servis/surucu/yazma) girmez. */
  unusable?: number | null;
  /** Kosuda kullanilan modelin OLCULMUS kalite sinifi — tavsiye buna gore secilir (kanitlanmis
   *  modelde "daha yetenekli model secin" demek yanlis yonlendirmedir). */
  modelQuality?: "proven" | "untested" | "unusable" | string | null;
  /** Kosuda kullanilan model etiketi (rapor cumlesinde gecer). */
  model?: string | null;
}

/** `ImageAnalysisReport.errorKind` icin bilinen siniflar (sunucu `vision::classify_vision_error`
 *  ile BIREBIR). Her birinin `vision_index.error.<kod>` i18n karsiligi vardir. */
export type VisionErrorKind =
  | "gpu_driver"
  | "timeout"
  | "ollama_down"
  | "context_overflow"
  | "model_missing"
  | "out_of_memory"
  | "unusable_output"
  | "write_failed"
  | "other";

/** AI (Ollama) durum ozeti (AI ayar paneli; sunucu `AiStatusDto`, camelCase). `ollamaUp` Ollama
 *  erisilebilir mi; `chatModels`/`visionModels` yuklu modeller (model seciciler + durum). */
export type OllamaState = "running" | "stopped" | "not_installed" | "unreachable";

export interface AiStatus {
  ollamaUp: boolean;
  /** Kapaliysa nedenini ayirir; uzak endpoint asla `not_installed` olmaz. */
  ollamaState: OllamaState;
  /** Yalniz yerel, kurulu ama kapali Ollama hizmetinde true olur. */
  canStartOllama: boolean;
  chatModels: string[];
  visionModels: string[];
}

/** Mevcut analizlerin tek bir MODEL icin kirilimi. `model` bos → `ai_model` yazilmamis eski kayit.
 *  `quality` modelin OLCULMUS kalite sinifi (secim motoruyla ayni tablo). */
export interface AnalysisModelRow {
  model: string;
  total: number;
  unusable: number;
  quality: "proven" | "untested" | "unusable";
}

/** Cop-korumasi ONCESINDE yazilmis, bugunku esigi gecemeyen analizlerin onizlemesi (salt-okuma).
 *  `count` sifirlanmaya aday sayisi, `analyzedTotal` toplam analizli varlik (oran gostermek icin).
 *  `byModel` her ofisin KENDI tablosu (tek bir makinede olusmus sayiya guvenmek gerekmesin).
 *  `suspectButKept` bicim esigini GECEN ama olculmus-kotu modelle yazilmis kayitlar — sifirlama
 *  bunlara dokunmaz, ama gorunur olmalilar (kor nokta). */
export interface UnusableAnalyses {
  count: number;
  analyzedTotal: number;
  byModel: AnalysisModelRow[];
  suspectButKept: number;
}

/** `resetUnusableAnalyses` raporu. `sampleError` ilk hatanin ham metni (teshis; katlanabilir detay). */
export interface ResetAnalysesReport {
  reset: number;
  failed: number;
  sampleError: string | null;
}

/** Onerilen vision modeli (sunucu `VisionRecommendationDto`, camelCase). Makine-yerel: her lokasyon
 *  kendi GPU'suna gore. Secim olcutu once OLCULMUS cikti kalitesi, sonra VRAM'e sigma.
 *  `gpuName`/`vramMb` null → NVIDIA GPU yok (CPU); `recommended` null → yuklu vision modeli yok.
 *  Salt-oneri (hicbir sey kaydetmez). */
export interface VisionRecommendation {
  gpuName: string | null;
  vramMb: number | null;
  recommended: string | null;
  /** Onerilen modelin OLCULMUS cikti kalitesi. `unusable` → yuklu modellerin hicbiri kullanilabilir
   *  analiz uretmiyor (secim en az kotusunu verdi) → UI uyarir. `recommended` null ise null. */
  quality: "proven" | "untested" | "unusable" | null;
  /** `quality === "unusable"` iken onerilen model etiketi (`ollama pull <bu>`); aksi halde null. */
  suggestedPull: string | null;
}

/** Etkin Ollama adresinin kaynagi (`ollama_config.source`) — okunur etikete cevrilir (UI).
 *  `env` uygulama ortam-degiskeni · `setting` kullanicinin kalici ayari · `ollama_host` ham
 *  OLLAMA_HOST env · `default` yerlesik varsayilan. */
export type OllamaSource = "env" | "setting" | "ollama_host" | "default";

/** Etkin Ollama adres yapilandirmasi (sunucu `ollama_config`; camelCase). `base` = cozulmus etkin
 *  adres (istemci BURAYA gider) · `source` = nereden geldi · `setting` = kullanicinin kalici ayari
 *  (null → oto-cozum) · `ollamaHostEnv` = ham OLLAMA_HOST env (gosterim/ipucu; null yoksa). */
export interface OllamaConfig {
  base: string;
  source: OllamaSource;
  setting: string | null;
  ollamaHostEnv: string | null;
}

/** Oto-tespitte yoklanan tek bir aday Ollama adresi (sunucu `detect_ollama` ici; camelCase).
 *  `reachable` = erisildi mi · `modelCount` = o adreste bulunan model sayisi (erisilemezse 0). */
export interface OllamaCandidate {
  base: string;
  reachable: boolean;
  modelCount: number;
}

/** Ollama oto-tespit sonucu (`detect_ollama`; camelCase). `best` = erisilen ILK adres (yoksa null) ·
 *  `candidates` = yoklanan tum adaylar (durum + model sayisi). Ag cagrisi (birkac sn surebilir). */
export interface OllamaDetect {
  best: string | null;
  candidates: OllamaCandidate[];
}

/** Sohbet gecmisi mesaji (frontend → prompt baglami). */
export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** RAG sohbet zenginlestirme secenekleri (sunucu `RagOptions`, camelCase). Varsayilan kapali;
 *  Ollama gerektirenler Ollama yoksa backend'de sessizce atlanir (graceful). */
export interface RagChatOptions {
  rerank: boolean;
  queryRewrite: boolean;
  /** Hassasiyet oto-tespiti (A1): etkin kategoriler/kelimeler eslesen dosyalar sohbette gizlenir. */
  sensitivityEnabled: boolean;
  /** Etkin kategoriler (financial/personal/legal/hr) — sunucu kelime listesine cevirir. */
  sensitivityCategories: string[];
  /** Kullanici-tanimli ek hassasiyet kelimeleri. */
  sensitivityKeywords: string[];
}

/** Bir kaynak atifi (citation) — tiklanabilir kaynak karti (sunucu `CitationDto`). */
export interface Citation {
  index: number;
  assetId: number;
  fileName: string;
  path: string;
  page: number | null;
  snippet: string;
}

/** Retrieval tani (A5; sunucu `RetrieveDiag`, camelCase) — sorgu neden bu/bos sonuc verdi.
 *  `queryTokens` aranan anlamli kelimeler, `expandedTokens` mimari sozluk eki, `ftsCandidates`/
 *  `knnCandidates` aday, `gated` keyword-gate gecen, `fused` benzersiz aday, `returned` donen. */
export interface RetrieveDiag {
  queryTokens: string[];
  expandedTokens: number;
  ftsCandidates: number;
  knnCandidates: number;
  gated: number;
  fused: number;
  returned: number;
}

/** RAG sohbet cevabi (`rag_chat` sonucu). `kind`: greeting | list | rag | empty. */
export interface RagAnswer {
  answer: string;
  citations: Citation[];
  model: string;
  kind: string;
  retrievedChunks: number;
  elapsedMs: number;
  /** Retrieval tani (A5) — UI gozlem paneli. Greeting/bos-sorgu yolunda sifir-deger. */
  diagnostics: RetrieveDiag;
}

/** Kurulum kontrolunde tek bir satirin sonucu. `status`: `ok` | `warn` | `fail`;
 *  `code` i18n anahtarina cevrilir (`setup_check.<code>`) — metin backend'de KODLANMAZ. */
export interface SetupCheckRow {
  id: "gpu" | "ollama" | "vision_model" | "embed";
  status: "ok" | "warn" | "fail";
  code: string;
}

/** "Bu bilgisayar gorsel analize hazir mi" on-kontrolu (`setup_check`). Model CALISTIRMAZ.
 *  `driverVersion` bilerek YARGILANMAZ — gosterilir; hangi surucunun "eski" oldugu Ollama
 *  derlemesine gore degisir, sabit esik yanlis alarm uretirdi. */
export interface SetupCheck {
  overall: "ok" | "warn" | "fail";
  rows: SetupCheckRow[];
  gpuName: string | null;
  vramMb: number | null;
  driverVersion: string | null;
  gpuError: string | null;
  ollamaBase: string;
  visionModelCount: number;
  visionModel: string | null;
  visionQuality: string | null;
  suggestedPull: string | null;
  pendingImages: number;
}

/** Denemedeki TEK bir gorselin sonucu. `sample` basarisizlikta da dolu olur — modelin ne dedigini
 *  (reddetme mi, sacmalama mi) yalniz insan ayirt edebilir. */
export interface VisionTrialAttempt {
  fileName: string;
  usable: boolean;
  elapsedMs: number;
  fieldCount: number;
  errorKind: string | null;
  errorDetail: string | null;
  sample: string | null;
  leanRetry: boolean;
}

/** GERCEK deneme sonucu (`vision_trial`). En cok 3 gorsel denenir, ilk BASARIDA durur — tek
 *  ornek karar vermeye yetmez (olculdu: saglikli model bir logoyu betimlemeyi REDDETTI).
 *  `usable` = en az bir deneme uretimde kabul edilebilir cikti verdi. `elapsedMs` basarili
 *  cagrinin suresi (kuyruk tahmini bundan turer). `modelQuality` UI'nin tavsiyeyi ayarlamasi
 *  icin: olculmus-saglikli model takilirsa dogru oneri "modeli degistir" DEGILDIR. */
export interface VisionTrial {
  model: string;
  modelQuality: string;
  usable: boolean;
  attempts: VisionTrialAttempt[];
  elapsedMs: number;
}

/** AI sohbet/vision/Ollama komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const aiChatIpc = {
  /** Kurulum kontrolu: kart/surucu · Ollama · vision modeli kalitesi · MiniLM. Salt-okuma, hizli
   *  (model kosturmaz). Gercek deneme icin `visionTrial`. */
  setupCheck: (): Promise<SetupCheck> => invoke<SetupCheck>("setup_check"),

  /** TEK gorseli URETIM yoluyla analiz et (admin) — tahmin degil olcum. Hicbir sey YAZMAZ (denenen
   *  gorsel bekleyen kalir). Reddetme tokenleri: `trial_busy` (kosu suruyor) · `trial_no_sample`
   *  (analiz bekleyen gorsel yok). Yavas model dakikalar surebilir. */
  visionTrial: (model: string): Promise<VisionTrial> =>
    invoke<VisionTrial>("vision_trial", { model }),

  // ── AI gorsel-analiz (vision pipeline): thumbnail → AI metin betim → birlesik arama ──
  /** Gorsel-analiz durumu (analiz edilen/bekleyen/toplam + MiniLM hazir mi). Salt-okuma. */
  imageAnalysisStatus: (): Promise<ImageAnalysisStatus> =>
    invoke<ImageAnalysisStatus>("image_analysis_status"),

  /** Ollama'da yuklu VISION modelleri (gorsel-analiz model secici). Ollama/vision yoksa reddedilir. */
  ollamaVisionModels: (): Promise<string[]> => invoke<string[]>("ollama_vision_models"),

  /** Yuklu vision modelleri arasindan en iyisini oner: once olculmus cikti kalitesi, sonra GPU
   *  (NVIDIA) VRAM'ine sigma. Salt-oneri; hicbir sey kaydetmez. Ollama yoksa reject (sessiz gecilir). */
  recommendVisionModel: (): Promise<VisionRecommendation> =>
    invoke<VisionRecommendation>("recommend_vision_model"),

  /** `scope`'a uyan (thumbnail'li, analiz-bekleyen) asset'leri AI vision ile analiz et → ai_ betim →
   *  re-chunk (admin). Canli ilerleme Channel ile (embed deseni). `model` bos → backend ayni oneri
   *  motoruyla secer (sabit varsayilana DUSMEZ).
   *  Zaten bir kosu aktifse backend `Err("gorsel analiz zaten calisiyor")` doner. Bitince rapor doner
   *  (`stopped=true` → "Durdur" ile kesildi, kalan bekliyor). */
  runImageAnalysis: (
    model: string,
    scope: AnalysisScope,
    onProgress?: (p: ImageAnalysisProgress) => void,
  ): Promise<ImageAnalysisReport> => {
    const channel = new Channel<ImageAnalysisProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<ImageAnalysisReport>("run_image_analysis", {
      model,
      scope,
      onProgress: channel,
    });
  },

  /** Aktif gorsel-analiz kosusunu durdur ("Durdur"; admin). Kosu batch/asset-arasi gorup erken cikar
   *  → kalan is bekleyen kalir (resumable). Yalniz bayrak set eder (senkron beklemez). */
  stopImageAnalysis: (): Promise<void> => invoke<void>("stop_image_analysis"),

  /** ONIZLEME (salt-okuma): kac ESKI analiz bugunku cop-korumasi esigini gecemiyor. Hicbir seyi
   *  degistirmez — kullanici once gorur, sonra sifirlamaya karar verir. */
  countUnusableAnalyses: (): Promise<UnusableAnalyses> =>
    invoke<UnusableAnalyses>("count_unusable_analyses"),

  /** Kullanilamaz eski analizleri BEKLEYENE geri al (admin). Damgayi kaldirir → calisan bir modelle
   *  yeniden analiz edilebilirler. Saglikli analizlere DOKUNMAZ. Analiz kosarken reddedilir. */
  resetUnusableAnalyses: (): Promise<ResetAnalysesReport> =>
    invoke<ResetAnalysesReport>("reset_unusable_analyses"),

  /** Bir KAPSAMDA analiz-bekleyen asset sayisi ("N görsel analiz edilecek" onizleme). Salt-okuma
   *  (rol yok). Secim kapsaminda `ids.length` yerine bunu kullan → skip/thumbnail suzgeci dogru yansir. */
  countPendingAnalysis: (scope: AnalysisScope): Promise<number> =>
    invoke<number>("count_pending_analysis", { scope }),

  // ── RAG sohbet (Artim 4-5): Ollama model kesfi + sohbet (stream) ──
  /** Ollama'da yuklu chat modelleri (oto-kesif; UI model secici). Ollama yoksa reddedilir. */
  ollamaModels: (): Promise<string[]> => invoke<string[]>("ollama_models"),

  /** AI (Ollama) durumu: erisilebilir mi + yuklu chat/vision modelleri (AI ayar paneli). Salt-okuma. */
  aiStatus: (): Promise<AiStatus> => invoke<AiStatus>("ai_status"),

  /** Yerel, kurulu ama kapali Ollama hizmetini baslat (admin). Backend yalniz loopback HTTP
   * adresine izin verir; uzak/HTTPS endpoint'lerine dokunmaz. UI ardindan aiStatus ile hazirligi yoklar. */
  startOllama: (): Promise<void> => invoke<void>("start_ollama"),

  /** Etkin Ollama adres yapilandirmasi: cozulmus adres + kaynak + kullanicinin kalici ayari + ham
   *  OLLAMA_HOST env. Salt-okuma (her rol; duzenleme admin). */
  ollamaConfig: (): Promise<OllamaConfig> => invoke<OllamaConfig>("ollama_config"),

  /** Kalici Ollama adresini ayarla. Bos/null → ayar temizlenir (oto-cozume duser). **Admin** —
   *  aksi halde backend Err atar (UI gate yalniz gorunum). invoke arg adi tam `base`. */
  setOllamaBase: (base: string | null): Promise<void> =>
    invoke<void>("set_ollama_base", { base }),

  /** Aday Ollama adreslerini yokla → erisilen ILK (best) + tum adaylar (durum + model sayisi).
   *  Ag cagrisi (birkac sn surebilir). */
  detectOllama: (): Promise<OllamaDetect> => invoke<OllamaDetect>("detect_ollama"),

  /** RAG sohbet: selamlama/liste-bypass + retrieve + (gerekirse) Ollama generate. `onToken`
   *  ile cevap token-token akar (UI canli); tam (temiz) cevap + citation doner. `options`:
   *  zenginlestirme (rerank/query-rewrite; varsayilan kapali → eski davranis). `scope`:
   *  retrieval'in NEREDE arayacagi (kapsam seçici) — `{kind:"all"}` = tum arsiv (eski davranis),
   *  `{kind:"filter", filter}` = aktif facet filtresi, `{kind:"ids", ids}` = secili asset'ler.
   *  `remote` (LAN Faz 5; varsayilan false = YEREL, regresyon yok): true → retrieval ANA ARSIV
   *  host'undan (onceden insa edilmis indeks), uretim yine ISTEMCI Ollama'sinda. citations/diag/
   *  on_token AKISI birebir AYNI. Host'ta model/indeks yoksa backend `remote_not_indexed` doner. */
  ragChat: (
    question: string,
    model: string,
    history: ChatMsg[],
    options: RagChatOptions,
    scope: AnalysisScope,
    remote: boolean,
    onToken?: (token: string) => void,
  ): Promise<RagAnswer> => {
    const channel = new Channel<string>();
    if (onToken) channel.onmessage = onToken;
    return invoke<RagAnswer>("rag_chat", {
      question,
      model,
      history,
      options,
      scope,
      remote,
      onToken: channel,
    });
  },

  /** Devam eden RAG sohbet uretimini DURDUR (uzun cevap iptali). Backend CHAT_STOP set eder →
   *  akis token'lar arasinda kesilir; `ragChat` Promise'i o ana kadarki KISMI cevapla resolve olur
   *  (hata degil) → ChatView normalce commit eder. Uretim yoksa zararsiz. */
  stopRagChat: (): Promise<void> => invoke<void>("stop_rag_chat"),
};
