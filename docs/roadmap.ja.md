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
| 6 | 堅牢化・周辺(ルーター、SSR 等) | 🟡 進行中 — **ルーター + エラーバウンダリ + 開発時警告 + SSR/ハイドレーション 完了**;残りは任意 |

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
  描画(`<Outlet>` 不要)、params は連鎖でマージ。*相対 `<Link>` href は follow-up。*
- [x] **SSR + ハイドレーション。** 完了 ── `renderToString`(コア、ランタイム非依存:
  シリアライズ可能なサーバ DOM を設置して eager な JSX ランタイムを実 `document` 無しで
  走らせ、ツリーを一度組んで `{ html, head }`(スコープド CSS も収集)を返し dispose する ──
  サーバでは `onMount` は発火しない)。`hydrate`(クライアント)はサーバマークアップ上に
  ライブなアプリをマウントする。SSG は同じ `renderToString` をビルド時に走らせれば出る
  (decisions 参照)。例(`examples/ssr`)は動く Bun SSR サーバ + クライアントハイドレーション。
  ノード単位の引き取りは未実装で、コンパイラ/マーカーが要ると記録 ──
  [`decisions.md`](./decisions.md#ssr-hydration--ssg-phase-6) 参照。依存ゼロ・100% カバレッジ・
  `packages/core` はランタイム非依存を維持。
- [ ] **状態保持 HMR**(現状は全リロード ── Phase 5 で意図的に簡略化した部分)。
- [x] **エラーバウンダリ。** 完了 ── `catchError`(コアのプリミティブ)+ `<ErrorBoundary
  fallback={…}>`。子の *生成時* または *リアクティブ更新時* に throw されたエラーを捕捉して
  クラッシュさせず fallback を描画し、`reset` でサブツリーを作り直す。owner ツリーに乗る
  (エラーハンドラを private シンボル下の context として保存し、throw は最も近いハンドラを
  上に辿る ── 無ければ再 throw)。依存ゼロ・カバレッジ 100%・ランタイム非依存。詳細は
  [`decisions.ja.md`](./decisions.ja.md#エラーバウンダリphase-6) を参照。
- [ ] **非同期 / Suspense** プリミティブ(例: `resource`)。
- [x] **開発時の警告。** 完了 ── オプトインのランタイム診断(`setDev(true)`。
  `kanabun dev` は `globalThis.__KANABUN_DEV__` 経由で自動有効化)。owner 外の
  `effect()`/`onMount()`/`onCleanup()` と、computed 内のシグナル書き込みを検知。重複排除
  あり、差し替え可能なシンク(`setWarnHandler`)付き。「thunk として渡すべき signal を
  読んでしまった」ケースはコンパイラ無しでは確実に検知できない ── 理由と *検知できる* もの
  は [`decisions.ja.md`](./decisions.ja.md#開発時警告phase-6) を参照。依存ゼロ・カバレッジ
  100%・ランタイム非依存。

### DX と型の精緻化
- [~] `JSX.IntrinsicElements` の厳密化。**イベントハンドラは完了** ── `on*` プロップを
  `EventHandler<E>`(型付きイベント)関数として型付け。よって「`() =>` 書き忘れ」
  (`onClick={count.set(…)}`)はコンパイルエラーになり、条件付きハンドラ(`undefined`)や
  `void`/`undefined` の区別も正確に扱う。詳細は
  [`dx.ja.md`](./dx.ja.md#1-型レベルのチェックコンパイル時)。**残り:** 要素ごとの *属性*
  型(まだ `[attr]: any`)。
- [ ] `splitProps` の戻り型を厳密化(`Pick`/`Omit` のタプル)。現状は緩い
  `Array<Partial<T>>`。

> ミスを *実際に* 捕まえる 3 層(型・実行時の開発警告・テスト)は
> [`dx.ja.md`](./dx.ja.md) に集約 ── コンパイラ無しでは捕まえられないもの、そして
> その穴を埋める linter も含めて。

### ツール・公開
- [ ] `@kanabun/core` と `@kanabun/cli` を npm に**公開**する。それまでは `create` が生成する
  `package.json` は `^0.0.0` のプレースホルダを参照し、クイックスタートはこのリポジトリから
  実行する。
- [ ] バージョニング / リリース戦略。
- [ ] **自前 linter(`kanabun lint`)。** ランタイムでは捕まえられない取り違えを静的解析で
  拾う ── 主に子/属性で `{count}` のつもりの `{count()}`(呼び出しが値に潰れる前にソースを
  見る必要がある)と、関連する規約違反。ESLint プラグインでは **ない**(ESLint は外部依存で、
  kanabun は依存ゼロ)── Bun レイヤーの第一級 CLI コマンドで、型チェックで既に使っている
  オンデマンドの TypeScript パーサを再利用する。オプトインかつ開発時のみの作成支援ツールで
  あって、ランタイムコンパイラではない(創設時の制約を保つ)。詳細は
  [`dx.ja.md`](./dx.ja.md#4-将来自前-linter)。

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
