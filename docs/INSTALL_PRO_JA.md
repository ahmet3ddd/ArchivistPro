# ArchivistPro — インストールガイド (プロフェッショナル / システム管理者)

> **バージョン:** 3.0.0 | **日付:** 2026-05-23 | **プラットフォーム:** Windows 10/11 (64-bit)
>
> このガイドはシステム管理者、IT プロフェッショナル、複数ワークステーションへの展開担当者向けです。サイレントインストール、ネットワーク展開、環境変数、ファイルの場所をカバーします。
>
> エンドユーザー向けガイドは **[初心者向けインストールガイド](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/INSTALL_BEGINNER_JA.md)** を参照。

---

## 1. システム要件

| 要件 | 最小 | 推奨 | 制約 |
|---|---|---|---|
| OS | Windows 10 1809+ (64-bit) | Windows 11 22H2+ | x86/ARM 非対応 |
| CPU | x64 (SSE4.2) | 4 コア以上、AVX2 | — |
| RAM | 4 GB | 8 GB 以上 (AI 用 16 GB) | sql.js は DB を RAM に完全ロード |
| ディスク | 2 GB | 5 GB 以上 SSD | NVMe 推奨 (並列スキャン) |
| WebView2 | Edge runtime 組み込み | — | MSI の `offlineInstaller` モード |
| GPU (オプション) | — | WebGPU 対応 | embedding 5-10 倍高速 |

### 依存関係

- **WebView2 Runtime** — MSI 内の `offlineInstaller` モードに組み込み済み。別途インストール不要 (`tauri.conf.json` → `windows.webviewInstallMode`)。
- **VC++ Redistributable** — Tauri runtime に必要な DLL は MSI に同梱。
- **Ollama** (オプション) — AI Chat に必要; `https://ollama.com` から、またはサイレント: `winget install Ollama.Ollama --silent`。
- **ODA File Converter** (オプション) — DWG 高度メタデータ用; アプリ内からワンクリックでインストール可能。

---

## 2. サイレントインストール

### MSI で

```cmd
:: デフォルトインストール、ログをファイルに
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet /norestart /log install.log

:: カスタムターゲット位置
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi INSTALLDIR="D:\Apps\ArchivistPro" /quiet

:: 全マシンインストール (全ユーザー)
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi ALLUSERS=1 /quiet

:: テスト用に再起動を抑制
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet REBOOT=ReallySuppress
```

### NSIS (.exe) で

```cmd
:: サイレントインストール
ArchivistPro_3.0.0_x64-setup.exe /S

:: カスタムターゲット
ArchivistPro_3.0.0_x64-setup.exe /S /D=C:\Apps\ArchivistPro
```

> **注:** NSIS バージョンでは、`/D=` パラメータは**最後**の引数で、**引用符なし**である必要があります (NSIS の要件)。

### MSI パラメータ

| パラメータ | 意味 | デフォルト |
|---|---|---|
| `/quiet` または `/qn` | 完全サイレント、UI なし | — |
| `/passive` または `/qb` | プログレスバー、操作なし | — |
| `/norestart` | 再起動をトリガーしない | — |
| `/log <path>` | 詳細ログ | — |
| `INSTALLDIR=<path>` | インストールターゲットフォルダー | `C:\Program Files\ArchivistPro` |
| `ALLUSERS=1` | 全マシンインストール | ユーザー単位 |

---

## 3. 展開方法

### 3.1. Group Policy (GPO)

Active Directory 環境で複数マシンに展開:

