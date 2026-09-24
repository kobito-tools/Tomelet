# Tick Tock Tome

<img src="assets/icon/app-icon-1024.png" width="96" align="right" alt="">

## Todoとタイマー

TodoはHOMEと時間割の間にあります。名前、複数タグ、期限日、達成度を登録し、時間割の2段階追加画面から取り込めます。Todoの達成度は0〜99%を1%刻みで調整し、100%の完了はアクションの実行履歴と一緒に記録します。添付欄には選択済みのファイル名だけを表示し、「添付を選ぶ」から右側の選択画面を開いて、一般ファイル・くらしの本・まなびの本・論文を種類ごとに検索、追加できます。Todoは独立したテーブル、ID、更新日時、競合確認用の版番号、削除情報を持ちます。スマホから追加する認証付き同期機能は将来拡張であり、現時点では外部ネットワークへ公開しません。

時間割の関連資料は名前・著者による検索とタグの絞り込みで探せます。左下の「アクション開始」では、新しいアクション、今後の予定、Todoを選び、目標所要時間を指定します。「完了とする」では達成度とメモを記録し、100%未満ならTodoへ残すかを選択します。Todoへ残す期限日の初期値は今日です。終了時間を超えた未処理アクションは、次回起動時に1件ずつ確認します。

「常駐 ON」で左下に独立したタイマーウィンドウを表示できます。独立ウィンドウの「常駐OFF」で閉じ、「完了」でTick Tock Tomeを前面へ出して完了入力画面を開きます。macOSではSwiftのビルド環境（Command Line Tools）が必要です。WindowsではPowerShellとWindows Formsを使います。通常のアプリより手前に表示しますが、OSの保護画面などより上に表示される保証はありません。Tick Tock Tomeを終了すると常駐タイマーも終了します。

画面内タイマーは、現在の時間枠にあるアクション名と終了までの時間、次のアクションと開始時刻を表示します。時間枠外では「休憩中」とし、次の予定があれば開始までを、なければ現在時刻を表示します。

## メモ（連携アプリ PopNote!）

