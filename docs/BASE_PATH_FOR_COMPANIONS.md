# 基準パスと保存フォルダ（連携アプリ向け仕様）

PopNote! など、Tomelet と連携するアプリの開発者向けにまとめた文書です。Tomelet 本体の「基準パス」と、こびとツール共通の保存フォルダ `.kobito-tools/` の決まりを説明します。

- **1〜3章**：基準パスとデータセット、保存フォルダの形
- **4〜5章**：共有タグと、PopNote! のメモの保存・表示（本体・PopNote! の両方で**実装済み**）
- **5a章**：Pastephant（クリップボード履歴）から残した日ごとのメモ（本体・Pastephant の両方で**実装済み**）
- **6章**：旧形式 `.TickTockTome/` からの移行

---

## 1. 基準パスとは

**基準パスは1か所だけ**です。利用者が選んだフォルダ（例：Google Drive の「マイドライブ」）を基準パスとし、Tomelet のデータはすべてこのフォルダを基準に管理します。

- 書籍・文書・一般ファイルは、基準パスからの**相対パス**だけで参照します。ファイル本体はコピーしません。
- APIで場所を表すときは、常に `rootId: "base"` と `relativePath`（基準パスからの相対パス、区切りは `/`）の組を使います。

## 2. 保存フォルダ `.kobito-tools/`

基準パスは1つの箱（**データセット**）として扱います。基準パスの直下に隠しフォルダ `.kobito-tools/` を置き、アプリごとのフォルダに分けて保存します。

```text
<基準パス>/
├── Book/ Paper/ …                     ← 利用者のファイル（アプリはコピーしない）
└── .kobito-tools/
    ├── dataset.json                   ← ID（両アプリ共通）と本体の共有設定
    ├── Tomelet/                       ← 本体（Tomelet と同じアイコン付き）
    │   ├── lock.json                  ← 本体の使用中の印
    │   ├── database/ticktocktome.sqlite3
    │   └── uploads/ backups/ exports/ quarantine/
    ├── PopNote/                       ← PopNote!
    │   ├── lock.json                  ← PopNote! の使用中の印
    │   ├── database/popnote.sqlite3   ← メモ（本体と同じ表の形）
    │   └── uploads/                   ← メモに貼った画像
    ├── Pastephant/                    ← Pastephant（書き出すときだけ使う）
    │   ├── lock.json                  ← 書き出し中の印
    │   ├── database/pastephant.sqlite3 ← 日ごとのクリップのメモ（本体と同じ表の形）
    │   └── uploads/                   ← メモに添付した画像
    └── Tags/tags.json                 ← 両アプリで共有するタグ
```

- **ID**：利用者が付ける名前です（例：「研究用」「個人」）。60文字以内で日本語も使え、後から変更できます。どちらのアプリで作っても同じ `dataset.json` を使います。
- **データセットキー**：基準パス（シンボリックリンクを解決した絶対パス）の SHA-256 の先頭16桁です。IDは変更できますが、キーは同じ場所なら変わりません。
- `dataset.json`：`{"format": "kobito-tools-dataset", "schemaVersion": 1, "datasetId", "createdAt", "revision", "settings": {}, "legacyRoots": {}}`。`settings` は本体の共有設定で、PopNote! は読み書きしません。
- どちらのアプリも、自分のフォルダが無ければ作ります。`.kobito-tools/` 自体が無いときは `.kobito-tools-creating-<uuid>/` で作ってから名前を変えます。
- **1つのSQLiteを2つのアプリから書き込みません。** 本体は `Tomelet/`、PopNote! は `PopNote/` のDBだけに書き込みます。

### このPCだけに保存するもの

OS標準のローカル領域（macOS では `~/Library/Application Support/TickTockTome/config/`）には、次だけを保存します。

| ファイル | 中身 |
|---|---|
| `setting.json` | 現在の基準パス、これまで開いた基準パスの一覧、ポート、PCの識別子、ローカルLLMの場所 |
| `integrations.json` | 連携アプリのトークン（PopNote! の `memo:read`・`memo:write` など） |

## 3. 開く・切り替える

