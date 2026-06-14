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
スコープド `css`)、そして CLI(`create` / `dev` / `build`)を実装・テスト済み。**TodoMVC が動き、`kanabun dev` /
`kanabun build` が機能します。**

---

## クイックスタート

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

動かせる例:[`examples/counter/`](examples/counter/) と
[`examples/todomvc/`](examples/todomvc/)(`bun examples/<name>/index.html` で起動 ──
Bun 1.3+ の HTML エントリ dev サーバーを利用)。

---

## CLI(`@kanabun/cli`)

`kanabun` コマンドは唯一の Bun 依存層です。Bun のバンドラ/サーバーをラップするので、
esbuild / Vite への依存はありません。`@kanabun/core` はランタイム非依存のままです。

```sh
kanabun create my-app     # 新規プロジェクトを生成
kanabun dev               # ./index.html の dev サーバー、変更で全リロード
kanabun build             # ./index.html を ./dist にブラウザ向けバンドル
```

`dev` は HTML エントリを配信し、TS/TSX をオンザフライでバンドルし、WebSocket で
ライブリロードします(状態保持 HMR は先送り、今は全リロード)。`build` は
`bun build --target browser` のラッパーです。

---

## API リファレンス

**`@kanabun/core`**

| グループ | エクスポート |
| --- | --- |
| リアクティビティ | `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot` |
| ライフサイクル | `onMount`, `onCleanup` |
| 描画 | `render`, `jsx`, `jsxs`, `Fragment`(低レベル: `createElement`, `insert`, `reconcileNodes`) |
| 制御構文 | `Show`, `For`, `mapArray` |
| props | `mergeProps`, `splitProps` |
| スタイリング | `css`(スコープド CSS) |
| 型 | `Accessor`, `Signal`, `SignalOptions`, `Disposer`, `Props`, `JSXChild`, `JSX`, `ShowProps`, `ForProps` |

**`@kanabun/cli`**(`kanabun` コマンド。ライブラリとしても import 可能)

| 関数 | 役割 |
| --- | --- |
| `build(opts)` | ブラウザ向けバンドル。`{ success, outputs, logs }` を返す(例外を投げない)。 |
| `dev(opts)` | dev サーバー起動。`{ url, port, stop() }` を返す。 |
| `createDevHandler(opts)` | dev の `fetch` ハンドラ(埋め込み/テスト用)。 |
| `create(name, opts?)` / `templateFiles(name)` | プロジェクト生成 / そのファイル取得。 |
| `parseArgs(argv)` / `run(argv)` | CLI 引数の解析とディスパッチ。 |

---

## ロードマップ

Phase 0〜5 は完了(TodoMVC 稼働、CLI 動作)。残り ── `context`、ルーター、
SSR、状態保持 HMR ── と未決の設計判断は
[`docs/roadmap.ja.md`](docs/roadmap.ja.md)([English](docs/roadmap.md))で管理しています。

---

## 開発

必要なのは [Bun](https://bun.com/) だけです。

```sh
bun install            # 入るのは @types/bun(型定義)のみ。出荷物には乗らない
bun test               # テスト実行
bun run test:coverage  # カバレッジ付き実行(text + lcov)
bun run typecheck      # bunx tsc --noEmit(TypeScript はオンデマンド取得)
```

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
- **開発: 1つ、型専用。** 唯一の dev 依存は
  [`@types/bun`](https://www.npmjs.com/package/@types/bun) で、`bun:test` と
  Bun の型を提供します。型なので出荷されません。
- **TypeScript**(本プロジェクトが許可するツール)はベンダリングせず、
  `bunx tsc` でオンデマンド取得します。
- CI 基盤(`actions/checkout` や `oven-sh/setup-bun` などの GitHub Actions)は
  プロジェクトの依存グラフには含まれません。

### 構成

```
packages/
  core/        @kanabun/core — リアクティブコア + DOM/JSX ランタイム(ランタイム非依存)
    src/
      reactive.ts         signals: signal/computed/effect/batch/createRoot, onMount
      dom.ts              render + 細粒度の DOM バインド + keyed 差分
      control-flow.ts     <Show>, <For>, mapArray(keyed)
      props.ts            mergeProps / splitProps
      css.ts              スコープド CSS(ハッシュ + スコープ + <style> 注入)
      jsx-runtime.ts      jsx/jsxs/Fragment + JSX 型名前空間
      jsx-dev-runtime.ts  dev トランスフォームの入口
  cli/         @kanabun/cli — `kanabun` コマンド(Bun 専用層)
    src/        build.ts, create.ts, dev.ts, index.ts(argv + ディスパッチ)
    bin/        kanabun.ts
examples/
  counter/     動かせるリアクティブなカウンター
  todomvc/     動かせる TodoMVC
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
