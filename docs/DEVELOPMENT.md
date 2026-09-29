# 開発について

Tomelet の構成、データの保存方法、開発・保守用のコマンドをまとめます。利用方法は [README](../README.md) を、コードの構成は [ARCHITECTURE.md](../ARCHITECTURE.md) を参照してください。

## 全体像

| 部分 | 役割 | 保存場所 |
|---|---|---|
| 画面 | 日記を書く・探す・開く | Gitリポジトリ内 |
| ローカルAPI | 画面からの依頼を検証する受付係 | Gitリポジトリ内 |
| SQLite | 日記、タグ、時間割、作業履歴を保存 | 基準パス直下の`.kobito-tools/Tomelet/` |
| 関連ファイル・本・文書のPDF | 基準パスからの相対パス（本体はコピーしない） | SQLite／本体は基準パス内 |
| 表紙画像・時間割からアップロードした添付 | ファイル実体 | `.kobito-tools/Tomelet/uploads/` |
| PC固有設定・認証情報 | 現在の基準パス、ポート、連携トークン、ローカルLLMの場所 | Gitリポジトリ外のローカル領域 |

主要データは、利用者が選んだ基準パス直下の隠しフォルダ`.kobito-tools/`へ保存します。Tomeletのデータは`.kobito-tools/Tomelet/`（アプリと同じアイコン付き）、PopNote!のメモは`.kobito-tools/PopNote/`、両アプリ共通のタグは`.kobito-tools/Tags/tags.json`です。PC固有設定は、ソースコードとは別の次の場所へ保存します。

