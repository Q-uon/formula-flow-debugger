# Formula Flow Debugger v0.6 — GitHub Pages対応版

Formula Flow Debuggerは、Excelの選択セルから数式の参照元をたどり、計算値、小数残存、丸め関数、LOOKUPの実採用経路、外部参照、エラーをグラフ表示するOffice Add-inです。

v0.6は**GitHub PagesのHTTPS配信を通常運用**とします。利用者のPCごとに`start-windows.cmd`、`server.py`、Python、OpenSSL、localhost証明書を準備する必要はありません。

## v0.6の要点

- GitHub Pagesで配信できる静的HTML／CSS／JavaScript
- リポジトリのサブパスでも動作する相対アセットURL
- GitHub Pages URLを反映したExcel用`manifest.xml`の自動生成
- GitHub ActionsからPagesへ自動デプロイ
- `dist/`に公開用ファイルだけを生成
- JavaScriptを1ファイルへバンドルし、CSSとともに保守的にminify
- Excel上のアドイン名を**Formula Flow Debugger v0.6**に統一
- タスクペイン下部へバージョン、ビルドID、UTCビルド日時を常時表示
- v0.5のズーム、Pan、ノードドラッグ、セル／範囲リンク、深さ、LOOKUP、強調表示を維持

---

# 1. データとプライバシー

## 業務Excelの内容はGitHubへ送信しません

このアドインの解析処理は、Excelのタスクペイン内でOffice.jsを使って実行されます。

- セル値
- 数式
- シート名
- 参照関係
- LOOKUPの検索値・一致セル・返却セル
- 解析結果

これらをGitHub、GitHub Pages、独自API、ログ収集サービスなどへ送信するコードはありません。GitHub PagesはHTML、CSS、JavaScript、アイコンを配信するだけです。

`Content-Security-Policy`では、自サイトとMicrosoft公式Office.js以外のスクリプトを許可していません。アプリケーションコードには`fetch`、XHR、WebSocket、解析テレメトリを実装していません。

ただし、Office.js本体はMicrosoft公式の次のHTTPS URLから読み込まれます。

```text
https://appsforoffice.microsoft.com/lib/1/hosted/office.js
```

## JavaScriptは完全には秘匿できません

`dist/assets/app.bundle.min.js`はバンドル・minifyされていますが、ブラウザーへ配信されるJavaScriptは利用者が取得・解析できます。GitHub Pagesを利用するWebアプリで、クライアント側JavaScriptを完全に秘匿することはできません。

`dist/`には開発用の分割ソース、テスト、Pythonスクリプトを含めませんが、これは配布物を小さくし、公開対象を必要最小限にするための分離であり、知的財産保護を保証するものではありません。

---

# 2. ディレクトリ構成

```text
formula-flow-debugger/
├─ .github/workflows/deploy-pages.yml  # GitHub Pages自動公開
├─ assets/                             # 開発用アイコン
├─ src/                                # 開発ソース
├─ tests/                              # 回帰・Pages・サブパステスト
├─ tools/build_pages.py                # dist生成
├─ manifest.xml                        # GitHub Pages用プレースホルダー
├─ manifest.github-pages.xml           # Pages manifestテンプレート
├─ manifest.localhost.xml              # 任意のlocalhost開発用
├─ index.html                          # 開発用HTML
├─ server.py / start-windows.cmd       # 任意のlocalhost開発用
└─ dist/                               # 生成される公開用成果物
   ├─ index.html
   ├─ help.html
   ├─ manifest.xml
   ├─ build-info.json
   ├─ .nojekyll
   └─ assets/
      ├─ app.bundle.min.js
      ├─ app.min.css
      └─ icon-*.png
```

通常の社内利用者が必要とするのは、公開済みGitHub Pages URLと、そこからダウンロードした`manifest.xml`だけです。

---

# 3. GitHubリポジトリを作成する

1. GitHubで**New repository**を選択します。
2. リポジトリ名を決めます。例：

   ```text
   formula-flow-debugger
   ```

3. このプロジェクトの内容をリポジトリのルートへ登録します。
4. 既定ブランチを`main`にします。
5. GitHub Pagesを社外公開したくない場合は、組織のGitHub契約・Pages公開範囲・社内セキュリティ方針を確認してください。GitHub Pagesサイト自体が公開でも、Excelデータは送信されませんが、アドインのHTML／JavaScriptは公開されます。

