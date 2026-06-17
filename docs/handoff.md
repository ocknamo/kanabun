# 引き継ぎメモ(次セッション向け)

> このファイルは作業の引き継ぎ用メモです(プロダクト文書ではないので日本語のみ)。
> 規約は [`../CLAUDE.md`](../CLAUDE.md)、残作業は [`roadmap.md`](./roadmap.md) が一次情報。
> ここは「いまの状態」と「今セッションで得た知見・落とし穴」に絞ります。
> 最終更新: 2026-06-17 / 最終コミット: SSG コマンド(`kanabun generate`)

## 1. いまどこにいるか

- **ブランチ**: `claude/phase-6-tasks-fb7r41` で開発(`main` 直push しない / PR は指示があるまで作らない)。`main` には PR #1〜#6 経由で scoped CSS・VRT・カバレッジバッジ・context・ルーター・エラーバウンダリまでマージ済み。
- **進捗**: 要求定義の **Phase 0〜5 完了**。**Phase 6 は ルーター(`@kanabun/router`)+ エラーバウンダリ + 開発時警告 + SSR/ハイドレーション + 非同期(`resource`/`<Suspense>`)を実装済み**。
  - ルーター ── history ベース、`<Router>`/`<Routes>`(排他+404 fallback)/`<Route>`/`<Link>` + `useNavigate`/`useLocation`/`useParams`、差し替え可能な history ソース(browser / **hash**(GitHub Pages 向け)/ memory)。
  - **開発時警告(今セッション)** ── `packages/core/src/dev.ts`。オプトイン(`setDev(true)`、`kanabun dev` は `globalThis.__KANABUN_DEV__` で自動 ON)。owner 外の `effect()`/`onMount()`/`onCleanup()` と computed 内のシグナル書き込みを検知。重複排除 + 差し替え可能シンク(`setWarnHandler`)。詳細は `decisions.md`「Dev-time warnings (Phase 6)」。
  - **`on*` イベントハンドラの型付け(今セッション)** ── `JSX.IntrinsicElements` の部分厳密化。`packages/core/src/jsx-runtime.ts` に `EventHandler<E>` と `HTMLAttributes`(typed `on*` + `[attr]: any`)を追加し、`IntrinsicElements` を `[name]: HTMLAttributes` に。`onClick={count.set(…)}`(アロー書き忘れ=`void`)や非関数がコンパイルエラーに。条件付きハンドラ(`undefined`)は許す。型レベルテストは `packages/core/src/jsx-types.spec.ts`(`@ts-expect-error` で自己検証)。**残り**:要素ごとの *属性* 型はまだ緩い。
  - **開発者支援ドキュメント `docs/dx.md`(+ `.ja.md`)を新設** ── 型・実行時警告・テストの 3 層 + 将来の linter 構想を集約。
  - **ネストルーティング(今セッション)** ── `*` ワイルドカードのルートがプレフィックスでマッチする *レイアウト* になり、`matchRoute` が返す余りパス(`rest`)を新しい `RelPathContext` 経由でネストした `<Routes>`/`<Route>` に渡す。`<Outlet>` は無し(ネストした `<Routes>` をレイアウトの本体内・ホスト要素の内側に置く=それ自体が outlet)。params は連鎖でマージ(`useParams()` が `{ org, id }` を読める)。詳細は `decisions.md`「Nested routing (Phase 6)」。落とし穴は §4 に追記。
  - **SSR + ハイドレーション(今セッション)** ── `renderToString`(`packages/core/src/server.ts`)はシリアライズ可能なサーバ DOM(`server-dom.ts`)を `globalThis.document` に一時設置し、eager な JSX ランタイムを実 DOM 無しで走らせて `{ html, head }` を返す。`createRoot` で組んで即 `dispose`(`onMount` は microtask で owner 破棄済み→発火しない)。`hydrate`(`dom.ts`)はサーバマークアップをクリアしてライブツリーをマウント(ノード単位の引き取りはしない=eager bottom-up + コンパイラ無しの帰結。理由は `decisions.md`)。スコープド CSS は import 時(document 無し)に `pending` へ退避し `flushStyles` で再生(`css.ts`)。例は `examples/ssr`(Bun サーバ `server.tsx` + クライアント `main.tsx`)。
  - **非同期 / Suspense(今セッション)** ── `packages/core/src/async.ts`。`resource(fetcher)` / `resource(source, fetcher)` が非同期関数を 3 つの signal(`value`/`loading`/`error`)+ `version` カウンタに変える。`version` で**レース安全**(古い resolve/reject は破棄)。`source` 変化で再取得、未準備(`false`/`null`/`undefined`)はアイドル。fetcher は `Promise.resolve().then(...)` で 1 microtask 遅延 → 同期 throw も rejection 化・`loading` が観測可能に。エラーは `error()` で公開(ErrorBoundary へ自動転送しない=eager bottom-up の制約。理由は `decisions.md`)。`<Suspense fallback>` は `SuspenseContext`(increment/decrement レジストリ)を提供し、子を**境界の下・専用 createRoot で一度だけ**生成して `pending()` で fallback/子を選ぶ(ErrorBoundary と同型。遅延生成は無限ループするので一度だけが要)。初回ロードのみサスペンド(`resolvedOnce`)、refetch は直前値を残す。子は**関数**で包む規約。`{ mutate, refetch }` アクション付き。詳細は `decisions.md`「Async / Suspense (Phase 6)」。落とし穴は §4 に追記。
  - **SSG / `kanabun generate`(今セッション)** ── `packages/cli/src/generate.ts`。SSR/ハイドレーションのプリミティブに乗る薄い CLI prerender ループ(新しい描画経路は無い)。SSG **config**(`{ routes?, render(path), client?, title?, document? }`)を `await import` し、ルートごとに `renderToString(() => render(path))` → HTML ドキュメントで包んで `<outdir>/<route>/index.html`(`/`→`index.html`、`/about/`→`about/index.html`)に書き出す。任意の `client` は config からの相対で解決し `Bun.build` で一度だけバンドル→全ページが `<script>` で参照(ハイドレート)。`build` 同様 never-throw(`Bun.build` は失敗時 `AggregateError` を投げ、`errorMessages` で展開)。CLI は `kanabun generate [entry]`(既定エントリ `ssg.tsx`)。型(`SSGConfig`/`DocumentContext` 等)は `@kanabun/cli` から re-export、tsconfig `paths` に `@kanabun/cli` を追加。例は `examples/ssg`(`app.tsx`/`ssg.tsx`/`main.tsx`、2 ルート + ハイドレートするカウンター)。落とし穴は §4 に追記。
  - 残る Phase 6(状態保持 HMR、相対 `<Link>` href)は未着手。
