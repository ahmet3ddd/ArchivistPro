//! Video metadata — MP4/MOV atom parser + AVI/MKV/WebM/FLV header tespiti.
//!
//! H2 `video_metadata.rs`'ten nakil (saf-Rust, harici arac yok). MP4 `moov/mvhd`
//! (sure), `tkhd`/`stsd` (boyut/codec) atom'larini okur; akis-MP4 icin dosya sonunu da
//! dener.

use std::io::{Read, Seek, SeekFrom};

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor, Thumbnail};

/// Video ust boyut siniri: 16 GiB (yalniz bas 32 MB + son 512 KB okunur).
const MAX_VIDEO_SIZE: u64 = 16 * 1024 * 1024 * 1024;
/// Atom taramasi icin okunacak bas kismi.
const MAX_READ: u64 = 32 * 1024 * 1024;

/// Video dosyalari icin extractor.
pub struct VideoExtractor;

impl Extractor for VideoExtractor {
    fn id(&self) -> &'static str {
        "video"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["mp4", "m4v", "mov", "avi", "mkv", "webm", "flv", "wmv"]
    }
    fn max_size(&self) -> u64 {
        MAX_VIDEO_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let f = std::fs::File::open(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        let mut data = Vec::new();
        f.take(MAX_READ)
            .read_to_end(&mut data)
            .map_err(|e| ExtractError::io(&input.path, e))?;

        let mut duration_hint = None;
        let mut width = None;
        let mut height = None;
        let mut codec_hint = detect_non_mp4_codec(&data);
        let mut file_type_brand = None;

        if codec_hint.is_none() {
            for (atype, off, len) in iter_atoms(&data) {
                let atom = &data[off..off + len];
                match &atype {
                    b"ftyp" => {
                        file_type_brand = parse_ftyp(atom);
                        if codec_hint.is_none() {
                            if let Some(brand) = &file_type_brand {
                                codec_hint = Some(brand.trim().to_string());
                            }
                        }
                    }
                    b"moov" => parse_moov(
                        atom,
                        &mut duration_hint,
                        &mut width,
                        &mut height,
                        &mut codec_hint,
                    ),
                    _ => {}
                }
            }

            // moov bas kisimda yoksa (akis-MP4) dosya sonunu dene.
            if duration_hint.is_none() && input.size_bytes > MAX_READ {
                let tail_size = (512 * 1024).min(input.size_bytes as usize);
                let seek_pos = input.size_bytes - tail_size as u64;
                if let Ok(mut f2) = std::fs::File::open(&input.path) {
                    if f2.seek(SeekFrom::Start(seek_pos)).is_ok() {
                        let mut tail = Vec::new();
                        if f2.take(tail_size as u64).read_to_end(&mut tail).is_ok() {
                            for (atype, off, len) in iter_atoms(&tail) {
                                if &atype == b"moov" {
                                    parse_moov(
                                        &tail[off..off + len],
                                        &mut duration_hint,
                                        &mut width,
                                        &mut height,
                                        &mut codec_hint,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut out = Extracted::new();
        if let Some(v) = duration_hint {
            out.set("duration_hint", v);
        }
        if let Some(v) = width {
            out.set("width", v);
        }
        if let Some(v) = height {
            out.set("height", v);
        }
        if let Some(v) = codec_hint {
            out.set("codec_hint", v);
        }
        if let Some(v) = file_type_brand {
            out.set("file_type_brand", v);
        }
        match video_thumbnail(&input.path) {
            Ok(thumbnail) => out.thumbnail = Some(thumbnail),
            Err(reason) => out.warn(format!("video onizlemesi uretilemedi: {reason}")),
        }
        Ok(out)
    }
}

/// Video poster karesi. Windows Shell, sistemdeki medya thumbnail saglayicisini kullanarak
/// videoyu decode eder; kart sicak-yolunda dosya acilmaz, sonuc ingest sirasinda DB'ye yazilir.
#[cfg(windows)]
fn video_thumbnail(path: &std::path::Path) -> Result<Thumbnail, String> {
    use std::ffi::c_void;
    use std::mem::size_of;

    use image::{DynamicImage, RgbaImage};
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BI_RGB,
        DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY,
    };

    // Ingest worker'i COM'u daha once baska apartment modelinde baslatmis olabilir. O durumda
    // RPC_E_CHANGED_MODE hata degildir: thread zaten COM-hazirdir, yalniz CoUninitialize bize ait
    // degildir. Diger baslatma hatalari gercek hata olarak doner.
    let init = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let uninitialize = init.is_ok();
    if init.is_err() && init != RPC_E_CHANGED_MODE {
        return Err(format!("COM baslatilamadi: {init:?}"));
    }

    let result = (|| unsafe {
        let shell_path = HSTRING::from(path.as_os_str());
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&shell_path, None).map_err(|e| e.to_string())?;
        // THUMBNAILONLY: dosya-ikonu poster diye kaydedilmesin. Shell uygun codec/handler
        // bulamazsa temizce hata verir ve UI video ikonuna geri duser.
        let bitmap = factory
            .GetImage(SIZE { cx: 512, cy: 512 }, SIIGBF_THUMBNAILONLY)
            .map_err(|e| e.to_string())?;

        let decoded = hbitmap_to_rgba(bitmap, |bitmap, info, pixels| {
            let hdc = GetDC(None);
            if hdc.0.is_null() {
                return Err("ekran DC alinamadi".to_string());
            }
            let lines = GetDIBits(
                hdc,
                bitmap,
                0,
                info.bmiHeader.biHeight.unsigned_abs(),
                Some(pixels.as_mut_ptr().cast::<c_void>()),
                info,
                DIB_RGB_COLORS,
            );
            ReleaseDC(None, hdc);
            if lines == 0 {
                Err("thumbnail pikselleri okunamadi".to_string())
            } else {
                Ok(())
            }
        });
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let (width, height, pixels) = decoded?;
        let rgba = RgbaImage::from_raw(width, height, pixels)
            .ok_or_else(|| "thumbnail piksel boyutu gecersiz".to_string())?;
        archivist_thumbnail::encode_thumbnail(&DynamicImage::ImageRgba8(rgba))
            .ok_or_else(|| "thumbnail JPEG kodlanamadi".to_string())
    })();

    if uninitialize {
        unsafe { CoUninitialize() };
    }
    /// HBITMAP'i ustten-asagi BGRA32 olarak oku ve RGBA'ya cevir. Piksel okuma closure'i GDI
    /// cagrisini disarida tutar; boyut/kanal donusumu birim testinde saf olarak kanitlanir.
    fn hbitmap_to_rgba(
        bitmap: HBITMAP,
        read_pixels: impl FnOnce(HBITMAP, &mut BITMAPINFO, &mut [u8]) -> Result<(), String>,
    ) -> Result<(u32, u32, Vec<u8>), String> {
        let mut raw = BITMAP::default();
        let got = unsafe {
            GetObjectW(
                HGDIOBJ(bitmap.0),
                size_of::<BITMAP>() as i32,
                Some((&mut raw as *mut BITMAP).cast::<c_void>()),
            )
        };
        if got == 0 || raw.bmWidth <= 0 || raw.bmHeight == 0 {
            return Err("thumbnail boyutu okunamadi".to_string());
        }
        let width = u32::try_from(raw.bmWidth).map_err(|_| "gecersiz genislik".to_string())?;
        let height = raw.bmHeight.unsigned_abs();
        if width > 4096 || height > 4096 {
            return Err("thumbnail beklenenden buyuk".to_string());
        }
        let byte_len = usize::try_from(u64::from(width) * u64::from(height) * 4)
            .map_err(|_| "thumbnail boyutu tasti".to_string())?;
        let mut pixels = vec![0u8; byte_len];
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = raw.bmWidth;
        info.bmiHeader.biHeight = -(height as i32); // negatif = top-down, dikey cevirme yok
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;
        read_pixels(bitmap, &mut info, &mut pixels)?;
        bgra_to_rgba(&mut pixels);
        Ok((width, height, pixels))
    }

    result
}

#[cfg(not(windows))]
fn video_thumbnail(_path: &std::path::Path) -> Result<Thumbnail, String> {
    Err("bu platformda video thumbnail saglayicisi yok".to_string())
}

fn bgra_to_rgba(pixels: &mut [u8]) {
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        // Shell thumbnail'larinda alpha kanali siklikla sifirdir; JPEG'e kodlanacagi icin opak yap.
        pixel[3] = 255;
    }
}

fn read_u16_be(data: &[u8], offset: usize) -> Option<u16> {
    if offset + 2 > data.len() {
        return None;
    }
    Some(u16::from_be_bytes([data[offset], data[offset + 1]]))
}
fn read_u32_be(data: &[u8], offset: usize) -> Option<u32> {
    if offset + 4 > data.len() {
        return None;
    }
    Some(u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]))
}
fn read_u64_be(data: &[u8], offset: usize) -> Option<u64> {
    if offset + 8 > data.len() {
        return None;
    }
    Some(u64::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ]))
}
fn atom_type(data: &[u8], offset: usize) -> Option<[u8; 4]> {
    if offset + 4 > data.len() {
        return None;
    }
    Some([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}
fn type_to_str(t: &[u8; 4]) -> String {
    t.iter()
        .map(|&b| {
            if b.is_ascii_graphic() || b == b' ' {
                b as char
            } else {
                '?'
            }
        })
        .collect()
}

fn format_duration(duration_units: u64, timescale: u32) -> String {
    if timescale == 0 {
        return format!("{duration_units} units");
    }
    let total_secs = duration_units / u64::from(timescale);
    let (h, m, s) = (total_secs / 3600, (total_secs % 3600) / 60, total_secs % 60);
    if h > 0 {
        format!("{h:02}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

/// Ust-seviye atom'lari dolas: (tip, veri_baslangic, veri_uzunluk).
fn iter_atoms(data: &[u8]) -> Vec<([u8; 4], usize, usize)> {
    let mut result = Vec::new();
    let mut offset = 0usize;
    while offset + 8 <= data.len() {
        let Some(size) = read_u32_be(data, offset) else {
            break;
        };
        let Some(atype) = atom_type(data, offset + 4) else {
            break;
        };
        let (data_offset, atom_end) = if size == 1 {
            if offset + 16 > data.len() {
                break;
            }
            let Some(ext) = read_u64_be(data, offset + 8).map(|s| s as usize) else {
                break;
            };
            if ext < 16 {
                break;
            }
            (offset + 16, offset + ext)
        } else if size == 0 {
            (offset + 8, data.len())
        } else {
            if size < 8 {
                break;
            }
            (offset + 8, offset + size as usize)
        };
        let atom_end = atom_end.min(data.len());
        let data_len = atom_end.saturating_sub(data_offset);
        result.push((atype, data_offset, data_len));
        if atom_end <= offset {
            break;
        }
        offset = atom_end;
    }
    result
}

fn parse_moov(
    data: &[u8],
    duration_hint: &mut Option<String>,
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, off, len) in iter_atoms(data) {
        let atom = &data[off..off + len];
        match &atype {
            b"mvhd" => parse_mvhd(atom, duration_hint),
            b"trak" => parse_trak(atom, width, height, codec_hint),
            _ => {}
        }
    }
}

fn parse_mvhd(data: &[u8], duration_hint: &mut Option<String>) {
    if data.is_empty() {
        return;
    }
    let version = data[0];
    let (timescale, duration) = if version == 1 {
        if data.len() < 32 {
            return;
        }
        (
            read_u32_be(data, 20).unwrap_or(0),
            read_u64_be(data, 24).unwrap_or(0),
        )
    } else {
        if data.len() < 20 {
            return;
        }
        (
            read_u32_be(data, 12).unwrap_or(0),
            u64::from(read_u32_be(data, 16).unwrap_or(0)),
        )
    };
    if timescale > 0 && duration > 0 {
        *duration_hint = Some(format_duration(duration, timescale));
    }
}

fn parse_trak(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, off, len) in iter_atoms(data) {
        let atom = &data[off..off + len];
        match &atype {
            b"mdia" => parse_mdia(atom, width, height, codec_hint),
            b"tkhd" => parse_tkhd(atom, width, height),
            _ => {}
        }
    }
}

fn parse_tkhd(data: &[u8], width: &mut Option<u32>, height: &mut Option<u32>) {
    if data.is_empty() {
        return;
    }
    let (w_off, h_off) = if data[0] == 1 { (88, 92) } else { (76, 80) };
    if let Some(w_fp) = read_u32_be(data, w_off) {
        let w = w_fp >> 16;
        if w > 0 && w <= 65535 {
            *width = Some(w);
        }
    }
    if let Some(h_fp) = read_u32_be(data, h_off) {
        let h = h_fp >> 16;
        if h > 0 && h <= 65535 {
            *height = Some(h);
        }
    }
}

fn parse_mdia(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, off, len) in iter_atoms(data) {
        if &atype == b"minf" {
            parse_minf(&data[off..off + len], width, height, codec_hint);
        }
    }
}

fn parse_minf(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, off, len) in iter_atoms(data) {
        if &atype == b"stbl" {
            parse_stbl(&data[off..off + len], width, height, codec_hint);
        }
    }
}

fn parse_stbl(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, off, len) in iter_atoms(data) {
        if &atype == b"stsd" {
            parse_stsd(&data[off..off + len], width, height, codec_hint);
        }
    }
}

fn parse_stsd(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    if data.len() < 8 {
        return;
    }
    if read_u32_be(data, 4).unwrap_or(0) == 0 {
        return; // entry_count
    }
    let entry_offset = 8;
    if entry_offset + 8 > data.len() {
        return;
    }
    let entry_size = read_u32_be(data, entry_offset).unwrap_or(0) as usize;
    let Some(et) = atom_type(data, entry_offset + 4) else {
        return;
    };

    let is_video = matches!(
        &et,
        b"avc1"
            | b"avc2"
            | b"avc3"
            | b"avc4"
            | b"hvc1"
            | b"hev1"
            | b"mp4v"
            | b"s263"
            | b"H263"
            | b"VP08"
            | b"VP09"
            | b"vp08"
            | b"vp09"
            | b"av01"
            | b"dvav"
            | b"dvhe"
    );
    if is_video && codec_hint.is_none() {
        *codec_hint = Some(type_to_str(&et));
        // Visual sample entry: header(8) + reserved(6) + data_ref(2) + reserved(16) + w(2) + h(2)
        let w_off = entry_offset + 8 + 6 + 2 + 16;
        let h_off = w_off + 2;
        let Some(entry_end) = entry_offset.checked_add(entry_size) else {
            return;
        };
        let safe_end = entry_end.min(data.len());
        if h_off + 2 <= safe_end {
            if let (Some(w), Some(h)) = (read_u16_be(data, w_off), read_u16_be(data, h_off)) {
                if w > 0 {
                    *width = Some(u32::from(w));
                }
                if h > 0 {
                    *height = Some(u32::from(h));
                }
            }
        }
    }
}

fn parse_ftyp(data: &[u8]) -> Option<String> {
    if data.len() < 4 {
        return None;
    }
    Some(
        data[0..4]
            .iter()
            .map(|&b| {
                if b.is_ascii_graphic() || b == b' ' {
                    b as char
                } else {
                    '?'
                }
            })
            .collect(),
    )
}

fn detect_non_mp4_codec(data: &[u8]) -> Option<String> {
    if data.len() < 12 {
        return None;
    }
    if data.starts_with(b"RIFF") && &data[8..12] == b"AVI " {
        return Some("AVI".to_string());
    }
    if data[0] == 0x1A && data[1] == 0x45 && data[2] == 0xDF && data[3] == 0xA3 {
        if data.windows(4).any(|w| w == b"webm") {
            return Some("WebM".to_string());
        }
        return Some("Matroska".to_string());
    }
    if data.starts_with(b"FLV") {
        return Some("FLV".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `size + type + payload` atom byte'lari kur.
    fn atom(typ: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let size = (8 + payload.len()) as u32;
        let mut v = size.to_be_bytes().to_vec();
        v.extend_from_slice(typ);
        v.extend_from_slice(payload);
        v
    }

    #[test]
    fn duration_from_mvhd_v0() {
        // mvhd payload: version(1)+flags(3)+creation(4)+mod(4)+timescale(4)+duration(4)
        let mut mvhd = vec![0u8; 20];
        mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes()); // timescale
        mvhd[16..20].copy_from_slice(&5000u32.to_be_bytes()); // duration → 5 sn
        let moov = atom(b"moov", &atom(b"mvhd", &mvhd));

        let mut duration = None;
        let (mut w, mut h, mut codec) = (None, None, None);
        for (atype, off, len) in iter_atoms(&moov) {
            if &atype == b"moov" {
                parse_moov(
                    &moov[off..off + len],
                    &mut duration,
                    &mut w,
                    &mut h,
                    &mut codec,
                );
            }
        }
        assert_eq!(duration.as_deref(), Some("00:05"));
    }

    #[test]
    fn format_duration_hours() {
        assert_eq!(format_duration(3661, 1), "01:01:01");
        assert_eq!(format_duration(125, 1), "02:05");
        assert_eq!(format_duration(100, 0), "100 units");
    }

    #[test]
    fn non_mp4_detection() {
        let mut avi = b"RIFF\0\0\0\0AVI ".to_vec();
        avi.extend_from_slice(&[0u8; 4]);
        assert_eq!(detect_non_mp4_codec(&avi).as_deref(), Some("AVI"));
        assert_eq!(
            detect_non_mp4_codec(b"FLV\x01\0\0\0\0\0\0\0\0").as_deref(),
            Some("FLV")
        );
        assert_eq!(detect_non_mp4_codec(&[0u8; 4]), None);
    }

    #[test]
    fn bgra_pixels_become_opaque_rgba() {
        let mut pixels = vec![10, 20, 30, 0, 1, 2, 3, 99];
        bgra_to_rgba(&mut pixels);
        assert_eq!(pixels, vec![30, 20, 10, 255, 3, 2, 1, 255]);
    }

    #[test]
    fn video_extensions_include_wmv() {
        assert!(VideoExtractor.extensions().contains(&"wmv"));
    }
}
