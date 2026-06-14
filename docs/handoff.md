# 引き継ぎメモ(次セッション向け)

> このファイルは作業の引き継ぎ用メモです(プロダクト文書ではないので日本語のみ)。
> 規約は [`../CLAUDE.md`](../CLAUDE.md)、残作業は [`roadmap.md`](./roadmap.md) が一次情報。
> ここは「いまの状態」と「今セッションで得た知見・落とし穴」に絞ります。
> 最終更新: 2026-06-14 / 最終コミット: `e4f00cf`

## 1. いまどこにいるか

- **ブランチ**: `claude/bun-svelte-framework-mpn6g0` で開発(`main` 直push しない / PR は指示があるまで作らない)。すべて push 済み。
- **進捗**: 要求定義の **Phase 0〜5 完了**。Phase 4 は一部(`onMount`/`mergeProps`/`splitProps` 済、`context`・scoped CSS 未)。Phase 6 は未着手。
- **品質**: **118 テスト / 0 fail、全ソース 100% カバレッジ、`tsc` クリーン**。依存ゼロ(dev は `@types/bun` のみ)、`packages/core` はランタイム非依存を維持。
- **成果物**: `@kanabun/core`(signals + JSX/DOM ランタイム + 制御構文 + props/lifecycle)、`@kanabun/cli`(`create`/`dev`/`build`)、`examples/{counter,todomvc}`、バイリンガル docs。

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

最有力は **`context` の設計判断**。ランタイム(コンパイラなし)では JSX の子が即時生成されるため、`<Provider>` が子の読み取りより先に値を設定できない。ランタイムのみの答えは**関数の子**(`<Ctx.Provider value={v}>{() => <App/>}</Ctx.Provider>`、`<Show>` と同じ「関数は遅延」規約)。A=関数の子で実装 / B=コンパイラ導入(これまで却下)/ C=先送り、の3択。ユーザーは A/B/C 形式の論点提示を好む(過去の `$state` 判断と同様)。

その他: scoped CSS、ルーター(別パッケージ)、SSR、状態保持 HMR、`JSX.IntrinsicElements` 厳密化、`splitProps` タプル型化、npm 公開。

## 4. 今セッションで踏んだ落とし穴(再発防止メモ)

- **`Bun.build` は未解決エントリ/import で例外(`AggregateError`)を投げる**。`{success:false}` を返さない。`packages/cli/src/errors.ts` の `errorMessages()` で `.errors` を展開して診断を拾っている。`build()` は never-throw 契約。
- **dev サーバーのパストラバーサルは lexical チェックだけでは不十分**。`%2e%2e` 系に加え、**root 内の symlink が root 外を指すケース**があるため、`realpath` で実体解決して封じ込めている(`packages/cli/src/dev.ts`)。回帰させないこと(該当テストあり)。
- **JSX 自動ランタイム**: tsconfig の `paths` で `@kanabun/core`(と `/jsx-runtime`,`/jsx-dev-runtime`)を `packages/core/src` にマップ。`examples/` は workspace glob 外なのでこの paths がないと解決できない。`jsxImportSource: "@kanabun/core"`。
- **反応式の規約**: 関数=リアクティブ(`{count}`/`{() => …}`)、`{count()}`=一度読むだけ、`on*`=イベント。`<Show>` の子は「素の要素=非表示でも生存 / 関数の子=非表示で破棄・再生成」。この eager-children の性質が `context` 判断の根っこ。
- **`onMount`** は `queueMicrotask`(標準グローバル、ランタイム非依存OK)で「同期描画の後」に1回。owner を捕捉して `onCleanup` を効かせ、破棄済みならスキップ。
- **カバレッジ**: `bunfig.toml` の `coveragePathIgnorePatterns` で `**/test/**`(DOMモック等のヘルパー)と `**/examples/**` を除外。`build.ts` で `.map(String)` を使うのは、空配列時にユーザー関数が未実行=未カバレッジになるのを避けるため。
- **`create` で生成したアプリは未公開のため `bun install` が通らない**(`@kanabun/core` `^0.0.0` プレースホルダ)。クイックスタートはリポジトリから実行する前提。npm 公開は TODO。
- レビューサブエージェントは**セッション制限で中断することがある**。その場合は手動レビューで代替し、制限解除後に再実行した(透明性のため報告に明記する運用)。

## 5. 主要ファイル早見

- `packages/core/src/reactive.ts` — signals・owner ツリー・`onMount`(push-pull 3色塗り、glitch-free)
- `packages/core/src/dom.ts` — `render`・細粒度バインド・`reconcileNodes`(keyed 差分)
- `packages/core/src/control-flow.ts` — `<Show>`/`<For>`/`mapArray`
- `packages/cli/src/{build,dev,create,index,errors}.ts` — CLI(Bun 依存はここだけ)
- `docs/{decisions,roadmap}.md`(+ `.ja.md`)— 設計判断 / 残作業
