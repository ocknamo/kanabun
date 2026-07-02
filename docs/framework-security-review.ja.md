# フレームワークセキュリティレビュー — 攻撃ベクトル起点

*[English](./framework-security-review.md) | 日本語*

本レポートは kanabun に対する **2 回目・外部起点** のセキュリティレビューです。
[`security.md`](./security.ja.md) が内部の全体監査（S1–S7、すべて修正済み）の記録で
あるのに対し、こちらは *外側* から出発します。主要フロントエンドフレームワーク
（Angular / AngularJS、React、Vue、Svelte / SvelteKit、Solid）の High 以上の CVE を
調査し、それらを **典型的な攻撃ベクトル** に蒸留したうえで、各ベクトルについて
kanabun を検証します。そして「そのベクトルが当てはまる／当てはまらない理由」を、
コード参照と、可能な限り再現確認を添えて説明します。

先に結論を述べます。**新規の脆弱性は見つかりませんでした。** kanabun の小さな
表面積（ランタイム JSX、シグナル、コンパイラなし、サーバフレームワークなし、
ランタイム依存ゼロ）が以下のクラスのほとんどを構造的に排除しており、適用され
うる僅かなものは S1–S7 で既に塞がれています。各判定は個別に説明します。

深刻度はプロジェクト規約に従います: 🔴要対応 / 🟡推奨 / 🔵軽微 /
✅該当なし・緩和済み。

---

## Part 1 — High 以上の CVE 調査と、それが表す攻撃ベクトル

以下の CVE は、フレームワーク別ではなく、それが例示する **ベクトルクラス** で
グループ化しています。各クラスが Part 2 のレビュー項目になります。

### CVE の全体像（代表的な High/Critical）

| フレームワーク | CVE / advisory | クラス | 概要 |
| --- | --- | --- | --- |
| Angular | CVE-2025-66412 (8.5) | サニタイザ回避 | SVG/MathML 属性の誤分類で sanitizer を回避する Stored XSS |
| Angular | CVE-2026-32635 (8.6) | サニタイザ回避 | i18n マークした `href`/`src` が URL サニタイズを飛ばす |
| Angular | CVE-2026-52725 / CVE-2026-50557 | サニタイザ回避 | 名前空間付き `<svg:script>` / 属性がコンパイル時のスクリプト除去を回避 |
| AngularJS | サンドボックス脱出クラス（例: CVE-2022-27665） | クライアント側テンプレートインジェクション | `{{…}}` 式をブラウザで評価 → サンドボックス脱出 → XSS |
| React | CVE-2025-55182 "React2Shell" (10.0) | 安全でないデシリアライズ | RSC が攻撃者の POST body をデシリアライズ → サーバ側 RCE |
| React | CVE-2025-55184 / CVE-2025-67779 (7.5) | DoS | RSC のリクエスト処理が CPU/メモリを枯渇 |
| Vue | CVE-2024-6783 | プロトタイプ汚染 → XSS | 汚染された `Object.prototype.staticClass/staticStyle` が DOM に描画 |
| vue-i18n | CVE-2025-27597 (8.9) | プロトタイプ汚染 | メッセージコンパイラのプロトタイプ汚染 → DoS/コード実行の可能性 |
| Svelte | CVE-2026-27121 | SSR スプレッド属性 XSS | 攻撃者制御のスプレッドがインラインの `onclick`/`onerror` を出力 |
| Svelte | CVE-2026-27122 | 動的タグインジェクション | `<svelte:element this={tag}>` に信頼できないタグでタグを閉じる |
| Svelte | CVE-2026-27902 | ハイドレーションマーカーインジェクション | HTML コメント / ハイドレーションマーカー内の信頼できないデータが脱出 |
| SvelteKit | CVE-2025-32388 | 反射型 XSS | `searchParams` の反復でサニタイズされていないパラメータ *名* を描画 |
| SvelteKit | CVE-2026-22803 / CVE-2025-67647 | SSRF | 偽装 `Host` ヘッダ → 内部サービスへのサーバ側リクエスト |
| devalue | CVE-2026-22774/22775 | DoS | ハイドレーションパースで未検証の Base64 → CPU/メモリ枯渇 |
| Solid | CVE-2025-27109 | フラグメントのエスケープ漏れ | JSX フラグメント内の式が SSR でエスケープされていなかった |
| Solid | (advisory) escapeHTML | 属性エスケープ漏れ | ある経路で属性値の `<` がエスケープされない |

