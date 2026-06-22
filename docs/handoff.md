# 引き継ぎメモ(次セッション向け)

> このファイルは作業の引き継ぎ用メモです(プロダクト文書ではないので日本語のみ)。
> 規約は [`../CLAUDE.md`](../CLAUDE.md)、残作業は [`roadmap.md`](./roadmap.md) が一次情報。
> ここは「いまの状態」と「今セッションで得た知見・落とし穴」に絞ります。
> 最終更新: 2026-06-21 / 最終コミット: Phase 7 アイランドのコア(`<Island>` / `registerIsland` / `hydrateIslands`)+ `examples/islands` デモ(ブランチ `claude/phase-7-lrtmhg`)。直前は Phase 7 エコシステムプリミティブ(`lazy` / `<Portal>` / `<Dynamic>` / `<Head>`・`<Title>`)+ `examples/primitives`(PR #26 マージ済み)

## 1. いまどこにいるか

- **ブランチ**: 現在は `claude/task-roadmap-inventory-doyffg`(`main` 直push しない / PR は指示があるまで作らない)。`main` には PR 経由で scoped CSS・VRT・context・ルーター・エラーバウンダリ・SSR/ハイドレーション・非同期・SSG・**CSS HMR**(PR #23)までマージ済み。加えて **セキュリティ監査の修正**(SSR XSS S1/S2・残り S3–S7、PR #15–#22)と **大規模リファクタ**(500行超ファイル/400行超 spec の分割・`createDependentScope`/`stringFlag`/`asEl` 共通化、PR #18–#21)もマージ済み。
- **進捗**: 要求定義の **Phase 0〜5 完了**。**Phase 6 は ルーター(`@kanabun/router`)+ エラーバウンダリ + 開発時警告 + SSR/ハイドレーション + 非同期(`resource`/`<Suspense>`)+ SSG(`kanabun generate`)+ CSS HMR を実装済み**(残るは状態保持 HMR のみ=コンパイラ無しでは到達不可)。
  - ルーター ── history ベース、`<Router>`/`<Routes>`(排他+404 fallback)/`<Route>`/`<Link>` + `useNavigate`/`useLocation`/`useParams`、差し替え可能な history ソース(browser / **hash**(GitHub Pages 向け)/ memory)。
  - **開発時警告(今セッション)** ── `packages/core/src/dev.ts`。オプトイン(`setDev(true)`、`kanabun dev` は `globalThis.__KANABUN_DEV__` で自動 ON)。owner 外の `effect()`/`onMount()`/`onCleanup()` と computed 内のシグナル書き込みを検知。重複排除 + 差し替え可能シンク(`setWarnHandler`)。詳細は `decisions.md`「Dev-time warnings (Phase 6)」。
  - **`on*` イベントハンドラの型付け(今セッション)** ── `JSX.IntrinsicElements` の部分厳密化。`packages/core/src/jsx-runtime.ts` に `EventHandler<E>` と `HTMLAttributes`(typed `on*` + `[attr]: any`)を追加し、`IntrinsicElements` を `[name]: HTMLAttributes` に。`onClick={count.set(…)}`(アロー書き忘れ=`void`)や非関数がコンパイルエラーに。条件付きハンドラ(`undefined`)は許す。型レベルテストは `packages/core/src/jsx-types.spec.ts`(`@ts-expect-error` で自己検証)。**残り**:要素ごとの *属性* 型はまだ緩い。
  - **開発者支援ドキュメント `docs/dx.md`(+ `.ja.md`)を新設** ── 型・実行時警告・テストの 3 層 + 将来の linter 構想を集約。
  - **ネストルーティング(今セッション)** ── `*` ワイルドカードのルートがプレフィックスでマッチする *レイアウト* になり、`matchRoute` が返す余りパス(`rest`)を新しい `RelPathContext` 経由でネストした `<Routes>`/`<Route>` に渡す。`<Outlet>` は無し(ネストした `<Routes>` をレイアウトの本体内・ホスト要素の内側に置く=それ自体が outlet)。params は連鎖でマージ(`useParams()` が `{ org, id }` を読める)。詳細は `decisions.md`「Nested routing (Phase 6)」。落とし穴は §4 に追記。
  - **SSR + ハイドレーション(今セッション)** ── `renderToString`(`packages/core/src/server.ts`)はシリアライズ可能なサーバ DOM(`server-dom.ts`)を `globalThis.document` に一時設置し、eager な JSX ランタイムを実 DOM 無しで走らせて `{ html, head }` を返す。`createRoot` で組んで即 `dispose`(`onMount` は microtask で owner 破棄済み→発火しない)。`hydrate`(`dom.ts`)はサーバマークアップをクリアしてライブツリーをマウント(ノード単位の引き取りはしない=eager bottom-up + コンパイラ無しの帰結。理由は `decisions.md`)。スコープド CSS は import 時(document 無し)に `pending` へ退避し `flushStyles` で再生(`css.ts`)。例は `examples/ssr`(Bun サーバ `server.tsx` + クライアント `main.tsx`)。
  - **非同期 / Suspense(今セッション)** ── `packages/core/src/async.ts`。`resource(fetcher)` / `resource(source, fetcher)` が非同期関数を 3 つの signal(`value`/`loading`/`error`)+ `version` カウンタに変える。`version` で**レース安全**(古い resolve/reject は破棄)。`source` 変化で再取得、未準備(`false`/`null`/`undefined`)はアイドル。fetcher は `Promise.resolve().then(...)` で 1 microtask 遅延 → 同期 throw も rejection 化・`loading` が観測可能に。エラーは `error()` で公開(ErrorBoundary へ自動転送しない=eager bottom-up の制約。理由は `decisions.md`)。`<Suspense fallback>` は `SuspenseContext`(increment/decrement レジストリ)を提供し、子を**境界の下・専用 createRoot で一度だけ**生成して `pending()` で fallback/子を選ぶ(ErrorBoundary と同型。遅延生成は無限ループするので一度だけが要)。初回ロードのみサスペンド(`resolvedOnce`)、refetch は直前値を残す。子は**関数**で包む規約。`{ mutate, refetch }` アクション付き。詳細は `decisions.md`「Async / Suspense (Phase 6)」。落とし穴は §4 に追記。
  - **SSG / `kanabun generate`(今セッション)** ── `packages/cli/src/generate.ts`。SSR/ハイドレーションのプリミティブに乗る薄い CLI prerender ループ(新しい描画経路は無い)。SSG **config**(`{ routes?, render(path), client?, title?, document? }`)を `await import` し、ルートごとに `renderToString(() => render(path))` → HTML ドキュメントで包んで `<outdir>/<route>/index.html`(`/`→`index.html`、`/about/`→`about/index.html`)に書き出す。任意の `client` は config からの相対で解決し `Bun.build` で一度だけバンドル→全ページが `<script>` で参照(ハイドレート)。`build` 同様 never-throw(`Bun.build` は失敗時 `AggregateError` を投げ、`errorMessages` で展開)。CLI は `kanabun generate [entry]`(既定エントリ `ssg.tsx`)。型(`SSGConfig`/`DocumentContext` 等)は `@kanabun/cli` から re-export、tsconfig `paths` に `@kanabun/cli` を追加。例は `examples/ssg`(`app.tsx`/`ssg.tsx`/`main.tsx`、2 ルート + ハイドレートするカウンター)。落とし穴は §4 に追記。
  - **相対 `<Link>` href(今セッション)** ── `packages/router/src/location.ts` に純関数 `resolvePath(to, from)` を追加(`new URL(to, BASE+from)` で、ブラウザが `<a href>` を解決するのと同じ規約)。`Router` の `navigate` が相対ターゲットを現在地に対して解決(絶対パスは素通り)するので `<Link>` と `useNavigate()` の両方で相対が効く。`<Link>` は描画する `<a href>` を解決済み絶対パスに(リアクティブ。中クリック/コピー/no-JS フォールバック用)。外部 href は `isExternal` 判定でそのまま(解決すると origin が剥がれるため)。`resolvePath` は index から re-export。テスト: location.spec.ts「resolvePath」群、router.spec.ts「a relative href resolves…」。
  - **`splitProps` タプル型(今セッション)** ── 戻り型を `Array<Partial<T>>` から精密タプル `SplitProps<T, K>`(キーグループごとの `Pick` + 末尾 `Omit`)へ。`const K extends ReadonlyArray<ReadonlyArray<keyof T>>` でリテラルキーを推論に残すのが肝。実装は不変、`return groups as unknown as SplitProps<T, K>`。コンパイル時テストは props.spec.ts「precise tuple」(`@ts-expect-error`)。
  - **JSX 属性型の厳密化(今セッション)** ── `packages/core/src/jsx-runtime.ts`。`on*` を `DOMEventHandlers` に切り出し、`HTMLAttributes`(グローバル基底:typed なグローバル属性 + events + `[attr]: any` の逃げ道)を拡張する要素別インターフェース(`AnchorHTMLAttributes`/`InputHTMLAttributes`/…)を追加。各属性は `Attr<T> = T | null | undefined | (() => T|null|undefined)`(値 or リアクティブアクセサ ── 規約尊重)。`IntrinsicElements` を主要要素にマップし、`[name: string]: HTMLAttributes` で残りをフォールバック。`[attr]: any` を残すので未知属性・未掲載要素は無破壊。型は core index から re-export。型テストは jsx-types.spec.ts「JSX attribute types」。
  - **CSS HMR(PR #23・handoff 後にマージ)** ── dev サーバが `.css` 変更をホットスワップ(`css:<path>` メッセージ → クライアントが該当 `<link rel="stylesheet">` だけ再フェッチ、アプリ状態は保持。一致無しは全リロードにフォールバック)。CSS 以外は従来どおり全リロード。判定は純粋・単体テスト済みヘルパー(`changeMessage`)。E2E(実ブラウザでホットスワップ検証)もカバー。詳細は `decisions.md`「CSS HMR (Phase 6)」。
  - 残る Phase 6(**状態保持 HMR**=コード編集をまたいで状態保持)は未着手 ── runtime-JSX・VDOM 無し設計ではコンパイラ無しに到達不可(コンポーネント境界/描画マーカーが無い)。
- **Phase 7(前セッション)**: **エコシステムプリミティブ完了** ── `lazy()`(動的 import + `<Suspense>` 連携、モジュールは成功・失敗ともキャッシュ)/ `<Portal>`(別 DOM ノードへテレポート、所有は現在ツリー、2 コメントマーカー間を cleanup で除去)/ `<Dynamic>`(実行時ホスト、`component` は関数=リアクティブ規約)/ `<Head>`・`<Title>`(SSR head channel に乗る、`renderToString` は dispose 前に head を読む)。`packages/core/src/{lazy,portal,dynamic,head}.ts`。`dom.ts` は `normalize` を export、`server-dom.ts`/`dom-mock.ts` に `body` を追加。デモは `examples/primitives`。
- **Phase 7(今セッション)**: **アイランドのコア完了** ── `packages/core/src/islands.ts`。`<Island name props>` はモジュールレベルのレジストリ(`registerIsland(name, Component)`)から引いてサーバで `<div data-island data-props>` に描画(props は属性へ JSON 直列化)。クライアントは `hydrateIslands({root?, registry?})` が `[data-island]` を走査(既定は `doc()` 全体)→ `data-props` を `JSON.parse`(無ければ `{}`)→ 同じレジストリで解決 → 各コンテナを `hydrate`。返り値は全アイランドを破棄する disposer。未登録 name は両側で throw。**レジストリ駆動を両側に**したのが設計判断(子で受け取らない=name → component 単一の真実、props は一度だけ)。登録モジュールはサーバ描画・クライアントエントリの両方から副作用 import する。`dom-mock.ts` に最小 `querySelectorAll`(属性セレクタのみ)を追加(テスト専用・カバレッジ除外)。**型安全な経路 `defineIslands({ Counter })`**(レビュー後のユーザー指摘#1で追加)── 型付きマップを受け取り、束ねた `<Island>`(`name` がマップのキーに制約=タイポはコンパイルエラー、`props` もコンポーネント別に型付く)/ `hydrateIslands`(マップを explicit registry として渡す)を返す。内部は同じ `lookup`/`hydrateIslands` 再利用=ランタイム一本、ファクトリは型のみ。`const` 型引数でリテラルキーを残すのが肝。型テストは islands.spec.ts「checks the name and props at compile time」(`@ts-expect-error`)。**ネストしたアイランドは元ツリーで検出→スキップ + dev 警告**(レビュー🟡#1)。デモは `examples/islands`(`defineIslands` 配線・SSR サーバ + 静的外殻 + 独立カウンター 2 つ)。playwright でクリック→増加を実機確認済み。
- **Phase 7 アイランド単位バンドル分割(今セッション)**: **CLI `buildIslands` + core `hydrateIslandsLazy` 完了**。`packages/cli/src/islands.ts` の `buildIslands({ islands })` が各アイランドを個別エントリ + `splitting:true` でバンドル(共有コードは共有チャンクへ集約)+ **非バンドルの**ブートストラップ `islands.js`(名前→`import("./chunk.js")` を `hydrateIslandsLazy` に渡す素の ESM)を書き出す。実行時、ページに存在するアイランドのチャンクだけ取得。`core/src/islands.ts` に `hydrateIslandsLazy(loaders, {root?})`(`collectIslands` を `hydrateIslands` と共有、loader 欠落は dev 警告+スキップ、ロード後に dispose 済みなら mount しない)。`normalizeBase` は `packages/cli/src/paths.ts` に抽出して generate と共有。デモは `examples/islands/{counter,clock}.tsx`(default export)+ `serve-split.ts`(build→SSR→配信)。playwright で「Counter/Clock のチャンクだけ読まれる + 増加/時刻更新」を実機確認済み。**残る Phase 7**: 作成支援ツール(`kanabun lint`・dev オーバーレイ)。
- **品質**: **383 テスト / 0 fail、全ソース 100% カバレッジ、`tsc` クリーン**。依存ゼロ(dev は `@types/bun` のみ)、`packages/{core,router}` はランタイム非依存を維持。
- **成果物**: `@kanabun/core`、`@kanabun/cli`(`create`/`dev`/`build`/**`generate`**)、**`@kanabun/router`**、`examples/{counter,todomvc,router,primitives,islands,ssr,ssg}`、VRT(スクショ回帰)ゲート、バイリンガル docs。

## 2. 必須ワークフロー(CLAUDE.md より)

- **完了報告の直前に必ず `skeptical-reviewer` サブエージェントを実行**し、🔴 は全て直す。フェーズ/意味のある区切りごとに回す。
- 検証コマンド(作業完了前に全部通す):
  ```sh
  bun test
  bun test --coverage          # 閾値 0.9(bunfig.toml)。core/cli とも実質 100%
  bunx tsc --noEmit
  bun build ./examples/counter/main.tsx --target browser --outfile /tmp/out.js
  bun build ./examples/todomvc/main.tsx --target browser --outfile /tmp/out.js
  ```
- 規約: **依存追加禁止**(`@types/bun` 例外)、`packages/core` に Bun/Node API を入れない、テストは `*.spec.ts`、signals は明示 getter(`count()`/`.set`)、ドキュメントは EN/JA 同期。

## 3. 次にやるなら(roadmap.md 参照)

Phase 6 のルーター・**ネストルーティング**・**相対 `<Link>` href**・エラーバウンダリ・開発時警告・`on*` イベント + **要素ごとの属性**型付け・**`splitProps` タプル型**・SSR + ハイドレーション・**非同期(`resource`/`<Suspense>`)**・**SSG(`kanabun generate`)**・**CSS HMR** は **完了**。残るは(いずれも任意):
  - **状態保持 HMR** ── コンパイラ無しでは到達不可(非CSS編集は全リロードのまま)。
  - **Phase 7** ── **エコシステムプリミティブ(`lazy`・`<Portal>`・`<Dynamic>`・`<Head>`/`<Title>`)+ アイランドのコア(`<Island>`・`registerIsland`・`hydrateIslands`)は完了**(上記 §1、設計は `decisions.md`「Ecosystem primitives (Phase 7)」「Islands / partial hydration」)。**残り**: アイランド単位のバンドル分割(CLI ── ページに含まれるアイランドのチャンクだけを読む code-split + クライアントブートストラップ)/ 作成支援ツール ── **自前 linter(`kanabun lint`)** / **dev オーバーレイ**(`setWarnHandler` の消費側)。設計メモは `decisions.md`(アイランド)/ `dx.md`(linter、下記)。これらはコード未着手。
  - **Phase 8** ── 重量級エコシステム(Phase 7 から先送り)。**SSR ストリーミング(`renderToStream`)**(eager 同期とは別の非同期描画経路 + チャンク縫合クライアントが要る)/ **リアクティブ store(`createStore`)**(プロキシベースのネスト store・パス単位細粒度更新)/ **`@kanabun/testing`**(リポジトリ内 DOM モック上の単体テスト補助、別パッケージ)。いずれも大物。
  - **npm 公開**(`@kanabun/core`・`@kanabun/cli`)+ **バージョニング/リリース戦略** ── 未公開のため `create` は `^0.0.0` プレースホルダ。
  - **SSG 動的パラメータ**(`getStaticPaths` + ビルド時データ焼き込み)── Phase 6(SSG)の follow-up(`roadmap.md:76` / `decisions.md`)。
  - 軽微: dev サーバの `realpath` 二重 stat / `parseArgs` の `--a --b` 挙動 / router の VRT ベースライン commit(note のみ)。

**自前 linter(`kanabun lint`)** は方針合意済み・**設計のみ記録**(未実装)。ESLint は外部依存ゆえ不可 → CLI/Bun レイヤーで自前実装し、オンデマンドの TypeScript パーサ(Bun の auto-install で `import("typescript")`)を再利用する。具体設計(コマンド形・パーサ・目玉ルール `reactive-call-in-jsx` のセマンティック/シンタクティック 2 案・後続ルール・テスト方針・**先に確認すべき実現性**=マニフェスト記載なしで auto-install import が解決するか)は `docs/dx.md`(+`.ja.md`)§4「Design sketch」に記載。

参考(完了済み): ルーターは `packages/router/src/`(`location.ts` = `parsePath`/`matchPath`、`source.ts` = `RouterSource`/browser+memory、`router.ts` = コンポーネント+フック)。設計判断は `decisions.md` の「Router (Phase 6)」。`context` は `packages/core/src/context.ts`、scoped CSS は `packages/core/src/css.ts`。

## 4. 今セッションで踏んだ落とし穴(再発防止メモ)

- **`Bun.build` は未解決エントリ/import で例外(`AggregateError`)を投げる**。`{success:false}` を返さない。`packages/cli/src/errors.ts` の `errorMessages()` で `.errors` を展開して診断を拾っている。`build()` は never-throw 契約。
- **dev サーバーのパストラバーサルは lexical チェックだけでは不十分**。`%2e%2e` 系に加え、**root 内の symlink が root 外を指すケース**があるため、`realpath` で実体解決して封じ込めている(`packages/cli/src/dev.ts`)。回帰させないこと(該当テストあり)。
- **JSX 自動ランタイム**: tsconfig の `paths` で `@kanabun/core`(と `/jsx-runtime`,`/jsx-dev-runtime`)を `packages/core/src` にマップ。`examples/` は workspace glob 外なのでこの paths がないと解決できない。`jsxImportSource: "@kanabun/core"`。
- **反応式の規約**: 関数=リアクティブ(`{count}`/`{() => …}`)、`{count()}`=一度読むだけ、`on*`=イベント。`<Show>` の子は「素の要素=非表示でも生存 / 関数の子=非表示で破棄・再生成」。この eager-children の性質が `context` 判断の根っこ。
- **`onMount`** は `queueMicrotask`(標準グローバル、ランタイム非依存OK)で「同期描画の後」に1回。owner を捕捉して `onCleanup` を効かせ、破棄済みならスキップ。
- **`context` の遅延 thunk 罠**: Provider の関数子が **DOM を直接返す**場合は `insert`→`effect` が provider owner 配下で同期生成され context が効くが、子が **`<For>`/`<Show>` のような thunk を返す**と、その thunk は外側の `insert` の effect(= provider スコープ外)で後から走るため、何もしないと値が見えずデフォルトに落ちる。対策として Provider は「返り値が関数なら、呼ばれるたびに provider owner へ再突入(所有のみ・トラッキングは触らない)」するようラップしている。あわせて `createRoot` が親 owner を記録(`owner.owner = prevOwner`)するので `<For>` 行から上の Provider を辿れる。回帰テスト: `context.spec.ts` の「<For> rows resolve a Provider above the list」。
- **テストの配置**: `*.spec.ts` は対象ソースと同じ階層に置く(例: `dom.spec.ts` は `packages/core/src/dom.ts` の隣)。専用の `test/` ディレクトリは廃止。
- **カバレッジ**: `*.spec.ts` 自体は `coverageSkipTestFiles` で除外。`bunfig.toml` の `coveragePathIgnorePatterns` で `**/dom-mock.ts`(共有 DOM モック)と `**/examples/**` を除外。`build.ts` で `.map(String)` を使うのは、空配列時にユーザー関数が未実行=未カバレッジになるのを避けるため。
- **`create` で生成したアプリは未公開のため `bun install` が通らない**(`@kanabun/core` `^0.0.0` プレースホルダ)。クイックスタートはリポジトリから実行する前提。npm 公開は TODO。
- レビューサブエージェントは**セッション制限で中断することがある**。その場合は手動レビューで代替し、制限解除後に再実行した(透明性のため報告に明記する運用)。
- **ルーターの `useParams`/`useLocation` は「関数の子」配下が前提**。`<Route>` の `component`/関数の子には params accessor を直接渡すので問題ないが、`useParams()` を読む子孫コンポーネントは **関数の子**(遅延)経由で構築しないと、即時の子は context のデフォルト(空オブジェクト)しか見えない ── core の context と同じ eager-children 制約。テストで固定済み(`router.spec.ts`「descendants read the matched params」は `() => jsx(Profile,{})`)。
- **ルーターのテストは `window` 不要**。`createMemorySource` を `<Router source={…}>` に注入し、`src.go(path)` で popstate(back/forward)をシミュレートする。ブラウザソースは `WindowLike` を構造的に受けるので、`pushState` で内部 URL を更新する fake window を渡せば検証できる。デフォルト(`window` 解決)経路のカバーは `globalThis.window` に fake を置いてから source なしで `<Router>` を描画。
- **`examples/router` はメモリソース採用**。`file://`/CI でもアドレスバーに触れず動くようにするため。実アプリでは既定の browser source に差し替える。見た目確認は `snapshot` スキル(Link クリックで遷移後のスクショも撮る)。**コミット済み VRT ベースラインは未追加**(`tests/visual/` は counter/todomvc のみ。router を足すなら pinned Playwright コンテナでベースライン生成が必要 ── follow-up)。
- **ルーターの破棄は「使い捨てスロット」(`disposableSlot`)で明示管理**。context ラップが影響して、ルートのサブツリーは安定した Router owner の下で走るため、insert effect の `disposeOwned` だけでは切替時に前ルートが破棄されずリークする。`<Route>`/`<Routes>` は内容を専用 `createRoot` で所有し、切替/アンマウントで前を dispose する(`<For>`/`mapArray` と同じ明示破棄)。回帰テスト: router.spec.ts「disposes the previous route's scope on switch」「standalone <Route> disposes ... when it stops matching」「disposing the render tears down the active route content」。
- **`<Routes>` の排他は `<Route>` が返す thunk のプロパティ(`$matched`/`$content`)で実現**。即時 JSX 評価でも、関数にメタを載せて単独描画と排他選択を両立(Solid の `<Switch>`/`<Match>` 相当、名前は React Router 流 `<Routes fallback>`)。`<Routes>` 配下では各 `<Route>` 自身の `fallback` は無視される。
- **ネストルーティングの落とし穴: ネストした `<Routes>` は必ずホスト要素の内側に置く**。`<Routes>`/`<Route>` は thunk(関数)を返すが、レイアウトがそれを**素のまま return** すると、親ルートの insert effect の `reconcile`→`normalize`(`dom.ts`)が関数を **一度だけ eager に呼ぶ**ため、ネスト側の `$matched` 読みが**親のトラッキングに混入**し、内側遷移ごとに親レイアウトが再構築される(`disposableSlot` の `createRoot` は untrack だが、戻り値の関数は slot を抜けた親 effect 側で平坦化されるのでそこが効かない)。`<div>` 等の要素で包めば、その要素の `insert` が専用 effect を張るので解決。フラット例も既に `<Routes>` を `<div class={shell}>` 内に置いており同じ規約。回帰テスト: router.spec.ts「switching a nested route disposes the previous child, keeps the layout」(レイアウトの onCleanup が内側遷移で呼ばれないことを確認)。

- **SSR の落とし穴(今セッション)**:
  - **module-level `css\`…\`` はサーバ import 時に document が無い** → `inject` が throw せず `pending` に退避、`renderToString` 冒頭の `flushStyles()` で設置済み document の `<head>` に再生する。`pending` はクリアしない(描画ごとに再注入、head 走査で重複排除)。回帰: `server.spec.ts`「import-time styles」。
  - **真のノード引き取りハイドレーションは eager bottom-up JSX では不可能**。`jsx("div",{children:[jsx("span")]})` は内側の `createElement` を先に評価するので、子はサーバツリーのどこに属すか判る前に作られる。上から辿るカーソル=マーカー/コンパイラが要る → 「コンパイラなし」制約で除外。よって `hydrate` は mount-over(クリア→描画)。`decisions.md`「SSR, hydration & SSG」に明記。
  - **空関数本体はカバレッジで「未実行関数」になる**。`addEventListener(){}` のような空ボディや **暗黙コンストラクタ**(`class Style` にコンストラクタを書かない等)は、内部に実行可能文が無いため bun のカバレッジが「関数ヒット」を付けられず、行 100% でも Funcs が下がる。明示コンストラクタ/文を1つ置けば解消(`server-dom.ts` の `Style` は明示コンストラクタにしてある)。
  - **`renderToString` は `globalThis.document` を save/restore** する。テストは実 document を入れず、サーバを模す(`server.spec.ts` の `afterEach` で削除)。

- **非同期(`resource`/`<Suspense>`)の落とし穴(今セッション)**:
  - **`<Suspense>` の子は必ず一度だけ生成して生かしておく**(ErrorBoundary と同型)。`pending===0` で初めて子を遅延生成する素朴版は、隠す→resource 破棄→decrement→再表示→resource 再生成…で無限ループする。専用 `createRoot` + `SuspenseContext` の下で一度だけ生成し、`pending()` で fallback/子を選ぶだけにする。
  - **子は関数(`{() => …}`)で包む**。素の eager な子は `<Suspense>` 実行前に作られ、resource が `SuspenseContext` を見つけられず境界に登録されない(`<Show>`/context と同じ eager-children 制約)。
  - **レース安全は `version` カウンタで**。load ごとに `++version` を捕捉し、resolve/reject 時に `v !== version` なら破棄。`source` 変化・`mutate`・dispose・unready は全て `version++` で進行中をキャンセル。テスト: async.spec.ts「ignores a stale resolution/rejection」。
  - **fetcher は `Promise.resolve().then(() => fetcher(…))` で 1 microtask 遅延**。同期 throw も rejection 化でき、解決前に `loading` が true に観測される。テストは `deferred()` + `setTimeout(0)` の `tick()` で microtask を排出して検証。
  - **初回ロードのみサスペンド**(`resolvedOnce`)。refetch は `loading` を立てるが境界に再登録せず直前値を残す。エラーは `error()` で公開し ErrorBoundary には自動転送しない(理由は `decisions.md`)。

- **SSG / `generate` の落とし穴(今セッション)**:
  - **`Bun.build` は失敗時 `success:false` を返さず *throw* する**(構文エラーも未解決 import も `AggregateError`。検証済み)。よって `generate` のクライアントバンドルは「成功=書き出し済み」前提でよく、失敗は外側 `catch` → `errorMessages` で拾う(`build()` と同じ)。`if (!built.success)` の早期 return は到達不能なので置かない(置くとカバレッジが落ちる)。
  - **`generate.spec.ts` の config フィクスチャは OS tmpdir に書く**。`build.spec` の不正ファイルはバンドルされるだけ(ランタイムに import されない)なのでカバレッジに出ないが、`generate` は config を `await import` で **ランタイムに読み込む** ため、リポジトリ内に置くとカバレッジ対象になってしまう。文字列を返すだけの config(`@kanabun/core` 非 import)は tmpdir で OK。E2E は実物の `examples/ssg` を使う。
  - **クライアントバンドル失敗テスト(`render` 未呼び)は funcs カバレッジを落とす**。tmpdir でも `await import` 済みなので、未呼びの `render` アロー分 funcs<100% になる。`bunfig.toml` の `coveragePathIgnorePatterns` に `**/kanabun-generate-fix-*/**` を追加して除外(examples/dom-mock と同じ「テスト専用＝製品コードでない」扱い)。
  - **例 `examples/ssg/app.tsx` の `css` はコンポーネント関数の中で呼ぶ**(モジュールトップレベルにしない)。トップレベルだと import 時に `pending` へ退避され、共有テストプロセスの後続 `renderToString`(`server.spec.ts`)が `flushStyles` で巻き込んで head 期待が崩れる。関数内で呼べば render/hydrate 中に実 document へ直接注入され、プロセス汚染が無い。
  - **`@kanabun/cli` を tsconfig `paths` に追加**(例の `ssg.tsx` が型 `SSGConfig` を import するため)。型のみ(`verbatimModuleSyntax`+`isolatedModules` で完全消去)なので Bun/Node API がブラウザ束に混ざることはない。
  - **`client` は config ファイルからの相対で解決**(`resolve(dirname(entryPath), config.client)`)。cwd 相対だと壊れやすいため。
  - **SSG の VRT(今セッション)** ── `tests/visual/ssg.visual.cjs`(2 ルート `/`・`/about/` を PC/モバイルで撮影)+ `examples/ssg/serve.ts`(`generate` で temp dir に静的ビルドして配信するハーネス。パストラバーサルは `join`+`relative`/`isAbsolute` の封じ込めで防ぐ ── CI ハーネスでもあるため)。`playwright.config.cjs` の webServer に `bun examples/ssg/serve.ts`(PORT 3103)を追加。
  - **⚠️ ベースライン画像は未コミット。このまま PR を開くと既存の緑だった `visual` ゲートが赤になる**(初回ブートストラップとは別物 ── `__screenshots__/` には既に counter/todomvc/ssr のベースラインがあり、`ci.yml` の `visual` ジョブは `pull_request` で無条件に `npx playwright test`(update なし)を実行するため、新 spec の `ssg-*.png` 欠如で missing-snapshot エラーになり既存 3 例の判定も巻き込む)。この環境は Ubuntu Noble 24.04 で CI の pinned コンテナ(`mcr.microsoft.com/playwright:v1.56.1-jammy` = 22.04)とフォント/AA が異なり、ローカル生成ベースラインをコミットすると逆に誤差分になる(README の規約)。Noble 上で `--update-snapshots` → 比較は 4/4 green を確認済み(検証のみ・破棄)。**前提手順(SSR と同一)**: spec コミット後、**このブランチで**「Update visual baselines」ワークフロー(jammy, visual-baselines.yml ── 全 `*.visual.cjs` を自動収集するのでワークフロー変更は不要)を実行して jammy ベースラインを生成・コミットしてから PR/マージする。SSR の前例: spec コミット `78e117f` の直後に `86f1a7a chore(visual): update VRT baselines`。
  - **`base`(config か `--base` フラグ。フラグが優先)でサブパス配信に対応**。`normalizeBase` で先頭・末尾スラッシュ1個に正規化(`/` ⇒ `/`、`repo` ⇒ `/repo/`)し、クライアント `<script>` の src に前置(`/repo/main.js`)。`DocumentContext.base` にも公開しカスタム `document` が使える。GitHub Pages の `/repo/` 配信向け。アプリ内リンクの base 相対化はアプリ/将来の router 相対 `<Link>` の責務。回帰テスト: generate.spec.ts「prefixes the client script src with a normalized --base」「exposes the normalized base to a custom document」、cli.spec.ts の generate ケース(`--base /app/`)。
  - **同一ファイルに落ちるルートは一度だけ描画**(`/` と `/`、`/a` と `/a/` 等)。`written` Set で重複排除し、`pages` が実書き出し数と一致するようにした(skeptical-reviewer の 🟡 指摘)。`..` を含むルートは outdir 外に出るので `relative`+`isAbsolute` で弾いて failure(信頼境界ではなくガードレール。routes はビルド時 config 由来)。回帰テスト: generate.spec.ts「renders routes mapping to the same file once」「refuses a route that escapes the output directory」。

- **相対 `<Link>` / `resolvePath` の落とし穴(今セッション)**:
  - **解決は「URL 規約」= 現在地の最終セグメントは "ファイル" 扱い**。`/users/1` 上で `href="2"` → `/users/2`(兄弟。`1` を置換)、`href="../2"` → `/2`(`/users/` から1つ上って `2`)。テストで `2`/`../2` を取り違えると期待値がズレる(実際に踏んだ)。末尾スラッシュありの base(`/users/1/`)なら `href="x"` → `/users/1/x`。
  - **外部 href は `<a>` 表示でも `resolvePath` に通さない**。`new URL("https://x.com/p", base).pathname` は `/p` になり origin が剥がれるため。`Link` は `isExternal(props.href)` で分岐し外部はそのまま、内部のみ `() => resolvePath(...)` でリアクティブに。クリック側は `handleClick` が外部を素通りさせるので二重解決は無い。
  - **`navigate` での解決は `location()`(= `parsePath(path())`).pathname に対して**。絶対パスは `resolvePath` で素通り(`new URL("/x", base)` → `/x`)なので既存テスト(`nav("/x")` 等)は無変更。**外部/スキーム target は `isExternal(to)` で素通し**(`Link` と対称。resolvePath に通すと origin が剥がれるため。skeptical-reviewer 🟡#1)。回帰: router.spec.ts「useNavigate leaves an external/scheme target verbatim」。
  - **`resolvePath` は公開 API だが `to` は信頼入力前提・`from` は pathname 前提**(docコメントに明記)。URL 標準そのままなので空文字 `to`=現在地維持、エンコード `..`(`%2e%2e`)も登る、スキーム付きは絶対 URL 解決で origin 喪失。境界ケースは location.spec.ts でピン留め(skeptical-reviewer 🟡#2)。
- **`splitProps` タプル型の落とし穴(今セッション)**: 精密タプルには **`const` 型引数が必須**(`const K extends ReadonlyArray<...>`)。無いと `["class"]` が `string[]` に推論されリテラルキーが消える。TS は `bunx tsc`(latest)なので `const` 型引数(TS 5.0+)は使える。実装は不変・`as unknown as SplitProps<T,K>` でキャスト。
- **JSX 属性型の落とし穴(今セッション)**: `HTMLAttributes` に `[attr: string]: any` を **残したまま** typed な名前付きプロパティを足すのが肝。TS は「宣言済みメンバはその型で検査、それ以外だけ index に落ちる」ので、`class={5}` はエラーにしつつ `data-*`/未知属性は緩いまま(既存の `on*` と同じ前例)。属性は必ず `Attr<T>`(`T | null | undefined | (() => …)`)= リアクティブ規約を型でも許す。`ref` の `(el)=>代入式` は戻り値があっても `(el: Element) => void` に代入可(void 戻りの特例)。`IntrinsicElements` の `[name]: HTMLAttributes` フォールバックで未掲載要素も無破壊。

- **Phase 7 プリミティブの落とし穴(今セッション)**:
  - **`<Head>`/`<Title>` は `renderToString` の head 読み取り順に依存**。両者は owner の cleanup で head ノードを除去する(クライアント遷移でページ固有タグを漏らさないため)が、`renderToString` は描画末尾でルートを dispose する。そのため `<head>` のシリアライズを **`dispose()` 前**(createRoot の try 内)に移した。css ヘルパはスタイルを除去しない(`css.ts` に onCleanup 無し)ので、この順序変更は css にとって no-op = 既存 SSR 出力は不変。回帰: head.spec.ts「is serialized into the head during SSR」、既存の server.spec.ts も緑。
  - **`<Dynamic>` の `component` は「関数=リアクティブ」規約で型ごと固定**。`string | (() => タグ|コンポーネント)`。コンポーネント自体も関数なので、静的コンポーネントもアクセサ経由(`component={() => MyComp}`)で渡す = コンパイラ無しで「アクセサ」と「コンポーネント直渡し」の曖昧さを潰す。型で直渡しを禁止しているのが肝(spec 参照)。
  - **`<Portal>`/`<Head>` の既定マウント先のため `ServerDocument`/`MockDocument` に `body` を追加**。Portal の内容はサーバではシリアライズされない(`renderToString` は mount サブツリー + head のみ返す)= **portal はクライアントの関心事**。`body` は「サーバ描画時に既定マウント先が無くて落ちる」のを防ぐだけ。回帰: portal.spec.ts「renders under renderToString without throwing」。
  - **`lazy()` は `resource` の上に薄く乗るだけ**(第二の仕組み無し)。モジュール promise を `cached ??= loader()` で一度だけ生成 → 全インスタンス・再マウントで再 import しない。reject も同じ promise に残るので後続マウントは同じエラーを再提示(`resource` と同型、`<ErrorBoundary>` 自動転送なし)。`<Suspense>` の下に **関数の子** で描く規約は全 resource 共通。戻り型は `T`(ラップ元の props 契約)= props 無しコンポーネントも `<LazyPanel/>` で型エラー無し。
  - **`examples/primitives` は VRT 未追加**(`tests/visual/` に spec を足していない)。見た目は snapshot スキルで PC/モバイル/モーダル展開を確認(検証のみ)。VRT を足すなら jammy ベースライン生成ワークフローが要る(SSR/SSG の前例と同じ)。

- **アイランドの落とし穴(今セッション)**:
  - **レジストリ駆動を両側に採用**(子で受け取らない)。設計メモの素朴版は `<Island>...children...>` で子をそのまま描くが、それだと name と子コンポーネントと props を 3 重に書いて同期させる羽目になる。`registerIsland(name, Component)` に一元化し、サーバは name で引いて描画・クライアントは同じ name でハイドレート・props は属性へ一度だけ。**登録モジュール(`examples/islands/islands.tsx`)を server と client の両エントリから副作用 import** しないと name が解決できない(共有チャネルはモジュールスコープのみ。所有権ツリーは境界で切れる)。
  - **`data-props` は属性なので `serialize` が `"` を `&quot;` にエスケープ**。ブラウザは HTML パース時に復号するので `getAttribute("data-props")` は元の JSON 文字列に戻り `JSON.parse` で通る。モック(`render` 経由)はエスケープせず生 JSON を格納するので、どちらの経路でも `JSON.parse` 一発で読める。
  - **`hydrateIslands` は `hydrate` をコンテナ(=`[data-island]` div)毎に呼ぶ**。`hydrate` は中身をクリアして再描画するので、サーバ HTML と同一バイトを再生成=フラッシュ無し。div 自体は残り中身だけ差し替わる。アイランドは**フラット**前提(登録コンポーネントが自身で `<Island>` を出さない)── ネストすると外側の再描画で内側のサーバ markup を壊す。
  - **`dom-mock.ts` に最小 `querySelectorAll` を追加**(属性プレゼンスセレクタ `[name]` のみ対応。それ以外は throw)。テスト専用・カバレッジ除外(`coveragePathIgnorePatterns` の `**/dom-mock.ts`)。`hydrateIslands` の既定 root(`doc()`)分岐をカバーするため `MockDocument` にも(head+body を走査する)版を足した。
  - **`examples/islands` は SSR サーバ型**(`examples/ssr` と同型)で HTML エントリではない。見た目とハイドレーションは server を起動して playwright で実機確認(クリック→増加 0→1・100→102 を確認、検証のみ)。VRT は未追加。

- **アイランド単位バンドル分割の落とし穴(今セッション)**:
  - **⚠️ `bun test` 内の `Bun.build` は動的 import のバンドルを拒否する**(「Bundle failed」)。静的 import / 複数エントリ + `splitting:true` は通る(`generate` の単一エントリビルドが緑なのはこのため)。当初は「生成したブートストラップが島を動的 import → それを `Bun.build`」案だったが、これが `bun test` で必ず失敗し成功パスを単体テストできない。**対策=設計変更**: 各島を複数エントリ + splitting で静的にバンドルし、ブートストラップ(`islands.js`)は**バンドルせず**素の ESM として書き出す(ブラウザが import を解決)。これで唯一のバンドラ作業が静的ビルドになり、`buildIslands` は 100% カバー可能(成功/失敗/ガード全分岐)。実運用(`bun run`)では動的 import も問題なく動く ── 制約は `bun test` ランタイム限定。
  - **エントリチャンク名 = ソースの basename**(`naming.entry: "[name].js"`)。ブートストラップは `./counter.js` 等を安定参照する。**basename 衝突**(別ディレクトリの同名ファイル)は出力が上書きされるので、ビルド前に純粋な文字列チェックで弾く(`distinct file names`)。回帰: islands.spec.ts「fails when two island entries share a file basename」(2 つ目のパスは存在不要 ── チェックはビルド前)。
  - **生成する runtime エントリ(`kanabun-islands-runtime.ts`)が `@kanabun/core` を再 export**。これを第一エントリのディレクトリ内の一時ディレクトリ(`.kanabun-islands-<uuid>/`)に書くのは、`@kanabun/core` が島と同じ node_modules から解決されるため。ビルド後に temp ディレクトリごと削除(`finally`)。
  - **`hydrateIslandsLazy` は core 側**(ランタイム非依存)。loader 欠落は dev 警告+スキップ(`hydrateIslands` の throw と違い本番の白画面を防ぐ)。ロード解決時に dispose 済みなら mount しない(`disposed` フラグ)。テストは `() => Promise.resolve(...)` + `setTimeout(0)` の `tick()` で非同期排出。
  - **`buildIslands` のテストは in-process でフルカバー可能**(成功パスを含む)。`serve-split.ts` の実ブラウザ検証(network タブに `counter.js`/`clock.js` + 共有チャンクだけ出る)は検証のみで VRT 未追加。

## 5. 主要ファイル早見

- `packages/core/src/reactive.ts` — signals・owner ツリー(親リンク)・`signal`/`computed`/`effect`/`batch`/`untrack`・`catchError`(push-pull 3色塗り、glitch-free)。`lifecycle.ts` = `onCleanup`/`createRoot`/`onMount`、`context.ts` = `createContext`/`useContext`(どちらもエンジンの owner-scope ヘルパー上の薄い層)
- `packages/core/src/dom.ts` — `render`・`hydrate`・細粒度バインド・`reconcileNodes`(keyed 差分)
- `packages/core/src/server.ts` — `renderToString`(SSR/SSG、DOM 不要)。`server-dom.ts` — シリアライズ可能なサーバ DOM(エスケープ・void 要素・rawtext 対応)
- `packages/core/src/control-flow.ts` — `<Show>`/`<For>`/`mapArray`
- `packages/core/src/async.ts` — `resource`(値/loading/error signal + version でレース安全)・`<Suspense>`(`SuspenseContext` 増減レジストリ + 子を一度だけ生成)
- `packages/core/src/islands.ts` — アイランド(部分ハイドレーション)。`<Island>`(レジストリから引いて `<div data-island data-props>` に描画)・`registerIsland`(モジュールレベルレジストリ)・`defineIslands`(型付きマップ)・`hydrateIslands`(`[data-island]` 走査 → `JSON.parse` → 解決 → `hydrate`)・`hydrateIslandsLazy`(loader マップで島チャンクを遅延ロード)。`collectIslands` で走査を共有。`renderToString`(サーバ)+ `hydrate`(コンテナ毎)の再利用=第3の描画経路なし。デモは `examples/islands/{counter,clock,islands,app,main,server}.tsx`
- `packages/core/src/{lazy,portal,dynamic,head}.ts` — Phase 7 プリミティブ。`lazy.ts` = `lazy()`(resource + 動的 import、モジュールキャッシュ)、`portal.ts` = `<Portal>`(別ノードへテレポート、コメントマーカー範囲を cleanup で除去)、`dynamic.ts` = `<Dynamic>`(実行時ホスト)、`head.ts` = `<Head>`/`<Title>`(head へ追加、SSR head channel)。デモは `examples/primitives/{main,lazy-panel}.tsx`
- `packages/core/src/{props,css}.ts` — `mergeProps`/`splitProps`・scoped `css`(ハッシュ class + `<style>` 注入)
- `packages/cli/src/{build,dev,create,generate,islands,paths,index,errors}.ts` — CLI(Bun 依存はここだけ)。`generate.ts` = SSG(config → ルートごとに `renderToString` → `.html` 書き出し + 任意 client バンドル)、`islands.ts` = `buildIslands`(島を複数エントリ + splitting でバンドル + 非バンドルブートストラップ)、`paths.ts` = `normalizeBase`(generate と共有)。デモハーネスは `examples/islands/serve-split.ts`
- `examples/ssg/{app,ssg,main}.tsx` — SSG 例(`ssg.tsx` が config、`main.tsx` が hydrate エントリ)
- `packages/router/src/{location,source,router,index}.ts` — ルーター(`parsePath`/`matchPath`・history ソース・`<Router>`/`<Route>`/`<Link>`+フック)。ランタイム非依存(`window` は遅延解決)
- `docs/{decisions,roadmap}.md`(+ `.ja.md`)— 設計判断 / 残作業
