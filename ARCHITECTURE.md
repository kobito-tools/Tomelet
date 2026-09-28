# Tomeletの構成

## 対応関係

| 入り口 | 処理 | 保存先 |
|---|---|---|
| `index.html`、`js/` | 表示と利用者操作 | 保存しない |
| `animations/navigation-power/` | 電池・コード・豆電球・Screen Beansの演出 | 保存しない |
| `scripts/server.js` | HTTP受付、検証、アクセス制限 | 保存しない |
| `scripts/services/` | 日記などのルール | 保存しない |
| `scripts/repositories/` | SQLを使った読み書き | SQLite |
| `scripts/server.js`、Repository | 他アプリAPIの検証と取込 | SQLite |
| `migrations/` | DBの表と索引の定義 | Gitで公開 |
| `tools/` | 移行、検査、バックアップ | Git外のDBを操作 |

## ソースコードと個人データの分離

```text
Gitリポジトリ          OSのローカル領域（PC固有）       基準パス（利用者が選ぶ1か所）
TickTockTome/          TickTockTome/                    <基準パス>/
├── index.html         ├── config/setting.json          ├── 利用者のPDF・ファイル
├── css/ js/           │     （基準パス・ポート・LLM）  └── .kobito-tools/
├── scripts/           ├── config/integrations.json         ├── dataset.json（ID・共有設定）
├── migrations/        └── runtime/                         ├── Tomelet/（lock.json・database/・uploads/ backups/ …）
├── tools/                                                  ├── PopNote/（PopNote!のメモ）
└── tests/                                                  └── Tags/tags.json（共有タグ）
```

個人データ領域や基準パスの絶対パスをソースコードへ埋め込みません。

## 保存の流れ

```text
画面
  ↓ JSON形式のローカルHTTP要求
server.js
  ↓ 入力サイズ、Origin、形式を検査
Service
  ↓ 日付、題名、相対パスなどを検証
Repository
  ↓ BEGIN IMMEDIATE
SQLite
  ↓ 成功ならCOMMIT、失敗ならROLLBACK
画面へ結果
```

## 画面の責務

| 画面 | 責務 |
|---|---|
| HOME | 今週のアクション数、ファイル数、本・文書の読了数と登録数、期限超過を含む直近1週間のTodo、今日の時間割、活動分析への入口 |
| 時間割 | 日付別の予定時間、アクション、タグ、場所、達成度、完了項目の編集 |
| カレンダー | 緑のアクション、期限日に赤く表示する未完了Todo、日記・作業履歴の月・週・日表示、ドラッグによる時間割の日付変更 |
| 活動分析 | 予定時間と実績時間、完了率、未実施、直近7日間、タグ別実績時間を自動集計し、任意でローカルLLM分析を追加 |
| 作業ツリー | 同じタグを持つ時間割アクションの時間的な接続表示 |
| ファイル | Todo・時間割から登録したファイルを、名前・関連作業・複数タグのAND条件で検索し、詳細から開く |
| 書籍 | 一般書・小説・雑誌・教科書・参考書の読書状態、タグ、要点、関連日記の管理 |
| 文書 | 論文・PDFの書類などの読書状態、タグ、要点、関連日記の管理 |
| 設定 | 配色テンプレート、説明付きの固定8分類タグ、基準パス（ID・切替・要再リンク）、ゴミ箱の管理 |
| 使い方 | 主要画面と基準パス・データセットの考え方を図入りで説明 |
| メモ（別リポジトリの連携アプリ PopNote!） | 表示する設定のとき、カレンダー・検索・ファイルでメモを表示し、PopNote! を呼び出す |

日付ごとの事実はカレンダーの日表示へまとめます。活動分析は、予定と実績を計算で自動集計し、毎晩文章を入力しなくても成立させます。作業ツリーはタグの長期的なつながりを見る画面です。検索は独立タブを持たず、全画面共通の上部検索欄から横断検索結果へ移動します。

## メモ（連携アプリ PopNote!）

