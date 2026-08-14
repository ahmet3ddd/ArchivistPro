//! Cihaz-uretimi dosya-adi pattern'leri (H2 `PHOTO_FILENAME_PATTERNS`, satir 227) — regexsiz,
//! elle bayt-tarama. IMG_0001 · DSC_0001 · DSCF/DSCN · PXL_ · DJI_ · GOPR/GX · Pxxxx · MVIMG_ ·
//! PANO · BURST · SELFIE · 20240515_133045 · ISO timestamp · epoch-ms. `s` = kucuk-harf, uzantisiz
//! dosya adi. Herhangi biri uyarsa → yuksek-olasilik Fotograf.

#[inline]
fn is_sep(b: u8) -> bool {
    b == b'-' || b == b'_'
}

/// `from`'dan itibaren ardisik ASCII rakam sayisi.
fn digit_run(b: &[u8], from: usize) -> usize {
    let mut n = 0;
    while from + n < b.len() && b[from + n].is_ascii_digit() {
        n += 1;
    }
    n
}

/// `from`'dan itibaren ardisik ASCII kucuk-harf sayisi.
fn lower_run(b: &[u8], from: usize) -> usize {
    let mut n = 0;
    while from + n < b.len() && b[from + n].is_ascii_lowercase() {
        n += 1;
    }
    n
}

fn starts(b: &[u8], p: &[u8]) -> bool {
    b.len() >= p.len() && &b[..p.len()] == p
}

/// Cihaz uretimi dosya adi mi? H2'nin 20 regex pattern'inin birebir karsiligi.
pub(super) fn matches_photo_filename(s: &str) -> bool {
    let b = s.as_bytes();
    // img[-_]\d{4,}  (IMG_20240515_133045 / IMG-20240515-WA0001 dahil: hepsi bu on-eke uyar)
    if starts(b, b"img") && b.len() > 3 && is_sep(b[3]) && digit_run(b, 4) >= 4 {
        return true;
    }
    // dsc[-_]?\d{4,}
    if starts(b, b"dsc") {
        let i = if b.len() > 3 && is_sep(b[3]) { 4 } else { 3 };
        if digit_run(b, i) >= 4 {
            return true;
        }
    }
    // dscf\d{4,} / dscn\d{4,}
    if (starts(b, b"dscf") || starts(b, b"dscn")) && digit_run(b, 4) >= 4 {
        return true;
    }
    // pxl[-_]\d{8}[-_]\d{6}
    if starts(b, b"pxl") && b.len() > 3 && is_sep(b[3]) {
        let d1 = digit_run(b, 4);
        if d1 == 8 && 4 + d1 < b.len() && is_sep(b[4 + d1]) && digit_run(b, 5 + d1) >= 6 {
            return true;
        }
    }
    // dji[-_]\d{4,}
    if starts(b, b"dji") && b.len() > 3 && is_sep(b[3]) && digit_run(b, 4) >= 4 {
        return true;
    }
    // gopr\d{4,}
    if starts(b, b"gopr") && digit_run(b, 4) >= 4 {
        return true;
    }
    // gx?\d{6,}   (GX010001 / G0010001)
    if starts(b, b"g") {
        let i = if b.len() > 1 && b[1] == b'x' { 2 } else { 1 };
        if digit_run(b, i) >= 6 {
            return true;
        }
    }
    // p\d{7,}
    if starts(b, b"p") && digit_run(b, 1) >= 7 {
        return true;
    }
    // p[a-z]{2,4}\d{4,}   (PANO0001, PMNG... — H2 pattern 9)
    if starts(b, b"p") {
        let la = lower_run(b, 1);
        if (2..=4).contains(&la) && digit_run(b, 1 + la) >= 4 {
            return true;
        }
    }
    // mvimg[-_]\d{8}
    if starts(b, b"mvimg") && b.len() > 5 && is_sep(b[5]) && digit_run(b, 6) >= 8 {
        return true;
    }
    // pano[-_]?\d{4,}
    if starts(b, b"pano") {
        let i = if b.len() > 4 && is_sep(b[4]) { 5 } else { 4 };
        if digit_run(b, i) >= 4 {
            return true;
        }
    }
    // burst\d+
    if starts(b, b"burst") && digit_run(b, 5) >= 1 {
        return true;
    }
    // selfie...
    if starts(b, b"selfie") {
        return true;
    }
    // \d{8}[-_]\d{6}   (20240515_133045)
    {
        let d1 = digit_run(b, 0);
        if d1 == 8 && d1 < b.len() && is_sep(b[d1]) && digit_run(b, d1 + 1) >= 6 {
            return true;
        }
    }
    // \d{4}-\d{2}-\d{2}[-_t]\d{2}[-:]?\d{2}   (ISO 2024-05-15T13:30)
    if iso_timestamp(b) {
        return true;
    }
    // \d{13,}   (epoch-ms)
    if digit_run(b, 0) >= 13 {
        return true;
    }
    false
}

/// `^\d{4}-\d{2}-\d{2}[-_t]\d{2}[-:]?\d{2}` — ISO timestamp on-eki.
fn iso_timestamp(b: &[u8]) -> bool {
    let take = |i: usize, n: usize| digit_run(b, i) >= n && i + n <= b.len();
    if !take(0, 4) || b.get(4) != Some(&b'-') || !take(5, 2) || b.get(7) != Some(&b'-') || !take(8, 2)
    {
        return false;
    }
    match b.get(10) {
        Some(&c) if c == b'-' || c == b'_' || c == b't' => {}
        _ => return false,
    }
    if !take(11, 2) {
        return false;
    }
    let i = if matches!(b.get(13), Some(&b'-') | Some(&b':')) { 14 } else { 13 };
    digit_run(b, i) >= 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_device_names() {
        for name in [
            "img_0001", "img-1234", "img_20240515_133045", "img-20240515-wa0001", "dsc_0001",
            "dsc0001", "dscf1234", "dscn0007", "pxl_20240515_133045", "dji_0042", "gopr1234",
            "gx010001", "g0010001", "p1234567", "pano0001", "burst0001", "selfie", "20240515_133045",
            "1715772645123", "2024-05-15t13:30",
        ] {
            assert!(matches_photo_filename(name), "cihaz adi olmali: {name}");
        }
    }

    #[test]
    fn rejects_non_device_names() {
        for name in ["kat_plani", "render_final", "img_12", "vray_test", "cephe", "gx0001"] {
            assert!(!matches_photo_filename(name), "cihaz adi OLMAMALI: {name}");
        }
    }
}
