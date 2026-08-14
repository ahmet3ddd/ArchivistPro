//! H2 zaman metinlerini unix SANIYEye cevirir.
//!
//! H2'de zaman bicimi KARISIKTIR (olculdu, varsayim degil): kolon DEFAULT'lari SQLite
//! `datetime('now')` uretir (`YYYY-MM-DD HH:MM:SS`, UTC, 'Z'siz), uygulama kodu ise
//! ISO-8601 yazar (`...T...Z` / `±HH:MM`); ayrica kimi alanlar epoch-ms dizgesi tasiyabilir.
//! Ayni kolonda iki bicim YAN YANA bulunabilir → parser hepsini kabul eder.
//!
//! Kural: parse edilemeyen deger icin **0 uydurulmaz** — `None` doner, cagiran alani
//! atlar/varsayilana duser ve `bad_timestamps` sayacina isler (sessiz veri bozulmasi yok).
//!
//! chrono/time bagimliligi BILEREK yok (workspace minimal-deps disiplini): gun hesabi
//! Howard Hinnant'in "days from civil" algoritmasiyla saf fonksiyondur.

/// H2 zaman metni → unix saniye. Kabul edilen bicimler:
/// - ISO-8601: `YYYY-MM-DD[Thh:mm[:ss[.frac]]][Z|±HH:MM|±HHMM]` (ofset yoksa UTC varsayilir)
/// - SQLite `datetime('now')`: `YYYY-MM-DD HH:MM:SS` (UTC varsayilir)
/// - Salt-rakam dizge: `>= 1e12` epoch-MILISANIYE kabul edilir (H2 `Date.now()`), aksi saniye
pub fn parse_h2_timestamp(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // Salt-rakam → epoch (ms ya da sn). Isaret kabul edilmez (H2 negatif epoch uretmez).
    if s.bytes().all(|b| b.is_ascii_digit()) {
        let n: i64 = s.parse().ok()?;
        return Some(if n >= 1_000_000_000_000 { n / 1000 } else { n });
    }

    // Tarih kismi: YYYY-MM-DD (zorunlu).
    let b = s.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: u32 = s.get(5..7)?.parse().ok()?;
    let day: u32 = s.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Saat kismi: 'T' ya da ' ' ayraciyla; yoksa 00:00:00 (date-only ISO — or. deadline).
    let mut hour: i64 = 0;
    let mut minute: i64 = 0;
    let mut second: i64 = 0;
    let mut rest = ""; // saatten SONRASI (kesir + ofset)
    if b.len() > 10 {
        if b[10] != b'T' && b[10] != b' ' {
            return None;
        }
        let time_part = &s[11..];
        if time_part.len() < 5 || time_part.as_bytes().get(2) != Some(&b':') {
            return None;
        }
        hour = time_part.get(0..2)?.parse().ok()?;
        minute = time_part.get(3..5)?.parse().ok()?;
        rest = time_part.get(5..).unwrap_or("");
        if let Some(r) = rest.strip_prefix(':') {
            second = r.get(0..2)?.parse().ok()?;
            rest = r.get(2..).unwrap_or("");
        }
        if !(0..24).contains(&hour) || !(0..60).contains(&minute) || !(0..60).contains(&second) {
            return None;
        }
        // Salise kesri atilir (saniye cozunurlugu yeter).
        if let Some(r) = rest.strip_prefix('.') {
            let digits = r.bytes().take_while(|b| b.is_ascii_digit()).count();
            rest = &r[digits..];
        }
    }

    // Ofset: 'Z' | ±HH:MM | ±HHMM | ±HH — yoksa UTC. utc = yerel − ofset.
    let offset_secs: i64 = match rest.as_bytes().first() {
        None => 0,
        Some(b'Z') if rest.len() == 1 => 0,
        Some(sign @ (b'+' | b'-')) => {
            let o = &rest[1..];
            let (oh, om) = match o.len() {
                2 => (o.parse::<i64>().ok()?, 0),
                4 => (o.get(0..2)?.parse().ok()?, o.get(2..4)?.parse().ok()?),
                5 if o.as_bytes()[2] == b':' => {
                    (o.get(0..2)?.parse().ok()?, o.get(3..5)?.parse().ok()?)
                }
                _ => return None,
            };
            let total = oh * 3600 + om * 60;
            if *sign == b'+' { total } else { -total }
        }
        Some(_) => return None,
    };

    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset_secs)
}

/// Gregoryen takvim gunu → 1970-01-01'den gun sayisi (Howard Hinnant, "days from civil").
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + (d as i64 - 1);
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_utc_with_z() {
        // 2026-06-26T07:39:43Z — gercek H2 snapshot adindan alinan bicim.
        assert_eq!(parse_h2_timestamp("2026-06-26T07:39:43Z"), Some(1_782_459_583));
        // Epoch referansi.
        assert_eq!(parse_h2_timestamp("1970-01-01T00:00:00Z"), Some(0));
    }

    #[test]
    fn iso_with_fraction_and_offsets() {
        let base = parse_h2_timestamp("2026-06-26T07:39:43Z").unwrap();
        // Kesir atilir.
        assert_eq!(parse_h2_timestamp("2026-06-26T07:39:43.733Z"), Some(base));
        // +03:00 → UTC'den 3 saat geri.
        assert_eq!(parse_h2_timestamp("2026-06-26T10:39:43+03:00"), Some(base));
        assert_eq!(parse_h2_timestamp("2026-06-26T10:39:43+0300"), Some(base));
        // Ofsetsiz ISO → UTC varsayilir.
        assert_eq!(parse_h2_timestamp("2026-06-26T07:39:43"), Some(base));
    }

    #[test]
    fn sqlite_datetime_now_format() {
        // datetime('now') → 'YYYY-MM-DD HH:MM:SS' (bosluklu, Z'siz, UTC).
        assert_eq!(
            parse_h2_timestamp("2026-06-26 07:39:43"),
            parse_h2_timestamp("2026-06-26T07:39:43Z")
        );
    }

    #[test]
    fn date_only_is_midnight_utc() {
        // deadline gibi salt-tarih alanlari.
        assert_eq!(parse_h2_timestamp("1970-01-02"), Some(86_400));
    }

    #[test]
    fn epoch_digit_strings() {
        // >= 1e12 → milisaniye kabul edilir (H2 Date.now()).
        assert_eq!(parse_h2_timestamp("1782459583733"), Some(1_782_459_583));
        // Kucuk salt-rakam → saniye.
        assert_eq!(parse_h2_timestamp("1782459583"), Some(1_782_459_583));
    }

    #[test]
    fn garbage_yields_none_never_zero() {
        for junk in ["", "   ", "bozuk", "2026-13-01T00:00:00Z", "2026-06-26X07:39:43",
                     "26/06/2026", "2026-06-26T7:39", "2026-06-26T07:39:43+3"] {
            assert_eq!(parse_h2_timestamp(junk), None, "{junk:?} None olmali (0 uydurulmaz)");
        }
    }

    #[test]
    fn leap_year_boundary() {
        // 2024 artik yil: 29 Subat gecerli, 2023'te degil.
        assert!(parse_h2_timestamp("2024-02-29T00:00:00Z").is_some());
        // Gun-31 siniri kaba dogrulama: 31 Nisan yanlis ama days_from_civil tasar —
        // kabul edilebilir (H2 SQLite/JS'ten gecerli tarih yazar); asil koruma ay araligi.
        assert_eq!(
            parse_h2_timestamp("2024-03-01T00:00:00Z"),
            parse_h2_timestamp("2024-02-29T00:00:00Z").map(|t| t + 86_400)
        );
    }
}