メモは別リポジトリの macOS アプリ PopNote!（バンドルID `io.github.kobito-tools.popnote`）が作成・保存します。PopNote! は保存先フォルダを自分で選び、`.kobito-tools/PopNote/` の自分のDBへ直接保存します。Tomelet はメモを書き込まず、「PopNote! のメモを本アプリでも表示する」設定のときだけ、PopNote! のDBを読み取り専用で開いて自分のDBの `memos` 表へ写し、カレンダー・検索・ファイルに表示します（`scripts/popnote-memos.js`）。

```text
PopNote!.app ─→ <基準パス>/.kobito-tools/PopNote/（database/popnote.sqlite3・uploads/・lock.json）
                                  │ 読み取り専用（更新日時が変わったら写し直す）
Tomelet server.js ─→ Tomelet/database の memos 表（表示用の写し）
PopNote!.app ─ companion-connect.js popnote --no-launch ─→ 専用トークン → GET /api/v1/integrations/memo/context（本体が開いている基準パス）
本体の「✎」・カレンダー → server.js → open popnote://open/<メモID>?dataset=<データセットキー>
```

- 起動時に `.kobito-tools/PopNote/` のDBが見つかり、まだ決めていなければ「PopNote!のデータが確認されました。本アプリ上でも表示しますか？」と尋ねます。答えは `dataset.json` の `showPopNoteMemos` に保存し、設定の「基準パス」から変えられます。
- 連携アプリの一覧と権限は `scripts/integrations/companions.js` で固定し、未知のアプリIDにはトークンを発行しません。
- 本体の「✎」は、PopNote! のトークンが登録済みの場合だけ表示します。
- 連携APIは `context` だけを返します。本体経由でメモを書き込む古い PopNote! には410（`popnote-update-required`）を返します。

## 共有タグ

タグは Tomelet と PopNote! で共有します。正本は `.kobito-tools/Tags/tags.json` で、各アプリのDBの `tags`・`tag_categories` 表はその写しです（日記・メモなどとの関連付けに外部キーを使うため）。同期は `scripts/tag-store.js`（PopNote! は `Sources/TagStore.swift`）が同じ規則で行います。

- 同じIDは `revision` の大きい方を採用し、同じ `revision` なら内容を比べて決まった方を採ります。
- タグは完全削除せず、アーカイブだけにします。片方のDBに参照先のない関連が残らないようにするためです。
- 別々のアプリで同じ名前のタグを作った場合は、IDの順で後になる方の名前に印を付けて両方残します。
- 書き込みは一時ファイルからの置き換えで行い、書く直前に `revision` が変わっていれば読み直して統合し直します。
- 本体は開いたとき、画面の読み込みのたび（`tags.json` が変わったときだけ）、タグの変更の前後に同期します。

プロジェクト画面は設けません。継続テーマの分類はタグへ一本化します。既存DBにある`projects`と`journal_projects`は、過去データを失わないため当面残しますが、新規UIとAPIからは使用しません。

## 基準パスの設定

基準パスは1か所だけです。基準パスを1つの「データセット」として扱い、直下の隠しフォルダ`.kobito-tools/`の`dataset.json`にIDと共有設定、`Tomelet/`にSQLite、アップロード、バックアップを置きます。書籍・文書・ファイルは`root_id = "base"`と基準パスからの相対パスで参照します。処理は`scripts/dataset.js`にまとめています。

```text
起動
  ↓ setting.jsonの基準パスに.kobito-tools/dataset.jsonがあるか確認（旧.TickTockTome/だけなら分割移行してから開く）
  ↓ lock.jsonで別のPCが使用中でないか確認（30秒ごとに更新、2分で期限切れ）
開けない → DBを開かない「設定待ち」で起動し、画面は基準パスの設定だけを表示
  ↓ 「基準パスを選択」→ OS標準のフォルダ選択画面
  ├─ .kobito-tools（または旧.TickTockTome）あり → 「[ID]に切り替えますか？」→ ロックを取ってDBを開き直す
  └─ なし → IDを入力して作成（旧データは任意で複製・変換）
```

