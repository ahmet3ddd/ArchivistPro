//! ArchivistPro — İşletim Sistemi Olay Günlüğü Sorgusu
//!
//! Beklenmedik kapanış sonrası "neden" tahmininde kullanılır.
//! Windows: PowerShell `Get-WinEvent` ile Application + System log'larını sorgular:
//!   - Application Error / Application Hang / Windows Error Reporting (uygulama crash/hang)
//!   - System: 1074 (planlı kapanış), 6006 (event log durdu), 6008 (beklenmedik shutdown), 41 (kernel-power)
//!
//! Diğer platformlarda boş liste döner.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsEventEntry {
    pub time: String,
    pub id: i64,
    pub level: String,
    pub provider: String,
    pub message: String,
}

#[cfg(target_os = "windows")]
fn build_powershell_script(start_iso: &str, end_iso: &str) -> String {
    // ISO 8601 → DateTime parse, two parallel queries (Application + System), JSON output
    format!(
        r#"$ErrorActionPreference='SilentlyContinue'
$start=[DateTime]::Parse('{start}')
$end=[DateTime]::Parse('{end}')
$collected=@()
try {{
  $appEvents = Get-WinEvent -FilterHashtable @{{
    LogName='Application'
    StartTime=$start
    EndTime=$end
    ProviderName='Application Error','Application Hang','Windows Error Reporting','.NET Runtime'
  }}
  if ($appEvents) {{
    foreach ($e in $appEvents) {{
      if ($e.Message -match '(?i)archivistpro') {{ $collected += $e }}
    }}
  }}
}} catch {{}}
try {{
  $sysEvents = Get-WinEvent -FilterHashtable @{{
    LogName='System'
    StartTime=$start
    EndTime=$end
    Id=1074,6006,6008,41
  }}
  if ($sysEvents) {{ $collected += $sysEvents }}
}} catch {{}}
$out = $collected | ForEach-Object {{
  $msg = $_.Message
  if ($msg -and $msg.Length -gt 400) {{ $msg = $msg.Substring(0,400) }}
  [PSCustomObject]@{{
    time=$_.TimeCreated.ToUniversalTime().ToString('o')
    id=[int]$_.Id
    level=$_.LevelDisplayName
    provider=$_.ProviderName
    message=$msg
  }}
}}
if ($null -eq $out) {{ '[]' }} elseif ($out -is [Array]) {{ $out | ConvertTo-Json -Compress -Depth 2 }} else {{ '[' + ($out | ConvertTo-Json -Compress -Depth 2) + ']' }}
"#,
        start = start_iso,
        end = end_iso
    )
}

#[cfg(target_os = "windows")]
async fn run_powershell(script: String) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    // CREATE_NO_WINDOW = 0x0800_0000 — konsol penceresi açılmasın
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-Command", &script,
        ])
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| format!("PowerShell çalıştırılamadı: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Belirli bir zaman aralığındaki ilgili OS event'lerini döndürür.
/// `start_iso` / `end_iso` ISO 8601 (UTC önerilir).
/// Windows dışı platformlarda boş liste döner.
#[tauri::command]
pub async fn query_os_events_for_crash(
    start_iso: String,
    end_iso: String,
) -> Result<Vec<OsEventEntry>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = build_powershell_script(&start_iso, &end_iso);
        let stdout = run_powershell(script).await?;
        if stdout.is_empty() || stdout == "[]" {
            return Ok(vec![]);
        }
        // Tek event ise PowerShell ConvertTo-Json bazen object döner — array'e sar
        let json_str = if stdout.starts_with('[') {
            stdout
        } else {
            format!("[{}]", stdout)
        };
        let events: Vec<OsEventEntry> = serde_json::from_str(&json_str)
            .map_err(|e| format!("Event JSON parse hatası: {}", e))?;
        Ok(events)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (start_iso, end_iso); // kullanılmayan değişken uyarısını sustur
        Ok(vec![])
    }
}
