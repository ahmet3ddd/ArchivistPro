//! Sohbet oturumu basligi uretimi (H2 parite kalemi §3).
//!
//! **Taban DETERMINISTIK** — `archivist_db::session_title` sorgudaki stop-word gurultusunu atip
//! geriye kalan anlamli kelimeleri baslik yapar. Ollama olmadan da calisir; H3 offline-first
//! oldugu icin taban budur (H2'de yalniz LLM yolu vardi → Ollama yoksa baslik yok).
//!
//! **Opsiyonel RAFINE** — Ollama + chat modeli varsa H2'nin `ragService.ts:2005
//! generateSessionTitle` davranisi uzerine biner (ilk soru+cevaptan 2-5 kelimelik Turkce
//! baslik). Her hata SESSIZCE tabana duser: baslik uretimi bir sohbeti asla bozmamali.

use crate::ollama;

/// H2 pariti: kisa uretim (baslik birkac kelime), dusuk sicaklik (tutarli).
const NUM_PREDICT: i64 = 24;
/// H2 30sn kullaniyordu; H3'te baslik ARKA PLANDA rafine oldugu icin daha kisa tutuldu —
/// kullanici zaten deterministik basligi gormus durumda, uzun bekleme degersiz.
const TIMEOUT_SECS: u64 = 20;
/// Cevabin prompt'a giren kismi (H2: 400 karakter + elips).
const MAX_ANSWER_CHARS: usize = 400;
/// Baslik ust siniri (H2 ile ayni) — oturum listesi kirilmasin.
const MAX_TITLE_CHARS: usize = 60;

/// Ilk soru+cevaptan LLM ile kisa Turkce baslik. Ollama erisilemezse / model bos cevap
/// verirse `None` → cagiran deterministik tabani korur.
pub(super) fn llm_title(model: &str, query: &str, answer: &str) -> Option<String> {
    let snippet: String = if answer.chars().count() > MAX_ANSWER_CHARS {
        answer.chars().take(MAX_ANSWER_CHARS).collect::<String>() + "…"
    } else {
        answer.to_string()
    };
    let prompt = format!(
        "/no_think\nAşağıdaki soru ve cevaba göre 2-5 kelimelik, Türkçe, kısa ve açıklayıcı bir \
         SOHBET BAŞLIĞI üret. Sadece başlığı yaz — tırnak, açıklama, emoji, sonda noktalama yok.\
         \n\nSORU: {query}\nCEVAP: {snippet}\n\nBAŞLIK:"
    );
    let raw = ollama::generate(model, &prompt, 0.3, NUM_PREDICT, TIMEOUT_SECS).ok()?;
    clean_llm_title(&raw)
}

/// Model ciktisini basliga indirge (H2 `generateSessionTitle` temizlik zinciri):
/// `<think>` bloklari → ilk dolu satir → bas/son tirnak-isaret kirpma → `BAŞLIK:` on-eki →
/// 60 karakter tavani. Geriye anlamli sey kalmazsa `None`.
pub(super) fn clean_llm_title(raw: &str) -> Option<String> {
    let mut text = raw.to_string();
    while let (Some(s), Some(e)) = (text.find("<think>"), text.find("</think>")) {
        if s < e {
            text.replace_range(s..e + "</think>".len(), "");
        } else {
            break;
        }
    }
    text = text.replace("/no_think", "").replace("/nothink", "");

    // Ilk DOLU satir (model bazen bos satirla baslar).
    let mut title = text.lines().map(str::trim).find(|l| !l.is_empty())?.to_string();

    title = strip_label_prefix(&title);
    title = title
        .trim_matches(|c: char| "\"'`*_-\u{2013}\u{2014} \t".contains(c))
        .trim_end_matches(|c: char| ".!?:;,".contains(c))
        .trim()
        .to_string();

    if title.is_empty() {
        return None;
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        title = title.chars().take(MAX_TITLE_CHARS).collect::<String>().trim_end().to_string() + "…";
    }
    Some(title)
}

/// Bastaki `BAŞLIK:` / `Baslik -` / `Title:` etiketini at (H2 regex'inin karsiligi). Turkce
/// buyuk/kucuk harf tuzagi nedeniyle karsilastirma `normalize_tr` uzerinden yapilir.
fn strip_label_prefix(s: &str) -> String {
    const LABELS: &[&str] = &["baslik", "title"];
    // Ayraci HAM metinde bul → ofset kaymasi olmaz (normalize_tr karakter sayisini korumak
    // ZORUNDA degil; ona guvenen aritmetik kirilgan olurdu).
    if let Some(idx) = s.find([':', '-']) {
        let (head, rest) = s.split_at(idx);
        if LABELS.contains(&archivist_db::normalize_tr(head.trim()).as_str()) {
            return rest[1..].trim().to_string();
        }
    }
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::{clean_llm_title, strip_label_prefix};

    #[test]
    fn strips_think_block_and_quotes() {
        assert_eq!(
            clean_llm_title("<think>kısa olsun</think>\n\"Yalıtım Şartnamesi\""),
            Some("Yalıtım Şartnamesi".to_string())
        );
    }

    #[test]
    fn strips_label_prefix_and_trailing_punctuation() {
        assert_eq!(strip_label_prefix("BAŞLIK: Cephe Detayı"), "Cephe Detayı");
        assert_eq!(strip_label_prefix("Başlık - Kolon Planı"), "Kolon Planı");
        assert_eq!(strip_label_prefix("Cephe Detayı"), "Cephe Detayı", "etiket yoksa dokunma");
        assert_eq!(clean_llm_title("Başlık: Merdiven Korkuluğu."), Some("Merdiven Korkuluğu".to_string()));
    }

    #[test]
    fn takes_first_non_empty_line_only() {
        assert_eq!(
            clean_llm_title("\n\nZemin Kat Planı\nAçıklama: bu başlık...").as_deref(),
            Some("Zemin Kat Planı")
        );
    }

    #[test]
    fn none_when_model_returns_nothing_usable() {
        assert_eq!(clean_llm_title(""), None);
        assert_eq!(clean_llm_title("<think>sadece düşünce</think>"), None);
        assert_eq!(clean_llm_title("\"\""), None);
    }

    #[test]
    fn caps_overlong_titles() {
        let long = "a".repeat(120);
        let out = clean_llm_title(&long).unwrap();
        assert!(out.chars().count() <= 61, "60 + elips: {}", out.chars().count());
        assert!(out.ends_with('…'));
    }
}
