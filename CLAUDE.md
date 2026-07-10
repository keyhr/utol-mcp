# utol-mcp — エージェント向けガイド

東京大学 LMS「UTOL」の個人用 MCP サーバー。読み取り中心＋一部書き込み（ガードレール付き）。

## 「何ができるか」を聞かれたら

**ソースを読まずに、接続済み MCP のツール一覧（`utol` サーバー）をそのまま案内すること。**
ソースを読んで実装詳細を要約すると、フィールド名や仕様を誤って説明（捏造）しやすい。能力の正典はツール定義。

## ツールと正確な引数（推測しない）

読み取り:
- `auth_status` — 引数なし。ログイン状態。
- `list_courses` — `refresh?`。受講中の講義。
- `get_course` — `idnumber`, `refresh?`。講義詳細（お知らせ/教材/課題）。※受講登録済みのみ。
- `list_assignments` — `refresh?`。全科目横断の課題・締切。
- `get_assignment` — `idnumber`, `url`。課題詳細（読み取りのみ）。
- `get_syllabus` — `idnumber`, `syllabusUrl?`。シラバス（UTAS）。受講登録外は `search_courses` の `syllabusUrl` を渡す。
- `search_courses` — `keyword?`, `teacher?`, `year?`, `limit?`。コース検索（受講登録外可・公開情報のみ）。
- `get_material` — `idnumber`, `resourceId`, `mode?`。**教材内容を読む用途**（LLM コンテキストへ取り込む）。単一DLのみ。`resourceId` は `get_course` の `materials[].resourceId`。`mode` は `"text"`（既定・PDF テキスト抽出）または `"image"`（PDF ページ画像化）。画像ファイルは mode によらず ImageContent で返す。抽出非対応形式（docx/xlsx/zip 等）は `download_material` へ誘導。
- `download_material` — `idnumber`, `resourceId`, `destPath?`。**ファイルとして残す用途**（クライアントのローカルへ保存）。単一DLのみ。stdio 接続ではサーバーローカルのディスクへ保存し `{saved,bytes,fileName}` を返す（`destPath` 省略時は `~/.utol-mcp/downloads/`）。HTTP 接続では取得用の一時 URL を返す（`{url,fileName,bytes,expiresAt}`。`destPath` は無視）。
- `list_announcements` — `refresh?`。お知らせ（ヘッダー吹き出し）。
- `list_updates` — `refresh?`。更新情報＝最近の活動（ヘッダーベル）。
- `list_messages` — `refresh?`。メッセージ一覧（/lms/inquiry_list）。
- `refresh_cache` — 引数なし。

書き込み（**`confirm:true` が無ければプレビューのみ**。実行は監査ログに記録）:
- `set_task_no_submission` — `idnumber`, `contentsId`, `noSubmission`, `contentsType?`, `confirm?`。可逆。
- `register_course` — `idnumber`, `confirm?`。受講登録。
- `unregister_course` — `idnumber`, `confirm?`。受講登録解除（要注意）。

## できないこと（案内で断言しないよう注意）

- 講義資料の**一括ダウンロード**（単一のみ）。
- 課題提出・小テスト回答・掲示板投稿・メッセージ送信・ファイルアップロード（未実装）。
- 受講登録外コースの**内部コンテンツ**（教材・課題本文）取得（シラバス/検索の公開情報のみ）。

## 挙動の注意（重要）

- 各ツールは裏でブラウザ（Playwright）＋サイレント SSO を使う。**初回や get_course/download は10〜20秒**かかることがある。
- **タイムアウトや一時的な失敗は再試行で回復する。Claude Code の再起動は不要**。「全ツールが壊れた」と即断しない。
- 未ログイン時は自動ログインせず `utol-mcp login`（手動SSO）を案内する。
- ブラウザプロファイルは同時1プロセスのみ。アイドル時に自動解放するため、連続実行でなければ競合しない。

## 事実に忠実に

- ファイル名・締切・課題内容などは**ツールの実返却値のみ**を根拠にする。過去ターンや推測で値を作らない（存在しないファイル名等を前提に進めない）。
- 引数スキーマは上記のとおり。`courseIdnumber`/`fileId`/`savePath` のような名前は誤り。
