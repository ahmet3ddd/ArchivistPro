# Archivist Pro — インストールガイド

このガイドでは、開発環境に Archivist Pro をインストールして実行するための手順を説明します。

## システム要件

| 要件 | 最低 |
|------------|---------|
| オペレーティングシステム | Windows 10（64 ビット） |
| Node.js | 20+ |
| Rust | 1.77.2+ |
| Tauri CLI | 2.x |
| RAM | 4 GB（AI 機能には 8 GB 以上） |
| ディスク | 約 2 GB（依存関係を含む） |

## 1. 前提条件

### Node.js

[Node.js 20+](https://nodejs.org/) をダウンロードしてインストールします。インストールを確認：

```bash
node --version   # v20.x.x 以上
npm --version    # 10.x.x 以上
```

### Rust

[rustup](https://rustup.rs/) を使って Rust をインストールします：

```bash
# rustup のインストール（Windows インストーラーまたはシェル）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 確認
rustc --version   # 1.77.2 以上
cargo --version
```

### Tauri CLI

```bash
npm install -g @tauri-apps/cli
```

### Windows ビルド要件

Tauri は Windows で C++ ビルドツールが必要です。[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) がインストールされていない場合：

1. Visual Studio Build Tools をダウンロードする
2. 「C++ によるデスクトップ開発」ワークロードを選択する
3. インストールを完了する

## 2. プロジェクトのセットアップ

```bash
# リポジトリをクローン
git clone <repo-url>
cd Arsiv-H2

# 依存関係をインストール
npm install
```

`npm install` を実行すると、`postinstall` スクリプトが自動的に `sql-wasm.wasm` を `public/` ディレクトリにコピーします。このファイルは WASM SQLite データベースに必要です。

## 3. 開発

### Web モード（フロントエンドのみ）

```bash
npm run dev
```

ブラウザで `http://localhost:5173` が開きます。Rust バックエンドを必要とする機能（サムネイル、ファイルスキャンなど）はモックサービスで動作します。

### Tauri ネイティブモード

```bash
npm run tauri dev
```

フロントエンドと Rust バックエンドの両方をコンパイルし、ネイティブウィンドウで開きます。初回起動時は Rust のコンパイルに数分かかる場合があります。

> **注意：** 初回起動時に**2 つ**の初期画面が表示されます：
> 1. **セットアップウィザード** — システムチェック、ハードウェア検出、AI 設定、言語選択（4 ステップ）。完了後は再度表示されません。
> 2. **初回管理者セットアップ** — ユーザーが存在しない場合、ログイン画面の代わりに `FirstRunSetup` が開きます。ここで最初の管理者アカウントを作成します。ハードコードされた admin/admin パスワードはありません。
>
> パスワードを忘れた場合：ログイン画面の「パスワードを忘れた」フローで `%APPDATA%\com.archivistpro.desktop\recovery.key` を使用してください。

### ロールモード

アプリケーションは 2 つのロールモードで実行できます：

```bash
# 管理者モード（デフォルト）— 全機能が有効
npm run dev:admin

# ビューアーモード — 読み取り専用、アクセス制限あり
npm run dev:viewer
```

ロールモードは `VITE_APP_ROLE` 環境変数によって決まります。Vite モードファイル（`.env.admin`、`.env.viewer`）がこの変数を設定します。

## 4. 環境変数

| 変数 | 値 | 説明 |
|----------|--------|-------------|
| `VITE_APP_ROLE` | `admin` \| `viewer` | アプリケーションロール（デフォルト：admin） |

環境変数は `.env` ファイルまたは Vite モードファイル（`.env.admin`、`.env.viewer`）で定義できます。

## 5. プロダクションビルド

### Web ビルド

```bash
npm run build
```

出力は `dist/` ディレクトリに書き込まれます。

### Tauri インストーラー

```bash
npm run tauri build
```

Windows インストーラー（`.msi` および `.exe`）は `src-tauri/target/release/bundle/` 以下に作成されます。

## 6. オプション：Ollama のインストール（AI 機能）

Archivist Pro は AI 機能（DWG 自然言語検索、クエリ拡張）にローカルの Ollama サーバーを使用します。

1. [Ollama](https://ollama.ai/) をダウンロードしてインストールする
2. モデルを取得する：
   ```bash
   ollama pull llama3.2
   ```
3. Ollama サーバーが動作していることを確認する：
   ```bash
   curl http://localhost:11434/api/tags
   ```
4. アプリの「設定 > AI 設定」で Ollama 接続を設定する

> **ヒント：** 初回起動ウィザードは Ollama を自動検出します。Ollama がインストールされて実行中であれば、ウィザードが利用可能なビジョンモデルを一覧表示し、「ローカル AI」オプションを提案します。

CLIP 視覚検索と埋め込み機能は ONNX Runtime WASM を介してブラウザで実行されます。追加インストールは不要です。

## 7. テストの実行

### ユニットテスト

```bash
# すべてのテストを実行（605 テスト、35 ファイル）
npm run test

# ウォッチモード
npm run test -- --watch

# 単一ファイル
npm run test -- src/tests/database.test.ts
```

### Rust テスト

```bash
cd src-tauri
cargo test --features admin
```

### E2E テスト

```bash
npm run test:e2e
```

## 8. トラブルシューティング

### `sql-wasm.wasm が見つかりません` エラー

`postinstall` スクリプトが実行されていない可能性があります：

```bash
node -e "const fs=require('fs');fs.copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm','public/sql-wasm.wasm');"
```

### Rust ビルドエラー：`linker not found`

Visual Studio Build Tools がインストールされていません。上記の「Windows ビルド要件」セクションを参照してください。

### `npm run tauri dev` 接続エラー

Vite 開発サーバーが起動する前に Tauri ウィンドウが開いている可能性があります。まず別のターミナルで `npm run dev` を実行してから、`npm run tauri dev` を試してください。

### Ollama 接続エラー

Ollama サーバーが動作していることを確認してください：

```bash
ollama serve    # サーバーを起動する
ollama list     # インストール済みモデルを一覧表示する
```

デフォルトポートは `11434` です。別のポートを使用している場合は、アプリの AI 設定で更新してください。

### WASM メモリエラー（大規模データベース）

多数のファイルをスキャンした大規模アーカイブでは、ブラウザのメモリ制限に達する場合があります。Tauri ネイティブモードで実行すると、この問題が軽減されます。
