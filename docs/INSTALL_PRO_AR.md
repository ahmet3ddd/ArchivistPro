# ArchivistPro — دليل التثبيت (للمحترفين / مسؤول النظام)

> **الإصدار:** 3.0.0 | **التاريخ:** 2026-05-23 | **المنصة:** Windows 10/11 (64-bit)
>
> هذا الدليل لمسؤولي الأنظمة ومتخصصي تكنولوجيا المعلومات والأشخاص الذين ينشرون البرنامج على محطات عمل متعددة. يشمل التثبيت الصامت ونشر الشبكة ومتغيرات البيئة ومواقع الملفات.
>
> لدليل موجه للمستخدم النهائي، راجع
> **[دليل التثبيت للمبتدئين](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/INSTALL_BEGINNER_AR.md)**.

---

## 1. متطلبات النظام

| المتطلب | الحد الأدنى | المُوصى به | القيد |
|---|---|---|---|
| نظام التشغيل | Windows 10 1809+ (64-bit) | Windows 11 22H2+ | x86/ARM غير مدعوم |
| المعالج | x64 (SSE4.2) | 4+ أنوية، AVX2 | — |
| الذاكرة | 4 GB | 8 GB+ (16 GB لـ AI) | sql.js يحمل قاعدة البيانات بالكامل في الذاكرة |
| القرص | 2 GB | 5 GB+ SSD | يُوصى بـ NVMe (مسح متوازي) |
| WebView2 | Edge runtime مدمج | — | وضع `offlineInstaller` في MSI |
| GPU (اختياري) | — | WebGPU-capable | embedding أسرع 5-10× |

### التبعيات

- **WebView2 Runtime** — مدمج داخل MSI في وضع `offlineInstaller`؛ لا حاجة لتثبيت منفصل (`tauri.conf.json` → `windows.webviewInstallMode`).
- **VC++ Redistributable** — DLLs المطلوبة من Tauri runtime مدمجة مع MSI.
- **Ollama** (اختياري) — مطلوب لـ AI Chat؛ من `https://ollama.com` أو الصامت: `winget install Ollama.Ollama --silent`.
- **ODA File Converter** (اختياري) — لبيانات DWG المتقدمة؛ قابل للتثبيت بنقرة واحدة من داخل التطبيق.

---

## 2. التثبيت الصامت

### مع MSI

```cmd
:: تثبيت افتراضي، سجل إلى ملف
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet /norestart /log install.log

:: موقع هدف مخصص
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi INSTALLDIR="D:\Apps\ArchivistPro" /quiet

:: تثبيت لكل الأجهزة (جميع المستخدمين)
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi ALLUSERS=1 /quiet

:: قمع إعادة التشغيل للاختبار
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet REBOOT=ReallySuppress
```

### مع NSIS (.exe)

```cmd
:: تثبيت صامت
ArchivistPro_3.0.0_x64-setup.exe /S

:: هدف مخصص
ArchivistPro_3.0.0_x64-setup.exe /S /D=C:\Apps\ArchivistPro
```

> **ملاحظة:** بالنسبة لإصدار NSIS، يجب أن يكون معامل `/D=` **آخر** وسيطة و **غير مقتبس** (متطلب NSIS).

### معاملات MSI

| المعامل | المعنى | الافتراضي |
|---|---|---|
| `/quiet` أو `/qn` | صامت تماماً، بدون واجهة | — |
| `/passive` أو `/qb` | شريط تقدم، بدون تفاعل | — |
| `/norestart` | لا تشغل إعادة التشغيل | — |
| `/log <path>` | سجل مفصل | — |
| `INSTALLDIR=<path>` | مجلد التثبيت الهدف | `C:\Program Files\ArchivistPro` |
| `ALLUSERS=1` | تثبيت لكل الأجهزة | لكل مستخدم |

---

## 3. طرق النشر

### 3.1. Group Policy (GPO)

للنشر متعدد الأجهزة في Active Directory:

