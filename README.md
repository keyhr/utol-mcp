# utol-mcp

東京大学の学習管理システム **UTOL (UTokyo LMS)** を、MCP クライアント（Claude Desktop など）から
扱えるようにする個人用の **MCP サーバー**です。受講登録済みの講義・締切・お知らせ・教材・課題などを
自然言語で参照できます。

ローカル実行を前提とし、機能は読み取りが中心です。認証はユーザー本人が公式の UTokyo Account
ログイン画面で行い、ツールはパスワードや MFA コードを扱いません。

## できること

- 受講登録済みの講義（時間割）・お知らせ・教材リンクの一覧
- 全科目を横断した課題・テストの締切一覧、課題詳細の参照
- シラバス（UTAS）の参照、受講登録外コースの検索（公開カタログ情報のみ）
- 教材ファイルの個別ダウンロード
- 課題の「提出不要」切替、コースの受講登録・解除（確認付きの書き込み操作）

## セットアップ

### 1. インストールとログイン

npx で実行する場合は次のとおりです。

```bash
npx -y utol-mcp login
```

ブラウザが開くので、UTokyo Account でログインしてください。ログインが確認されると、以降の実行で
再認証が不要になります（セッションは `~/.utol-mcp/` に保存されます）。

> **状態確認・ログアウト**
> ```bash
> npx -y utol-mcp auth-status   # ログイン済みか確認
> npx -y utol-mcp logout        # セッションとキャッシュを削除
> ```

### 2. MCP クライアントに登録

Claude Desktop などの設定ファイルに次を追加します。

```json
{
  "mcpServers": {
    "utol": { "command": "npx", "args": ["-y", "utol-mcp", "serve"] }
  }
}
```

登録後、クライアントから「今週の課題の締切は？」「〇〇の講義のお知らせを見せて」のように
自然言語で問い合わせできます。

## 提供ツール

読み取り中心のツールです。

| ツール | 説明 | 主な引数 |
|---|---|---|
| `auth_status` | ログイン状態の確認 | — |
| `list_courses` | 受講登録している講義（時間割）一覧 | `refresh?` |
| `get_course` | 講義詳細（お知らせ・教材・課題） | `idnumber` |
| `list_assignments` | 全科目横断の課題・テスト一覧と締切 | `refresh?` |
| `get_assignment` | 課題詳細（読み取りのみ） | `idnumber`, `url` |
| `get_syllabus` | シラバス（UTAS 参照） | `idnumber`, `syllabusUrl?` |
| `search_courses` | コース検索（受講登録外可・公開カタログ情報のみ） | `keyword?`, `teacher?`, `year?` |
| `download_material` | 教材ファイルの単一ダウンロード | `idnumber`, `resourceId`, `destPath` |
| `list_messages` | メッセージ一覧（メタのみ・本文なし） | `refresh?` |
| `refresh_cache` | 主要一覧の再取得 | — |

- `get_course` / `get_assignment` / `download_material` は、受講登録中のコースのみ対象です。
- `download_material` の対象は `get_course` が返す `materials[].resourceId` で指定します。
- 受講登録外コースは `search_courses` が返す公開カタログ情報とシラバスのみを参照できます。

### 書き込み操作

状態を変更する操作です。`confirm:true` が無い場合は実行せずプレビューのみを返し、実行時は
`~/.utol-mcp/audit.log` に記録が残ります。特に `unregister_course` は受講登録・提出物に影響します。

| ツール | 説明 | 可逆性 |
|---|---|---|
| `set_task_no_submission` | 課題を「提出不要」⇔「未提出」に切替 | 可逆 |
| `register_course` | コースを受講登録 | 解除可能 |
| `unregister_course` | 受講登録を解除 | 要注意（データ喪失の可能性） |

## ポリシー

- 個人の学習支援を目的とし、大量アクセスや教材収集には用いません。
- UTokyo SSO・MFA・CAPTCHA・アクセス制御・レート制限を回避しません。
- 認証はユーザー本人が正規ログイン画面で行い、ツールは資格情報を収集・保存・入力しません。
- 受講登録外コースは公開カタログ情報とシラバスのみを取得し、保護された内部コンテンツは取得しません。
- セッション情報は機密情報として `~/.utol-mcp/`（権限 700）に保存します。Git・ログ・クラウドには含めないでください。
- 利用者は大学の規則、UTOL の利用規程、関連法令を守る必要があります。
- 本ツールは無保証で提供されます。利用に伴う損害や不利益について、開発者は一切の責任を負いません。利用者自身の責任で使用してください。

詳細は [`docs/AUTHENTICATION_POLICY.md`](docs/AUTHENTICATION_POLICY.md) を参照してください。

## 認証の仕組み

UTOL のアプリセッションはブラウザ終了時に失われますが、`utol-mcp login` で確立した UTokyo Account
（Microsoft SSO）の永続セッションが端末に残るため、以降のツール実行時は資格情報・MFA なしの
リダイレクトのみでセッションが再確立されます。再認証の途中で資格情報・MFA・アカウント選択が
要求された場合は直ちに中止し、手動ログインを促します。詳細は
[`docs/AUTHENTICATION_POLICY.md`](docs/AUTHENTICATION_POLICY.md) を参照してください。

## 開発

TypeScript 製です。`npm install` 時の `prepare` スクリプトで `dist/` へ自動ビルドされるため、
npx でも動作します。ローカルで開発する場合は次のとおりです。

```bash
npm install        # 依存 + Chromium 取得 + 自動ビルド
npm run build      # 変更を反映する際に再ビルド
npm test           # パーサ・日時正規化の単体テスト
npm run typecheck

node dist/index.js login   # ローカルビルドでの実行例
```

MCP クライアントにローカルビルドを登録する場合は、`serve` を次のように指定します。

```json
{ "command": "node", "args": ["/absolute/path/to/utol-mcp/dist/index.js", "serve"] }
```

実 UTOL に対する主要フロー（ログイン・認証再確立・時間割/課題/講義/シラバス/検索/教材DL）は
実機で検証済みです。`test/fixtures/raw/`（`.gitignore` 済み）に実 HTML を保存してパーサの
セレクタを確定しています。UTOL 側の画面改修時は、同ディレクトリの HTML を更新して
パーサを再確認してください。

## ライセンス

MIT
