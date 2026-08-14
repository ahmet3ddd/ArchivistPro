//! GPU tespiti (NVIDIA) — vision-model oto-onerisi ve KURULUM KONTROLU icin.
//!
//! `nvidia-smi` cagrilir; yoksa/AMD/Intel/hata → GPU yok sayilir (CPU varsayilir). NVIDIA-odakli:
//! kullanicinin 3 lokasyonu da NVIDIA (1050 Ti / 3060 / 3070). Parse **saf + test edilebilir**
//! (`nvidia-smi` cagrisindan ayri). Detay tamamen makine-yerel — hicbir sey DB'ye/git'e yazilmaz.
//!
//! **Neden `probe` ayri (2026-08-09):** `detect_nvidia() -> None` UC ayri durumu tek cevaba
//! katliyordu: NVIDIA karti/surucusu YOK · `nvidia-smi` var ama hata verdi · cikti ayristirilamadi.
//! Model onerisi icin fark onemsizdi (uceunde de CPU'ya duser), ama kurulum kontrolu kullaniciya NE
//! YAPACAGINI soylemek zorunda: "kart yok, analiz cok yavas olacak" ile "surucu bozuk gorunuyor"
//! tamamen farkli eylemlerdir. [`probe`] ucunu ayirir, [`detect_nvidia`] eski sozlesmeyi korur.

use std::process::Command;

/// Tespit edilen GPU: ad + toplam VRAM (MB) + surucu surumu.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vram_mb: u32,
    /// NVIDIA surucu surumu (or. `560.94`); `nvidia-smi` bu alani vermezse `None`.
    ///
    /// Kurulum kontrolu bunu **oldugu gibi gosterir, YARGILAMAZ**: "bu surucu cok eski mi" sorusu
    /// guvenilir biçimde cevaplanamaz — 2026-08-07'de 561.17 CUDA/PTX hatasi verdi ama BU makinede
    /// 560.94 sorunsuz calisiyor. Belirleyen surucu tek basina degil, Ollama'nin hangi CUDA arac
    /// zinciriyle derlendigi. Sabit esik yanlis-alarm uretirdi; sayi gercek bir `gpu_driver`
    /// hatasinda anlam kazanir (mesaja konur).
    pub driver_version: Option<String>,
}

/// `nvidia-smi` yoklamasinin UC sonucu — kurulum kontrolu bunlari farkli cumlelere cevirir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GpuProbe {
    /// `nvidia-smi` calistirilamadi (komut yok / PATH'te degil) → NVIDIA karti ya da surucusu yok.
    SmiMissing,
    /// `nvidia-smi` calisti ama basarisiz dondu veya ciktisi ayristirilamadi. Ham iz tasinir —
    /// bu, "kart yok"tan farklidir (surucu kurulu ama bozuk/eksik olabilir).
    Unreadable(String),
    Found(GpuInfo),
}

/// `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits` ciktisi.
/// Bicim: her satir `NVIDIA GeForce RTX 3070, 8192, 560.94`. Birden cok GPU varsa **EN COK VRAM'li**
/// (en yetenekli) secilir. Bozuk/bos → `None`. GPU adlarinda virgul olmaz → duz `split(',')` guvenli.
///
/// Ucuncu alan **istege bagli**: eski `nvidia-smi` surumleri ya da iki-alanli cagri hala ayristirilir
/// (`driver_version = None`). Boylece parse, sorgu alanlari degisse de sessizce COKMEZ.
fn parse_smi_csv(out: &str) -> Option<GpuInfo> {
    out.lines()
        .filter_map(|line| {
            let mut it = line.split(',');
            let name = it.next()?.trim().to_string();
            let vram_mb = it.next()?.trim().parse::<u32>().ok()?;
            let driver_version =
                it.next().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
            if name.is_empty() {
                return None;
            }
            Some(GpuInfo { name, vram_mb, driver_version })
        })
        .max_by_key(|g| g.vram_mb)
}

/// NVIDIA GPU'yu `nvidia-smi` ile yokla — uc sonucu AYIRARAK (bkz [`GpuProbe`]).
pub fn probe() -> GpuProbe {
    let out = match Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"])
        .output()
    {
        Ok(o) => o,
        // Komut bulunamadi (en sik durum) → kart/surucu yok.
        Err(_) => return GpuProbe::SmiMissing,
    };
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return GpuProbe::Unreadable(if err.is_empty() {
            format!("nvidia-smi cikis kodu {}", out.status)
        } else {
            err
        });
    }
    let text = String::from_utf8_lossy(&out.stdout);
    match parse_smi_csv(&text) {
        Some(info) => GpuProbe::Found(info),
        None => GpuProbe::Unreadable(text.trim().to_string()),
    }
}

/// NVIDIA GPU'yu tespit et. Komut yok / hata / ayristirilamadi → `None` (CPU varsayilir).
/// Model onerisi bu sadelestirilmis goruntuyu kullanir; ayrimi gereken yerler [`probe`]'u cagirir.
pub fn detect_nvidia() -> Option<GpuInfo> {
    match probe() {
        GpuProbe::Found(info) => Some(info),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_gpu() {
        assert_eq!(
            parse_smi_csv("NVIDIA GeForce RTX 3070, 8192, 560.94"),
            Some(GpuInfo {
                name: "NVIDIA GeForce RTX 3070".to_string(),
                vram_mb: 8192,
                driver_version: Some("560.94".to_string()),
            })
        );
    }

    /// Surucu alani YOKSA (eski nvidia-smi / iki-alanli cikti) parse yine calisir — alan
    /// eklemek eski ciktiyi kirmamali (aksi halde GPU birden "yok" gorunur, oneri de bozulurdu).
    #[test]
    fn driver_field_is_optional() {
        let g = parse_smi_csv("NVIDIA GeForce RTX 3070, 8192").expect("iki alanli cikti da gecerli");
        assert_eq!(g.vram_mb, 8192);
        assert_eq!(g.driver_version, None);
        // Bos ucuncu alan da `None` (bosluk "surucu surumu" degildir).
        assert_eq!(parse_smi_csv("RTX, 8192,   ").and_then(|g| g.driver_version), None);
    }

    #[test]
    fn parse_multi_gpu_picks_largest_vram() {
        let g = parse_smi_csv(
            "NVIDIA GeForce GTX 1050 Ti, 4096, 560.94\nNVIDIA GeForce RTX 3060, 12288, 560.94",
        )
        .expect("bir GPU secilmeli");
        assert_eq!(g.vram_mb, 12288);
        assert_eq!(g.name, "NVIDIA GeForce RTX 3060");
    }

    #[test]
    fn parse_garbage_or_empty_is_none() {
        assert_eq!(parse_smi_csv(""), None);
        assert_eq!(parse_smi_csv("virgulsuz satir"), None);
        assert_eq!(parse_smi_csv("Ad, sayi-degil"), None);
    }
}