コマンド例：

```bash
git init
git add .
git commit -m "Formula Flow Debugger v0.6"
git branch -M main
git remote add origin https://github.com/GITHUB_USER/formula-flow-debugger.git
git push -u origin main
```

`GITHUB_USER`は実際のGitHubユーザー名またはOrganization名へ置換してください。

---

# 4. GitHub ActionsでPagesを公開する（推奨）

## 4.1 Pagesを有効化

1. GitHubリポジトリの**Settings**を開きます。
2. 左メニューの**Pages**を開きます。
3. **Build and deployment > Source**で**GitHub Actions**を選択します。

## 4.2 ワークフローを実行

`main`へpushすると、`.github/workflows/deploy-pages.yml`が以下を実行します。

1. JavaScript回帰テスト
2. Pythonテスト
3. GitHub PagesのベースURLを自動判定
4. `dist/`を生成
5. 本番バンドルの構文検証
6. Pagesへデプロイ

手動で実行する場合：

1. リポジトリの**Actions**を開く
2. **Deploy Formula Flow Debugger v0.6 to GitHub Pages**を選択
3. **Run workflow**を押す

## 4.3 公開URL

通常のプロジェクトリポジトリ：

```text
https://GITHUB_USER.github.io/REPOSITORY_NAME/
```

例：

```text
https://contoso-tools.github.io/formula-flow-debugger/
```

ユーザーサイト用リポジトリ`GITHUB_USER.github.io`の場合：

```text
https://GITHUB_USER.github.io/
```

ワークフローはこの違いを自動判定します。

---

# 5. manifest URLの設定

## 自動生成

GitHub Actionsは実際のユーザー名とリポジトリ名からURLを計算し、公開サイトに次を生成します。

```text
https://GITHUB_USER.github.io/REPOSITORY_NAME/manifest.xml
```

公開後、ブラウザーでこのURLを開くかダウンロードしてください。生成済みmanifestには、次のURLがすべて実際のPages URLで設定されています。

- `SourceLocation`
- `FunctionFile`
- `Taskpane.Url`
- `IconUrl`
- `HighResolutionIconUrl`
- `SupportUrl`
- `AppDomain`

## プレースホルダーから手動生成

GitHubユーザー名やリポジトリ名が未確定の場合、ルートの`manifest.xml`と`manifest.github-pages.xml`には次の置換しやすいプレースホルダーがあります。

```text
__PAGES_BASE_URL__
__PAGES_ORIGIN__
```

推奨は直接編集ではなく、ビルドコマンドです。

```bash
python3 tools/build_pages.py \
  --base-url https://GITHUB_USER.github.io/REPOSITORY_NAME \
  --build-id manual-001
```

Windows：

```powershell
py -3 tools\build_pages.py --base-url https://GITHUB_USER.github.io/REPOSITORY_NAME --build-id manual-001
```

生成物：

```text
dist/manifest.xml
```

`--base-url`には`index.html`を付けず、末尾の`/`も不要です。HTTPS URLだけを受け付けます。

---

# 6. Excelへ登録する

1. GitHub Pages上の`manifest.xml`をローカルへダウンロードします。
2. Excelを開きます。
3. **ホーム > アドイン > その他のアドイン > マイ アドイン**を開きます。
4. **カスタム アドインのアップロード**を選択します。
5. ダウンロードした`manifest.xml`を指定します。
6. Excel上で次の名前を確認します。

   ```text
   Formula Flow Debugger v0.6
   ```

7. **ホーム > 数式デバッグ v0.6 > 計算フロー v0.6**を開きます。
8. タスクペイン下部でバージョンとビルド情報を確認します。

例：

```text
Formula Flow Debugger v0.6
Build: v0.6.0 · a1b2c3d · 2026-11-26T00:00:00Z
```

組織ポリシーによりカスタムアドインのアップロードが禁止されている場合は、Microsoft 365管理者による統合アプリ展開が必要です。

---

# 7. 手動公開の代替手順

## 方法A：Actionsを手動実行

コードを変更せず再公開したいだけなら、Actions画面の**Run workflow**が最も簡単です。

## 方法B：`docs/`をブランチから公開

GitHub Actionsを使えない場合：