1. انسخ MSI إلى مشاركة شبكة (`\\fileserver\deploy\ArchivistPro\`).
2. **Group Policy Management** → OU ذو الصلة → **Computer Configuration → Policies → Software Settings → Software Installation** → حزمة جديدة.
3. اختر نوع الحزمة: **Assigned** (تثبيت تلقائي).
4. أدخل مسار UNC: `\\fileserver\deploy\ArchivistPro\ArchivistPro_3.0.0_x64_en-US.msi`.
5. تثبت الأجهزة في OU الهدف تلقائياً بعد إعادة التشغيل.

### 3.2. Intune / MEM (Microsoft Endpoint Manager)

1. Intune Console → **Apps → Windows → Add** → **Line-of-business app**.
2. ارفع ملف MSI.
3. التعيين: اختر مجموعة المستخدمين / مجموعة الأجهزة المطلوبة.

### 3.3. PSExec / RemoteSigning

```powershell
# سطر واحد، عبر الشبكة
$cred = Get-Credential
Invoke-Command -ComputerName PC01,PC02,PC03 -Credential $cred -ScriptBlock {
    Start-Process msiexec.exe -ArgumentList '/i \\fileserver\deploy\ArchivistPro_3.0.0.msi /quiet' -Wait
}
```

### 3.4. Chocolatey / Winget (مستقبلاً)

> حزم Chocolatey و Winget غير منشورة بعد. مخطط لها في دورة v3.x.

---

## 4. مواقع الملفات

### مثبت (للقراءة فقط)

| الموقع | المحتوى |
|---|---|
| `%ProgramFiles%\ArchivistPro\` | ثنائي التطبيق + WebView2 + locales |
| `%ProgramFiles%\ArchivistPro\ArchivistPro.exe` | التنفيذ الرئيسي |
| `%ProgramFiles%\ArchivistPro\resources\` | نماذج AI المدمجة، الأيقونات |

### بيانات المستخدم (قراءة/كتابة — لكل مستخدم)

| الموقع | المحتوى |
|---|---|
| `%APPDATA%\com.archivistpro.desktop\` | مجلد البيانات الرئيسي |
| `%APPDATA%\com.archivistpro.desktop\archivist.db` | قاعدة البيانات الرئيسية (البيانات الوصفية، العلامات) |
| `%APPDATA%\com.archivistpro.desktop\archivist_vec.db` | قاعدة بيانات المتجهات (v3.0.0+) |
| `%APPDATA%\com.archivistpro.desktop\archivist_local.db` | الأرشيف المحلي |
| `%APPDATA%\com.archivistpro.desktop\recovery.key` | مفتاح استرداد كلمة المرور |
| `%APPDATA%\com.archivistpro.desktop\backups\` | DB snapshots تلقائية (آخر 5) |
| `%APPDATA%\com.archivistpro.desktop\backups-local\` | snapshots محلية |
| `%APPDATA%\com.archivistpro.desktop\logs\` | ملفات سجل النظام (دوران 7 أيام) |
| `%LOCALAPPDATA%\com.archivistpro.desktop\` | ذاكرة التخزين المؤقت، بيانات الجلسة (WebView2) |

### Registry

| المسار | المحتوى |
|---|---|
| `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.archivistpro.desktop` | معلومات الإزالة (MSI) |
| `HKCU\Software\ArchivistPro\` | (غير مستخدم — كل الإعدادات في قاعدة البيانات) |

---

## 5. متغيرات البيئة

يمكن ضبط سلوك ArchivistPro عبر متغيرات البيئة هذه (معظمها اختياري؛ الإعدادات الافتراضية مضبوطة للإنتاج):

| المتغير | القيم | الافتراضي | الوصف |
|---|---|---|---|
| `ARCHIVIST_DB_JOURNAL` | `wal` / `delete` | `wal` | وضع SQLite journal. الشبكة → DELETE تلقائياً. |
| `ARCHIVIST_V3_EPOCH` | `on` / `off` | `on` | تبديل معمارية V3. علم localStorage — يُعيَّن داخل التطبيق فقط. |
| `RUST_LOG` | `info` / `debug` / `trace` | (غير معيَّن) | مستوى السجل في Rust. `debug` للتحليل العميق. |
| `ARCHIVIST_DATA_DIR` | مسار كامل | `%APPDATA%\com.archivistpro.desktop` | نقل مجلد البيانات (وضع اختبار/محمول). |

### أمثلة

```cmd
:: تعطيل WAL عند العمل على مشاركة شبكة
setx ARCHIVIST_DB_JOURNAL delete

:: تسجيل مفصل
setx RUST_LOG debug

:: نقل مجلد البيانات إلى D:
setx ARCHIVIST_DATA_DIR "D:\ArchivistData"
```

---

## 6. الشبكة والأمان

### 6.1. المنافذ المفتوحة

| المنفذ | الاتجاه | الاستخدام | الافتراضي |
|---|---|---|---|
| 9471 | داخل (مسؤول) / خارج (مشاهد) | LAN mini HTTP server (مشاركة الأرشيف) | مغلق (يفتحه المسؤول) |
| 11434 | خارج (localhost) | Ollama API (لـ AI Chat) | localhost فقط |

قاعدة جدار الحماية (فقط إذا تم استخدام LAN server):

```cmd
netsh advfirewall firewall add rule name="ArchivistPro LAN" ^
  dir=in action=allow protocol=TCP localport=9471 remoteip=LocalSubnet
```

### 6.2. القائمة البيضاء لمضاد الفيروسات

قد تشير بعض منتجات AV للشركات إلى مسح ملفات ArchivistPro (يفتح ملفات كثيرة في وقت قصير). الاستثناءات المقترحة:

- **المجلد:** `C:\Program Files\ArchivistPro\`
- **العملية:** `ArchivistPro.exe`
- **المجلد (البيانات):** `%APPDATA%\com.archivistpro.desktop\`

### 6.3. CSP (Content Security Policy)

CSP صارم داخل التطبيق، مبني على `default-src 'self'`. مكالمات الشبكة مسموح بها فقط إلى:

- `http://localhost:11434` (Ollama API)
- `http://localhost:9471` (LAN server)
- `https://asset.localhost` (Tauri asset protocol)

لا CDN خارجي، لا تتبع، لا telemetry.

### 6.4. Tauri Capabilities

ملفات `src-tauri/capabilities/*.json` تحدد أوامر Rust المسموح بها:

- `desktop.json` — أوامر خاصة بسطح المكتب
- `viewer.json` — مجموعة فرعية متاحة للدور المشاهد
- `admin.json` — أوامر خاصة بالمسؤول

يتم إنتاج تنفيذيات معزولة حسب الدور في وقت البناء (`--mode admin` / `--mode viewer`) — أوامر المسؤول غير موجودة فعلياً في ثنائي المشاهد.

---

## 7. ترحيل V3 (3.0.0 جديد)

عند الترقية من v2.4.x إلى v3.0.0، يُرحَّل الأرشيف تلقائياً إلى مخطط V3.

### 7.1. التدفق

1. يبدأ التطبيق.
2. يُقرأ `PRAGMA user_version`؛ إذا كان `< 3`، يبدأ الترحيل.
3. يتم إنشاء النسخة الاحتياطية `archivist_premigrate_v3.db.bak`.
4. ترحيل مرحلي: epoch 0 → 1 (embeddings) → 2 (text_chunks + FTS) → 3 (asset_relations).
5. يتم التحقق من كل مرحلة بـ round-trip.
6. الإنهاء: `DROP × 3 + VACUUM + user_version = 3` ذري من جانب Rust.
7. `reloadDatabase` يزامن واجهة التطبيق مع الحالة الجديدة.

### 7.2. التشغيل اليدوي (مسؤول)

لوحة **الإعدادات → التخزين → ترحيل مخطط V3** يمكن تشغيلها يدوياً. إذا كان تحكم المسؤول مفضلاً، عطل التشغيل التلقائي بـ `ARCHIVIST_V3_EPOCH=off`، ثم ابدأ يدوياً من اللوحة.

### 7.3. النشر الجماعي — استراتيجية الترحيل

للمسؤولين الذين يديرون عدداً كبيراً من التثبيتات القديمة مركزياً:

1. **المجموعة التجريبية:** اختبر الترحيل اليدوي على 1-2 جهاز أولاً.
2. **الطرح:** إذا نجح الاختبار التجريبي، الترحيل التلقائي افتراضياً آمن (لا حاجة لإجراء من المستخدم؛ يعمل عند التشغيل الأول).
3. **النسخ الاحتياطي:** قبل الترحيل، يمكن لسكربت PowerShell نسخ جميع مجلدات بيانات المستخدمين إلى تخزين الشبكة:

```powershell
$users = Get-ChildItem "C:\Users" -Directory
foreach ($u in $users) {
    $src = "C:\Users\$($u.Name)\AppData\Roaming\com.archivistpro.desktop"
    if (Test-Path $src) {
        $dst = "\\backupserver\archivistpro-pre-v3\$($u.Name)\$(Get-Date -Format 'yyyyMMdd')"
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
        Copy-Item $src $dst -Recurse -Force
    }
}
```

### 7.4. التراجع

إذا حدث خطأ بعد الترحيل:

```cmd
:: أغلق التطبيق، ثم
cd %APPDATA%\com.archivistpro.desktop
ren archivist.db archivist_v3_attempt.db
ren archivist_vec.db archivist_vec_attempt.db
ren archivist_premigrate_v3.db.bak archivist.db
:: افتح التطبيق — يعود إلى الحالة القديمة (epoch=0)
```

---

## 8. ضبط الأداء

### 8.1. عدد عمال المسح

يُضبط من `الإعدادات → التخزين → مسح متعدد الأنوية`.

| التخزين | العمال المُوصى بهم |
|---|---|
| HDD | 1-2 |
| SATA SSD | 3-4 |
| NVMe (≤8 أنوية) | 6-8 |
| NVMe (≥16 أنوية) | 10-16 |

الافتراضي يُكتشف تلقائياً من الأجهزة عند التشغيل الأول.

### 8.2. AI (Embedding) — WebGPU vs WASM

على GPUs التي تدعم WebGPU، embedding أسرع 5-10×. المتصفح يختار تلقائياً؛ تجاوز يدوي عبر `الإعدادات → AI → الواجهة الخلفية`.

### 8.3. القرص I/O

- قاعدة البيانات الرئيسية و `vec.db` **يجب أن يكونا على نفس SSD** — تقسيمهما على أقراص يبطل قفل الكتابة المشترك.
- مسح مضاد الفيروسات في الوقت الفعلي لـ `archivist.db` و `archivist_vec.db` يقلل الأداء — أضفهما إلى قائمة استثناءات AV.

---

## 9. المراقبة واستكشاف الأخطاء

### 9.1. مواقع السجلات

```
%APPDATA%\com.archivistpro.desktop\logs\
├── system.log          (الحالي — Rust tracing)
├── system.log.1        (اليوم السابق)
├── ...
└── system.log.6        (قبل 7 أيام — ثم دوران)
```

سجل التدقيق داخل التطبيق:
**الإعدادات → السجلات → عارض سجل التدقيق**

### 9.2. تقارير الانهيار

```
%APPDATA%\com.archivistpro.desktop\crashes\
└── crash_<timestamp>.txt
```

وصول للمسؤول فقط
(**الإعدادات → المطور → تقارير الانهيار**).

### 9.3. مشاكل شائعة

| الأعراض | السبب المحتمل | الحل |
|---|---|---|
| تثبيت MSI "1603" | WebView2 runtime مفقود أو تالف | ثبّت WebView2 يدوياً من Microsoft، ثم أعد المحاولة |
| "DB error" عند التشغيل الأول | DB تالفة من الإصدار القديم | استعد من نسخة `recovery.key` احتياطية أو أعد إنشاء DB |
| AI Chat "Ollama غير موجود" | خدمة Ollama متوقفة | شغّل `ollama serve` أو انقر **بدء** في إعدادات AI |
| المسح بطيء جداً | HDD + عدد عمال عالٍ | اخفض العمال إلى 1-2 |
| `disk-write-failed` | القرص ممتلئ أو لا صلاحية | افحص حق الكتابة على `%APPDATA%` والمساحة الفارغة |
| أخطاء قفل أرشيف UNC | WAL غير آمن على الشبكة | اجبر `ARCHIVIST_DB_JOURNAL=delete` |

---

## 10. إلغاء التثبيت

### جهاز واحد

```cmd
:: إذا تم التثبيت عبر MSI
wmic product where name="ArchivistPro" call uninstall /nointeractive

:: أو بـ GUID (msiexec)
msiexec /x {ARCHIVISTPRO-PRODUCT-GUID} /quiet /norestart
```

### تنظيف بيانات المستخدم

إلغاء التثبيت **لا يحذف بيانات المستخدم** — متعمد لمنع فقدان البيانات. للحذف الكامل:

```cmd
rmdir /s /q "%APPDATA%\com.archivistpro.desktop"
rmdir /s /q "%LOCALAPPDATA%\com.archivistpro.desktop"
```

### إلغاء التثبيت الجماعي (عبر GPO)

1. Group Policy → علّم حزمة Software Installation كـ **Remove**.
2. تُلغي الأجهزة المستهدفة التثبيت تلقائياً بعد إعادة التشغيل.

---

## 11. إدارة الإصدار والتحديثات

### التحديثات التلقائية

> التحديث التلقائي داخل التطبيق **مخطط له** مع v3.0.0. حالياً، التحديثات يدوية.

### التحديث اليدوي

1. نزّل MSI الجديد من GitHub Releases.
2. ثبّت MSI الجديد فوق الموجود — MSI يدعم الترقية في المكان، بيانات المستخدم محفوظة.
3. عند التشغيل الأول، أي ترحيل جديد يعمل تلقائياً.

---

## 12. الترخيص والقانون

- **الترخيص:** MIT (انظر `LICENSE` في جذر المستودع)
- **الكود المصدري:** https://github.com/ahmet3ddd/Arsiv-H2
- **المسؤولية:** البرنامج مقدم "كما هو" بدون ضمان. تحقق مع مجموعة اختبار قبل النشر الإنتاجي.
- **Telemetry:** لا شيء. لا يتم جمع بيانات استخدام؛ لا شيء يُرسل إلى أي خادم.

---

## 13. الدعم والملاحظات

- **GitHub Issues:** https://github.com/ahmet3ddd/Arsiv-H2/issues
- **داخل التطبيق:** **الإعدادات → المطور → "إرسال ملاحظات للمطور"** (تقرير الانهيار مرفق تلقائياً، اختياري).

---

*يتم تحديث هذا الدليل مع تطور البرنامج. آخر تحديث: 2026-05-23 (v3.0.0).*