- Tomelet のサーバーは、**同時に1つのデータセットだけ**を開きます。切替はサーバーを再起動せずに行います。
- フォルダを選ぶと、`.kobito-tools/dataset.json`（または旧 `.TickTockTome/`）があれば保存されたIDで「『ID』に切り替えますか？」と確認し、無ければIDを付けて作ります。PopNote! だけが作ったデータセットでも、本体はIDを引き継いで `Tomelet/` を作ります。
- **排他ロック**：開いている間は各アプリのフォルダの `lock.json` に使用中の印を置きます（30秒ごとに更新し、2分更新が無ければ期限切れ）。本体とPopNote! は別々のフォルダに印を置くので、互いに引き継ぐ必要はありません。
- 本体が基準パスを開いていないとき（未設定・見つからない・別のPCが使用中）は、すべての `/api/` がHTTP 503（`setupRequired: true`）を返します。

## 4. 共有タグ（`Tags/tags.json`）

正本は `tags.json` で、各アプリのDBの `tags`・`tag_categories` 表はその写しです（メモや日記との関連付けに外部キーを使うため）。

```json
{ "format": "kobito-tags", "schemaVersion": 1, "revision": 12, "updatedAt": "…",
  "categories": [{ "id", "name", "description", "displayOrder", "revision", "deletedAt" }],
  "tags": [{ "id", "categoryId", "name", "description", "displayOrder", "revision", "archivedAt", "deletedAt" }] }
```

同期の規則（本体 `scripts/tag-store.js`、PopNote! `Sources/TagStore.swift` で同じ）：

1. `tags.json` とDBの写しを読み、IDごとに `revision` の大きい方を採ります。同じ `revision` で内容が違う場合は、キーを並べた内容の文字列が大きい方を採ります（どちらのアプリでも同じ結果になるため）。
2. 同じ名前が2つあれば、IDの順で後になる方の名前に ` (IDの末尾4文字)` を付け、`revision` を1上げます。
3. 分類が見つからないタグは「その他」（`other`）へ入れます。
4. 結果をDBへ反映します（名前の入れ替えで一意制約に触れないよう、先に仮の名前へ退避）。
5. `tags.json` と違えば、書く直前にもう一度読み、`revision` が変わっていなければ `revision + 1` で一時ファイルから置き換えます。変わっていれば1からやり直します。

- タグを**完全削除することはありません**（アーカイブのみ）。片方のDBに参照先のない関連が残らないようにするためです。
- タグを作る・変えるときは、直前に同期してから変更し、変更後すぐに同期します。

## 5. PopNote! のメモ

### 保存（PopNote!）

- PopNote! は保存先フォルダ（基準パス）を自分で選び、`.kobito-tools/PopNote/` の自分のDBへ**直接**保存します。本体の起動状態には左右されません。
- 新しいDBは、本体の `migrations/*.sql` の写し（PopNote! の `schema/`）をファイル名順に適用して作ります。PRAGMAは本体と同じ（`foreign_keys=ON`・`journal_mode=DELETE`・`synchronous=FULL`・`busy_timeout=5000`）です。
- 別のPCの PopNote! の印が有効な間は書き込まず、「『PC名』で使用中です」と案内します。

### 表示（本体）

- 本体は起動時に `PopNote/database/popnote.sqlite3` を見つけると、まだ決めていなければ「PopNote!のデータが確認されました。本アプリ上でも表示しますか？」と尋ねます。答えは `dataset.json` の `settings.showPopNoteMemos`（`true`・`false`、未回答は無し）に保存します。
- 表示する場合、本体はPopNote! のDBを**読み取り専用**で開き、削除されていないメモとその関連（タグ・添付ファイルの登録・貼り付け画像）を自分のDBの `memos` 表へ写します。DBの更新日時・大きさが変わったときだけ写し直します。本体からメモは編集しません。
- 貼り付け画像は `PopNote/uploads/` に置いたまま、本体の `/api/v1/uploads/<id>/content` から配信します。

### 連携API（本体）