1. 実URLで`dist/`を生成します。

   ```bash
   python3 tools/build_pages.py --base-url https://GITHUB_USER.github.io/REPOSITORY_NAME --build-id manual-001
   ```

2. `dist/`の内容をリポジトリの`docs/`へコピーします。
3. `docs/`をcommitして`main`へpushします。
4. **Settings > Pages > Build and deployment**で次を選択します。
   - Source: **Deploy from a branch**
   - Branch: `main`
   - Folder: `/docs`
5. 公開後、`/manifest.xml`をダウンロードしてExcelへ登録します。

注意：Actions方式とブランチ方式を同時には使用せず、どちらか一方に統一してください。

---

# 8. バージョンアップ手順

1. ソースを更新します。
2. `package.json`、manifestテンプレート、タスクペイン表示のバージョンを更新します。
3. ローカルでテストします。

   ```bash
   node --test
   python3 -m unittest discover -s tests -p 'test_*.py' -v
   ```

4. `main`へpushします。
5. Actionsのbuild/deployが成功したことを確認します。
6. 公開サイトの`build-info.json`を開きます。

   ```text
   https://GITHUB_USER.github.io/REPOSITORY_NAME/build-info.json
   ```

7. `version`、`buildId`、`builtAt`を確認します。
8. タスクペイン下部のBuild表示と一致することを確認します。
9. manifestの`Version`やURLを変更した場合は、公開済み`manifest.xml`を再ダウンロードし、Excel側の登録を更新します。
10. Excel/WebView2のキャッシュが残る場合は、Excelを完全に終了して開き直します。

---

# 9. 開発用localhost（任意）

GitHub Pages公開前の開発確認だけに、従来のlocalhost構成を残しています。

```powershell
start-windows.cmd
```

または：

```powershell
py -3 server.py --trust-cert --open-browser
```

localhost用manifest：

```text
manifest.localhost.xml
```

これは開発者向けです。社内利用者の通常運用では使用しません。

---

# 10. v0.5から維持する機能

- グラフ専用25%～300%ズーム
- マウスポインター中心ズーム
- 背景Pan
- ノード個別ドラッグ
- 自動整列、配置リセット、全体表示
- セル、単一範囲、複数範囲リンク
- 上流深度1～20階層
- 最大セル数制限
- XLOOKUP、VLOOKUP、HLOOKUP、LOOKUP、INDEX＋MATCH、INDEX＋XMATCHの安全な実採用経路
- 複雑LOOKUPで推測しない処理
- LOOKUP全参照範囲の展開
- ROUND、ROUNDDOWN、ROUNDUP、小数残存、LOOKUP、外部参照、エラーの強調
- 「その他を薄くする」
- 複数属性バッジ
- 外部ブックを自動で開かない安全動作

---

# 11. テスト対象

- v0.5の全グラフ操作と数式解析の回帰
- JavaScript構文
- Python構文
- `dist/`に公開用ファイルだけが入ること
- 開発用`src/`やPythonが`dist/`へ入らないこと
- GitHub PagesのリポジトリサブパスからHTML、JS、CSS、manifestを取得できること
- HTML内のアセットURLが相対URLであること
- manifest内のURLが設定したPages HTTPS URLであること
- プレースホルダーが本番manifestに残らないこと
- ブラウザー資産に`http://`参照がないこと
- バージョンとビルド情報が常時表示されること
- `build-info.json`がクライアントサイド処理を明記すること
- OpenSSL不要の証明書生成とlocalhost開発構成の回帰

---

# 12. 最終確認が必要な事項

## 実際のGitHub Pages

- OrganizationのPages公開ポリシーでサイトへアクセスできること
- ActionsのPagesデプロイ権限が許可されていること
- 実際のユーザー名・リポジトリ名を含むURLでmanifestが生成されること
- Pagesの反映遅延やCDNキャッシュ後に最新Buildが表示されること
- Microsoft 365テナントやネットワークから`github.io`へアクセスできること

## Windows版Excel

- GitHub Pages URLがExcel WebView2内で読み込めること
- カスタムアドインのアップロードがテナントポリシーで許可されること
- グラフのホイールズーム、背景Pan、ノードドラッグが高DPI環境で自然に動作すること
- セル、長い範囲、複数範囲の選択とスクロール動作
- 利用中のOffice.jsでRangeAreas一括選択が可能か、不可の場合に先頭範囲＋警告へフォールバックすること