出典は末尾にリンクしています。

### 蒸留した攻撃ベクトル

上記から、繰り返し現れる根本原因クラスは以下です:

- **A1 — SSR/シリアライザ XSS。** 信頼できないデータが、シリアライザが生
  出力するか過小エスケープする位置を通って HTML 文字列に到達する: 属性 *値*、
  属性 *名*、タグ *名*、または raw-text（`<script>`/`<style>`）本文。
  *(Angular サニタイザ回避、Solid フラグメント/属性漏れ、Svelte 27122、
  SvelteKit 32388。)*
- **A2 — スプレッド属性のイベントハンドラインジェクション。** コンポーネントが
  攻撃者制御のキーをスプレッドし、`on*` ハンドラがインライン属性として出力される。
  *(Svelte CVE-2026-27121。)*
- **A3 — 動的要素/タグインジェクション。** 信頼できない入力から実行時に選んだ
  タグ名がタグを閉じる、または危険な要素を指名する。*(Svelte CVE-2026-27122。)*
- **A4 — クライアント側テンプレートインジェクション / 式サンドボックス脱出。**
  フレームワークが描画内容中のテンプレート式を評価する。*(AngularJS `{{…}}`。)*
- **A5 — プロトタイプ汚染 → XSS/DoS。** 再帰マージやネストしたクエリパーサが
  `__proto__` 経由で書き込み、後の描画が汚染されたグローバルプロトタイプを読む。
  *(Vue CVE-2024-6783、vue-i18n CVE-2025-27597。)*
- **A6 — `href`/`src` の危険な URL スキーム。** `javascript:`/`data:`/`vbscript:`
  がクリックで辿られる。*(横断的な XSS クラス。フレームワーク固有のリスクは、
  ルータが代わりに URL を辿る箇所。)*
- **A7 — クライアント↔サーバペイロードの安全でないデシリアライズ。**
  シリアライズされたリクエスト/ハイドレーションペイロードを過剰に信頼して
  デシリアライズする。*(React CVE-2025-55182。)*
- **A8 — サーバのリクエスト処理: SSRF / DoS。** サーバフレームワークが `Host`
  ヘッダを信頼する、またはハイドレーション入力を境界なしでパースする。
  *(SvelteKit CVE-2026-22803、devalue DoS。)*
- **A9 — Dev サーバ / ビルドツール: パストラバーサルとクラッシュ。** dev サーバが
  ルート外のファイルを配信する、または不正リクエストがハンドラをクラッシュさせる。
- **A10 — ReDoS。** フレームワークの正規表現が細工入力で破滅的にバックトラックする。
- **A11 — ハイドレーションマーカー / コメントインジェクション。** ハイドレーション
  マーカーや HTML コメント内の信頼できないデータが脱出する。*(Svelte CVE-2026-27902。)*
- **A12 — クライアント側メモリ枯渇。** リアクティビティがスコープ/リスナを
  リークし続けてタブが死ぬ（サーバ DoS クラスのクライアント版）。

---

## Part 2 — 各ベクトルに対する kanabun のレビュー

各項目は、判定・具体コードに紐づく根拠・証拠を示します。以下の 8 つの主張は
再現確認（V1–V8、実ソースに対して実行、すべて pass）で裏付けています。

### A1 — SSR/シリアライザ XSS ✅緩和済み（S1/S2/S4/S6/S7）

kanabun の *唯一の* HTML 文字列生成経路は `packages/core/src/server-dom.ts` の
`serialize()` です。攻撃者が到達しうるすべての位置が守られています:

- **属性値** — `escapeAttr` が `& < > "` を無害化し、値は常にダブルクオートで
  囲まれます（`server-dom.ts:48`、出力は `:249`）。Solid の
  「`escapeHTML` が `<` をエスケープしない」クラスを塞ぎます。*(V7: `title` が
  `"><img …>` でも `&quot;&gt;&lt;img …` として描画。)*