- macOS: `~/Library/Application Support/TickTockTome/`
- Windows: `%LOCALAPPDATA%\TickTockTome\`
- テストや上級者向け変更: 環境変数 `TICKTOCKTOME_DATA_DIR`


## 開発に必要なもの

- Node.js 22.5以上
- macOSまたはWindows
- 初回設定時以外はインターネット接続不要

npmパッケージは使用していません。SQLiteにはNode.js本体の機能を使用します。

## コマンドからのセットアップと起動

```text
node scripts/setup.js          # 連携トークンの用意、DBの検査、macOSでは Tomelet.app の生成
node scripts/setup.js --check  # 設定の確認だけ（アプリは作り直さない）
npm start                      # サーバーを起動（既定は http://localhost:3174/）
npm test                       # テスト
npm run package:mac            # Releases 用の dist/Tomelet_<版>_universal.dmg を作成（macOS）
```

`npm run package:mac`（`tools/package-macos-release.js`）は、Node.js や Xcode の無い Mac でも動く `Tomelet.app` を作ります。`.app` の中に、コミット済みのソース（`git archive`）、nodejs.org の公式ビルドから作ったユニバーサル版の Node.js（ハッシュを照合し、`.build/node/` に保存して再利用）、ビルド済みの常駐タイマーを入れます。版番号は `package.json` の `version` です。同梱する Node.js は、macOS 12 に対応する 22 系です（24 系は macOS 13.5 以上が必要）。

`Tomelet-Setup` で作る `.app` は、このフォルダと手元の Node.js を Info.plist に絶対パスで記録します。配布用の `.app` は `.app` からの相対パス（`Contents/Resources/app`、`Contents/MacOS/node`）を記録します。PopNote! はこの2つのキーから本体を探すため、どちらの形にも対応しています。

旧名 DailyLog で使っていた場合は、新しい名前の領域が無い限り、既存の `DailyLog` フォルダと `dailylog.sqlite3` をそのまま使います。環境変数も旧名の `DAILYLOG_DATA_DIR`、`DAILYLOG_PORT` を引き続き読み取ります。

内部の識別子（PC固有設定の `TickTockTome/`、バンドルID `local.ticktocktome.desktop`、環境変数 `TICKTOCKTOME_*`）は、旧名 Tick Tock Tome のまま据え置いています。既存のデータと PopNote! との連携を保つためです。

## データの保存方法

SQLiteへ実体を保存するもの：

- 日記本文
- メモの見出し・本文（装飾つきHTML）・タグ・添付との関係
- 日付、題名、タグ
- 時間割の時間、アクション、場所、達成度、タグ、完了項目、関連項目のID
- 書籍・文書の書誌情報、読書状態、要点、日記との関連
- Activity Loggerから受け取った作業履歴
- Todo・時間割から登録した管理ファイルの名前・相対パス（ファイル本体ではありません）
- 管理ファイルとTodo・アクションの関係、および関係先から集計したタグ

基準パスから登録するファイル本体はTomeletへコピーしません。DBには次だけを保存します。

```text
基準パスからの相対パス
```

ファイルを開く直前に、基準パスの外へ出ていないか、シンボリックリンク先も含めて検査します。

ファイル一覧は、Todoまたは時間割から利用者が登録したファイルを表示します。名前・相対パス・関連するTodo／アクション・そこから集計したタグをSQLiteだけで検索します。複数のタグを選んだ場合は、選択したタグをすべて含むファイルだけを表示します（AND検索）。一覧表示時にはファイル本体へアクセスせず、存在確認は詳細画面の「OSの標準アプリで開く」を押したときだけ行います。旧File Indexer由来の索引は既存データ保全のためDBに残しますが、現在のファイル画面には混在させません。

本・文書のPDFは、基準パスからの相対パスだけを保存します。PDFの容量による登録制限はありません。新規作成・編集フォームの「PDF」から選択できます。ブラウザはドロップしたファイルの絶対パスを取得できないため、ドロップ時も選択画面で同じPDFを選び直してください。基準パスの外のファイルは登録できません。

本・文書のPDFと一般ファイルはコピーせず、基準パスからの相対パスだけを保存します。表紙画像と、旧版で直接追加済みの添付は、`.kobito-tools/Tomelet/uploads/`へ実体を保存します。既存データは移行時にも削除しません。

PDF追加直後の資料は「未確認」となり、一覧に赤い印を表示します。ローカルLLMは初期状態では無効で、モデルを自動ダウンロードせず、外部APIにも送信しません。設定画面の手順に従って`llama-cli`、GGUFモデル、`pdftotext`の場所を明示的に設定した場合だけ、PDFから書誌情報の候補を抽出します。候補は自動保存されず、編集画面で確認して保存します。

## 保存場所の考え方

Tomeletは、基準パスを1つの「データセット」として扱います。

```text
基準パス/                       ← 書籍・文書・ファイルはここからの相対パスで管理
├── Book/ Paper/ …              ← 利用者のファイル（コピーしない）
└── .kobito-tools/              ← こびとツール共通の隠しフォルダ
    ├── dataset.json            ← ID（両アプリ共通）、配色・フォント・タグ表示・PopNote!表示の設定
    ├── Tomelet/                ← アプリと同じアイコン
    │   ├── lock.json           ← 使用中の印（開いている間だけ）
    │   ├── database/ticktocktome.sqlite3
    │   └── uploads/  backups/  exports/  quarantine/
    ├── PopNote/                ← PopNote!のメモ（database/popnote.sqlite3・uploads/・lock.json）
    └── Tags/tags.json          ← 両アプリで共有するタグ（各DBのtags表はこの写し）