- 切替はサーバーの再起動なしで行います。切替先のロックを先に取り、取れた場合だけ現在のDBを閉じます。
- 別のPCが強制的に開いた場合、こちらは次のロック更新時にDBを閉じて設定待ちへ戻ります。
- 基準パスは同期フォルダに置かれるため、SQLiteは`-wal`/`-shm`を残さない`journal_mode = DELETE`で開きます。
- アイコンはmacOSではNSWorkspace、Windowsでは`desktop.ini`で付けます。装飾なので失敗しても動作は続けます。
- 絶対パスはフォルダ選択の結果としてサーバーが一時保持し、画面からは選択トークンで確定します。

### 旧設定（種類別基準パス）からの移行

`schemaVersion 1`の`setting.json`にあった種類別基準パスと保存先は、`legacy`として保持します。新しい基準パスを作成するときに引き継ぎを選ぶと、旧DBを検証済みバックアップ経由で複製し、各旧基準パスが新しい基準パスの中にあれば接頭辞を付けて相対パスを書き換えます（例：`books` + `novel.pdf` → `base` + `Book/novel.pdf`）。同じ実ファイルを複数の旧基準パスで登録していた管理ファイルは1件へまとめます。基準パスの外にあった参照は旧IDのまま残し、設定画面の「要再リンク」から選び直します。旧DBは削除しません。連携アプリが旧IDで送ってきた場所も、`dataset.json`の`legacyRoots`で読み替えます。

## 表示言語

画面右上の「日本語／English」で表示言語を切り替えます。選んだ言語はPC固有設定（`setting.json`の`language`）へ保存し、切り替え時はページを読み込み直します。

- 画面は日本語で組み立て、Englishのときだけ`js/i18n.js`が表示直前に英語へ置き換えます。MutationObserverは描画前に実行されるため、日本語が一瞬見えることはありません。
- 訳は`js/i18n-en.js`にあります。表示文字列の全文一致と、数値や名前を含む文言の規則（正規表現）の2種類です。サーバーのエラー文も画面に出る時点で訳します。
- 入力欄・本文など利用者が入力した内容は訳しません。
- 使い方ページの図は`tools/build-help-svg-en.js`で英語版（`help-*.en.svg`）を生成し、Englishのときに差し替えます。
- macOSアプリのメニューとダイアログ、常駐タイマーのウィンドウも同じ設定に従います。
- **画面に日本語の文言を追加・変更したら、`js/i18n-en.js`へ英訳も追加してください。** 辞書に無い文言は日本語のまま表示されます。

## セキュリティ境界

- サーバーは`127.0.0.1`のみで待ち受ける。
- 配信する静的ファイルを許可リストで固定する。
- UIからの更新は同一Originだけを受け付ける。
- 他アプリからの取込はアプリ別Bearer tokenで認証する。
- SQLiteや設定ファイルをGitリポジトリ内へ生成しない。
- ファイルは基準パスからの相対パス（`root_id = "base"` + `relative_path`）で参照する。
- OSコマンドはシェルを使わず実行する。
- 通常ログへ日記本文、ウィンドウタイトル、実パス、トークンを出さない。

## DB更新

`migrations/`をファイル名順に適用し、`schema_migrations`へ履歴を保存します。各マイグレーションはトランザクションで実行します。既存DBの構造を更新する直前には、`backups/`へ整合性確認済みスナップショットを自動作成します。

全文検索はSQLite FTS5を使用します。Journalの追加、更新、論理削除に合わせてトリガーが検索索引を更新します。
## 共有データとPC固有設定

`setting.json`と`integrations.json`はOS標準のTomeletローカル領域に残します。`setting.json`に保存するのは、現在の基準パス、PCの識別子、ポート、ローカルLLMの実行ファイルの場所だけです。配色・フォント・タグ表示・PopNote!のメモを表示するかは`.kobito-tools/dataset.json`へ保存し、同じ基準パスを開いたPCで共有します。

複数PCでの同時編集は第2段階で、PCごとの変更ログを`.kobito-tools/Tomelet/changes/<PC>/`へ書き出して取り込む方式を予定しています。第1段階では排他ロックで同時使用を防ぎます。