- **テキスト子** — `escapeText` が `& < >` を無害化（`:44`、`:245`）。通常の
  `{userInput}` は決してインジェクションになりません。*(V6。)*
- **属性名** — `ServerNode.setAttribute` が `VALID_ATTR_NAME` で検証し、実 DOM
  同様に throw します（`:167`）。攻撃者制御のスプレッド *キー*
  （`<div {...user} />`）はもうタグを閉じられません — これが **S1**。*(V2。)*
- **タグ名** — `ServerDocument.createElement` が `VALID_TAG_NAME` で検証し
  throw します（`:224`）。信頼できない要素型（`jsx(userTag, …)`）はもうマークアップを
  注入できません — これが **S6** で、Svelte CVE-2026-27122 の直接の対応物です。*(V8。)*
- **raw-text 本文** — `<script>`/`<style>` 本文は（HTML 仕様どおり）そのまま
  出力されますが、`escapeRawText` が大文字小文字を無視して `</script` / `</style`
  の脱出シーケンスを壊します（`:64`、適用は `:263`）。これが **S2/S7**。
  *(V5: `css` 補間の `</style><img …>` は `<style>` から脱出できない。)*

Angular のサニタイザ回避 CVE（SVG/MathML/名前空間）には **対応物がありません**:
kanabun には回避すべき HTML サニタイザがそもそも存在しません。信頼できない
HTML 文字列を DOM にパースすることが一切なく、`[innerHTML]` バインディングも
`dangerouslySetInnerHTML` も `v-html` もありません。コンテンツが DOM になるのは
`createTextNode`/`setAttribute`（クライアント）かエスケープするシリアライザ
（サーバ）経由のみ。ソース全体を `innerHTML`、`insertAdjacentHTML`、
`document.write`、`outerHTML` で grep しても何もヒットしません。「サニタイザの
許可リストがこの要素を誤分類したか？」という問い自体が、許可リストも
文字列→DOM パースも無いため成立しません。

### A2 — スプレッド属性のイベントハンドラインジェクション ✅構造的に排除

これは **Svelte CVE-2026-27121** そのもののシンクです。kanabun では `on*` プロパティは
`applyProp`（`dom.ts:96`）が `addEventListener` で扱い、**決して** 属性として
書き込みません。サーバでは `ServerNode.addEventListener` が no-op（`server-dom.ts:181`）
で完全に破棄します。よって `{...{ onclick: "alert(1)" }}` をスプレッドしても属性は
付かず、何もシリアライズされません。
*(V1: `<div {...{onclick:"alert(1)"}}>x</div>` はちょうど `<div>x</div>` として描画。)*
「`on*` は常にリスナ」というルールは呼び出しごとの判断ではなくフレームワーク不変条件
なので、攻撃者提供の `on*` がインライン HTML になる経路は存在しません。

### A3 — 動的要素/タグインジェクション ✅緩和済み（S6）

kanabun には動的ホストコンポーネント `<Dynamic component={…}>`（`dynamic.ts`）が
あり、低レベルの `jsx(type, …)` も文字列タグを受け付けます。どちらも
`createElement` を通り、サーバでは `ServerDocument.createElement` を通ります。これは
タグ名を検証し、不正なら throw します（`server-dom.ts:224`）。よって開発者が信頼
できない値を `<Dynamic>` の `component` や `jsx` に配線しても、`img src=x onerror=…`
のようなタグはシリアライズされず fail-safe します。*(V8。)* クライアントでは実
`document.createElement` が同じ入力で既に `InvalidCharacterError` を throw するので、
クライアントとサーバが一致し、Svelte のバグを隠していた非対称性は消えています。

### A4 — クライアント側テンプレートインジェクション / サンドボックス脱出 ✅設計上該当なし

AngularJS のこのクラスのバグには **テンプレート評価器** が必要です: フレームワークが
描画内容から `{{ 式 }}` を走査して *評価* します。kanabun にはそれがありません。
テンプレート言語も `{{…}}` 補間も式パーサも、脱出すべきサンドボックスもありません。
JSX はビルド時に TypeScript/Bun が素の関数呼び出し（`jsx(...)`）にコンパイルし、実行時
「リアクティブ値」はランタイムが呼ぶただの JavaScript 関数（`dom.ts:105`）であって、
パースして eval する文字列ではありません。ソース全体を `eval(`、`new Function`、
動的コード生成で grep しても何もありません。子として置かれた信頼できないデータは
テキストノードになる *文字列* であり、テンプレートとして扱われません。
「コンパイラなし・テンプレート DSL なし」という創設制約がこのクラス全体を排除します。

