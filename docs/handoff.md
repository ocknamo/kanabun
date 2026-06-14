# 引き継ぎメモ(次セッション向け)

> このファイルは作業の引き継ぎ用メモです(プロダクト文書ではないので日本語のみ)。
> 規約は [`../CLAUDE.md`](../CLAUDE.md)、残作業は [`roadmap.md`](./roadmap.md) が一次情報。
> ここは「いまの状態」と「今セッションで得た知見・落とし穴」に絞ります。
> 最終更新: 2026-06-14 / 最終コミット: `bec0513`(context 実装)

## 1. いまどこにいるか

- **ブランチ**: `claude/phase-4-tasks-docs-kuiulb` で開発(`main` 直push しない / PR は指示があるまで作らない)。`main` には PR #1〜#3 経由で scoped CSS・VRT・カバレッジバッジまでマージ済み。
- **進捗**: 要求定義の **Phase 0〜5 完了**。Phase 4 も **`context`(`createContext`/`useContext`)を実装し完了**(`onMount`/`mergeProps`/`splitProps`/scoped `css`/`context`)。Phase 6 は未着手。
- **品質**: **145 テスト / 0 fail、全ソース 100% カバレッジ、`tsc` クリーン**。依存ゼロ(dev は `@types/bun` のみ)、`packages/core` はランタイム非依存を維持。
- **成果物**: `@kanabun/core`(signals + JSX/DOM ランタイム + 制御構文 + props/lifecycle + scoped `css`)、`@kanabun/cli`(`create`/`dev`/`build`)、`examples/{counter,todomvc}`、VRT(スクショ回帰)ゲート、バイリンガル docs。

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

Phase 4 は **完了**(`context` を実装)。残るは Phase 6 / DX(任意、優先度は低め): ルーター(別パッケージ)、SSR、状態保持 HMR、`JSX.IntrinsicElements` 厳密化、`splitProps` タプル型化、npm 公開。

参考(完了済み): scoped CSS は `packages/core/src/css.ts`(PR #2)。`context` は `packages/core/src/reactive.ts` の末尾 Context セクション(`createContext`/`useContext`/owner ツリーの親リンク)。設計判断は **関数の子**を採用(`decisions.md` の「Context (Phase 4)」参照)。

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

## 5. 主要ファイル早見

- `packages/core/src/reactive.ts` — signals・owner ツリー(親リンク)・`onMount`・`createContext`/`useContext`(push-pull 3色塗り、glitch-free)
- `packages/core/src/dom.ts` — `render`・細粒度バインド・`reconcileNodes`(keyed 差分)
- `packages/core/src/control-flow.ts` — `<Show>`/`<For>`/`mapArray`
- `packages/core/src/{props,css}.ts` — `mergeProps`/`splitProps`・scoped `css`(ハッシュ class + `<style>` 注入)
- `packages/cli/src/{build,dev,create,index,errors}.ts` — CLI(Bun 依存はここだけ)
- `docs/{decisions,roadmap}.md`(+ `.ja.md`)— 設計判断 / 残作業