```

以前の版の`.TickTockTome/`（本体とPopNote!が1つのDBを共有）は、開いたときに`scripts/dataset.js`の`migrateLegacyLayout`で上の形へ分割移行し、元のフォルダは`.TickTockTome.migrated/`として残します。手動で移行するときは`node tools/migrate-kobito-tools.js <基準パス>`を使います（TomeletとPopNote!を終了してから）。

- **データセット（基準パス側）**：ID、日記、時間割、書籍・文書の情報、表紙画像、添付、バックアップ、外見の設定
- **PC固有設定**：現在の基準パス、ポート番号、アプリ連携用トークン、ローカルLLMの実行ファイルの場所

基準パスをGoogle Driveなどの同期フォルダにすれば、別PCでも同じフォルダを基準パスに選ぶだけで同じデータを開けます。フォルダごと移動しても、相対パスで管理しているため参照は切れません。

> 開いている間は`.kobito-tools/Tomelet/lock.json`に使用中の印を置き、別のPCから同時に開こうとすると確認を表示します。同時に開くと片方の変更が失われるおそれがあるため、PCを切り替えるときは先にTomeletを終了し、同期の完了を確認してください。複数PCでの同時編集は、今後、PCごとの変更ログを同期する方式で対応する予定です。

## README のデモGIFを作り直す

```text
node tools/record-demo.js
```

一時フォルダにデモデータを作ってサーバーを起動し、ヘッドレスの Google Chrome で画面を撮影して `docs/images/demo.gif` を書き出します。実データには触れません。Google Chrome と ffmpeg が必要です。

## デモデータで画面を試す

デモは実データと混ざらない専用フォルダへ作成します。指定先が空でなければ処理を停止します。

```text
node tools/create-demo-data.js --data-dir "/path/to/ticktocktome-demo"
TICKTOCKTOME_DATA_DIR="/path/to/ticktocktome-demo" node scripts/server.js
```

日記4件、時間割2件、書籍6件、文書3件、作業履歴2件、管理ファイル2件が作成されます。資料名や内容はすべて架空です。

## ResearchNoteからの移行

先にバックアップを作り、移行先を空のTomelet DBにすることを推奨します。移行元JSONは変更しません。

```text
node tools/import-researchnote-json.js --source "/path/to/ResearchNote/data"
```

ResearchNoteで登録した関連ファイルも引き継ぐ場合：

```text
node tools/import-researchnote-json.js --source "/path/to/ResearchNote/data" --root-id documents
```

- 同じ日の複数活動は、1件の日記へまとめます。
- ResearchNoteの全活動・論文・タグ原文は`legacy_import_records`へ保存します。
- 同じ入力はハッシュで検出し、二重に移行しません。
- 移行先に同じ日の日記がある場合は、安全のため停止します。

## バックアップと検査

```text
node tools/backup-database.js
node tools/check-database.js
node tools/restore-database.js --from "/path/to/backup.sqlite3"
```

バックアップはGitリポジトリ外の`backups`へ作られます。将来の更新でDBの表構成を変更する場合も、変更直前のDBが自動で同じ場所へ退避されます。

## 他アプリとの連携

初回設定で、Activity LoggerとCommand Center用のランダムトークンを生成します。実トークンはGit管理外の`integrations.json`に保存されます。File Indexer連携は新規利用の前提にせず、旧版との互換APIだけを残しています。

| 連携元 | API | 権限 |
|---|---|---|
| Activity Logger | `POST /api/v1/integrations/activity-events:batch` | `activity:write` |
| 旧File Indexer（互換用） | `POST /api/v1/integrations/file-index:batch` | `files:write`（新規セットアップではトークンを作成しません） |
| Command Center | `GET /api/v1/integrations/command/search` | `search:read` |
| Command Center | `GET /api/v1/integrations/command/journals/by-date/:date` | `journal:read` |
| Command Center | `POST /api/v1/integrations/command/journals` | `journal:write` |

HTTPヘッダーへ`Authorization: Bearer <token>`を指定します。APIは`127.0.0.1`だけで待ち受けます。

送受信する項目と具体例は[INTEGRATIONS.md](INTEGRATIONS.md)を参照してください。

## GitHubへ公開する前の確認

実行します。

```text
npm run check:public
npm test
git status --short
```

以下は公開しません。

- `ticktocktome.sqlite3`
- DBバックアップ
- `setting.json`
- `integrations.json`
- 実データのJSONエクスポート
- 実際のファイルパス
- 作業履歴を含むログ

詳しい構成は[ARCHITECTURE.md](../ARCHITECTURE.md)を参照してください。

初めてGitHubへ公開するときは[PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md)の順に確認してください。
