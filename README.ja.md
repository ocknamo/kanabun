# kanabun

[![CI](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml/badge.svg)](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml)

*[English](./README.md) | 日本語*

> **Bun + TypeScript** だけで作る、Svelte ライクなフロントエンドフレームワーク。
> **ランタイム依存はゼロ**。

狙いは、Svelte の「変数を書き換えると UI が勝手に追従する」気持ちよさを、
素のブラウザ JS にコンパイルして実現すること。利用者のアプリに余計なフレーム
ワークランタイムが乗りません。kanabun 自身が頼るのは Bun(開発体験のため)と
TypeScript(型のため)だけで、ブラウザに出るのは標準 JS のみ。開発環境も最小限に
保っています(型専用の dev 依存が1つだけ。[下記参照](#依存はあえて最小限))。

**状態:** 初期段階。Phase 1(リアクティブコア)と Phase 2(JSX ランタイム + `render`)
を実装・テスト済み。リアクティブなカウンターがエンドツーエンドで動きます。

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

動かせる例は [`examples/counter/`](examples/counter/) にあります
(`bun examples/counter/index.html` で起動)。

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
([`.github/workflows/ci.yml`](.github/workflows/ci.yml))。

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
  core/        @kanabun/core — リアクティブコア + DOM/JSX ランタイム
    src/
      reactive.ts         signals: signal/computed/effect/batch/createRoot
      dom.ts              render + 細粒度の DOM バインド
      jsx-runtime.ts      jsx/jsxs/Fragment + JSX 型名前空間
      jsx-dev-runtime.ts  dev トランスフォームの入口
    test/      *.spec.ts(+ dom-mock.ts: 小さなテスト専用 DOM)
examples/
  counter/     動かせるリアクティブなカウンター
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
