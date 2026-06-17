# セキュリティ診断と既知のリスク

*[English](./security.md) | 日本語*

フレームワーク全体のセキュリティ診断で見つかった事項の記録。これらは**まだ
未修正**で、今後計画的に対応するためにここに記録しておく。脅威モデルは
(1) XSS などの一般的な Web リスク、(2) メモリリーク、(3) Web API を独自実装した
ことによる潜在リスク、をカバーする。

各事項は推測ではなく具体的な再現コード (PoC) で確認済み。重大度はプロジェクト
規約に従う: 🔴 要対応 / 🟡 推奨 / 🔵 軽微。

## サマリ

| ID | 重大度 | 領域 | 概要 |
| --- | --- | --- | --- |
| [S1](#s1--ssrspread-props-経由の属性名インジェクション) | 🔴 | XSS (SSR) | spread props の属性**名**が無検証・無エスケープで出力される |
| [S2](#s2--css-の補間による-style-脱出) | 🔴 | XSS (SSR) | `css` の補間値が `<style>` raw-text を脱出できる |
| [S3](#s3--hrefsrc-の-url-スキーム未検証) | 🟡 | XSS | `href`/`src` の URL スキーム未検証（`javascript:` が素通し） |
| [S4](#s4--servernode-が実-dom-と乖離している) | 🟡 | Web API 独自実装 | `ServerNode` が実 DOM の検証を省略し、サーバ側で防御をすり抜ける |
| [S5](#s5--dev-サーバdecodeuricomponent-の未捕捉例外) | 🟡 | dev サーバ | パスの `decodeURIComponent` が未捕捉の `URIError` を投げうる |

対象外（意図的に追跡しない）: CSS ハッシュ衝突時の「先勝ち」挙動と、dev 専用で
理論上無制限の `seen` 警告集合。いずれも実用上のセキュリティ影響なしと判断。

### すでに堅牢な点

- **テキスト・属性値のエスケープ。** `server-dom.ts` の `escapeText` /
  `escapeAttr` は `& < >`（および常に二重引用符で囲まれる属性値の `"`）を適切に
  無害化するため、通常の `{userInput}` の子要素・属性値は XSS 経路にならない。
- **メモリ管理。** owner tree + `onCleanup` モデルにより、`createRoot`、`effect`
  の再実行 (`disposeOwned`)、`mapArray`（アイテム単位の root と未再利用アイテムの
  破棄）、router の `disposableSlot`、`resource`（version によるキャンセル）、
  `<Suspense>` の各所でリアクティブスコープが正しく破棄される。イベントリスナは
  要素生成時に一度だけ登録され（effect 内で再登録しない）蓄積しない。明確な
  リークは見つからなかった。
- **dev サーバのパストラバーサル。** `cli/src/dev.ts` は字句的な `..` チェックと
  `realpath` による包含チェックの二段構え（配信ルート外を指すシンボリックリンクも
  捕捉）。

---

## S1 — SSR：spread props 経由の属性名インジェクション

**箇所:** `packages/core/src/server-dom.ts`（`serialize`, `ServerNode.setAttribute`）

`serialize()` は属性**値**はエスケープするが属性**名** `k` をそのまま出力し、
`ServerNode.setAttribute` は実 DOM と違い名前の妥当性検証をしない:

```ts
// server-dom.ts — serialize()
for (const [k, v] of node.attributes) attrs += ` ${k}="${escapeAttr(v)}"`; // k が無エスケープ
// server-dom.ts — setAttribute(): 実 DOM は不正名で InvalidCharacterError を投げる
setAttribute(name, value) { this.attributes.set(name, String(value)); }
```

コンポーネントが**キー**を攻撃者に制御されたオブジェクトを spread すると
（`<div {...userObject} />`）、キーでタグを閉じてマークアップを注入できる。

**PoC（再現済み）:**

```
key:  'x><img src=x onerror=alert(1)'
out:  <div x><img src=x onerror=alert(1)="y"></div>   ← タグ脱出・XSS 成立
```

危険なのは**非対称性**: クライアントでは実 `setAttribute` が不正名で例外を投げて
失敗安全になるが、サーバは黙って受理する。

**修正方針:** `serialize`（または `setAttribute`）で属性名を安全な集合
（例 `/^[A-Za-z_:][-A-Za-z0-9_:.]*$/`）に制限し、不正名はスキップ／例外化して
実 DOM の挙動に揃える。

## S2 — `css` の補間による `<style>` 脱出

**箇所:** `packages/core/src/css.ts`（`css`）, `server-dom.ts`（`serialize` の raw-text 経路）

公開ヘルパ `css` は補間値を `String(values[i])` で連結する。`<style>` は raw-text
要素なので `serialize()` は中身を**無エスケープ**で出力する（HTML 仕様上は正しい）。
補間値に閉じタグを含めると `<style>` を脱出できる。

**PoC（再現済み）:**

```
css`... ${ "</style><img src=x onerror=alert(1)>" }`
head: <style data-k="...">.k-...{</style><img src=x onerror=alert(1)>}</style>  ← XSS 成立
```

クライアント経路（`style.textContent = cssText`）は安全で、これは**SSR でのみ**
顕在化する。ドキュメントには untrusted を `<style>`/`<script>` に補間するなと注意
書きがあるが、`css` の補間構文自体が誤用を誘発する。

**修正方針:** raw-text 本体の直列化時（または `css` の出力）で、大小文字を無視した
`</style` / `</script` の出現を無害化する。HTML 仕様上 raw-text 内にこれらを含めて
はならないため、中和は安全に行える。

## S3 — `href`/`src` の URL スキーム未検証

**箇所:** `packages/core/src/dom.ts`（`setAttr`）, `packages/router/src/router.ts`（`Link`）

URL を含む属性は無検証で素通しされ、`href="javascript:alert(1)"` がそのまま出力
される（再現済み）。Solid / Svelte 等も開発者責任としているため一部は許容リスク
だが、router の `<Link>` は `javascript:` を「外部リンク」と判定し
（`isExternal()` がスキームに一致）**ブラウザ既定動作にフォールバック**するため、
クリックで実行される点に注意。

**修正方針:** 責任範囲を明記しつつ、`<Link>` では危険スキーム（`javascript:`,
`data:`）を外部リンク扱いせず拒否する。

## S4 — `ServerNode` が実 DOM と乖離している

**箇所:** `packages/core/src/server-dom.ts`

S1 の根本原因。`ServerNode` は実 DOM の不変条件（属性名検証、`createElement` の
タグ名検証など）を強制しない。これは「Web API を独自実装した」典型的リスクで、
クライアントとサーバの挙動が分岐し、ガードを飛ばすのはサーバ側になる。直列化前に
実 DOM の最低限の検証に合わせる検証層を設ければ、この種の問題を一括して塞げる。

## S5 — dev サーバ：`decodeURIComponent` の未捕捉例外

**箇所:** `packages/cli/src/dev.ts`

```ts
const pathname = decodeURIComponent(new URL(req.url).pathname);
```

不正なパーセントエスケープ（`/%ZZ`、単独の `%`）で `decodeURIComponent` が
`URIError` を投げ、ハンドラ内で未捕捉になる。dev 限定かつリクエスト単位の失敗
（サーバ自体は落ちない）だが、デコードを `try/catch` で囲み 404 にフォールバック
させるのが堅実。トラバーサルの包含チェック自体は妥当。