### A5 — プロトタイプ汚染 → XSS/DoS ✅構造的に排除

候補シンクは 2 つあり、どちらも安全です:

- **`mergeProps` / `splitProps`**（`props.ts`）は `Object.keys` +
  `Object.defineProperty` でコピー — own enumerable キーのみ。`__proto__` という名の
  ソースキーは（`defineProperty` により）結果の *own* プロパティになり、
  `Object.prototype` への書き込みには **なりません**。*(V3:
  `{"__proto__":{"polluted":1}}` をマージしても `Object.prototype.polluted` は
  undefined のまま。)* 再帰的ディープマージが無いため、Vue の `staticClass`/
  `staticStyle` ガジェット（ネストした AST/オブジェクトを辿って代入）に相当するものが
  ありません。
- **ルータのクエリパース**（`location.ts:29`）は標準 `URLSearchParams` を使い、平坦な
  string→string ペアを生成します。`qs` 風の `a[b]=c` ネストブラケットパーサが無いので、
  `?__proto__[x]=y` は素のキー `"__proto__[x]"` になり、プロトタイプ書き込みには
  なりません。素の `?__proto__=y` のケースも無害です: `query[key] = value`
  （`location.ts:32`）は新しいオブジェクトの own キーに *文字列* 値を代入するだけで、
  `Object.prototype` を変更しません。*(V4。)*

island props 経路（`islands.ts:208`）は攻撃者が *読める*（サーバ作成の）マークアップを
`JSON.parse` しますが、`JSON.parse` はプロトタイプを汚染しません（`"__proto__"` キーは
パース結果の own プロパティになる）。またドキュメントは island props をサーバ作成
データであって信頼境界ではないと既に明記しています。

### A6 — `href`/`src` の危険な URL スキーム ✅フレームワーク所有部分は緩和済み（S3）

各フレームワーク共通の原則: 開発者が書いた要素上の生の `href="javascript:…"` は
開発者の責任です（Solid、Svelte、kanabun いずれもこの立場 — `LinkProps` と S3 に
明記）。*フレームワーク* が所有するのは、ユーザに代わって URL を辿る箇所です。それは
まさに `<Router>` の `<Link>` / `useNavigate` で、守られています: `isUnsafeHref`
（`router.ts:329`）がブラウザが無視する ASCII 空白/制御文字を除去してから
`javascript:`/`data:`/`vbscript:` を拒否し、危険な `<Link>` は `href` の無い
**inert アンカー** として描画され（`router.ts:374`）、`handleClick` は `navigate` を
スキップします。外部/スキームリンク（`https:`、`mailto:`、`//host`）は引き続き動作
します。これが **S3**。なおルータはサーバ側のオープンリダイレクトを一切行わない
（サーバフレームワークが無い）ため、SvelteKit のリダイレクト→SSRF 連鎖の対応物は
ありません。

### A7 — クライアント↔サーバペイロードの安全でないデシリアライズ ✅該当なし

React の **React2Shell**（CVE-2025-55182）は RSC 固有の欠陥です: サーバエンドポイントが
攻撃者の POST body を生きたオブジェクト/関数にデシリアライズして実行します。kanabun には
**サーバコンポーネントプロトコルも RPC もサーバアクションもカスタムデシリアライザも
ありません。** `renderToString`（`server.ts`）は純粋な一方向関数です: view thunk →
HTML 文字列。リクエスト body を読むことも、クライアント入力をデシリアライズすることも
ありません。どこかにある唯一のデシリアライズは island props の `JSON.parse` だけで、
それは *サーバが作成* したマークアップに埋め込まれたデータを、実行コードではなく
不活性な素のオブジェクトにパースします。受信ネットワークペイロードからコード実行への
経路はありません。

### A8 — サーバのリクエスト処理: SSRF / DoS ✅該当なし（サーバフレームワークなし）

