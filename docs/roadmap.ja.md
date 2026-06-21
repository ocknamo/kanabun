# ロードマップと残 TODO

*[English](./roadmap.md) | 日本語*

何が出来ていて何が残っているかのスナップショットです。設計の*理由*は
[`decisions.ja.md`](./decisions.ja.md) を参照してください。

## 状態

| Phase | 範囲 | 状態 |
| --- | --- | --- |
| 0 | 足場: Bun ワークスペース、tsconfig、CI、カバレッジ | ✅ 完了 |
| 1 | signals コア: `signal`/`computed`/`effect`、バッチ、クリーンアップ、所有権 | ✅ 完了 |
| 2 | JSX ランタイム + `render`(細粒度リアクティブ DOM) | ✅ 完了 |
| 3 | 制御構文: `<Show>`、`<For>`(keyed); **TodoMVC 稼働** | ✅ 完了 |
| 4 | コンポーネントモデルと DX | ✅ 完了 — `onMount`/`mergeProps`/`splitProps`/スコープド `css`/`context` |
| 5 | Bun 連携: `create` / `dev` / `build` CLI | ✅ 完了 |
| 6 | 堅牢化・周辺(ルーター、SSR 等) | 🟡 進行中 — **ルーター + エラーバウンダリ + 開発時警告 + SSR/ハイドレーション + 非同期(`resource`/`<Suspense>`)+ SSG(`kanabun generate`)+ CSS HMR 完了**;残りは任意 |
| 7 | アイランド / 部分ハイドレーション + エコシステムプリミティブ(`lazy`・`<Portal>`・`<Dynamic>`・head API)+ 作成支援ツール(`kanabun lint`・dev オーバーレイ) | 🟡 進行中 — **エコシステムプリミティブ(`lazy`・`<Portal>`・`<Dynamic>`・`<Head>`/`<Title>`)+ アイランドのコア(`<Island>`・`registerIsland`・`hydrateIslands`)完了**;アイランド単位のバンドル分割(CLI)+ 作成支援ツールは計画。設計メモ: [`decisions.ja.md`](./decisions.ja.md#アイランド--部分ハイドレーションphase-7--設計メモ)(アイランド)、[`dx.ja.md`](./dx.ja.md#4-将来自前-linter)(linter) |
| 8 | 重量級エコシステム: SSR ストリーミング(`renderToStream`)、リアクティブ store(`createStore`)、`@kanabun/testing` | 🔜 計画 — Phase 7 から先送り(大きめのサブシステム) |

全期間で維持した品質基準: **ランタイム依存ゼロ**、`packages/core` のランタイム非依存、
全ソースファイルの行/関数カバレッジ 100%、`tsc` クリーン、ドキュメントのバイリンガル。

## 残 TODO

### Phase 4 — コンポーネントモデル ✅ 完了
- [x] **`context`(`createContext` / `useContext`)。** 完了 ── **関数の子**
  (`<Ctx.Provider value={v}>{() => <App/>}</Ctx.Provider>`)を採用。`<Show>`/`<For>`
  と同じ「関数は遅延」規約と整合する。コンパイラ案は却下(創設制約)、素の即時子は
  デフォルトしか見えない(テストで固定)。実装は owner ツリーに乗る(親リンク + `context`
  マップ、`useContext` は上へ辿る)。詳細は
  [`decisions.ja.md`](./decisions.ja.md#コンテキストphase-4) を参照。
- [x] **スコープド CSS。** 完了 ── ランタイムの Emotion 風 `css\`…\`` ヘルパー。本体を
  クラスにハッシュし、ルールをスコープして `<style>` を 1 回注入(dedupe 付き)。比較した
  選択肢(CSS Modules 風・Svelte 属性方式は却下)は
  [`decisions.ja.md`](./decisions.ja.md#スコープド-cssphase-4) を参照。

### Phase 6 — 堅牢化・周辺(任意)
- [x] **ルーター**を別パッケージ(`@kanabun/router`)で、history ベースで。完了 ──
  `<Router>`/`<Routes>`/`<Route>`/`<Link>` + `useNavigate`/`useLocation`/`useParams`、
  差し替え可能な history ソース(`createBrowserSource` / `createHashSource` /
  `createMemorySource` ── ハッシュは GitHub Pages でも書き換え無しで動く)の上に構築。
  `<Routes>` は排他(最初にマッチ)ルーティングと 404 用の共有 `fallback` を提供。
  core の signals と owner ツリー context に乗る。依存ゼロ・カバレッジ 100%・ランタイム
  非依存。詳細は [`decisions.ja.md`](./decisions.ja.md#ルーターphase-6) を参照。
  **ネストルーティング**(レイアウト + 子ルート)は完了 ── `*` ワイルドカードのルートが
  プレフィックスでマッチする *レイアウト* になり、余りパスに対してネストした `<Routes>` を
  描画(`<Outlet>` 不要)、params は連鎖でマージ。**相対 `<Link>` href** は完了 ──
  `<Link href="edit">` / `"../list"` / `"?tab=bio"` が現在地に対して、ブラウザが
  `<a href>` を解決するのと同じ規約で解決される(`location.ts` の純関数 `resolvePath`。
  `useNavigate()` も相対を解決し、描画される `<a>` は解決済みの絶対パスを表示しつつ
  リアクティブに保つ)。外部 href はそのまま。
- [x] **SSR + ハイドレーション。** 完了 ── `renderToString`(コア、ランタイム非依存:
  シリアライズ可能なサーバ DOM を設置して eager な JSX ランタイムを実 `document` 無しで
  走らせ、ツリーを一度組んで `{ html, head }`(スコープド CSS も収集)を返し dispose する ──
  サーバでは `onMount` は発火しない)。`hydrate`(クライアント)はサーバマークアップ上に
  ライブなアプリをマウントする。SSG は同じ `renderToString` をビルド時に走らせれば出る ──
  下の **SSG** 参照。例(`examples/ssr`)は動く Bun SSR サーバ + クライアントハイドレーション。
  ノード単位の引き取りは未実装で、コンパイラ/マーカーが要ると記録 ──
  [`decisions.md`](./decisions.md#ssr-hydration--ssg-phase-6) 参照。依存ゼロ・100% カバレッジ・
  `packages/core` はランタイム非依存を維持。
- [x] **SSG(`kanabun generate`)。** 完了 ── SSR プリミティブに乗る薄い CLI prerender
  ループ(`packages/cli/src/generate.ts`)。新しい描画経路は無い。SSG の **config**
  (`{ routes?, render(path), client?, title?, document? }`)を import し、ルートごとに
  `renderToString` を走らせて `<outdir>/<route>/index.html`(`/` → `index.html`、
  `/about/` → `about/index.html`)に書き出す。任意の `client` エントリは一度だけバンドル
  され全ページから参照される ── これで静的 HTML がハイドレートする。無ければ静的のみ。
  `base`(config か `--base`)はクライアント script の src に前置され、サブパス配信
  (GitHub Pages)に対応。`build` 同様 never-throw。ルート列挙は今のところ明示の `routes`
  配列(router 連動の列挙・動的パラメータ向け `getStaticPaths`・ビルド時データ焼き込みは
  follow-up)。動く例は `examples/ssg`。
  [`decisions.md`](./decisions.md#kanabun-generate--ssg-コマンド) 参照。
- [x] **CSS ホットリプレース(HMR)。** 完了 ── `.css` の変更はホットスワップ(dev サーバが
  ターゲットメッセージ `css:<path>` を送り、クライアントが該当する `<link rel="stylesheet">`
  だけをその場で再フェッチ ── アプリの状態は全て保持される。一致するスタイルシートが無ければ
  全リロードにフォールバック)。CSS 以外の変更は従来どおり **全リロード**。メッセージ判定は純粋・
  単体テスト済みのヘルパー(`changeMessage`)。
  [`decisions.md`](./decisions.md#css-hmr-phase-6) 参照。
- [ ] **コンポーネント単位の状態保持 HMR**(*コード* 編集をまたいで状態を保持)。この runtime-JSX・
  VDOM 無し設計では **コンパイラ無しに実現不可** ── モジュールを差し替えて当てるための
  コンポーネント境界や描画マーカーが存在しない。CSS 以外の編集は全リロードのまま(Phase 5 の
  意図的な簡略化)、CSS 編集は上記でホットスワップ。[`decisions.md`](./decisions.md#css-hmr-phase-6) 参照。
- [x] **エラーバウンダリ。** 完了 ── `catchError`(コアのプリミティブ)+ `<ErrorBoundary
  fallback={…}>`。子の *生成時* または *リアクティブ更新時* に throw されたエラーを捕捉して
  クラッシュさせず fallback を描画し、`reset` でサブツリーを作り直す。owner ツリーに乗る
  (エラーハンドラを private シンボル下の context として保存し、throw は最も近いハンドラを
  上に辿る ── 無ければ再 throw)。依存ゼロ・カバレッジ 100%・ランタイム非依存。詳細は
  [`decisions.ja.md`](./decisions.ja.md#エラーバウンダリphase-6) を参照。
- [x] **非同期 / Suspense** プリミティブ。完了 ── `resource(fetcher)` /
  `resource(source, fetcher)` が非同期関数をリアクティブな状態に変える:値アクセサ + 
  `loading`/`error` アクセサ + `{ mutate, refetch }` アクション。レース安全(古い fetch が
  新しい結果を上書きしない)、リアクティブな `source` 変化で再取得、source が未準備
  (`false`/`null`/`undefined`)の間はアイドル。`<Suspense fallback>` は子の resource が
  *初回ロード* 中は fallback を表示し、完了後に子を見せる(子は境界の下で一度だけ生成し、
  隠れている間も生かしておく ── 要素子を持つ `<Show>` と同じ)。以降の `refetch()` は
  直前の値を画面に残す(インラインのスピナーには `loading()` を読む)。子は **関数** で包み、
  resource が境界の下で生成されるようにする(`<Show>`/context と同じ規約)。エラーは
  `resource.error()` で公開(`<ErrorBoundary>` へ自動転送はしない)。コアの signals + 
  owner ツリー context に乗る;依存ゼロ・カバレッジ 100%・ランタイム非依存。詳細は
  [`decisions.ja.md`](./decisions.ja.md#非同期--suspensephase-6) を参照。
- [x] **開発時の警告。** 完了 ── オプトインのランタイム診断(`setDev(true)`。
  `kanabun dev` は `globalThis.__KANABUN_DEV__` 経由で自動有効化)。owner 外の
  `effect()`/`onMount()`/`onCleanup()` と、computed 内のシグナル書き込みを検知。重複排除
  あり、差し替え可能なシンク(`setWarnHandler`)付き。「thunk として渡すべき signal を
  読んでしまった」ケースはコンパイラ無しでは確実に検知できない ── 理由と *検知できる* もの
  は [`decisions.ja.md`](./decisions.ja.md#開発時警告phase-6) を参照。依存ゼロ・カバレッジ
  100%・ランタイム非依存。

### Phase 7 — アイランド + エコシステムプリミティブ + 作成支援ツール(計画)

**アイランド。** 明示的・手動のアイランド(コンパイラ無し・resumability 無し)── 印を付けたコンポーネントだけが
ハイドレートされ、静的な外殻はクライアント JS を送らない。完全な根拠とスコープ境界は
[`decisions.ja.md`](./decisions.ja.md#アイランド--部分ハイドレーションphase-7--設計メモ) を参照。
- [x] **`<Island>` 境界 + レジストリ(コア)。** 完了 ── `<Island name props>` は
  レジストリ(`registerIsland(name, Component)`)からコンポーネントを引き、サーバでは
  `<div data-island data-props>` ラッパの内側に描画する(props は属性へ JSON 直列化 ──
  初回描画 / SEO は不変)。クライアントでは `hydrateIslands()` が全 `[data-island]` を走査し、
  props を復元、同じレジストリからコンポーネントを解決して、それらだけを `hydrate` する ──
  他は一切実行されない。`defineIslands({ Counter, … })` が型安全な経路: 型付きマップのキーが
  `<Island name>` を制約し(タイポ / 未登録 name はコンパイルエラー)、各コンポーネントが
  `props` を型付ける(ランタイムは同一)。`renderToString`(サーバ)+ `hydrate`(コンテナ毎)を再利用 ──
  第3の描画経路は作らない。props は JSON 直列化可能なもののみ(クロージャ / signal は境界を
  越えない)。各アイランドは独立した root(context / 所有権ツリーは越えない ── 共有状態は
  モジュールレベルの singleton signal で)。動くデモは `examples/islands`(静的な外殻 +
  独立した 2 つのカウンターアイランド)。`packages/core/src/islands.ts`。詳細は
  [`decisions.ja.md`](./decisions.ja.md#アイランド--部分ハイドレーションphase-7--設計メモ)。
- [ ] **アイランド単位のバンドル分割(CLI)。** 本当の payload 削減: `packages/cli` がアイランド
  単位で code-split し、ページはそこに含まれるアイランドのチャンクだけを読み込む + それらを
  mount するクライアントブートストラップ。Bun / バンドラの仕事なので CLI 層に置く。コアは
  ランタイム非依存のまま。
- 対象外(記録済み): アイランドの自動検出とノード単位の引き取り(どちらもコンパイラが要る)、
  resumability(ランタイム JSX 設計と矛盾)。

**作成支援ツール。**
- [ ] **自前 linter(`kanabun lint`)。** ランタイムでは捕まえられない取り違えを静的解析で
  拾う ── 主に子/属性で `{count}` のつもりの `{count()}`(呼び出しが値に潰れる前にソースを
  見る必要がある)と、関連する規約違反。ESLint プラグインでは **ない**(ESLint は外部依存で、
  kanabun は依存ゼロ)── Bun レイヤーの第一級 CLI コマンドで、型チェックで既に使っている
  オンデマンドの TypeScript パーサを再利用する。オプトインかつ開発時のみの作成支援ツールで
  あって、ランタイムコンパイラではない(創設時の制約を保つ)。詳細は
  [`dx.ja.md`](./dx.ja.md#4-将来自前-linter)。
- [ ] **dev オーバーレイ。** 開発時の警告や未捕捉/`<ErrorBoundary>` のエラーを、コンソール
  だけでなく `kanabun dev` の画面オーバーレイとして表示する。土台は既にある ──
  `setWarnHandler` が dev 警告のシンクを差し替えられる
  ([`decisions.ja.md`](./decisions.ja.md#開発時警告phase-6))ので、オーバーレイはその消費側。
  開発時のみ・CLI/Bun レイヤーに置く。コアはランタイム非依存のまま。

**エコシステムプリミティブ。** ── すべて core で実装済み(ランタイム非依存・依存ゼロ・100% カバレッジ)。
- [x] **`lazy()`。** 完了 ── コンポーネントを動的 `import()` の背後に遅延させ、その境界で
  code-split。既出の `<Suspense>` と統合(初回描画でモジュールをロードし、最寄りの境界を
  サスペンド)。モジュールは **一度だけ** ロードしてキャッシュ(再マウントは再 import しない)。
  import 失敗は `resource` の rejection として保持(`ErrorBoundary` へ自動転送しない、`resource`
  と同型)。`packages/core/src/lazy.ts`。
- [x] **`<Portal>`。** 完了 ── 子を別の DOM ノード(既定 `document.body`、`mount` で指定可)へ
  描画。**現在のリアクティブツリーが所有** ── 子のリアクティブ性は `<Portal>` を描画した owner の
  下に作られ、破棄は DOM 位置でなく owner に従う(離脱/アンマウントで除去)。除去のため対象内に
  2 つのコメントマーカーで挟み、その範囲を cleanup で消す(リアクティブな子が後から追加したノードも
  含む)。元の位置には何も描画しない。`packages/core/src/portal.ts`。
- [x] **`<Dynamic>`。** 完了 ── 実行時に選んだホスト(タグ名 or コンポーネント)を描画し、値の
  変化に応じてリアクティブに差し替え(残りの props/children を転送)。`component` は **関数=リアクティブ**
  規約に従う ── `component="div"` は静的タグ、`component={() => …}` はアクセサ(タグ名 or
  コンポーネントを返す)。コンポーネント自体も関数なので、静的コンポーネントもアクセサ経由で渡す
  (`component={() => MyComp}`)= コンパイラ無しで両者を曖昧さなく区別。`packages/core/src/dynamic.ts`。
- [x] **head / メタ API(`<Head>` / `<Title>`)。** 完了 ── `renderToString` が返す `head`
  チャネルに乗る、ページごとの `<head>` 内容。`<Head>` は子を `document.head` に追加(SSR では
  サーバ document の `<head>` に追加され、シリアライズされた `head` に乗る)。`<Title>` はその糖衣
  (`<title>` を head に置く、テキストはリアクティブ可)。内容は現在ツリーが所有 ── リアクティブな
  属性/テキストは in-place 更新、追加したノードは owner 破棄で除去(ページ間で漏れない)。SSR で
  `renderToString` は dispose 前に `<head>` を読む(Head/Title が cleanup で除去しても失われない)。
  `packages/core/src/head.ts`。

### Phase 8 — 重量級エコシステム(Phase 7 から先送り)(計画)
Phase 7 から意図的に外した大きめのピース ── どれも小さなプリミティブではなく、相応の
サブシステム(新しい描画経路・プロキシ層・別パッケージ)。創設目標には不要だが、入れる場合は
同じ品質基準(依存ゼロ・`packages/core` ランタイム非依存・カバレッジ 100%・`tsc` クリーン)を守る。
- [ ] **SSR ストリーミング(`renderToStream`)。** 今の `renderToString` はツリーを eager に
  全部組んでバッファ済みの HTML 文字列を 1 つ返す。ストリーミングは生成しながら markup を
  flush し、`<Suspense>` 境界を順不同に解決(fallback を先に流し、解決後に差し込む)して TTFB を
  改善する。同期 eager 経路とは別の **非同期** 描画経路と、流れてくるチャンクを縫合する
  クライアントが要るため重い ── `renderToString` の小改修では済まない。
- [ ] **リアクティブ store(`createStore`)。** 深いオブジェクト/配列状態を、パス単位の細粒度
  更新(+ `produce` 風セッター)で扱う、プロキシベースのネスト store。今のフラットな signal を
  超える。プロキシ層と新しい更新 API 面を足すため重い。依存ゼロ・ランタイム非依存(core)を維持。
- [ ] **`@kanabun/testing` ユーティリティ。** 第一級のテスト補助パッケージ(モックへ描画・
  `fireEvent`・microtask/effect の flush・クエリ補助)を、リポジトリ内 DOM モックの上に。
  アプリ作者が jsdom 無しでコンポーネントを単体テストできる ── コアのスイートが使うのと同じ
  モックを利用者向けにパッケージ化。別パッケージ・開発時のみ。
- (別枠で追跡・Phase 8 ではない: SSG 動的パラメータ / `getStaticPaths` + ビルド時データ焼き込みは
  **Phase 6(SSG)** の follow-up。router の VRT ベースラインは *既知の軽微項目* の CI チョア。)

### DX と型の精緻化
- [x] `JSX.IntrinsicElements` の厳密化。**イベントハンドラ** ── `on*` プロップを
  `EventHandler<E>`(型付きイベント)関数として型付け。よって「`() =>` 書き忘れ」
  (`onClick={count.set(…)}`)はコンパイルエラーになり、条件付きハンドラ(`undefined`)や
  `void`/`undefined` の区別も正確に扱う。**要素ごとの属性**も型付け済み ──
  `IntrinsicElements` が主要要素を各自の形(`a`/`input`/`button`/…)にマップし、各属性は
  `Attr<T>`(値 *または* リアクティブなアクセサ ── 規約を尊重)で型付け。よって誤った属性
  (`disabled="yes"`、`<button type="email">`)はコンパイルエラーになり、要素ごとの補完が効く。
  未掲載の要素・未知の属性(`data-*`/`aria-*`)は `[attr]: any` のフォールバックで緩いまま。
  詳細は [`dx.ja.md`](./dx.ja.md#1-型レベルのチェックコンパイル時)。
- [x] `splitProps` の戻り型を厳密化 ── キーグループごとの `Pick` + 末尾の rest 用 `Omit` の
  タプル(`SplitProps<T, K>`。`const` 型引数でリテラルキーを推論に残す)。旧来の緩い
  `Array<Partial<T>>` を置き換え。

> ミスを *実際に* 捕まえる 3 層(型・実行時の開発警告・テスト)は
> [`dx.ja.md`](./dx.ja.md) に集約 ── コンパイラ無しでは捕まえられないもの、そして
> その穴を埋める linter も含めて。

### ツール・公開
- [ ] `@kanabun/core` と `@kanabun/cli` を npm に**公開**する。それまでは `create` が生成する
  `package.json` は `^0.0.0` のプレースホルダを参照し、クイックスタートはこのリポジトリから
  実行する。
- [ ] バージョニング / リリース戦略。

> 自前 linter(`kanabun lint`)は **Phase 7**(作成支援ツール)へ移動 ── アイランドと
> 並んで上に記載。

### 既知の軽微項目(レビュー由来)
- [ ] dev サーバーは封じ込めのためリクエストごとに `realpath` の stat を行う(Bun 自身の
  解決に加えて二重 stat)。dev サーバー用途では許容、メモのみ。
- [ ] `parseArgs` は `--a --b` を `a=true`(値を消費しない)として扱う。現行フラグでは許容、
  増えたら文書化する。

## 未決の設計判断

Phase 4 に未決はなし(完了)。残りは Phase 6 / DX(任意、上記)。

(解決済み: **`context` の子モデル** — コンパイラや先送りではなく**関数の子**を採用。
**スコープド CSS** — ビルド工程や CSS Modules / Svelte 属性方式ではなく、ランタイムの
Emotion 風 `css` ヘルパーを採用。`decisions.ja.md` を参照。)

これらは元の構想ドキュメントの「難所」に対応します。signals の意味論(Phase 1)と keyed リスト
(Phase 3)は解決済み、状態保持 HMR(Phase 5/6)は全リロードへ意図的に先送りしました。
