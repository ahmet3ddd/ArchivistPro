# ArchivistPro — インストールガイド

> **バージョン:** 3.7.0 · **更新日:** 2026-08-20 · **プラットフォーム:** Windows 10/11 (64-bit)
>
> 他の言語: [Türkçe](KULLANICI_KURULUM_REHBERI.md) · [English](KULLANICI_KURULUM_REHBERI_EN.md) · [العربية](KULLANICI_KURULUM_REHBERI_AR.md) · [中文](KULLANICI_KURULUM_REHBERI_ZH.md)

このページは概要です。手順を追った詳しい説明は:
**[初心者向けガイド](INSTALL_BEGINNER_JA.md)** ·
**[システム管理者向けガイド](INSTALL_PRO_JA.md)**

---

## クイックインストール (5 ステップ)

1. **ダウンロード:** [Releases ページ](https://github.com/ahmet3ddd/ArchivistPro/releases/latest)
   から **`ArchivistPro_3.7.0_x64-setup.exe`** を入手します (推奨インストーラー。
   MSI はマシンレベルに*別の*コピーをインストールするため、意図がある場合のみ使用)。
2. **インストール:** ダウンロードしたファイルを実行します。Windows SmartScreen の
   警告が出たら **「詳細情報 → 実行」** をクリックします (パッケージは未署名のため、
   この警告は想定内です)。
3. **初回起動:** 「初期セットアップ」画面で最初の管理者 (admin) アカウントを作成し、
   そのアカウントでログインします。
4. **アーカイブの設定:** **ソースフォルダー → フォルダーを追加** でプロジェクト
   フォルダーを指定し、**スキャン** を実行します。ファイルは移動されません —
   アプリはインデックスを作るだけです (DWG・MAX・IFC・RVT・SKP・PDF など
   95 以上の形式を認識)。
5. **旧バージョンからの移行?** ArchivistPro 3.2.2 (旧世代) がインストール済みの
   場合、3.7.0 は**並行して**インストールされます。旧バージョンを**アンインストール
   しないでください**。データは **設定 → 一般 → 「以前のバージョンが見つかりました」**
   カードのインポートウィザードで移行します。

**AI 機能 (任意):** 検索・スキャン・プレビューは AI なしで完全に動作します。
セマンティック検索/ビジュアル検索やチャットを使う場合は
**設定 → AI → AI セットアップウィザード** を使います (詳細:
[初心者向けガイド §8](INSTALL_BEGINNER_JA.md) / [管理者向けガイド](INSTALL_PRO_JA.md))。

---

## リンク

- リリースノート: [CHANGELOG](../CHANGELOG.md)
- 問題の報告: [GitHub Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- ロードマップ: [ROADMAP](ROADMAP.md)
