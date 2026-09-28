# 他アプリ連携

## 最初に全体像

APIは、Tomeletへ決められた形式で依頼を渡す「専用受付」です。他アプリがSQLiteを直接開くことはありません。

```text
Activity Logger ──作業履歴──┐
将来の外部アプリ ──限定データ──┼→ 認証付きローカルAPI → 検証 → TomeletのSQLite
Command Center ─検索・日記───┤
PopNote! ─────メモ──────────┘
```

| 相手 | できること | できないこと |
|---|---|---|
| Activity Logger | 作業履歴の追加・更新 | 日記の読取・変更 |
| 将来のファイル連携アダプター | 現時点では未実装 | Tomeletは外部索引を前提にせず、Todo・時間割から管理ファイルを登録 |
| Command Center | 検索、日付指定、日記作成 | 作業履歴の変更 |
| PopNote! | メモの作成・更新・削除、メモ用タグの作成、画像添付、基準パス内のファイルの添付 | 日記・時間割・設定の読取・変更 |

## 共通ルール

- 接続先は既定で`http://127.0.0.1:3174`。
- Tomeletが停止中なら接続エラーにし、相手側で後から再送する。
- 実トークンは個人データ領域の`config/integrations.json`だけに保存する。
- `Authorization: Bearer <そのアプリ用トークン>`をHTTPヘッダーへ付ける。
- 送信する`source.id`は、そのトークンに登録されたアプリIDと同じにする。
- 更新APIは`Content-Type: application/json`を付ける。
- 1回の取込は最大1000件。大量データは分割する。
- 同じ`source.id + externalId`は新規追加ではなく更新として扱う。
- 小さい`sourceRevision`の古い再送は、現在値を上書きしない。
- タイムアウトや5xxエラーは再送可能。4xxエラーは入力または認証を直してから再送する。

## Activity Logger

`POST /api/v1/integrations/activity-events:batch`

```json
{
  "source": { "id": "activity-logger", "name": "Activity Logger" },
  "events": [
    {
      "externalId": "event-example-001",
      "startedAt": "2026-01-15T09:00:00+09:00",
      "endedAt": "2026-01-15T09:30:00+09:00",
      "applicationName": "Example Editor",
      "windowTitle": "Example document",
      "rootId": "base",
      "relativePath": "Example/document.txt",
      "projectName": "Example Project",
      "sourceRevision": 1,
      "sourceUpdatedAt": "2026-01-15T09:31:00+09:00"
    }
  ]
}
```

`filePath`の絶対パスは送りません。ファイルを表す場合は、`rootId: "base"` と基準パスからの相対パス（`relativePath`）を使います。基準パスは1か所だけで、Tomeletが現在開いている基準パスのデータへ保存されます（[基準パスの一本化](BASE_PATH_FOR_COMPANIONS.md)）。

旧版の種類別ID（`files`・`books`・`papers`など）で送った場合も、移行時に基準パスの中にあった場所なら、基準パスからの相対パスへ自動で読み替えます。

## 旧File Indexer互換API

新しいTomeletはFile Indexerを前提にしません。一般ファイルはTodo・時間割の編集画面から登録します。以下は旧版の既存データや自作連携を壊さないために残している互換仕様で、新規セットアップでは専用トークンを生成しません。

`POST /api/v1/integrations/file-index:batch`

```json
{
  "source": { "id": "file-indexer", "name": "File Indexer" },
  "items": [
    {
      "externalId": "file-example-001",
      "rootId": "base",
      "relativePath": "Example/document.txt",
      "name": "document.txt",
      "extension": ".txt",
      "sizeBytes": 1200,
      "modifiedAt": "2026-01-15T09:30:00+09:00",
      "indexedAt": "2026-01-15T09:32:00+09:00",
      "sourceRevision": 1,
      "missing": false
    }
  ]
}
```

移動・削除を検出したファイルは、いきなりレコードを消さず`missing: true`として送れます。