SvelteKit の `Host` ヘッダ SSRF（CVE-2026-22803）も devalue のハイドレーション DoS
（CVE-2026-22774/5）も、リクエストを処理しハイドレーション入力をパースする
**サーバフレームワーク / アダプタ** に存在します。kanabun は意図的にそのような層を
出荷しません: `packages/core` はランタイム非依存（`Bun.*`/`node:*` なし）で、リポジトリ内で
リクエストを処理するコードは **dev サーバ**（`cli/src/dev.ts`）だけで、これは A9 で
扱います。`Host` ヘッダを読む本番リクエストハンドラも、境界なしデコードを行う
ハイドレーションペイロードパーサもありません — kanabun のハイドレーションは同じ
ソースからアプリを再実行して DOM を再構築するもので（`dom.ts:319`）、シリアライズ
された状態 blob をパースしません。したがってパース経由 DoS クラスに入口がありません。

### A9 — Dev サーバ / ビルドツール: パストラバーサルとクラッシュ ✅堅牢

dev サーバは開発専用・localhost 向きですが、それでも堅牢化されています:

- **パストラバーサル** — `createDevHandler`（`dev.ts:246`）は配信ルートを
  `realpathSync` で解決し、*2 つ* の封じ込めチェックを適用します: 解決済みパスへの
  字句的チェック（`../` と `%2e%2e%2f` をブロック、`decodeURIComponent` が先に走る
  ため）**と**、ルート *内* にある外を指すシンボリックリンクをブロックする `realpath`
  チェック（`dev.ts:295–297`）。両方を通らないとリクエストは 404 になります。
- **不正エスケープでのクラッシュ** — `decodeURIComponent` は 404 を返す `try/catch`
  で包まれ、`/%ZZ` や単独の `%` がハンドラから throw できません（`dev.ts:281`）。
  これが **S5**。
- **ビルド時のルート脱出** — SSG の `generate` はファイルが `outdir` を脱出する
  ルートを拒否します（`generate.ts:149`）。ビルド時設定に対するガードレールです。

注入される dev プレリュード（`swapCss`、`devOverlay`）はフレームワーク作成の
ソースを `.toString()` でシリアライズしたもので、リクエストデータを一切補間しないため、
dev HTML に反射型 XSS の表面はありません。

### A10 — ReDoS ✅なし

フレームワーク内のすべての正規表現はアンカーされ、ネスト/重複量指定子を含まないため、
破滅的にバックトラックするものはありません: `VALID_ATTR_NAME` / `VALID_TAG_NAME`
（`server-dom.ts`）、`isExternal` / `UNSAFE_SCHEME`（`router.ts`）、`SCOPED_AT`
（`css.ts`）、`MODULE_RE` と `<base>`/`<head>` マッチャ（`dev.ts`）はすべて線形です。
兵器化されうる形で、境界なしの信頼できない入力にホットループで適用されるものは
ありません。`css` のスコーパは 1 文字ずつのレキサであってバックトラックする正規表現では
ありません。

### A11 — ハイドレーションマーカー / コメントインジェクション ✅該当なし

Svelte の CVE-2026-27902 は、状態をハイドレーションマーカーとして使う HTML **コメント** に
エンコードし、そこで信頼できないデータがコメントから脱出できることに由来します。
kanabun のハイドレーションはマーカーレスです: `hydrate`（`dom.ts:319`）は位置マーカーに
対してサーバノードを *採用* しません — コンテナをクリアして同じコンポーネントソースから
再描画します（コンパイラなし設計の意図的な帰結で、`dom.ts` と `decisions.md` に明記）。
コメントやハイドレーションマーカーを通じて状態を密輸しないため、脱出すべきものが
ありません。ランタイムが *実際に* 作るコメントノード（リアクティブスロット / ポータルの
アンカー、`dom.ts:161`、`portal.ts:43`）は常に空か定数文字列の本文で、信頼できない
データを持つことがないため、そもそも攻撃者制御データがコメント位置に到達しません。
なお、この安全性はこの不変条件に完全に依存しており、**エスケープには依存していません**:
`serialize` はコメント本文をそのまま出力する（`server-dom.ts:246` は
`` `<!--${node.data}-->` `` を返す）ため、本文中の `-->` は *脱出しうる* のです。
現状はコメント本文がフレームワーク定数の文字列のみなので問題ありませんが、将来
コメントに動的データを流す変更を入れる場合は、その時点で `-->` を中和する必要が
あります（ランタイムは肩代わりしません）。