会議中などにすぐ書くメモは、別リポジトリで公開している macOS アプリ [PopNote!](https://github.com/kobito-tools/PopNote) で書きます。PopNote! を入れると、次のように連携します。

- PopNote! で書いたメモは Tick Tock Tome の SQLite に保存され、作成日時のカレンダー、横断検索、ファイル一覧の関連作業、活動分析の元データに加わります。
- 画面上部に「✎」が表示され、カレンダー・検索結果・ファイル詳細のメモから PopNote! の該当メモを開けます。
- PopNote! だけを起動した場合は、Tick Tock Tome のウィンドウを出さずにローカルサーバーだけを起動します。サーバーは両方のアプリを閉じたときに止まります。
- 削除したメモは設定画面のゴミ箱から復元できます。

PopNote! は初回起動時に `scripts/companion-connect.js` を通じて専用トークン（`memo:read`・`memo:write` のみ）を `config/integrations.json` へ登録し、以後は[連携API](docs/INTEGRATIONS.md)だけでメモを読み書きします。

## キーボードショートカット

Macでは`⌘`、Windowsでは`Ctrl`と数字を組み合わせてタブを切り替えます。通し番号1〜9は同じ数字、10は`0`、11は`Shift+9`、12は`Shift+0`です。検索欄は`⌘K`または`Ctrl+K`です。ナビゲーションには通し番号だけを小さく表示し、一覧の下に操作方法をまとめています。OSの判定はブラウザ名ではなく、Tick Tock Tomeサーバーが動いているPCを基準にします。

## フォント

設定画面から「クラシック・モダン・まるもじ・てがき・明朝」を選べます。Noto Sans Japanese、Rounded M+ 1c、Yomogi、Shippori Minchoをアプリへ同梱しているため、OSに入っているフォントには依存しません。これらはSIL Open Font License 1.1で再配布でき、ライセンス本文と入手元は[`assets/fonts/`](assets/fonts/)に収録しています。

日記、作業履歴、関連ファイルを、自分のPC内で管理するローカルファーストの個人用アプリです。

## 全体像

| 部分 | 役割 | 保存場所 |
|---|---|---|
| 画面 | 日記を書く・探す・開く | Gitリポジトリ内 |
| ローカルAPI | 画面からの依頼を検証する受付係 | Gitリポジトリ内 |
| SQLite | 日記、タグ、時間割、作業履歴を保存 | Gitリポジトリ外（設定画面で変更可能） |
| 関連ファイル | `files`基準パスIDと相対パス（本体はコピーしない） | SQLite／本体はファイル用基準フォルダ内 |
| 本・論文のPDF | 基準フォルダIDと相対パス（本体はコピーしない） | SQLite／本体は基準フォルダ内 |
| 表紙画像・時間割からアップロードした添付 | ファイル実体 | Git外の`uploads` |
| PC固有設定・認証情報 | 種類別の基準パス、主要データ保存先へのポインタ、連携トークン | Gitリポジトリ外のローカル領域 |

実データは、初めからソースコードとは別の場所へ保存します。

- macOS: `~/Library/Application Support/TickTockTome/`
- Windows: `%LOCALAPPDATA%\TickTockTome\`
- テストや上級者向け変更: 環境変数 `TICKTOCKTOME_DATA_DIR`

旧名DailyLogで使っていた場合は、新しい名前の領域が無い限り、既存の`DailyLog`フォルダと`dailylog.sqlite3`をそのまま使います。データの移動は不要です。環境変数も旧名の`DAILYLOG_DATA_DIR`、`DAILYLOG_PORT`を引き続き読み取ります。

## 必要なもの

- Node.js 22.5以上
- macOSまたはWindows
- 初回設定時以外はインターネット接続不要

npmパッケージは使用していません。SQLiteにはNode.js本体の機能を使用します。

## 初回設定

GitHubからクローンした後、OSに合ったセットアップファイルを起動します。

| OS | 最初に起動するファイル | 作成・準備されるもの |
|---|---|---|
| macOS | `TickTockTome-Setup.command` | 個人データ領域、SQLite、連携トークン、`TickTockTome.app` |
| Windows | `TickTockTome-Setup.cmd` | 個人データ領域、SQLite、連携トークン、ブラウザ版の起動準備 |

macOSで「開発元を確認できない」と表示された場合は、Finderでファイルを右クリックして「開く」を選びます。

セットアップでは基準パスを入力しません。アプリを起動すると毎回、「ファイル」「くらしの本」「まなびの本」「論文」の4種類について設定済みか、参照可能かを確認します。未設定または見つからない場合は「基準パスの設定」が表示され、OS標準のフォルダ選択画面から設定できます。

コマンドからセットアップする場合だけ、次を実行します。

```text
node scripts/setup.js
```

基準パスはアプリの「設定」画面からいつでも再設定できます。「種類別の基準パス」の先頭には、日記・Todo・アクション・書誌情報・表紙画像・バックアップを置くTick Tock Tome主要データの保存先も表示します。内部IDはアプリが`files`、`books`、`textbooks`、`papers`として固定し、利用者がコマンドやIDを入力する必要はありません。

設定確認：

```text
node scripts/setup.js --check
```

## 起動と終了

macOS：

- アプリ版: `TickTockTome.app`
- 起動: `TickTockTome.command`
- 終了: `TickTockTome-Stop.command`

Windows：

- 起動: `TickTockTome.cmd`
- 終了: `TickTockTome-Stop.cmd`

コマンドから直接起動する場合：

```text
npm start
```

既定では `http://localhost:3174/` を開きます。

## 現在できること

- 1日1件の日記作成・編集
- 時間割の24時間表示、日付別編集、達成度・完了項目・関連資料の記録
- 予定・実績・完了率・タグ別時間・直近7日間を自動集計する活動分析
- 左ナビゲーション下部の予定連動カウントダウン
- 月・週・日を切り替えられるカレンダー表示と、時間割のドラッグによる日付変更
- 時間割のアクションとタグのつながりを表示する作業ツリー
- 連携アプリ PopNote! で書いたメモの保存と、カレンダー・検索への表示
- Markdown表示
- 固定8分類（関係・分野・テーマ・プロジェクト・活動・文脈・媒体・その他）によるタグ管理とアーカイブ・復元
- くらしの本・まなびの本の立体的な本棚表示とPDFドロップ追加
- 論文PDFの先頭ページを使った、立体的な論文棚表示とPDFドロップ追加
- くらしの本・まなびの本・論文の詳細表示、同じ画面内での編集、日記との関連付け
- 各資料のお気に入り登録と、LaTeXを含むメモ表示
- 論文のキーワード、DOIリンク、BibTeXコード全文の管理・コピー
- ファイル・フォルダの相対パス登録
- Todo・時間割へ添付したファイルを、名前・関連作業と、複数タグのAND条件から検索するカード一覧
- 起動時の基準パス確認と、設定画面からの追加・再設定
- 配色テンプレートと、背景色・カード色・ボタン色・文字色の変更、初期配色へのリセット
- 右上の目ボタンによるタグ単位の全画面表示フィルター
- 予定時刻と実績時刻を分離し、完了・実行中・未実施を予定順に確認
- ローカルLLMによる活動分析を、使用しない・手動・自動から選択
- 計画、振り返り、資料整理、基準パス、複数PC運用を10段階で説明する図入りの「使い方」画面
- OS標準アプリで関連ファイルを開く
- 日記の全文検索
- 画面上部からの日記・作業履歴・ファイル・資料の横断検索
- 日記と資料のゴミ箱への論理削除、復元、完全削除
- 完全削除前の自動DBバックアップ
- Activity Logger、Command Center用の認証付きローカルAPI（旧File Indexer取込は互換性のためのみ保持）
- ResearchNote JSONの非破壊移行

## データの保存方法

SQLiteへ実体を保存するもの：

- 日記本文
- メモの見出し・本文（装飾つきHTML）・タグ・添付との関係
- 日付、題名、タグ
- 時間割の時間、アクション、場所、達成度、タグ、完了項目、関連項目のID
- くらしの本・まなびの本・論文の書誌情報、読書状態、要点、日記との関連
- Activity Loggerから受け取った作業履歴
- Todo・時間割から登録した管理ファイルの名前・相対パス（ファイル本体ではありません）
- 管理ファイルとTodo・アクションの関係、および関係先から集計したタグ

基準パスから登録するファイル本体はTick Tock Tomeへコピーしません。DBには次だけを保存します。

```text
種類別の基準パスID + 選択したフォルダからの相対パス
```

ファイルを開く直前に、選択したフォルダ外へ出ていないか、シンボリックリンク先も含めて検査します。

ファイル一覧は、Todoまたは時間割から利用者が登録したファイルを表示します。名前・相対パス・関連するTodo／アクション・そこから集計したタグをSQLiteだけで検索します。複数のタグを選んだ場合は、選択したタグをすべて含むファイルだけを表示します（AND検索）。一覧表示時にはファイル本体へアクセスせず、存在確認は詳細画面の「OSの標準アプリで開く」を押したときだけ行います。旧File Indexer由来の索引は既存データ保全のためDBに残しますが、現在のファイル画面には混在させません。

本・論文のPDFは、基準フォルダIDと相対パスだけを保存します。PDFの容量による登録制限はありません。新規作成・編集フォームの「PDF」から選択できます。ブラウザはドロップしたファイルの絶対パスを取得できないため、ドロップ時も選択画面で同じPDFを選び直してください。基準フォルダ外のファイルは登録できません。

本・論文のPDFと一般ファイルはコピーせず、種類別基準パスからの相対パスだけを保存します。表紙画像と、旧版で直接追加済みの添付は、Git外の共有データ保存先にある`uploads/`へ実体を保存します。既存データは移行時にも削除しません。

PDF追加直後の資料は「未確認」となり、一覧に赤い印を表示します。ローカルLLMは初期状態では無効で、モデルを自動ダウンロードせず、外部APIにも送信しません。設定画面の手順に従って`llama-cli`、GGUFモデル、`pdftotext`の場所を明示的に設定した場合だけ、PDFから書誌情報の候補を抽出します。候補は自動保存されず、編集画面で確認して保存します。

## デモデータで画面を試す

デモは実データと混ざらない専用フォルダへ作成します。指定先が空でなければ処理を停止します。

```text
node tools/create-demo-data.js --data-dir "/path/to/ticktocktome-demo"
TICKTOCKTOME_DATA_DIR="/path/to/ticktocktome-demo" node scripts/server.js
```

日記4件、時間割2件、くらしの本・まなびの本・論文各3件、作業履歴2件、管理ファイル2件が作成されます。資料名や内容はすべて架空です。

## ResearchNoteからの移行

先にバックアップを作り、移行先を空のTick Tock Tome DBにすることを推奨します。移行元JSONは変更しません。

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

送受信する項目と具体例は[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)を参照してください。

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

詳しい構成は[ARCHITECTURE.md](ARCHITECTURE.md)を参照してください。

初めてGitHubへ公開するときは[docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md)の順に確認してください。
## 保存場所の考え方

Tick Tock Tomeは、次の2種類を分けて保存します。

- **共有データ**：日記、時間割、書籍・論文の情報、表紙画像、登録PDF、バックアップ
- **PC固有設定**：ファイル参照の基準パス、ポート番号、アプリ連携用トークン

共有データの保存先は、アプリの「設定 → 共有データの保存先」から変更できます。ローカルフォルダを選べばそのPCだけで完結し、Google Driveなどの同期フォルダを選べば別PCへ同期できます。切り替え時は現在のSQLiteを検証済みバックアップからコピーし、既存のTick Tock Tomeデータが選択先にある場合は上書きせず、そのデータを使用します。

> SQLiteをクラウド同期フォルダに置く場合、複数PCでTick Tock Tomeを同時に起動しないでください。クラウド同期はデータベース用のネットワーク共有ではないため、同時編集すると競合コピーが作られる可能性があります。PCを切り替える前にTick Tock Tomeを終了し、同期完了を確認してください。

ファイル参照の基準パスはPCごとに異なるため共有されません。別PCでは同じ内部IDに、そのPC側の対応フォルダを設定してください。