## Command Center

| 操作 | 方法とパス |
|---|---|
| 横断検索 | `GET /api/v1/integrations/command/search?q=keyword` |
| 日付の日記 | `GET /api/v1/integrations/command/journals/by-date/2026-01-15` |
| 日記作成 | `POST /api/v1/integrations/command/journals` |

日記作成の例：

```json
{
  "entryDate": "2026-01-15",
  "title": "今日の記録",
  "bodyMarkdown": "## メモ\n\n本文",
  "tagIds": [],
  "projectIds": [],
  "files": []
}
```

その日の日記がすでにある場合は上書きせず、既存の日記と`alreadyExisted: true`を返します。

## curlでの疎通確認例

次の`REPLACE_WITH_PRIVATE_TOKEN`は、実トークンへ置き換えます。実トークンをソースコード、README、Git履歴へ貼り付けないでください。

```text
curl -H "Authorization: Bearer REPLACE_WITH_PRIVATE_TOKEN" "http://127.0.0.1:3174/api/v1/integrations/command/search?q=example"
```

## PopNote!

基準パスの扱いと、メモの保存先に関する仕様変更は[BASE_PATH_FOR_COMPANIONS.md](BASE_PATH_FOR_COMPANIONS.md)にまとめています。

PopNote! はトークンを手で設定しません。本体が起動しているときに `node scripts/companion-connect.js popnote --no-launch` を実行し、`config/integrations.json` へ `memo:read`・`memo:write` 権限のトークンを登録します（登録済みなら同じトークン）。このスクリプトは `{"port", "token"}` を標準出力へ返します。`--no-launch` を付けない場合は、サーバーを本体ウィンドウなしで起動してから返します。

書き込み・読み取りに `X-TickTockTome-Dataset: <データセットキー>` を付けると、本体が開いているデータセットと違う場合に409（`{"code": "dataset-mismatch", "current": {"id", "key"}}`）を返して処理しません。

GETは`memo:read`、それ以外は`memo:write`が必要です。パスはすべて `/api/v1/integrations/memo/` からの相対です。

| メソッド・パス | 内容 |
|---|---|
| `GET context` | 開いているデータセット（`dataset: {id, key, basePath}`）、タグ、タグ分類、基準パス（`base`）の利用可否 |
| `GET memos?q=&from=&to=` | メモ一覧（見出し・本文・タグ名で検索。`from`・`to` は作成日時の範囲で、ISO形式のUTC） |
| `GET memos/<id>` | メモ本文、タグ、添付 |
| `POST memos` | メモ作成。`createdAt` を省略すると現在時刻 |
| `PUT memos/<id>` | メモ更新。`revision` が古い場合は409 |
| `DELETE memos/<id>` | ゴミ箱へ移動（`{"revision"}`） |
| `POST tags` | `{"name"}` と同名のタグを返し、無ければ「その他」に作成 |
| `POST uploads` | 画像を保存（`{"name","mimeType","base64"}`、25MBまで） |
| `POST files:pick` | 基準パス内のファイル選択画面を開き、選んだファイルを登録 |
| `POST files:reference` | `{"relativePath"}` の基準パス内のファイルを登録（連携アプリ側で選んだ場合） |
| `POST files/<id>:open` | 登録済みファイルをOS標準アプリで開く |

```json
{
  "title": "",
  "bodyHtml": "<div>会議の<b>決定事項</b></div>",
  "createdAt": "2026-01-15T05:05:07.000Z",
  "tagIds": ["tag-example"],
  "managedFileIds": [],
  "uploadIds": []
}
```

`title` が空なら「01月15日14時05分07秒のノート」形式の見出しを付けます。`bodyHtml` はサーバーで許可リスト（`b`・`i`・`u`・`s`・`br`・`div`・`ul`・`ol`・`li`と、`/api/v1/uploads/<id>/content` を指す `img`）へ整え、属性は保存しません。
