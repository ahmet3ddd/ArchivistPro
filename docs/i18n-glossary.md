# ArchivistPro — i18n Terim Sözlüğü

Bu sözlük 5 dilde (TR, EN, AR, JA, ZH) dokümantasyon ve UI metin tutarlılığı için
**referans noktasıdır**. Çeviri yapılırken bu tablodan bakılır; ad-hoc çeviri
yapılmaz. Yeni terim eklendiğinde önce buraya, sonra dokümana.

## Genel İlke

**Değişmeyen Terimler** — tüm dillerde olduğu gibi geçer (Latin alfabesinde
yazılır, çevrilmez):

- **Marka:** `ArchivistPro`
- **Dosya uzantıları:** `DWG`, `DXF`, `MAX`, `SKP`, `RVT`, `IFC`, `PDF`,
  `DOC/DOCX`, `XLS/XLSX`, `JPG/JPEG`, `PNG`, `MP4`, `ONNX`
- **Kütüphane / protokol adları:** `Tauri`, `Ollama`, `WebGPU`, `WebAssembly`,
  `WASM`, `SQLite`, `FTS5`, `HNSW`, `ANN`, `RAG`, `LLM`, `MSI`, `NSIS`, `LAN`,
  `UNC`, `WAL`, `IPC`, `CSP`, `MiniLM`, `CLIP`
- **Sistem dosyaları:** `archivist.db`, `archivist_vec.db`, `vec.db`,
  `archivist_local.db`, `*_premigrate_v3.db.bak`, `.archivistpro`
- **Şema kavramları:** `epoch`, `schema`, `migration`, `chunk`, `embedding`,
  `vector index`

## Çevrilen Terimler

### UI / Kullanıcı Arayüzü

| TR | EN | AR | JA | ZH |
|---|---|---|---|---|
| Arşiv | Archive | الأرشيف | アーカイブ | 档案 |
| Tarama | Scan | المسح | スキャン | 扫描 |
| Tarayıcı | Scanner | الماسح | スキャナー | 扫描器 |
| Dosya | File | ملف | ファイル | 文件 |
| Klasör | Folder | مجلد | フォルダ | 文件夹 |
| Kaynak Klasör | Source Folder | المجلد المصدر | ソースフォルダ | 源文件夹 |
| Etiket | Tag | علامة | タグ | 标签 |
| İlişki | Relation | علاقة | 関連付け | 关联 |
| Bağlantılı Dosyalar | Related Files | الملفات المرتبطة | 関連ファイル | 关联文件 |
| Versiyon (dosya) | Version | إصدار | バージョン | 版本 |
| Sürüm (program) | Release | إصدار | リリース | 发布版本 |
| Yedek | Backup | نسخة احتياطية | バックアップ | 备份 |
| Geri Yükle | Restore | استعادة | 復元 | 恢复 |
| Çöp Kutusu | Trash | المهملات | ゴミ箱 | 回收站 |
| Sürükle ve Bırak | Drag & Drop | السحب والإفلات | ドラッグ&ドロップ | 拖放 |
| Arama | Search | البحث | 検索 | 搜索 |
| Filtre | Filter | تصفية | フィルター | 筛选 |
| Sıralama | Sort | فرز | 並び替え | 排序 |
| Görünüm | View | عرض | 表示 | 视图 |
| Ayarlar | Settings | الإعدادات | 設定 | 设置 |
| Depolama | Storage | التخزين | ストレージ | 存储 |
| Detay | Detail | تفاصيل | 詳細 | 详情 |
| Kapat | Close | إغلاق | 閉じる | 关闭 |
| Aç | Open | فتح | 開く | 打开 |
| Sil | Delete | حذف | 削除 | 删除 |
| Kalıcı Sil | Permanent Delete | حذف نهائي | 完全削除 | 永久删除 |
| Geri Al | Undo | تراجع | 元に戻す | 撤销 |
| Yardım | Help | المساعدة | ヘルプ | 帮助 |
| Kullanıcı Kılavuzu | User Guide | دليل المستخدم | ユーザーガイド | 用户指南 |
| Yönetici Kılavuzu | Admin Guide | دليل المسؤول | 管理者ガイド | 管理员指南 |
| Sürüm Notları | Release Notes | ملاحظات الإصدار | リリースノート | 发布说明 |

### Roller / Yetkilendirme