### A12 — クライアント側メモリ枯渇 ✅堅牢（リークなし）

owner-tree + `onCleanup` モデルがリアクティブスコープを決定的に破棄します:
`createRoot`、effect の再実行（`disposeOwned`、`reactive.ts:269`）、`mapArray` の
アイテムごとルートと未再利用アイテムの破棄（`control-flow.ts:67`）、ルータの
`disposableSlot`（`router.ts:231`）、`resource` のバージョンベースのキャンセル
（`async.ts:127`）、`<Suspense>`/`<ErrorBoundary>` はすべて破棄時にテアダウンします。
イベントリスナは要素生成時に一度だけ登録され、effect 内では登録されないため
（`dom.ts:97`）、再描画をまたいで蓄積しません。effect フラッシュには
`MAX_FLUSH_ITERATIONS` の安全弁（`reactive.ts:62`）があり、暴走する更新ループでタブを
ハングさせる代わりに throw します。信頼できない入力に紐づく無制限な増加は
見つかりませんでした。

---

## 判定

| ベクトル | 判定 | 根拠 |
| --- | --- | --- |
| A1 SSR/シリアライザ XSS | ✅緩和済み | S1/S2/S4/S6/S7; V2/V5/V6/V7/V8 |
| A2 スプレッドイベントハンドラ | ✅排除 | `addEventListener` のみ; V1 |
| A3 動的タグインジェクション | ✅緩和済み | S6 タグ検証; V8 |
| A4 テンプレートインジェクション / サンドボックス | ✅該当なし | テンプレート DSL・eval なし |
| A5 プロトタイプ汚染 | ✅排除 | own キーコピー; V3/V4 |
| A6 危険な URL スキーム | ✅緩和済み | S3 `<Link>` ガード |
| A7 安全でないデシリアライズ | ✅該当なし | RSC/RPC/デシリアライザなし |
| A8 サーバ SSRF / DoS | ✅該当なし | サーバフレームワークなし |
| A9 Dev サーバ トラバーサル/クラッシュ | ✅堅牢 | S5 + 二重封じ込め |
| A10 ReDoS | ✅なし | アンカー済み・非バックトラック |
| A11 ハイドレーションマーカーインジェクション | ✅該当なし | マーカーレスハイドレーション |
| A12 クライアントメモリ枯渇 | ✅堅牢 | owner-tree 破棄 |

**新規発見なし。** kanabun がこれらのクラスを避けている主因は *構造的* です:
回避すべき HTML サニタイザが無い（A1-Angular）、テンプレート評価器が無い（A4）、
再帰プロップマージやネストクエリパーサが無い（A5）、サーバコンポーネント / RPC /
デシリアライザが無い（A7）、リクエスト処理サーバフレームワークが無い（A8）。
ランタイム JSX + SSR が *露出しえた* ベクトル（A1 シリアライザ位置、A2 イベント
スプレッド、A3 動的タグ、A6 ルータ URL）は S1–S7 監査で特定・修正され、V1–V8 で
検証されたとおり塞がれたままです。

---

## 付録 — 再現確認（V1–V8）

各確認は実ソース（`@kanabun/core` + ルータ）に対して実行し、すべて pass します。
これらが上記「なぜ脆弱でないか」の主張の実証的な裏付けです。

| # | ベクトル | 主張内容 |
| --- | --- | --- |
| V1 | A2 | `renderToString(() => jsx("div", { ...{ onclick: "alert(1)" }, children: "x" }))` → ちょうど `<div>x</div>`（インラインハンドラ非出力）。 |
| V2 | A1 | `renderToString(() => jsx("div", { "x><img src=x onerror=alert(1)": "y" }))` は **throw**（属性名検証）。 |
| V3 | A5 | `mergeProps({}, JSON.parse('{"__proto__":{"polluted":1}}'))` の後も `({}).polluted` は undefined。 |
| V4 | A5 | `parsePath("/x?__proto__[polluted]=1")` の後も `({}).polluted` は undefined。 |
| V5 | A1 | `</style><img …>` を補間した `css` → 描画された `head` に `</style><img` を含まない。 |
| V6 | A1 | `{"<img src=x onerror=alert(1)>"}` テキスト子は `&lt;img …` として描画され、`<img` にならない。 |
| V7 | A1 | `title` が `"><img …>` でも `&quot;` と `&lt;` で描画され、生の `><img` にならない。 |
| V8 | A1/A3 | `jsx("img src=x onerror=alert(1)", …)` を `renderToString` すると **throw**（タグ名検証）。 |

