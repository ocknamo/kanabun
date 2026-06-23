# kanabun

[![CI](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml/badge.svg)](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ocknamo/kanabun/badges/coverage.json)](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml)

*[English](./README.md) | 日本語*

> **Bun + TypeScript** だけで作る、Svelte ライクなフロントエンドフレームワーク。
> **ランタイム依存はゼロ**。

狙いは、Svelte の「変数を書き換えると UI が勝手に追従する」気持ちよさを、
素のブラウザ JS にコンパイルして実現すること。利用者のアプリに余計なフレーム
ワークランタイムが乗りません。kanabun 自身が頼るのは Bun(開発体験のため)と
TypeScript(型のため)だけで、ブラウザに出るのは標準 JS のみ。開発環境も最小限に
保っています(型専用の dev 依存が1つだけ。[下記参照](#依存はあえて最小限))。

**状態:** 初期段階だが実用可能。リアクティブコア、JSX ランタイム + `render`、制御構文
(`<Show>` / `<For>`、keyed)、DX プリミティブ(`onMount`、`mergeProps`、`splitProps`、
スコープド `css`、`context`)、エラーバウンダリ、SSR(`renderToString` / `hydrate`)+
SSG(`kanabun generate`)、非同期データ(`resource` / `<Suspense>`)、エコシステム
プリミティブ(`lazy`、`<Portal>`、`<Dynamic>`、`<Head>` / `<Title>`)、アイランド
(`<Island>` / `registerIsland` / `hydrateIslands`)、ルーター
(`@kanabun/router`)、そして CLI(`create` / `dev` / `build` / `generate`)を
実装・テスト済み。**TodoMVC が動き、`kanabun dev` / `kanabun build` が機能します。**

---

## クイックスタート

**前提:** [Bun をインストール](https://bun.sh/docs/installation)してください。

以下はすべてこのリポジトリのクローンから実行します ── パッケージはまだ npm に未公開です
([ロードマップ](docs/roadmap.ja.md)参照)。

```sh
bun install            # 入るのは @types/bun のみ
bun test               # 全テスト
```

例をライブリロードで動かす、またはブラウザ向けにバンドル:

```sh
# dev サーバー(変更で全リロード)
bun packages/cli/bin/kanabun.ts dev   examples/todomvc/index.html

# 本番バンドル
bun packages/cli/bin/kanabun.ts build examples/counter/index.html --outdir dist
```

新規アプリの生成(意図する `kanabun create` ワークフロー):

```sh
bun packages/cli/bin/kanabun.ts create my-app
```

最小のコンポーネント:

```tsx
import { signal, render } from "@kanabun/core";

function Counter() {
  const count = signal(0);
  return (
    <button type="button" onClick={() => count.update((n) => n + 1)}>
      count is {count}
    </button>
  );
}

render(() => <Counter />, document.getElementById("app")!);
```

---

## なぜ

signals は仮想 DOM も差分計算もなしに Svelte ライクな手触りを与えます
(変わった所だけ更新)。テンプレートは将来 **JSX** に乗せることで、型チェックと
エディタ支援を丸ごと TypeScript に任せられます。独自 DSL も LSP も作りません。
これにより kanabun 自身のコンパイラは小さく保たれ、コアは依存ゼロのままです。

設計判断の根拠と、検討して却下した代替案は
[`docs/decisions.ja.md`](docs/decisions.ja.md)([English](docs/decisions.md))を参照。

---

## リアクティブコア(`@kanabun/core`)

glitch-free・遅延評価の signals 実装。公開 API は意図的にごく小さく保っています。

```ts
import { signal, computed, effect, batch, untrack, onCleanup } from "@kanabun/core";

const count = signal(0);

// 読みは呼び出し、書きは .set / .update
count();                    // 0
count.set(1);
count.update((n) => n + 1); // 2

// 派生値はメモ化され、遅延評価される
const doubled = computed(() => count() * 2);

// effect は即時実行され、依存が変わると再実行される
const dispose = effect(() => {
  console.log("count is", count());
  return () => console.log("cleaning up"); // 任意の後始末(Svelte $effect 風)
});

// 書き込みをまとめ、観測者には1つの原子的変更として見せる
batch(() => {
  count.set(10);
  count.set(20); // effect は 20 で1回だけ実行
});

dispose(); // effect を停止
```

| API | 役割 |
| --- | --- |
| `signal(value, opts?)` | 書き換え可能な状態。読み `s()`、書き `s.set(v)` / `s.update(fn)`、購読せず読む `s.peek()`。 |
| `computed(fn, opts?)` | メモ化された派生値。読まれたときだけ、かつ依存が実際に変わったときだけ再計算。 |
| `effect(fn)` | 即時実行し依存変化で再実行。disposer を返す。`fn` はクリーンアップ関数を返せる。 |
| `batch(fn)` | 複数の書き込みを1回の通知/フラッシュにまとめる。 |
| `untrack(fn)` | 購読せずにリアクティブ値を読む。 |
| `onCleanup(fn)` | 実行中の effect / computed の後始末を登録する。 |

`opts` は `{ equals }` を受け取ります(独自比較関数、または `false` で毎回通知)。

### なぜ「明示 getter」(`count` ではなく `count()`)なのか

`count()` の呼び出しこそが依存を記録する瞬間 ── 装飾ではなく**購読そのもの**です。
これは SolidJS のモデルです。おかげでリアクティビティに**コンパイラが不要**になり
(Svelte の素の `count++` 魔法は原理的にコンパイラを要する)、コアは小さく保たれ、
`tsc` とエディタが独自ツールなしで全行を理解できます。

---

## 描画(JSX)

テンプレートは JSX/TSX です。TypeScript が kanabun 自身の JSX ランタイム
(`jsxImportSource: "@kanabun/core"`)に対して型チェックするので、DSL も LSP も不要。
**仮想 DOM も差分計算もありません**。`jsx(...)` が実 DOM を即時生成し、リアクティブな
箇所だけを細粒度の effect で接続します。

```tsx
import { signal, render } from "@kanabun/core";

function Counter() {
  const count = signal(0);
  return (
    <button type="button" onClick={() => count.update((n) => n + 1)}>
      count is {count}
    </button>
  );
}

render(() => <Counter />, document.getElementById("app")!);
```

コンポーネントは**一度だけ**実行されます(再実行しない)。リアクティビティは式ごとです。

### 反応式の規約

コンパイラがないので、何がリアクティブかは明示します。**関数で渡した子・属性が
リアクティブ**です。

```tsx
<span>{count}</span>             // リアクティブ(アクセサは関数)
<span>{() => count() * 2}</span> // リアクティブ(thunk)
<span>{count()}</span>           // 静的 ── 構築時に一度読むだけ
<div class={() => cls()} />      // リアクティブな属性
<button onClick={handler} />     // on* は常にイベント、リアクティブにはならない
```

### 制御構文:`<Show>` と `<For>`

`<Show>` は条件分岐、`<For>` は **keyed** なリスト描画です。アイテムは参照でキーづけされ、
アイテムごとにノードを一度だけ生成、挿入/削除/並べ替え時に再利用します(全再構築なし)。
アイテムが消えるとそのリアクティブスコープは破棄されます。

```tsx
<Show when={() => user()} fallback={<p>Loading…</p>}>
  <Profile user={user()!} />
</Show>

<For each={() => todos()} fallback={<p>No todos</p>}>
  {(todo) => <li class={() => (todo.done() ? "done" : "")}>{todo.title}</li>}
</For>
```

### コンポーネント補助

- `onMount(fn)` — 初回描画の後(次のマイクロタスク)に一度だけ実行。
- `onCleanup(fn)` — 現在のスコープの後始末。
- `mergeProps(...objs)` / `splitProps(props, [...keys])` — リアクティビティ(転送 getter)を
  保ったまま props を結合/分割。

### コンテキスト

`createContext(default)` は、`<Ctx.Provider>` で提供し `useContext(Ctx)` で読むハンドルを
返します。コンパイラがないため、Provider の子は **関数**でなければなりません ──
`<Show>`/`<For>` と同じ「関数は遅延」規約で、子が読む前に値が設定されるようにするためです。
値にアクセサを渡せばリアクティブになります。

```tsx
import { createContext, useContext, signal } from "@kanabun/core";

const Theme = createContext("light");

function Toolbar() {
  const theme = useContext(Theme); // 下では "dark"、無ければ既定の "light"
  return <div class={theme}>…</div>;
}

const theme = signal("dark");
// 関数の子(必須)── 値が提供された後に走る:
<Theme.Provider value={theme}>{() => <Toolbar />}</Theme.Provider>;
```

`useContext` は owner ツリーを上へ辿り、最も近い提供値(読み手の上に Provider が無ければ
既定値)を返します。(素の・関数でない子は Provider 実行前に構築されるため、既定値しか
見えません。)

### エラーバウンダリ

`<ErrorBoundary>` は、子の **生成時** または **リアクティブ更新時** に throw された
エラーを捕捉し、アプリをクラッシュさせずに `fallback` を描画します。子を関数で包めば
(同じ遅延の規約)その生成もガードされます。`fallback` はノード、または
`(err, reset) => node`(`reset` はエラーをクリアして子を作り直す)を指定できます。

```tsx
import { ErrorBoundary } from "@kanabun/core";

<ErrorBoundary fallback={(err, reset) => (
  <div>
    <p>壊れました: {String(err)}</p>
    <button onClick={reset}>再試行</button>
  </div>
)}>
  {() => <Widget />}
</ErrorBoundary>;
```

内部では、エラーハンドラを owner ツリーに(context と同様に)保存します。throw は
最も近い境界まで上に辿り、無ければホストへ再 throw されます。`catchError(tryFn, handler)`
は同じ仕組みをプリミティブとして提供し、命令的に捕捉したいときに使えます。

### 非同期データ:`resource` と `<Suspense>`

`resource` は非同期関数をリアクティブな状態に変えます ── 値アクセサ + `loading()` /
`error()` アクセサ + `{ mutate, refetch }` アクション。レース安全(古い fetch が新しい
結果を上書きしない)で、任意のリアクティブな `source` が変わるたびに再取得します
(`false` / `null` / `undefined` の source は「未準備 ── まだ取得しない」を意味します)。

```tsx
import { resource, Suspense } from "@kanabun/core";

function Profile(props: { id: () => number }) {
  // id() が変わるたびに再取得。data() は解決まで undefined。
  const [user, { refetch }] = resource(props.id, (id) => fetchUser(id));
  return (
    <div>
      <h1>{() => user()?.name ?? ""}</h1>
      {() => (user.loading() ? <span>更新中…</span> : null)}
      <button onClick={refetch}>再読み込み</button>
    </div>
  );
}

// <Suspense> は子の resource が *初回* ロード中は fallback を表示し、完了後に子を
// 見せる。以降の refetch() は直前の値を画面に残す(インラインのスピナーには
// loading() を読む)。resource が境界の下で生成されるよう、子は関数で包む。
<Suspense fallback={<p>読み込み中…</p>}>
  {() => <Profile id={id} />}
</Suspense>;
```

エラーは `resource.error()` で公開され(`<ErrorBoundary>` へ自動転送はしない)、表示の
仕方は UI 側で選べます。

### スコープド CSS

`css` はランタイム・コンパイラなしのヘルパー(Emotion 風)です。スタイル本体を
一意なクラス(`k-<hash>`)へハッシュし、各ルールをそのクラス配下にスコープして、
`<head>` に `<style>` を 1 回だけ注入(ハッシュで dedupe)し、適用するクラス名を
返します。ハッシュが一意なのでスタイルは原理的に衝突せず、セレクタ書き換えや
ビルドステップは不要 ── 文字列のスコープ付けだけです。

```tsx
import { css } from "@kanabun/core";

const button = css`
  padding: 0.5rem 1rem;
  &:hover { background: #ececec; }   // & -> スコープクラス
  .icon  { margin-right: 4px; }      // 素のセレクタ -> 子孫(.k-x .icon)
  @media (min-width: 40rem) { padding: 1rem; } // 内側も再スコープ
`;

<button class={button}>Save</button>;
```

`class` はただの文字列なのでそのまま渡せます。条件付き切り替えはいつもの関数形で、
例:`class={() => active() ? `${base} ${on}` : base}`。対応範囲は、トップレベル宣言・
`&`/子孫ネスト・カンマ区切り・`@media`/`@supports`/`@container`/`@document`/`@layer`
(内側を再スコープ)。その他の at-rule(`@keyframes`、`@font-face` …)は本質的に
グローバルなのでそのまま通します。ネストブロック直前の宣言は `;` で終端が必要(Sass /
ネイティブ CSS ネストと同じ)で、波括弧のマッチは字句的なので、文字列/コメント中の
リテラル `{`/`}` は解釈しません ── その用途はグローバルなスタイルシートで。

動かせる例:[`examples/counter/`](examples/counter/)、
[`examples/todomvc/`](examples/todomvc/)、[`examples/router/`](examples/router/)、
[`examples/primitives/`](examples/primitives/)(`lazy` / `<Portal>` / `<Dynamic>` /
`<Head>` のツアー)(`bun examples/<name>/index.html` で起動 ── Bun 1.3+ の HTML
エントリ dev サーバーを利用)。SSR の例([`examples/ssr/`](examples/ssr/))と
アイランドの例([`examples/islands/`](examples/islands/))はサーバーとして起動します:
`bun examples/ssr/server.tsx` / `bun examples/islands/server.tsx`。アイランド単位の
コード分割は `bun examples/islands/serve-split.ts`(ネットワークタブで、存在する
アイランドのチャンクだけが読まれるのが見えます)。

---

## SSR・ハイドレーション(`renderToString` / `hydrate`)

サーバー(またはビルド時)で HTML 文字列にレンダリングし、クライアントでインタラクティブに
します。`renderToString` は実 DOM を必要としません ── シリアライズ可能なサーバ DOM を
設置し、ツリーを一度組み(リアクティブ値は購読せず一度だけ読む。`onMount` は発火しない)、
マークアップと `<head>` に入れるスコープド CSS を返します。

```tsx
// サーバー(またはビルド時の prerender)
import { renderToString } from "@kanabun/core";
const { html, head } = renderToString(() => <App />);
const page = `<!doctype html><html><head>${head}</head>` +
             `<body><div id="app">${html}</div>` +
             `<script type="module" src="/main.js"></script></body></html>`;

// クライアント(main.tsx)
import { hydrate } from "@kanabun/core";
hydrate(() => <App />, document.getElementById("app")!);
```

**SSG は同じ `renderToString` をビルド時に走らせ**、リクエストごとに返す代わりに `.html`
ファイルへ書き出すだけです ── **`kanabun generate`** コマンドとして提供します(下記)。
`hydrate` はサーバマークアップ上にライブなアプリをマウントします(ページは既に描画済みなので
ちらつき無し)。既存ノードのその場引き取りはしません ── それにはコンパイラ/マーカーが要り、
「コンパイラなし」制約で除外されます。
[`docs/decisions.md`](docs/decisions.md#ssr-hydration--ssg-phase-6) 参照。

---

## CLI(`@kanabun/cli`)

`kanabun` コマンドは唯一の Bun 依存層です。Bun のバンドラ/サーバーをラップするので、
esbuild / Vite への依存はありません。`@kanabun/core` はランタイム非依存のままです。

```sh
kanabun create my-app     # 新規プロジェクトを生成
kanabun dev               # ./index.html の dev サーバー、変更で全リロード
kanabun build             # ./index.html を ./dist にブラウザ向けバンドル
kanabun generate ssg.tsx  # ルートを静的 .html に prerender(SSG)
```

`dev` は HTML エントリを配信し、TS/TSX をオンザフライでバンドルし、WebSocket で
ライブリロードします(状態保持 HMR は先送り、今は全リロード)。`build` は
`bun build --target browser` のラッパーです。

`generate` は SSG です。SSG config(`{ routes?, render(path), client?, title?,
base?, document? }`)を import し、ルートごとに `renderToString` を走らせて
`<outdir>/<route>/index.html` を書き出します。任意の `client` エントリは一度だけ
バンドルされ全ページから参照されるので、静的 HTML がライブなアプリにハイドレートします
(無ければ静的のみ)。`base`(または `--base`、例 `/repo/`)はクライアント `<script>` の
src に前置され、サブパス配信(GitHub Pages)で出力がそのまま動きます。
[`examples/ssg/`](examples/ssg/) 参照。

---

## ルーター(`@kanabun/router`)

history ベースのルーターを別パッケージで提供します。コアの signals と owner ツリー
context の上に構築されるため、**依存ゼロ**でランタイム非依存のまま(ブラウザのグローバルは
遅延解決。テストや SSR はインメモリの history ソースを使う)。

```tsx
import { Router, Route, Link, useParams } from "@kanabun/router";

function User() {
  const params = useParams();             // リアクティブなルートパラメータ
  return <h2>User {() => params().id}</h2>;
}

function App() {
  return (
    <Router>
      {() => (                            // 関数の子 = 遅延(<Show> と同じ規約)
        <>
          <nav>
            <Link href="/">Home</Link>
            <Link href="/users/1">User 1</Link>
          </nav>
          <Routes fallback={<p>404</p>}>  {/* 最初にマッチした1つ、なければ fallback */}
            <Route path="/" children={<p>home</p>} />
            <Route path="/users/:id" children={() => <User />} />
          </Routes>
        </>
      )}
    </Router>
  );
}
```

`<Route>` はパターン(`/`、`/users/:id`、`/files/*rest`)にマッチし、`<Show>` と同じく
マッチ結果を boolean にメモ化するので、内容はマッチごとに一度だけ構築され、params は
更新され続けます。単独の `<Route>` は独立に描画されますが、`<Routes>` で包むと**排他**
ルーティングになり、最初にマッチした1つだけが描画され、共有の `fallback` が未マッチ
(=自然な 404)を受けます。`<Routes>` の直下は `<Route>` のみ描画されるので、共有の
ナビ・見出しは `<Routes>` の外に置きます。`<Link>` は素の左クリックだけ横取りします(修飾キー付き
クリックや外部リンクはブラウザ既定に委ねる)。`useNavigate` / `useLocation` / `useParams`
は最寄りの `<Router>` を読みます。`source` prop で history バックエンドを差し替えられます:
省略でブラウザ history、`createHashSource()` は **GitHub Pages** のような静的ホスト向け
(ルートを URL ハッシュに置くので、サーバの書き換え無しで直リンク・リロードが動く)、
`createMemorySource()` はテスト/SSR 向け、または独自の `RouterSource`。

**ネストルーティング。** ルートに `*` ワイルドカードの末尾(`path="/users/*"`)を付けると、
プレフィックスでマッチする *レイアウト* になります。そのコンポーネントは余りパスに対して
ネストした `<Routes>` を描画します ── ホスト要素(レイアウト自身の chrome)の内側に置けば、
それが outlet になります(`<Outlet>` コンポーネントは不要)。params は連鎖でマージされ、
子孫の `useParams()` はネスト全体の捕捉(`{ org, id }`)を読めます:

```tsx
<Routes>
  <Route path="/users/*" component={() => <UsersLayout />} />
</Routes>;

function UsersLayout() {
  return (
    <div class="users-layout">
      <UserList />                          {/* 詳細遷移をまたいで常駐 */}
      <Routes fallback={<p>Pick a person.</p>}>
        <Route path="/:id" children={() => <User />} />
      </Routes>
    </div>
  );
}
```

---

## API リファレンス

**`@kanabun/core`**

| グループ | エクスポート |
| --- | --- |
| リアクティビティ | `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot` |
| ライフサイクル | `onMount`, `onCleanup` |
| 描画 | `render`, `hydrate`, `jsx`, `jsxs`, `Fragment`(低レベル: `createElement`, `insert`, `reconcileNodes`) |
| サーバー(SSR/SSG) | `renderToString`(→ `{ html, head }`。DOM 不要) |
| 制御構文 | `Show`, `For`, `mapArray` |
| エラー処理 | `ErrorBoundary`, `catchError` |
| 非同期 | `resource`, `Suspense` |
| エコシステムプリミティブ | `lazy`(コード分割)、`Portal`(テレポート)、`Dynamic`(実行時ホスト)、`Head` / `Title`(document head) |
| アイランド | `defineIslands`(型付きレジストリ ── コンパイル時の name/props チェック)、`Island`(境界)、`registerIsland`、`hydrateIslands`、`hydrateIslandsLazy`(アイランド単位のコード分割) |
| props | `mergeProps`, `splitProps` |
| コンテキスト | `createContext`, `useContext` |
| スタイリング | `css`(スコープド CSS) |
| 開発時警告 | `setDev`, `setWarnHandler`(オプトイン。`kanabun dev` が自動有効化) |
| 型 | `Accessor`, `Signal`, `SignalOptions`, `Disposer`, `Context`, `Props`, `JSXChild`, `JSX`, `EventHandler`, `HTMLAttributes`, `ShowProps`, `ForProps`, `ErrorBoundaryProps`, `RenderToStringResult`, `Resource`, `SuspenseProps`, `LazyModule`, `PortalProps`, `DynamicProps`, `HeadProps`, `TitleProps`, `IslandProps`, `IslandBoundaryProps`, `IslandComponent`, `IslandRegistry`, `HydrateIslandsOptions`, `IslandsMap`, `DefinedIslands`, `IslandLoader`, `IslandLoaders` |

**`@kanabun/cli`**(`kanabun` コマンド。ライブラリとしても import 可能)

| 関数 | 役割 |
| --- | --- |
| `build(opts)` | ブラウザ向けバンドル。`{ success, outputs, logs }` を返す(例外を投げない)。 |
| `generate(opts)` | ルートを静的 HTML にプリレンダ(SSG)。`{ success, pages, logs }` を返す。 |
| `buildIslands(opts)` | アイランド単位のコード分割 + 遅延ブートストラップ。`{ success, script, outputs, logs }` を返す。 |
| `dev(opts)` | dev サーバー起動。`{ url, port, stop() }` を返す。 |
| `createDevHandler(opts)` | dev の `fetch` ハンドラ(埋め込み/テスト用)。 |
| `create(name, opts?)` / `templateFiles(name)` | プロジェクト生成 / そのファイル取得。 |
| `parseArgs(argv)` / `run(argv)` | CLI 引数の解析とディスパッチ。 |

**`@kanabun/router`**

| グループ | エクスポート |
| --- | --- |
| コンポーネント | `Router`, `Routes`, `Route`, `Link` |
| フック | `useNavigate`, `useLocation`, `useParams` |
| ソース | `createBrowserSource`, `createHashSource`, `createMemorySource` |
| マッチング | `matchPath`, `matchRoute`, `parsePath` |
| 型 | `RouterProps`, `RoutesProps`, `RouteProps`, `RouteHandle`, `RouteThunk`, `LinkProps`, `Navigate`, `NavigateOptions`, `RouterSource`, `MemorySource`, `WindowLike`, `RouterLocation`, `RouteParams`, `RouteMatch` |

---

## ロードマップ

Phase 0〜5 は完了(TodoMVC 稼働、CLI 動作)。Phase 6 ではルーター(`@kanabun/router`)、
エラーバウンダリ、開発時警告、SSR/ハイドレーション、非同期 / Suspense、SSG
(`kanabun generate`)を、Phase 7 ではエコシステムプリミティブ(`lazy`、`<Portal>`、
`<Dynamic>`、`<Head>` / `<Title>`)、アイランド(`<Island>` / `registerIsland` /
`hydrateIslands`)、アイランド単位のバンドル分割(`buildIslands` + `hydrateIslandsLazy`)を
追加しました。残り ── 作成支援ツール(`kanabun lint`、dev オーバーレイ)、状態保持 HMR ── と
未決の設計判断は
[`docs/roadmap.ja.md`](docs/roadmap.ja.md)([English](docs/roadmap.md))で管理しています。

コンパイラがないため、ミスの検知は 3 層に頼ります ── 型付きの `on*` ハンドラ、オプトインの
実行時開発警告(`setDev`)、テスト。詳細は
[`docs/dx.md`](docs/dx.md)([日本語](docs/dx.ja.md))に集約しています。

---

## 開発

必要なのは [Bun](https://bun.com/) だけです。

```sh
bun install            # 入るのは @types/bun と typescript(いずれも型/開発用)。出荷物には乗らない
bun test               # テスト実行
bun run test:coverage  # カバレッジ付き実行(text + lcov)
bun run typecheck      # bunx tsc --noEmit(TypeScript は固定版の dev 依存)
```

npm への全パッケージ一括 publish（メンテナー向け）:

```sh
bun run pub:dry   # プレパブリッシュチェックのみ実行。公開は行わない
bun run pub       # チェック → 確認 → 依存順に publish
                  # (core → router → cli)
```

`bun run pub` は publish 前に `bun test`、`tsc --noEmit`、全 example のビルドを
実行します。パッケージ間の内部依存 (`"*"`) は publish 時だけ具体的なバージョン
(`^x.y.z`) に書き換えられ、終了後にローカルは `"*"` へ戻ります。
バージョンが `0.0.0` のままのパッケージは publish をブロックします
（`--allow-zero-version` で上書き可）。
その他のオプション: `--access public|restricted`、`--tag <dist-tag>`、`--yes`。

CI は push / PR ごとに型チェック・テスト・カバレッジを実行します
([`.github/workflows/ci.yml`](.github/workflows/ci.yml))。`main` への push 時には
lcov レポートからカバレッジ率を算出し(`scripts/coverage-badge.ts`)、shields.io
エンドポイント用 JSON を orphan な `badges` ブランチへ公開します。上部のカバレッジ
バッジはそれを読むだけなので、外部カバレッジサービスに頼らない自前ホストです。別レーンのビジュアル
リグレッションゲートが、ピン留めした Playwright コンテナでサンプルを撮影し、
コミット済みベースラインと差分比較します ──
[`tests/visual/README.md`](tests/visual/README.md) 参照。Playwright は CI 専用
ツールで、プロジェクト依存には含めません。

### 依存はあえて最小限

- **ランタイム: ゼロ。** `@kanabun/core` は標準 JS のみ。アプリのバンドルに何も
  追加しません。
- **開発: 2つ、固定版。** dev 依存は
  [`@types/bun`](https://www.npmjs.com/package/@types/bun)(`bun:test` と Bun の
  型を提供。型なので出荷されません)と
  [`typescript`](https://www.npmjs.com/package/typescript)(本プロジェクトが許可する
  ツール)の2つだけ。型チェックを再現可能にするため、いずれもバージョンを固定しており、
  `bunx tsc` は毎回最新へ浮動せずローカルのバイナリを解決します。
- **Bun** は `.bun-version`(`oven-sh/setup-bun` が自動で読む単一の真実)で固定し、
  ローカルと CI を同じランタイムに揃えます。
- CI 基盤(`actions/checkout` や `oven-sh/setup-bun` などの GitHub Actions)は
  プロジェクトの依存グラフには含まれません。

### 構成

```
packages/
  core/        @kanabun/core — リアクティブコア + DOM/JSX ランタイム(ランタイム非依存)
    src/
      reactive.ts         signals: signal/computed/effect/batch/createRoot, onMount, context
      dom.ts              render + 細粒度の DOM バインド + keyed 差分
      control-flow.ts     <Show>, <For>, mapArray(keyed)
      props.ts            mergeProps / splitProps
      css.ts              スコープド CSS(ハッシュ + スコープ + <style> 注入)
      jsx-runtime.ts      jsx/jsxs/Fragment + JSX 型名前空間
      jsx-dev-runtime.ts  dev トランスフォームの入口
  cli/         @kanabun/cli — `kanabun` コマンド(Bun 専用層)
    src/        build.ts, generate.ts, islands.ts, create.ts, dev.ts, index.ts(argv + ディスパッチ)
    bin/        kanabun.ts
  router/      @kanabun/router — history ベースのルーター(ランタイム非依存)
    src/        location.ts(解析/マッチ), source.ts(history ソース), router.ts(コンポーネント + フック)
examples/
  counter/     動かせるリアクティブなカウンター
  todomvc/     動かせる TodoMVC
  router/      動かせるマルチページのルーターデモ
  primitives/  lazy / <Portal> / <Dynamic> / <Head> のツアー
  islands/     静的な外殻 + 独立してハイドレートする 2 つのアイランド
  ssr/ ssg/    サーバー描画 + 静的生成のデモ
docs/          設計ドキュメント(English + 日本語)
```

`core` パッケージは標準 JS / Web API のみを使い(DOM は Web API)、Bun / Node 固有
API は一切触りません。ランタイム固有のコードは将来のフェーズで追加する薄い CLI / dev
層に閉じ込めます。

テストファイル名は `*.spec.ts`。レンダラはリポジトリ内の小さな DOM モックでテストする
ので、jsdom / happy-dom 依存は不要です。

---

## ライセンス

MIT