- **品質**: **295 テスト / 0 fail、全ソース 100% カバレッジ、`tsc` クリーン**。依存ゼロ(dev は `@types/bun` のみ)、`packages/{core,router}` はランタイム非依存を維持。
- **成果物**: `@kanabun/core`、`@kanabun/cli`(`create`/`dev`/`build`/**`generate`**)、**`@kanabun/router`**、`examples/{counter,todomvc,router,ssr,ssg}`、VRT(スクショ回帰)ゲート、バイリンガル docs。

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

Phase 6 のルーター・**ネストルーティング**・エラーバウンダリ・開発時警告・`on*` イベントハンドラ型付け・SSR + ハイドレーション・**非同期(`resource`/`<Suspense>`)** は **完了**。残るは Phase 6 / DX(任意): 状態保持 HMR、相対 `<Link>` href、`JSX.IntrinsicElements` の **属性** 型(イベントは済)、`splitProps` タプル型化、npm 公開。

**自前 linter(`kanabun lint`)** は方針合意済み・**設計のみ記録**(未実装)。ESLint は外部依存ゆえ不可 → CLI/Bun レイヤーで自前実装し、オンデマンドの TypeScript パーサ(Bun の auto-install で `import("typescript")`)を再利用する。具体設計(コマンド形・パーサ・目玉ルール `reactive-call-in-jsx` のセマンティック/シンタクティック 2 案・後続ルール・テスト方針・**先に確認すべき実現性**=マニフェスト記載なしで auto-install import が解決するか)は `docs/dx.md`(+`.ja.md`)§4「Design sketch」に記載。

参考(完了済み): ルーターは `packages/router/src/`(`location.ts` = `parsePath`/`matchPath`、`source.ts` = `RouterSource`/browser+memory、`router.ts` = コンポーネント+フック)。設計判断は `decisions.md` の「Router (Phase 6)」。`context` は `packages/core/src/reactive.ts` 末尾、scoped CSS は `packages/core/src/css.ts`。

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
  - **SSG の VRT(今セッション)** ── `tests/visual/ssg.visual.cjs`(2 ルート `/`・`/about/` を PC/モバイルで撮影)+ `examples/ssg/serve.ts`(`generate` で temp dir に静的ビルドして配信するハーネス)。`playwright.config.cjs` の webServer に `bun examples/ssg/serve.ts`(PORT 3103)を追加。**ベースライン画像は未コミット** ── この環境は Ubuntu Noble 24.04 で CI の pinned コンテナ(`mcr.microsoft.com/playwright:v1.56.1-jammy` = 22.04)とフォント/AA が異なり、ローカル生成だと誤差分になる(README の規約)。Noble 上で `--update-snapshots` → 比較は 4/4 green を確認済み(検証のみ・破棄)。**正規のベースラインは「Update visual baselines」ワークフロー(jammy)で生成・コミットする**(visual-baselines.yml は全 `*.visual.cjs` を自動収集するのでワークフロー変更は不要)。それまで visual ゲートは ssg のスナップ未存在で赤になる(README のブートストラップ手順どおり、想定内)。
  - **`base`(config か `--base` フラグ。フラグが優先)でサブパス配信に対応**。`normalizeBase` で先頭・末尾スラッシュ1個に正規化(`/` ⇒ `/`、`repo` ⇒ `/repo/`)し、クライアント `<script>` の src に前置(`/repo/main.js`)。`DocumentContext.base` にも公開しカスタム `document` が使える。GitHub Pages の `/repo/` 配信向け。アプリ内リンクの base 相対化はアプリ/将来の router 相対 `<Link>` の責務。回帰テスト: generate.spec.ts「prefixes the client script src with a normalized --base」「exposes the normalized base to a custom document」、cli.spec.ts の generate ケース(`--base /app/`)。
  - **同一ファイルに落ちるルートは一度だけ描画**(`/` と `/`、`/a` と `/a/` 等)。`written` Set で重複排除し、`pages` が実書き出し数と一致するようにした(skeptical-reviewer の 🟡 指摘)。`..` を含むルートは outdir 外に出るので `relative`+`isAbsolute` で弾いて failure(信頼境界ではなくガードレール。routes はビルド時 config 由来)。回帰テスト: generate.spec.ts「renders routes mapping to the same file once」「refuses a route that escapes the output directory」。

## 5. 主要ファイル早見

- `packages/core/src/reactive.ts` — signals・owner ツリー(親リンク)・`onMount`・`createContext`/`useContext`(push-pull 3色塗り、glitch-free)
- `packages/core/src/dom.ts` — `render`・`hydrate`・細粒度バインド・`reconcileNodes`(keyed 差分)
- `packages/core/src/server.ts` — `renderToString`(SSR/SSG、DOM 不要)。`server-dom.ts` — シリアライズ可能なサーバ DOM(エスケープ・void 要素・rawtext 対応)
- `packages/core/src/control-flow.ts` — `<Show>`/`<For>`/`mapArray`
- `packages/core/src/async.ts` — `resource`(値/loading/error signal + version でレース安全)・`<Suspense>`(`SuspenseContext` 増減レジストリ + 子を一度だけ生成)
- `packages/core/src/{props,css}.ts` — `mergeProps`/`splitProps`・scoped `css`(ハッシュ class + `<style>` 注入)
- `packages/cli/src/{build,dev,create,generate,index,errors}.ts` — CLI(Bun 依存はここだけ)。`generate.ts` = SSG(config → ルートごとに `renderToString` → `.html` 書き出し + 任意 client バンドル)
- `examples/ssg/{app,ssg,main}.tsx` — SSG 例(`ssg.tsx` が config、`main.tsx` が hydrate エントリ)
- `packages/router/src/{location,source,router,index}.ts` — ルーター(`parsePath`/`matchPath`・history ソース・`<Router>`/`<Route>`/`<Link>`+フック)。ランタイム非依存(`window` は遅延解決)
- `docs/{decisions,roadmap}.md`(+ `.ja.md`)— 設計判断 / 残作業
