//! Yedekleme — DB snapshot (yedek al) + restore (geri yukle). H2 pariti §O "DB snapshot".
//!
//! H3 mimarisi yedeklemeyi YAPISAL olarak basitlestirir (RATIONALE §3): arsiv **tek native
//! dosya** (assets + metadata + FTS + vektorler ayni DB icinde). H2'de veri sql.js heap'i +
//! cift-DB jonglorluguydu; orada tutarli snapshot zordu. Burada:
//!
//! - **backup_to:** SQLite **online backup API** (rusqlite `Connection::backup`) ile canli
//!   baglantidan `dst` dosyasina sayfa-duzeyinde TUTARLI kopya. WAL-guvenli (acik islemler/
//!   WAL kareleri dogru ele alinir; elle checkpoint GEREKMEZ). vec0 golge tablolari da kopyalanir.
//! - **restore_from:** online backup API (`Connection::restore`) ile `src` snapshot'tan CANLI
//!   baglantiya geri yukleme (uzerine yazar; uygulama yeniden baslatma GEREKMEZ). Ardindan
//!   `migrations::run` → eski sema versiyonlu bir snapshot ileri-tasinir (idempotent/ileri-yonlu).
//!   **GERI-ALINAMAZ** (mevcut arsivin uzerine yazar) → komut katmani ADMIN + onay ister.
//!
//! Not: sqlite-vec process-geneli auto-extension (connection.rs) → backup/restore'un actigi
//! ic baglantilar da vec0 modulunu gorur; online backup zaten sayfa-duzeyi (vtable yorumlamaz).

use std::path::Path;

use rusqlite::backup::Progress;
use rusqlite::DatabaseName;

use crate::error::DbError;
use crate::Db;

impl Db {
    /// Canli DB'yi `dst` dosyasina yedekle (online backup API → tutarli, WAL-guvenli).
    /// `dst` yoksa olusturulur; varsa uzerine yazilir. Cagiran (komut) benzersiz/zaman-damgali
    /// bir ad verir → kaza eseri ustune yazma olmaz.
    pub fn backup_to(&self, dst: &Path) -> Result<(), DbError> {
        // Progress callback yok (None) — yedek senkron + tek seferlik; ilerleme gerekmez.
        self.conn.backup(DatabaseName::Main, dst, None)?;
        Ok(())
    }

    /// `src` snapshot'tan canli baglantiya geri yukle (UZERINE YAZAR) + migration'lari uygula.
    /// **GERI-ALINAMAZ** (mevcut arsiv kaybolur). `src` gecerli bir SQLite yedegi olmali.
    /// Restore sonrasi sema eski olabilir → `migrations::run` ileri-tasir (forward-only).
    pub fn restore_from(&mut self, src: &Path) -> Result<(), DbError> {
        // None::<fn(Progress)> — restore'un FnMut tip parametresine somut tip ver (ilerleme yok).
        self.conn
            .restore(DatabaseName::Main, src, None::<fn(Progress)>)?;
        crate::migrations::run(&mut self.conn)?;
        Ok(())
    }
}
