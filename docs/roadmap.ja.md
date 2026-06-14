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
| 6 | 堅牢化・周辺(ルーター、SSR 等) | 🟡 進行中 — **ルーター完了**;残りは任意 |

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
  `<Router>`/`<Route>`/`<Link>` + `useNavigate`/`useLocation`/`useParams`、差し替え
  可能な history ソース(`createBrowserSource` / `createMemorySource`)の上に構築。
  core の signals と owner ツリー context に乗る。依存ゼロ・カバレッジ 100%・ランタイム
  非依存。詳細は [`decisions.ja.md`](./decisions.ja.md#ルーターphase-6) を参照。
- [ ] **SSR + ハイドレーション。** サーバーで `renderToString`、クライアントで hydrate。
- [ ] **状態保持 HMR**(現状は全リロード ── Phase 5 で意図的に簡略化した部分)。
- [ ] **エラーバウンダリ。**
- [ ] **非同期 / Suspense** プリミティブ(例: `resource`)。
- [ ] **開発時の警告**(例: thunk として渡すべき signal を読んでしまった等)。

### DX と型の精緻化
- [ ] `JSX.IntrinsicElements` の厳密化: 現状は意図的に緩い(`[name]: any`)。要素ごとの
  属性・イベントハンドラ型を付ける。
- [ ] `splitProps` の戻り型を厳密化(`Pick`/`Omit` のタプル)。現状は緩い
  `Array<Partial<T>>`。

### ツール・公開
- [ ] `@kanabun/core` と `@kanabun/cli` を npm に**公開**する。それまでは `create` が生成する
  `package.json` は `^0.0.0` のプレースホルダを参照し、クイックスタートはこのリポジトリから
  実行する。
- [ ] バージョニング / リリース戦略。

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
