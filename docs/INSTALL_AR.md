# Archivist Pro — دليل التثبيت

يشرح هذا الدليل الخطوات اللازمة لتثبيت Archivist Pro وتشغيله في بيئة التطوير.

## متطلبات النظام

| المتطلب | الحد الأدنى |
|------------|---------|
| نظام التشغيل | Windows 10 (64 بت) |
| Node.js | 20+ |
| Rust | 1.77.2+ |
| Tauri CLI | 2.x |
| الذاكرة العشوائية | 4 GB (8 GB+ لميزات الذكاء الاصطناعي) |
| القرص | ~2 GB (بما في ذلك التبعيات) |

## 1. المتطلبات الأساسية

### Node.js

قم بتنزيل وتثبيت [Node.js 20+](https://nodejs.org/). تحقق من التثبيت:

```bash
node --version   # v20.x.x أو أعلى
npm --version    # 10.x.x أو أعلى
```

### Rust

ثبّت Rust عبر [rustup](https://rustup.rs/):

```bash
# تثبيت rustup (مثبّت Windows أو shell)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# التحقق
rustc --version   # 1.77.2 أو أعلى
cargo --version
```

### Tauri CLI

```bash
npm install -g @tauri-apps/cli
```

### متطلبات بناء Windows

يتطلب Tauri أدوات بناء C++ على Windows. إذا لم يكن [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) مثبتًا:

1. قم بتنزيل Visual Studio Build Tools
2. اختر حمل العمل "تطوير سطح المكتب باستخدام C++"
3. أكمل التثبيت

## 2. إعداد المشروع

```bash
# استنساخ المستودع
git clone <repo-url>
cd Arsiv-H2

# تثبيت التبعيات
npm install
```

عند تشغيل `npm install`، يقوم سكريبت `postinstall` تلقائيًا بنسخ `sql-wasm.wasm` إلى دليل `public/`. هذا الملف ضروري لقاعدة بيانات WASM SQLite.

## 3. التطوير

### وضع Web (الواجهة الأمامية فقط)

```bash
npm run dev
```

يُفتح على `http://localhost:5173` في المتصفح. الميزات التي تتطلب Rust backend (الصور المصغرة، مسح الملفات، إلخ) تعمل مع خدمة وهمية.

### وضع Tauri الأصلي

```bash
npm run tauri dev
```

يُجمّع كلًا من الواجهة الأمامية و Rust backend ويفتحهما في نافذة أصلية. قد يستغرق تجميع Rust بضع دقائق في التشغيل الأول.

> **ملاحظة:** في أول تشغيل، تظهر **شاشتان** أوليتان:
> 1. **معالج الإعداد** — فحص النظام، اكتشاف الأجهزة، تكوين الذكاء الاصطناعي، واختيار اللغة (4 خطوات). لا تظهر مرة أخرى بعد الاكتمال.
> 2. **إعداد أول مسؤول** — إذا لم يوجد مستخدمون، تُفتح `FirstRunSetup` بدلاً من شاشة تسجيل الدخول؛ يُنشأ هنا أول حساب مسؤول. لا يوجد كلمة مرور مشفرة admin/admin.
>
> إذا نسيت كلمة المرور: استخدم `%APPDATA%\com.archivistpro.desktop\recovery.key` في تدفق "نسيت كلمة المرور" في شاشة تسجيل الدخول.

### أوضاع الأدوار

يمكن للتطبيق أن يعمل في وضعَي دور:

```bash
# وضع المسؤول (الافتراضي) — جميع الميزات نشطة
npm run dev:admin

# وضع المشاهد — للقراءة فقط، وصول محدود
npm run dev:viewer
```

يتحدد وضع الدور بواسطة متغير البيئة `VITE_APP_ROLE`. ملفات وضع Vite (`.env.admin`، `.env.viewer`) تضبط هذا المتغير.

## 4. متغيرات البيئة

| المتغير | القيم | الوصف |
|----------|--------|-------------|
| `VITE_APP_ROLE` | `admin` \| `viewer` | دور التطبيق (الافتراضي: admin) |

يمكن تعريف متغيرات البيئة في ملف `.env` أو في ملفات وضع Vite (`.env.admin`، `.env.viewer`).

## 5. بناء الإنتاج

### بناء Web

```bash
npm run build
```

يُكتب الناتج في دليل `dist/`.

### مثبّت Tauri

```bash
npm run tauri build
```

يُنشأ مثبّت Windows (`.msi` و`.exe`) تحت `src-tauri/target/release/bundle/`.

## 6. اختياري: تثبيت Ollama (ميزات الذكاء الاصطناعي)

يستخدم Archivist Pro خادم Ollama محليًا لميزات الذكاء الاصطناعي (البحث بالنص الطبيعي في DWG، توسيع الاستعلام).

1. قم بتنزيل وتثبيت [Ollama](https://ollama.ai/)
2. اجلب نموذجًا:
   ```bash
   ollama pull llama3.2
   ```
3. تحقق من أن خادم Ollama يعمل:
   ```bash
   curl http://localhost:11434/api/tags
   ```
4. قم بتكوين اتصال Ollama في التطبيق من الإعدادات > تكوين الذكاء الاصطناعي

> **تلميح:** يكتشف معالج التشغيل الأول Ollama تلقائيًا. إذا كان Ollama مثبتًا وجاريًا، يسرد المعالج نماذج الرؤية المتاحة ويقترح خيار "الذكاء الاصطناعي المحلي".

تعمل ميزات CLIP للبحث البصري والتضمين في المتصفح عبر ONNX Runtime WASM — لا يلزم تثبيت إضافي.

## 7. تشغيل الاختبارات

### اختبارات الوحدة

```bash
# تشغيل جميع الاختبارات (605 اختبار، 35 ملف)
npm run test

# وضع المراقبة
npm run test -- --watch

# ملف واحد
npm run test -- src/tests/database.test.ts
```

### اختبارات Rust

```bash
cd src-tauri
cargo test --features admin
```

### اختبارات E2E

```bash
npm run test:e2e
```

## 8. استكشاف الأخطاء وإصلاحها

### خطأ `sql-wasm.wasm غير موجود`

قد لا يكون سكريبت `postinstall` قد عمل:

```bash
node -e "const fs=require('fs');fs.copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm','public/sql-wasm.wasm');"
```

### خطأ بناء Rust: `linker not found`

Visual Studio Build Tools غير مثبت. راجع قسم "متطلبات بناء Windows" أعلاه.

### خطأ اتصال `npm run tauri dev`

قد يفتح نافذة Tauri قبل أن يبدأ خادم Vite للتطوير. جرّب تشغيل `npm run dev` في محطة منفصلة أولاً، ثم شغّل `npm run tauri dev`.

### خطأ اتصال Ollama

تأكد من أن خادم Ollama يعمل:

```bash
ollama serve    # تشغيل الخادم
ollama list     # سرد النماذج المثبتة
```

المنفذ الافتراضي هو `11434`. إذا كنت تستخدم منفذًا مختلفًا، قم بتحديثه في إعدادات الذكاء الاصطناعي في التطبيق.

### خطأ ذاكرة WASM (قواعد بيانات كبيرة)

في الأرشيفات الكبيرة التي تحتوي على ملفات ممسوحة كثيرة، قد يصل المتصفح إلى حد الذاكرة. التشغيل في الوضع الأصلي لـ Tauri يخفف هذه المشكلة.
