# 引き継ぎメモ(次セッション向け)

> このファイルは作業の引き継ぎ用メモです(プロダクト文書ではないので日本語のみ)。
> 規約は [`../CLAUDE.md`](../CLAUDE.md)、残作業は [`roadmap.md`](./roadmap.md) が一次情報。
> ここは「いまの状態」と「今セッションで得た知見・落とし穴」に絞ります。
> 最終更新: 2026-06-15 / 最終コミット: 開発時警告(dev-time warnings)

## 1. いまどこにいるか

- **ブランチ**: `claude/phase-6-2tvf6l` で開発(`main` 直push しない / PR は指示があるまで作らない)。`main` には PR #1〜#6 経由で scoped CSS・VRT・カバレッジバッジ・context・ルーター・エラーバウンダリまでマージ済み。
- **進捗**: 要求定義の **Phase 0〜5 完了**。**Phase 6 は ルーター(`@kanabun/router`)+ エラーバウンダリ + 開発時警告 を実装済み**。
  - ルーター ── history ベース、`<Router>`/`<Routes>`(排他+404 fallback)/`<Route>`/`<Link>` + `useNavigate`/`useLocation`/`useParams`、差し替え可能な history ソース(browser / **hash**(GitHub Pages 向け)/ memory)。
  - **開発時警告(今セッション)** ── `packages/core/src/dev.ts`。オプトイン(`setDev(true)`、`kanabun dev` は `globalThis.__KANABUN_DEV__` で自動 ON)。owner 外の `effect()`/`onMount()`/`onCleanup()` と computed 内のシグナル書き込みを検知。重複排除 + 差し替え可能シンク(`setWarnHandler`)。詳細は `decisions.md`「Dev-time warnings (Phase 6)」。
  - 残る Phase 6(SSR/ハイドレーション、状態保持 HMR、Async/Suspense(`resource`)、ネストルーティング)は未着手。
- **品質**: **225 テスト / 0 fail、全ソース 100% カバレッジ、`tsc` クリーン**。依存ゼロ(dev は `@types/bun` のみ)、`packages/{core,router}` はランタイム非依存を維持。
- **成果物**: `@kanabun/core`、`@kanabun/cli`(`create`/`dev`/`build`)、**`@kanabun/router`**、`examples/{counter,todomvc,router}`、VRT(スクショ回帰)ゲート、バイリンガル docs。

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

Phase 6 のルーターは **完了**。残るは Phase 6 / DX(任意): SSR + ハイドレーション、状態保持 HMR、エラーバウンダリ、Async/Suspense(`resource`)、開発時警告、`JSX.IntrinsicElements` 厳密化、`splitProps` タプル型化、npm 公開。

参考(完了済み): ルーターは `packages/router/src/`(`location.ts` = `parsePath`/`matchPath`、`source.ts` = `RouterSource`/browser+memory、`router.ts` = コンポーネント+フック)。設計判断は `decisions.md` の「Router (Phase 6)」。`context` は `packages/core/src/reactive.ts` 末尾、scoped CSS は `packages/core/src/css.ts`。

## 4. 今セッションで踏んだ落とし穴(再発防止メモ)