1. MSI をネットワーク共有 (`\\fileserver\deploy\ArchivistPro\`) にコピー
2. **Group Policy Management** → 関連 OU → **Computer Configuration → Policies → Software Settings → Software Installation** → 新しいパッケージ
3. パッケージタイプ: **Assigned** を選択 (自動インストール)
4. UNC パスを入力: `\\fileserver\deploy\ArchivistPro\ArchivistPro_3.0.0_x64_en-US.msi`
5. ターゲット OU のマシンは再起動後に自動インストール

### 3.2. Intune / MEM (Microsoft Endpoint Manager)

1. Intune Console → **Apps → Windows → Add** → **Line-of-business app**
2. MSI ファイルをアップロード
3. 割り当て: 必要なユーザーグループ / デバイスグループを選択

### 3.3. PSExec / RemoteSigning

```powershell
# ワンライナー、ネットワーク経由
$cred = Get-Credential
Invoke-Command -ComputerName PC01,PC02,PC03 -Credential $cred -ScriptBlock {
    Start-Process msiexec.exe -ArgumentList '/i \\fileserver\deploy\ArchivistPro_3.0.0.msi /quiet' -Wait
}
```

### 3.4. Chocolatey / Winget (将来)

> Chocolatey および Winget パッケージはまだ公開されていません。v3.x サイクルで予定。

---

## 4. ファイルの場所

### インストール済み (読み取り専用)

| 場所 | 内容 |
|---|---|
| `%ProgramFiles%\ArchivistPro\` | アプリバイナリ + WebView2 + locales |
| `%ProgramFiles%\ArchivistPro\ArchivistPro.exe` | メイン実行ファイル |
| `%ProgramFiles%\ArchivistPro\resources\` | バンドル AI モデル、アイコン |

### ユーザーデータ (読み書き — ユーザーごと)

| 場所 | 内容 |
|---|---|
| `%APPDATA%\com.archivistpro.desktop\` | メインデータフォルダー |
| `%APPDATA%\com.archivistpro.desktop\archivist.db` | メイン DB (メタデータ、タグ) |
| `%APPDATA%\com.archivistpro.desktop\archivist_vec.db` | ベクター DB (v3.0.0+) |
| `%APPDATA%\com.archivistpro.desktop\archivist_local.db` | ローカルアーカイブ |
| `%APPDATA%\com.archivistpro.desktop\recovery.key` | パスワード回復キー |
| `%APPDATA%\com.archivistpro.desktop\backups\` | 自動 DB スナップショット (最後 5 つ) |
| `%APPDATA%\com.archivistpro.desktop\backups-local\` | ローカル DB スナップショット |
| `%APPDATA%\com.archivistpro.desktop\logs\` | システムログファイル (7 日ローテーション) |
| `%LOCALAPPDATA%\com.archivistpro.desktop\` | キャッシュ、セッションデータ (WebView2) |

### レジストリ

| パス | 内容 |
|---|---|
| `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.archivistpro.desktop` | アンインストール情報 (MSI) |
| `HKCU\Software\ArchivistPro\` | (未使用 — すべての設定は DB に) |

---

## 5. 環境変数

ArchivistPro の動作はこれらの環境変数で調整できます (ほとんどオプション; デフォルトは本番用に調整済み):

| 変数 | 値 | デフォルト | 説明 |
|---|---|---|---|
| `ARCHIVIST_DB_JOURNAL` | `wal` / `delete` | `wal` | SQLite journal モード。ネットワーク共有検出時は自動的に DELETE。 |
| `ARCHIVIST_V3_EPOCH` | `on` / `off` | `on` | V3 アーキテクチャトグル。localStorage フラグ — アプリ内でのみ設定。 |
| `RUST_LOG` | `info` / `debug` / `trace` | (未設定) | Rust 側ログレベル。詳細解析には `debug`。 |
| `ARCHIVIST_DATA_DIR` | フルパス | `%APPDATA%\com.archivistpro.desktop` | データフォルダー移動 (テスト/ポータブルモード)。 |

### 例

```cmd
:: ネットワーク共有で作業時に WAL を無効化
setx ARCHIVIST_DB_JOURNAL delete

:: 詳細ログ
setx RUST_LOG debug

:: データフォルダーを D: に移動
setx ARCHIVIST_DATA_DIR "D:\ArchivistData"
```

---

## 6. ネットワークとセキュリティ

### 6.1. オープンポート

| ポート | 方向 | 用途 | デフォルト |
|---|---|---|---|
| 9471 | Inbound (admin) / Outbound (viewer) | LAN mini HTTP server (アーカイブ共有) | クローズ (管理者が開く) |
| 11434 | Outbound (localhost) | Ollama API (AI Chat 用) | localhost のみ |

ファイアウォールルール (LAN サーバーを使用する場合のみ):

```cmd
netsh advfirewall firewall add rule name="ArchivistPro LAN" ^
  dir=in action=allow protocol=TCP localport=9471 remoteip=LocalSubnet
```

### 6.2. ウイルス対策ホワイトリスト

一部のエンタープライズ AV 製品は ArchivistPro のファイルスキャンをフラグする可能性があります (短時間で多くのファイルを開く)。推奨される例外:

- **フォルダー:** `C:\Program Files\ArchivistPro\`
- **プロセス:** `ArchivistPro.exe`
- **フォルダー (データ):** `%APPDATA%\com.archivistpro.desktop\`

### 6.3. CSP (Content Security Policy)

厳格なアプリ内 CSP、`default-src 'self'` ベース。ネットワーク呼び出しは次のみ許可:

- `http://localhost:11434` (Ollama API)
- `http://localhost:9471` (LAN server)
- `https://asset.localhost` (Tauri asset protocol)

外部 CDN、トラッキング、テレメトリの呼び出しはありません。

### 6.4. Tauri Capabilities

`src-tauri/capabilities/*.json` ファイルは許可された Rust コマンドを定義:

- `desktop.json` — デスクトップ固有のコマンド
- `viewer.json` — viewer ロールがアクセスできるサブセット
- `admin.json` — admin 専用コマンド

ビルド時にロール隔離された実行ファイルが生成 (`--mode admin` / `--mode viewer`) — admin コマンドは viewer バイナリに物理的に存在しません。

---

## 7. V3 移行 (3.0.0 新機能)

v2.4.x から v3.0.0 にアップグレードすると、アーカイブは V3 スキーマに自動移行されます。

### 7.1. フロー

1. アプリケーション開始
2. `PRAGMA user_version` が読み取られる; `< 3` の場合、移行がトリガー
3. バックアップ `archivist_premigrate_v3.db.bak` が作成される
4. 段階的移行: エポック 0 → 1 (embeddings) → 2 (text_chunks + FTS) → 3 (asset_relations)
5. 各ステージはラウンドトリップで検証
6. 終了: Rust 側で `DROP × 3 + VACUUM + user_version = 3` 原子的に
7. `reloadDatabase` でアプリフロントエンドが新しい状態に同期

### 7.2. 手動トリガー (管理者)

**設定 → ストレージ → V3 スキーマ移行**パネルから手動でトリガーできます。管理者の制御が優先される場合、`ARCHIVIST_V3_EPOCH=off` で自動トリガーを無効化し、パネルから手動で開始します。

### 7.3. 一括展開 — 移行戦略

レガシーインストールを集中管理する管理者向け:

1. **パイロットグループ:** まず 1-2 台のマシンで手動移行をテスト
2. **ロールアウト:** パイロットが成功した場合、自動移行デフォルトは安全 (ユーザーアクション不要; 初回起動時に実行)
3. **バックアップ:** 移行前に、PowerShell スクリプトですべてのユーザーデータフォルダーをネットワークストレージにミラー:

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

### 7.4. ロールバック

移行後に問題が発見された場合:

```cmd
:: アプリを閉じる、その後
cd %APPDATA%\com.archivistpro.desktop
ren archivist.db archivist_v3_attempt.db
ren archivist_vec.db archivist_vec_attempt.db
ren archivist_premigrate_v3.db.bak archivist.db
:: アプリを開く — 古い (epoch=0) 状態に戻る
```

---

## 8. パフォーマンスチューニング

### 8.1. スキャンワーカー数

`設定 → ストレージ → マルチコアスキャン` で設定。

| ストレージ | 推奨ワーカー |
|---|---|
| HDD | 1-2 |
| SATA SSD | 3-4 |
| NVMe (≤8 コア) | 6-8 |
| NVMe (≥16 コア) | 10-16 |

デフォルトは初回起動時のハードウェアから自動検出。

### 8.2. AI (Embedding) — WebGPU vs WASM

WebGPU 対応 GPU では embedding が 5-10 倍高速。ブラウザが自動選択; 手動オーバーライドは `設定 → AI → バックエンド` から。

### 8.3. ディスク I/O

- メイン DB と `vec.db` は**同じ SSD 上にある必要があります** — 異なるディスクに分割すると共有書き込みロックが破綻します
- `archivist.db` と `archivist_vec.db` のリアルタイムウイルス対策スキャンはパフォーマンスを低下させます — AV 例外リストに追加することを推奨

---

## 9. モニタリングとトラブルシューティング

### 9.1. ログの場所

```
%APPDATA%\com.archivistpro.desktop\logs\
├── system.log          (現在 — Rust tracing)
├── system.log.1        (前日)
├── ...
└── system.log.6        (7 日前 — その後ローテーション)
```

アプリ内監査ログ: **設定 → ログ → 監査ログビューア**

### 9.2. クラッシュレポート

```
%APPDATA%\com.archivistpro.desktop\crashes\
└── crash_<timestamp>.txt
```

管理者のみアクセス可能 (**設定 → 開発者 → クラッシュレポート**)。

### 9.3. よくある問題

| 症状 | 考えられる原因 | 修正 |
|---|---|---|
| MSI インストール "1603" | WebView2 runtime 不足または破損 | Microsoft から WebView2 を手動インストール、その後 MSI 再試行 |
| 初回起動時に "DB error" | 古いバージョンからの破損 DB | `recovery.key` バックアップから復元または DB を再作成 |
| AI Chat "Ollama 見つからない" | Ollama サービス停止 | `ollama serve` 実行または AI 設定で **Start** クリック |
| スキャンが非常に遅い | HDD + 高ワーカー数 | ワーカーを 1-2 に下げる |
| `disk-write-failed` | ディスク満杯または権限なし | `%APPDATA%` への書き込み権限と空き容量を確認 |
| UNC アーカイブロックエラー | WAL がネットワークで安全でない | `ARCHIVIST_DB_JOURNAL=delete` を強制 |

---

## 10. アンインストール

### 単一マシン

```cmd
:: MSI でインストールされた場合
wmic product where name="ArchivistPro" call uninstall /nointeractive

:: または GUID で (msiexec)
msiexec /x {ARCHIVISTPRO-PRODUCT-GUID} /quiet /norestart
```

### ユーザーデータのクリーンアップ

アンインストールは**ユーザーデータを削除しません** — データ損失を防ぐ意図的な動作。完全なワイプ:

```cmd
rmdir /s /q "%APPDATA%\com.archivistpro.desktop"
rmdir /s /q "%LOCALAPPDATA%\com.archivistpro.desktop"
```

### 一括アンインストール (GPO 経由)

1. Group Policy → Software Installation パッケージを **Remove** としてマーク
2. ターゲットマシンは再起動後に自動アンインストール

---

## 11. バージョン管理とアップデート

### 自動アップデート

> アプリ内自動アップデーターは v3.0.0 で**計画中**です。現在、アップデートは手動です。

### 手動アップデート

1. GitHub Releases から新しい MSI をダウンロード
2. 既存の MSI を削除せずに新しい MSI を上書きインストール — MSI はインプレースアップグレードをサポート、ユーザーデータは保持
3. 初回起動時、新しい移行があれば自動的に実行

---

## 12. ライセンスと法律

- **ライセンス:** MIT (リポジトリルートの `LICENSE` を参照)
- **ソースコード:** https://github.com/ahmet3ddd/Arsiv-H2
- **責任:** ソフトウェアは「現状のまま」、保証なしで提供されます。本番展開前にテストグループで検証してください
- **テレメトリ:** なし。使用データは収集されず、サーバーに何も送信されません

---

## 13. サポートとフィードバック

- **GitHub Issues:** https://github.com/ahmet3ddd/Arsiv-H2/issues
- **アプリ内:** **設定 → 開発者 → "開発者にフィードバック送信"** (クラッシュダンプ自動添付、オプション)

---

*このガイドはプログラムの発展に合わせて更新されます。最終更新: 2026-05-23 (v3.0.0)。*