```ts
// 代表的な抜粋（V1・V2・V8）— bun test で実ソースに対して実行。
import { renderToString, jsx, mergeProps, css } from "@kanabun/core";

// V1 — スプレッドの on* は決してシリアライズされない（vs Svelte CVE-2026-27121）
expect(renderToString(() => jsx("div", { ...{ onclick: "alert(1)" }, children: "x" })).html)
  .toBe("<div>x</div>");

// V2 — 攻撃者制御のスプレッドキーは拒否される（S1）
expect(() =>
  renderToString(() => jsx("div", { "x><img src=x onerror=alert(1)": "y" })),
).toThrow();

// V8 — 信頼できないタグ名は拒否される（S6、vs Svelte CVE-2026-27122）
expect(() =>
  renderToString(() => jsx("img src=x onerror=alert(1)", { children: "" })),
).toThrow();
```

---

## 出典

**Angular / AngularJS**
- CVE-2025-66412 — SVG/MathML 属性誤分類による Stored XSS: <https://github.com/angular/angular/security/advisories/GHSA-v4hv-rgfq-gp49>
- CVE-2026-32635 — i18n サニタイズ回避: <https://securityonline.info/translation-trap-high-severity-angular-xss-flaw-cve-2026-32635/>
- CVE-2026-50557 — テンプレート/属性の名前空間サニタイズ回避（CVE-2026-52725 と併記される名前空間回避クラス）: <https://advisories.gitlab.com/npm/@angular/compiler/CVE-2026-50557/>
- AngularJS クライアント側テンプレートインジェクションとサンドボックス脱出（背景）: <https://portswigger.net/research/xss-without-html-client-side-template-injection-with-angularjs>, <https://portswigger.net/research/dom-based-angularjs-sandbox-escapes>; サンドボックス脱出の反射型 XSS 実例 CVE-2022-27665: <https://github.com/advisories/GHSA-prxf-5xrr-96cp>

**React**
- CVE-2025-55182 "React2Shell"（RSC デシリアライズ RCE）: <https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components>, <https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182>
- CVE-2025-55184 / DoS + ソース露出: <https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components>

**Vue**
- CVE-2024-6783 — プロトタイプ汚染による XSS（`staticClass`/`staticStyle`）: <https://www.cve.news/cve-2024-6783/>
- vue-i18n CVE-2025-27597 — プロトタイプ汚染: <https://github.com/intlify/vue-i18n/security/advisories/GHSA-9r9m-ffp6-9x4v>

**Svelte / SvelteKit**
- CVE-2026-27121 — SSR スプレッド属性 XSS（イベントハンドラ）: <https://github.com/sveltejs/svelte/security/advisories/GHSA-f7gr-6p89-r883>
- CVE-2026-27122 — `<svelte:element this={tag}>` タグインジェクション: <https://www.sentinelone.com/vulnerability-database/cve-2026-27122/>
- SvelteKit CVE-2025-32388 — 追跡される `searchParams` 経由の XSS: <https://github.com/advisories/GHSA-6q87-84jw-cjhp>
- SvelteKit CVE-2026-22803 / adapter-node — Host ヘッダ SSRF、および devalue DoS: <https://svelte.dev/blog/cves-affecting-the-svelte-ecosystem>

**Solid**
- CVE-2025-27109 — SSR での未エスケープ JSX フラグメントによる XSS: <https://github.com/solidjs/solid/security/advisories/GHSA-3qxh-p7jc-5xh6>
- SolidJS セキュリティガイド（属性エスケープ / innerHTML）: <https://docs.solidjs.com/solid-start/guides/security>