- **`Bun.build` は未解決エントリ/import で例外(`AggregateError`)を投げる**。`{success:false}` を返さない。`packages/cli/src/errors.ts` の `errorMessages()` で `.errors` を展開して診断を拾っている。`build()` は never-throw 契約。
- **dev サーバーのパストラバーサルは lexical チェックだけでは不十分**。`%2e%2e` 系に加え、**root 内の symlink が root 外を指すケース**があるため、`realpath` で実体解決して封じ込めている(`packages/cli/src/dev.ts`)。回帰させないこと(該当テストあり)。
- **JSX 自動ランタイム**: tsconfig の `paths` で `@kanabun/core`(と `/jsx-runtime`,`/jsx-dev-runtime`)を `packages/core/src` にマップ。`examples/` は workspace glob 外なのでこの paths がないと解決できない。`jsxImportSource: "@kanabun/core"`。
- **反応式の規約**: 関数=リアクティブ(`{count}`/`{() => …}`)、`{count()}`=一度読むだけ、`on*`=イベント。`<Show>` の子は「素の要素=非表示でも生存 / 関数の子=非表示で破棄・再生成」。この eager-children の性質が `context` 判断の根っこ。
- **`onMount`** は `queueMicrotask`(標準グローバル、ランタイム非依存OK)で「同期描画の後」に1回。owner を捕捉して `onCleanup` を効かせ、破棄済みならスキップ。
- **`context` の遅延 thunk 罠**: Provider の関数子が **DOM を直接返す**場合は `insert`→`effect` が provider owner 配下で同期生成され context が効くが、子が **`<For>`/`<Show>` のような thunk を返す**と、その thunk は外側の `insert` の effect(= provider スコープ外)で後から走るため、何もしないと値が見えずデフォルトに落ちる。対策として Provider は「返り値が関数なら、呼ばれるたびに provider owner へ再突入(所有のみ・トラッキングは触らない)」するようラップしている。あわせて `createRoot` が親 owner を記録(`owner.owner = prevOwner`)するので `<For>` 行から上の Provider を辿れる。回帰テスト: `context.spec.ts` の「<For> rows resolve a Provider above the list」。
- **カバレッジ**: `bunfig.toml` の `coveragePathIgnorePatterns` で `**/test/**`(DOMモック等のヘルパー)と `**/examples/**` を除外。`build.ts` で `.map(String)` を使うのは、空配列時にユーザー関数が未実行=未カバレッジになるのを避けるため。
- **`create` で生成したアプリは未公開のため `bun install` が通らない**(`@kanabun/core` `^0.0.0` プレースホルダ)。クイックスタートはリポジトリから実行する前提。npm 公開は TODO。
- レビューサブエージェントは**セッション制限で中断することがある**。その場合は手動レビューで代替し、制限解除後に再実行した(透明性のため報告に明記する運用)。
- **ルーターの `useParams`/`useLocation` は「関数の子」配下が前提**。`<Route>` の `component`/関数の子には params accessor を直接渡すので問題ないが、`useParams()` を読む子孫コンポーネントは **関数の子**(遅延)経由で構築しないと、即時の子は context のデフォルト(空オブジェクト)しか見えない ── core の context と同じ eager-children 制約。テストで固定済み(`router.spec.ts`「descendants read the matched params」は `() => jsx(Profile,{})`)。
- **ルーターのテストは `window` 不要**。`createMemorySource` を `<Router source={…}>` に注入し、`src.go(path)` で popstate(back/forward)をシミュレートする。ブラウザソースは `WindowLike` を構造的に受けるので、`pushState` で内部 URL を更新する fake window を渡せば検証できる。デフォルト(`window` 解決)経路のカバーは `globalThis.window` に fake を置いてから source なしで `<Router>` を描画。
- **`examples/router` はメモリソース採用**。`file://`/CI でもアドレスバーに触れず動くようにするため。実アプリでは既定の browser source に差し替える。見た目確認は `snapshot` スキル(Link クリックで遷移後のスクショも撮る)。**コミット済み VRT ベースラインは未追加**(`tests/visual/` は counter/todomvc のみ。router を足すなら pinned Playwright コンテナでベースライン生成が必要 ── follow-up)。
- **ルーターの破棄は「使い捨てスロット」(`disposableSlot`)で明示管理**。context ラップが影響して、ルートのサブツリーは安定した Router owner の下で走るため、insert effect の `disposeOwned` だけでは切替時に前ルートが破棄されずリークする。`<Route>`/`<Routes>` は内容を専用 `createRoot` で所有し、切替/アンマウントで前を dispose する(`<For>`/`mapArray` と同じ明示破棄)。回帰テスト: router.spec.ts「disposes the previous route's scope on switch」「standalone <Route> disposes ... when it stops matching」「disposing the render tears down the active route content」。
- **`<Routes>` の排他は `<Route>` が返す thunk のプロパティ(`$matched`/`$content`)で実現**。即時 JSX 評価でも、関数にメタを載せて単独描画と排他選択を両立(Solid の `<Switch>`/`<Match>` 相当、名前は React Router 流 `<Routes fallback>`)。`<Routes>` 配下では各 `<Route>` 自身の `fallback` は無視される。

## 5. 主要ファイル早見

- `packages/core/src/reactive.ts` — signals・owner ツリー(親リンク)・`onMount`・`createContext`/`useContext`(push-pull 3色塗り、glitch-free)
- `packages/core/src/dom.ts` — `render`・細粒度バインド・`reconcileNodes`(keyed 差分)
- `packages/core/src/control-flow.ts` — `<Show>`/`<For>`/`mapArray`
- `packages/core/src/{props,css}.ts` — `mergeProps`/`splitProps`・scoped `css`(ハッシュ class + `<style>` 注入)
- `packages/cli/src/{build,dev,create,index,errors}.ts` — CLI(Bun 依存はここだけ)
- `packages/router/src/{location,source,router,index}.ts` — ルーター(`parsePath`/`matchPath`・history ソース・`<Router>`/`<Route>`/`<Link>`+フック)。ランタイム非依存(`window` は遅延解決)
- `docs/{decisions,roadmap}.md`(+ `.ja.md`)— 設計判断 / 残作業