| TR | EN | AR | JA | ZH |
|---|---|---|---|---|
| Yönetici | Admin | المسؤول | 管理者 | 管理员 |
| Görüntüleyici | Viewer | المشاهد | 閲覧者 | 查看者 |
| Geliştirici | Developer | المطور | 開発者 | 开发者 |
| Rol | Role | دور | 役割 | 角色 |
| Yetki | Permission | صلاحية | 権限 | 权限 |
| Oturum | Session | جلسة | セッション | 会话 |

### Mimari / Domain

| TR | EN | AR | JA | ZH |
|---|---|---|---|---|
| Mimar | Architect | معماري | 建築家 | 建筑师 |
| Mimari (sıfat) | Architectural | معماري | 建築 | 建筑 |
| Proje | Project | مشروع | プロジェクト | 项目 |
| Müşteri | Client | عميل | クライアント | 客户 |
| Çizim | Drawing | رسم | 図面 | 图纸 |
| Plan | Plan | مخطط | 平面図 | 平面图 |
| Render | Render | render | レンダリング | 渲染 |
| Doku | Texture | نسيج | テクスチャ | 纹理 |
| Fotoğraf | Photo | صورة | 写真 | 照片 |
| Kategori | Category | فئة | カテゴリ | 类别 |
| Stil | Style | نمط | スタイル | 风格 |

### AI / Sistem

| TR | EN | AR | JA | ZH |
|---|---|---|---|---|
| Yapay Zekâ | AI | الذكاء الاصطناعي | AI | 人工智能 |
| AI Sohbet | AI Chat | محادثة الذكاء الاصطناعي | AI チャット | AI 聊天 |
| İndeksleme | Indexing | الفهرسة | インデックス作成 | 索引 |
| İçerik Araması | Content Search | البحث في المحتوى | コンテンツ検索 | 内容搜索 |
| Görsel Arama | Image Search | البحث المرئي | 画像検索 | 图像搜索 |
| Anlamsal Arama | Semantic Search | البحث الدلالي | セマンティック検索 | 语义搜索 |
| Önbellek | Cache | الذاكرة المؤقتة | キャッシュ | 缓存 |
| Performans | Performance | الأداء | パフォーマンス | 性能 |

### Veri / Şema

| TR | EN | AR | JA | ZH |
|---|---|---|---|---|
| Veritabanı | Database | قاعدة البيانات | データベース | 数据库 |
| Tablo | Table | جدول | テーブル | 表 |
| Sütun | Column | عمود | 列 | 列 |
| Satır | Row | صف | 行 | 行 |
| Anahtar Sözcük | Keyword | كلمة مفتاحية | キーワード | 关键词 |
| Meta Veri | Metadata | البيانات الوصفية | メタデータ | 元数据 |
| Dizin | Index | الفهرس | インデックス | 索引 |
| Şema Migrasyonu | Schema Migration | ترحيل المخطط | スキーマ移行 | 架构迁移 |

### Kurulum / Dağıtım

| TR | EN | AR | JA | ZH |
|---|---|---|---|---|
| Kurulum | Installation | التثبيت | インストール | 安装 |
| Yükleme | Install | تثبيت | インストール | 安装 |
| Kaldırma | Uninstall | إلغاء التثبيت | アンインストール | 卸载 |
| Güncelleme | Update | تحديث | アップデート | 更新 |
| Yüklenici | Installer | المثبت | インストーラー | 安装程序 |
| Sistem Gereksinimleri | System Requirements | متطلبات النظام | システム要件 | 系统要求 |
| Çevrimdışı | Offline | غير متصل | オフライン | 离线 |
| Çevrimiçi | Online | متصل | オンライン | 在线 |
| Ağ | Network | الشبكة | ネットワーク | 网络 |
| Paylaşım | Share / Sharing | المشاركة | 共有 | 共享 |

## Kullanım Notu

- **Tek kaynak ilkesi:** Çeviri sırasında bu tabloda yer almayan bir terimle
  karşılaşılırsa önce buraya eklenir, sonra dokümana. Aynı kavram farklı
  yerlerde farklı çevrilmemeli.
- **Bağlam istisnası:** Bağlamdan dolayı zorunlu bir varyant gerekirse
  (örn. fiilin emir kipi vs. mastar hali) ek satır olarak eklenir
  (örn. `Tarama (isim)` ve `Tara (eylem)` ayrı satırlar).
- **Sürüm:** Bu sözlük v3.0.0 ile birlikte oluşturuldu. Değişiklikler git
  geçmişinden takip edilir.