| API | 内容 |
|---|---|
| `GET /api/v1/integrations/memo/context` | `dataset: {id, key, basePath}`。本体が今開いている基準パスで、PopNote! が保存先の候補として示す |
| その他の `/api/v1/integrations/memo/…` | 410 `{"code": "popnote-update-required"}`（本体経由でメモを書き込んでいた古い PopNote! 向け） |
| `companion-connect.js popnote --no-launch` | サーバーを起動せずに、ポートと専用トークンだけを返す |
| 「✎」・カレンダーのメモ | `popnote://open/<メモID>?dataset=<キー>` で開く。PopNote! は保存先が違えば、そのキーの保存先へ切り替えてから開く |

## 5a. Pastephant から残したクリップ

Pastephant（クリップボード履歴）は、履歴そのものは各Macの `~/Library/Application Support/Pastephant/` に置き、基準パスには書き出した物だけを置きます。

- **書き出し（Pastephant）**：`⌘S` やタグの規則で残すと、その日の分を「09月28日のクリップ」という1つのメモにまとめ、`.kobito-tools/Pastephant/database/pastephant.sqlite3` に保存します（同じ日の2回目以降は末尾に追記）。DBは PopNote! と同じく本体の `migrations/*.sql` の写し（Pastephant の `schema/tomelet/`）で作り、PRAGMAも同じです。書き出す間だけ `lock.json`（`app: "pastephant"`）を置きます。
- 本文は本体のメモと同じ規則のHTML（`div`・`b`・`br`・`img`）で、画像は `managed_uploads`・`memo_uploads` に登録し、実体は `Pastephant/uploads/` に置きます。タグは共有タグ（4章）の ID で `memo_tags` に入れます。
- **表示（本体）**：`Pastephant/database/pastephant.sqlite3` を見つけると、PopNote! と同じように一度だけ表示するかを尋ね、`dataset.json` の `settings.showPastephantMemos` に保存します。表示する場合は `mirrorCompanionMemos`（`scripts/popnote-memos.js`）で PopNote! のメモと一緒に `memos` 表へ写します。画像は本体の `uploads/` に無ければ `PopNote/uploads/`・`Pastephant/uploads/` の順に探します。
- **開く**：Pastephant のメモを開くと、`pastephant://open?query=exported:<日付>` で Pastephant の履歴を、その日に残した項目に絞って開きます。

| API | 内容 |
|---|---|
| `PUT /api/v1/settings/pastephant-memos` | `{revision, show}`。表示する・しないを共有設定に保存する |
| `GET /api/v1/bootstrap` の `pastephant` | `{detected, show}` |

## 6. 旧形式 `.TickTockTome/` からの移行

以前は本体とPopNote! が `.TickTockTome/database/ticktocktome.sqlite3` を共有していました。本体は `.kobito-tools/` が無く `.TickTockTome/` だけがある基準パスを開くとき、次のように分割移行します（`dataset.js` の `migrateLegacyLayout`、手動なら `node tools/migrate-kobito-tools.js <基準パス>`）。

1. 旧 `lock.json` が有効なら（別のPC、または同じPCで動いている本体・PopNote!）移行しません。
2. 旧DBの整合性を確かめた複製を `Tomelet/` に作り、`uploads/`・`backups/` なども複製します。
3. メモがあれば、`PopNote/database/popnote.sqlite3` を新しく作り、メモ・メモのタグ・添付ファイルの登録・貼り付け画像を写します。本体側の複製からはメモを消します。
4. タグと分類を `Tags/tags.json` へ書き出します。
5. すべて一時フォルダで用意してから `.kobito-tools/` へ名前を変え、旧フォルダは `.TickTockTome.migrated/` として残します。

PopNote! は旧形式を自分では移行せず、Tomelet で基準パスを一度開くよう案内します。

---

## 用語

| 用語 | 意味 |
|---|---|
| 基準パス | 利用者が選んだ1つのフォルダ。すべてのファイル参照の起点 |
| データセット | 基準パスと、その直下の `.kobito-tools/` に保存されたデータのまとまり |
| ID | データセットに利用者が付けた名前。変更できる |
| データセットキー | 基準パスの場所から作る識別子。IDを変えても変わらない |
| 設定待ち | 本体が開いているデータセットが無く、APIが503を返す状態 |
