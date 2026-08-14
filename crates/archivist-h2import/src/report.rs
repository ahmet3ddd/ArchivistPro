//! Rapor DTO'lari (UI'a giden — serde camelCase). Kuru kosu ile uygula AYNI sekli doldurur:
//! kullanicinin "kuru kosuda gordugum = uygulamada olan" guveni bu simetriye dayanir.

use serde::Serialize;

use crate::h2read::H2UserBrief;

/// Hata/ornek listeleri bu tavani asamaz — rapor DTO'su IPC'de sisip UI'yi bogmasin.
/// Kesilen adet `dropped_errors`ta gorunur (kesik liste tam sanilmasin — pipeline deseni).
pub const REPORT_MAX_ENTRIES: usize = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    /// "assets" | "roots" | "collections"
    pub stage: String,
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct H2ImportReport {
    pub dry_run: bool,

    // Asset satirlari.
    pub assets_seen: usize,
    pub assets_inserted: usize,
    pub assets_existing: usize,
    pub assets_deleted_carried: usize,
    /// H2 satiri silinmisti ama H3'te AYNI yol AKTIF → H3 kazandi, cope TASINMADI.
    pub deleted_conflicts: usize,
    pub duplicate_h2_rows: usize,

    // AI.
    pub ai_written: usize,
    pub ai_skipped_existing: usize,
    /// Esik alti (tek alanli) analiz — yazilsaydi `ai_analyzed` damgasi dosyayi kalici
    /// "analizli" yapar, H3'un kendi modeli bir daha denemezdi.
    pub ai_skipped_thin: usize,
    pub drawing_type_dropped: usize,
    pub gorsel_turu_written: usize,

    // Kurasyon.
    pub tags_written: usize,
    pub favorites_written: usize,
    pub collections_created: usize,
    pub collection_items_written: usize,
    pub project_meta_written: usize,
    pub project_meta_skipped_existing: usize,

    // Kokler.
    pub roots_added: usize,
    pub roots_existing: usize,
    pub groups_created: usize,
    pub root_tags_written: usize,

    // Thumbnail.
    pub thumbnails_carried: usize,
    pub thumbnails_invalid: usize,

    // Zaman/veri kalitesi.
    pub unparsable_times: usize,

    // Tasinamayanlar (bilgi).
    pub users_not_migrated: Vec<H2UserBrief>,
    pub chat_sessions_not_migrated: i64,

    // Hatalar (kapakli liste).
    pub errors: Vec<(String, String)>,
    pub dropped_errors: usize,

    pub elapsed_ms: u64,
}

impl H2ImportReport {
    /// Kapakli hata ekleme — tavan asilirsa sayac artar, liste buyumez.
    pub(crate) fn push_error(&mut self, what: impl Into<String>, detail: impl Into<String>) {
        if self.errors.len() < REPORT_MAX_ENTRIES {
            self.errors.push((what.into(), detail.into()));
        } else {
            self.dropped_errors += 1;
        }
    }
}
