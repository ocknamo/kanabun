# 開発者支援:ミスを捕まえる

*[English](./dx.md) | 日本語*

kanabun には **コンパイラがありません**。リアクティブの規約 ──「関数はリアクティブ、
呼んだ値は一度きり、`on*` はイベント」── はビルドステップではなく規律で守ります。これは
創設時のトレードオフ([`decisions.ja.md`](./decisions.ja.md#2-明示-gettersolid-流-ゆえにコンパイラなし)
を参照)で、コンパイラ前提のフレームワークなら捕まえられる類のミスを取りこぼしうる、という
ことでもあります。このページは、それを *実際に* 捕まえる仕組みを 3 層に整理します。

| 層 | タイミング | 捕まえるもの | コスト |
| --- | --- | --- | --- |
| **型** | 編集 / `tsc` | `on*` ハンドラの形(誤り・関数の書き忘れ)、誤った要素属性 | なし(コンパイル時) |
| **開発時警告** | 実行時・オプトイン | owner 外の effect/ライフサイクル、不純な computed | オフ時はほぼ0 |
| **テスト / `snapshot`** | CI | 「更新されない」症状 | 自分で書くテスト |

## 1. 型レベルのチェック(コンパイル時)

`on*` プロップは **常に** イベントリスナー(DOM ランタイムが特別扱いし、リアクティブ thunk
には決してならない)なので、`JSX.IntrinsicElements` で関数型として型付けしています。これで
古典的な「`() =>` 書き忘れ」が **コンパイルエラー** になります ── もっとも早く・安く捕まえ
られ、実行時コストも誤検知もありません。

```tsx
<button onClick={count.set(count() + 1)}>   // ✗ 型エラー:これはレンダー時に1回走り、
                                             //   値は `void`(関数でない)。クリックは無反応
<button onClick={count() }>                  // ✗ 型エラー:`number` は関数でない
<button onClick={() => count.set(count() + 1)}>  // ✓
<button onClick={enabled ? handler : undefined}>  // ✓ 条件付きハンドラは正当
```

精度の鍵は、型システムが `void` と `undefined` を区別することです。setter 呼び出し
(`count.set(…)`)の型は `void` で、これはハンドラ型(オプショナルでも)に代入 **できない**
ので弾かれます。一方、本物の `undefined`(条件付きハンドラ)は許されます。ランタイム検査では
この 2 つを区別できませんが、型ならできます。イベントも型付きなので、`e.key` を読むハンドラ
はキーボードイベントのスロット(`EventHandler<KeyboardEvent>`)にしか置けません
(`strictFunctionTypes` が強制)。

**要素ごとの属性も型付き。** `JSX.IntrinsicElements` は主要要素を各自の属性形
(`<a href>`、`<input checked>`、`<button disabled>`、…)にマップし、各属性は `Attr<T>`
── その値 **または** リアクティブなアクセサ(`class="x"` も `class={() => …}` も通り、
`class={5}` は弾く)── として型付けされ、「関数はリアクティブ」の規約を尊重します。よって
誤った属性(`disabled="yes"`、`tabIndex="3"`、`<button type="email">`)はコンパイルエラーになり、
要素ごとの補完が効きます。未掲載の要素・未知の属性(`data-*` / `aria-*`)は `[attr]: any` の
逃げ道で緩いまま ── `on*` ハンドラと同じ優先順位で、型付きの名前は強制されつつ残りは緩いままです。

**限界。** これは `tsc` / エディタを使う場合にだけ効き、`any` 型の値には無力です(`[attr]: any`
のフォールバックでしか覆われていない属性も含む)。そして決定的に、子/属性の `{count()}`
取り違えには **拡張できません**。そこでは `{count}`(リアクティブ)も `{count()}`(静的)も
正当な API なので、型は両方を受け入れざるを得ません。`on*` が特別なのは、正当な形が(関数)
1 つしかないからです。

## 2. 実行時の開発警告(オプトイン)

型では見えないミスのために、`setDev(true)` で少数の **ランタイム診断** を有効化できます
([`decisions.ja.md`](./decisions.ja.md#開発時警告phase-6) を参照)。**既定オフ** ──
本番もテストも無音で、オフ時のホットパスコストもなし ── で、`kanabun dev` は
`globalThis.__KANABUN_DEV__` を注入して自動で有効化します。警告は重複排除され、差し替え
可能なシンク(`setWarnHandler`)を通ります。

`kanabun dev` ではこれらはコンソールに出るだけでなく、**dev オーバーレイ**が(未捕捉
エラーや unhandled rejection と併せて)画面上のパネルに集約するので、騒がしいコンソールの
中で警告を見失わずに済みます。同じシンクを消費する CLI レイヤーの仕組みです ──
[`decisions.ja.md`](./decisions.ja.md#dev-オーバーレイphase-7) を参照。

```ts
import { setDev } from "@kanabun/core";
setDev(true); // または kanabun dev に任せる
```

何を指摘するか(いずれもコアが既に持つ状態から検知でき、誤検知が少ないもの):

- **owner 外で作られた `effect()`** ── 自動 dispose されない(リークの恐れ)。
  `render`/`createRoot` の中で作るか、返り値の disposer を保持して呼ぶ。
- **owner 外の `onCleanup()`** ── コールバックが黙って一度も実行されない。
- **owner 外の `onMount()`** ── 実行はされるがライフサイクルに紐づかない。
- **computed の評価中のシグナル書き込み** ── 純粋であるべき場所の副作用(effect か
  イベントハンドラへ移す)。

## 3. それでも捕まえられないもの ── どう凌ぐか

最大の取り違え ── 子/属性で `{count}` のつもりが `{count()}` ── は上の 2 層からは
見えません。ランタイムが値を見る頃には `count()` はリテラルと区別できない素の値に潰れて
おり、(上述のとおり)静的形も正当なので型でも禁じられない。症状はただ **「画面が更新され
ない」** だけです。

防波堤:

- 操作後に値が *変わる* ことを assert する **テスト** が、取り違えを失敗テストに変えます
  (例:クリック→新しいテキストを期待)。
- **`snapshot` スキル** が before/after のスクショを撮り、静かに反応しなくなった UI を
  あぶり出します。

## 4. 自前 linter(`kanabun lint`)

`{count()}` の取り違えは、まさに **静的解析** なら捕まえられてランタイム検査では無理な類の
ものです ── 呼び出しが値に潰れる前に *ソース*(`count` はシグナルで、リアクティブな位置で
呼ばれている)を見る必要があるからです。そこで kanabun は **第一級の `kanabun lint`** を出荷
します。ESLint プラグインでは **ありません** ── ESLint(とそのプラグイン群)は外部依存であり、
kanabun は **依存ゼロ** で出荷するので、採用すれば創設時の制約を破ります。代わりに linter は
CLI / Bun レイヤー(`packages/cli/src/lint.ts`)に置き、型チェックで既に頼っている
**TypeScript パーサ**(固定版の `typescript` dev 依存。素の `import("typescript")` で取得)を
再利用します。これならランタイム依存は増えません ── オプトインかつ開発時のみの作成支援ツール
であって、フレームワークが依存するランタイムコンパイラではありません。

```sh
kanabun lint                 # カレント配下の **/*.tsx を検査
kanabun lint "src/**/*.tsx"  # glob を明示
```

リアクティブ位置での呼び出し(`{count()}` → `{count}` / `{() => …}` を提案)を指摘し、
`file:line:col  rule  message` を報告して検出時は非ゼロ終了(CI ゲート)。`build`/`generate`
同様 never-throw ── 内部失敗はクラッシュせずログとして返ります。

### 実装

- **形。** `kanabun lint [globs]` サブコマンド(`packages/cli/src/lint.ts`)。`lint()` が
  ファイルを列挙(`Bun.Glob`、`node_modules` は除外)し、`lintSource(source, file)` が TSX
  文字列を 1 本解析する ── 後者は export してあり、ルールはファイルシステム無しでフィクスチャ
  文字列から単体テストできる。診断の作法は `packages/cli/src/errors.ts` に倣う。
- **パーサ(⚠️ TypeScript 7 で一時停止)。** ルールは元々、各ファイルを **in-process** で
  TypeScript コンパイラ API(素の `import("typescript")` で固定版 `typescript` dev 依存に
  解決、`ts.createSourceFile(…, ScriptKind.TSX)`)によりパースしていた ── auto-install 頼みが
  不要で「TS は固定版の dev 依存」とも整合し、ランタイムには何も足さない。**TypeScript 7
  (ネイティブ移植版)はその in-process API を廃止した**:パーサはネイティブバイナリ内にあり、
  起動するサーバー API(`typescript/unstable/sync`)経由でしか使えず、AST の型/ガードは
  `typescript/unstable/ast` 配下に分割された ── in-process の `createSourceFile` はもう無い。
  そこで TS 7 へのツールチェーン更新に合わせ linter は **一時停止**:`lint()` は内部失敗を
  返し(誤った clean 判定は決してしない)、`lintSource()` は説明付きで throw する。一方で公開面
  (`lint` / `lintSource` / `formatFindings` と結果型)は温存し、移植を drop-in に保つ。移植は
  後述「TS 7 の見通し」を参照。
- **目玉ルール `reactive-call-in-jsx`。** 各 JSX 子 / `on*` 以外の属性を走査し、その
  リアクティブ位置の式から、accessor 風の識別子・メンバアクセスを callee に持つ引数なし
  呼び出し(`count()`、`store.sig()`)を指摘。ネストしたアロー/関数の部分木はスキップ(既に
  遅延 thunk=その中の呼び出しはリアクティブのまま)。`on*` プロップはイベント(`dom.ts` に
  合わせる)で走査しない。`{count()}`・`{count() + 1}`・`class={theme()}`・オブジェクト/`style`
  値の中の accessor 読み取りまで捕まえる。
  - これは **シンタクティック** 段階(AST のみ、`TypeChecker` 無し)。accessor 呼び出しと、
    意図的な一度きりの静的読み取りや素の引数なしヘルパ(`{getId()}`)を区別できないため、それらも
    報告される ── オプトインのツールとしては許容範囲。(`<For>` / `<Show>` の描画コールバック
    内の素の `{item()}` 読み取りも含む:コンパイラが無いので一度きり読み取りのままで、ルールは
    リアクティブな `{item}` を提案する。)**セマンティック** 段階
    (`ts.createProgram` + `TypeChecker` で callee の型を解決し `Accessor`/`Signal` だけ指摘 →
    誤検知ほぼゼロ)は記録済みの follow-up。
- **後続ルール。** `static-thunk`(シグナルを読まない `() => …` の子/属性 ── 無駄に遅延)と
  `on-handler-not-a-function`(§1 の `on*` 型付けで概ね吸収済み。素の JS 利用者向けに残す)。
- **テスト。** 一時停止中は「TS 7 で利用不可」の契約(`lint()` は説明付きで失敗、`lintSource()`
  は throw)を固定し、パーサ非依存の `formatFindings` は手組みの findings で網羅 ── リポジトリの
  カバレッジ基準を維持。ルールのフィクスチャテスト(ソース文字列→パース→検出を assert)は
  ネイティブ API 移植とともに復帰する。新たなランタイム依存は増やさない。
- **TS 7(ネイティブ)の見通し ── 移植方針。** TS 7 は先の注意点を現実にした:ネイティブ移植版は
  **in-process のコンパイラ API を提供しない**。パースはサーバー API(`typescript/unstable/sync`)
  経由のみ ── `API` を起動し、仮想ファイルシステム(`typescript/unstable/fs`)でソースを渡し、
  返ってきた `SourceFile` を `typescript/unstable/ast/is` のガードとノードのメソッド
  (`forEachChild`・`getStart`・`getLineAndCharacterOfPosition` は依然メソッド)で走査する。
  よって移植は:(1)`ts.createSourceFile` の代わりにサーバー API から `SourceFile` を得る、
  (2)`ts.isX(...)` のガード呼び出しを `typescript/unstable/ast/is` の関数に差し替える ── の
  2 点で、走査ロジック自体は不変。代償として `lint` は **サブプロセス**(ネイティブサーバー)を
  抱える(純 in-process の JS パースからの逸脱)ため、ネイティブ API が安定し Bun 上で検証できて
  から着地させる。**セマンティックモード**(同じサーバー API の `Checker` で callee の型を解決し
  `Accessor`/`Signal` だけ指摘 → 誤検知ほぼゼロ)が自然な後続で、Go ネイティブ版が約10倍速に
  するチェッカー処理そのもの。恩恵は本リポジトリではなく *利用者のコードベース規模* に比例する。
