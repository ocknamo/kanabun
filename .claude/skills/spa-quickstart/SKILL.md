---
name: spa-quickstart
description: >
  新しい空のリポジトリで（Bun 未インストール前提から）kanabun の SPA を
  テスト雛形付きで最速セットアップする手順。
  「kanabun で新規アプリ」「ゼロから SPA を作りたい」等で起動。
---

# kanabun SPA Quickstart

## 1. Bun をインストール

`bun -v` が通れば飛ばす。未導入なら:

```sh
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # PATH を反映（または新しいシェルを開く）
```

## 2. プロジェクト生成

```sh
bunx @kanabun/cli create my-app
cd my-app && bun install
```

`index.html` / `src/main.tsx` / `tsconfig.json`（JSX は `@kanabun/core` 設定済み）が生成される。

## 3. テスト雛形

テストできるよう App を `src/app.tsx` に分離し、`src/main.tsx` はマウントだけにする:

```tsx
// src/app.tsx
import { signal } from "@kanabun/core";

export function App() {
  const count = signal(0);
  return (
    <button type="button" onClick={() => count.update((n) => n + 1)}>
      count is {count}
    </button>
  );
}
```

```tsx
// src/main.tsx（丸ごと置き換え）
import { render } from "@kanabun/core";
import { App } from "./app";

render(() => <App />, document.getElementById("app")!);
```

```tsx
// src/app.spec.tsx
import { test, expect } from "bun:test";
import { renderToString } from "@kanabun/core";
import { App } from "./app";

test("App renders the initial count", () => {
  const { html } = renderToString(() => <App />);
  expect(html).toContain("count is 0");
});
```

`renderToString` は DOM 不要なのでそのまま `bun test` で走る。
クリック等のインタラクションテストは `@kanabun/testing` が npm 公開され次第
`bun add -d @kanabun/testing` で（`renderTest` / `fireEvent`、jsdom 不要）。

## 4. 実行

```sh
bun test        # テスト
bun run dev     # dev サーバー http://localhost:3000/
bun run build   # dist/ に本番バンドル
```

## 補足

- ルーティングが要るなら `bun add @kanabun/router`。
- 規約: signal は `count()` で読み、`count.set(v)` / `count.update(fn)` で書く。
  関数の子・属性はリアクティブ（`{count}`）、`{count()}` は一度きりの読み取り。
