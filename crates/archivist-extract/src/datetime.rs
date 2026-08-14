//! Tarih yardimcilari — Unix saniyesi → RFC 3339 (UTC). chrono'suz, sifir bagimlilik.
//!
//! Office (FILETIME) ve DWG (Julian) cikaricilari ortak kullanir. Howard Hinnant
//! civil-date algoritmasi (negatif gunler dahil dogru).

/// Unix saniyesi (epoch 1970-01-01) → `YYYY-MM-DDTHH:MM:SS+00:00`.
pub fn unix_to_rfc3339(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}+00:00")
}

/// Gun sayisindan (1970-01-01 = 0) takvim tarihine — Howard Hinnant.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_and_known() {
        assert!(unix_to_rfc3339(0).starts_with("1970-01-01T00:00:00"));
        assert!(unix_to_rfc3339(43_200).contains("12:00:00")); // ogle
        assert!(unix_to_rfc3339(1_704_067_200).starts_with("2024-01-01"));
    }
}
