---
name: snapshot
description: >
  examples/<name> の Bun dev サーバー(HTML エントリ)を起動し、playwright で PC と
  モバイル両 viewport のスクリーンショットを撮影してユーザーに送る。UI / スタイル変更後の
  見た目確認や、before/after の証跡が必要なときに使う。
  オプションでルート以外のパス指定や、特定セレクタの computed style 検査も可能。
  「スクショ撮って」「見た目確認したい」「CSS 反映されてる？」等で起動。
---

# UI Snapshot Skill

## 用途

`examples/` 配下のサンプル(`counter` / `todomvc`)の UI を視覚的に確認する。
test/build がグリーンでもレイアウト崩れやスコープド CSS の反映漏れは検出できないため、
レイアウト・スタイル変更時は本スキルで実画を確認する。

## 手順

### 1. dev サーバーを起動

kanabun は Bun 1.3+ の HTML エントリ dev サーバーで配信する(別途バンドル不要、TSX は
オンザフライでバンドルされる)。対象サンプルを選んで:

```bash
cd /home/user/kanabun && bun examples/counter/index.html   # または todomvc
```

`run_in_background: true` で起動し、出力ファイルパスを記録。

### 2. ready を待つ

```bash
until grep -q "url: http://localhost" <output_file>; do sleep 0.5; done
```

`url: http://localhost:3000/` が出たら準備完了(既定ポートは 3000)。

### 3. playwright スクリプトを実行

playwright は `/opt/node22/lib/node_modules/playwright` にグローバル配置されているため、
CommonJS で絶対パス require する必要がある(実行は `node`、Bun ではない)。
スクリプトは `/tmp/snapshot.cjs` に書く:

```javascript
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const url = process.env.SNAP_URL || 'http://localhost:3000/';
  const viewports = [
    { name: 'pc', width: 1280, height: 900 },
    { name: 'mobile', width: 375, height: 800 },
  ];
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `/tmp/snap-${vp.name}.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log('done');
})();
```

実行:

```bash
node /tmp/snapshot.cjs
```

### 4. ユーザーに送る

`SendUserFile` で `/tmp/snap-pc.png` と `/tmp/snap-mobile.png` を送る。
caption に「PC (1280px) / モバイル (375px)」のように viewport を明記。

### 5. dev サーバーを停止

```bash
kill %1 2>/dev/null  # または ps + kill <pid>
```

バックグラウンドプロセスの ID は Bash 起動時に表示される。

## オプション: computed style 検査(スコープド CSS の反映確認)

スタイルが効いていない疑いがあるときは、viewport ごとに対象セレクタの bounding box と
computed style を dump すると有効。`css` ヘルパーが注入する `.k-*` クラスが要素に付き、
期待した値が computed style に出ているかを確認できる。`/tmp/inspect.cjs`:

```javascript
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(process.env.SNAP_URL || 'http://localhost:3000/');
  await page.waitForLoadState('networkidle');
  const dump = async (sel, label) => {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        className: el.className,           // 注入された .k-* が付いているか
        width: Math.round(rect.width),
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        background: cs.backgroundColor,
      };
    }, sel);
    console.log(label + ':', JSON.stringify(r));
  };
  await dump('button', 'button');
  await dump('.count', 'count');
  await browser.close();
})();
```

`background` や `borderRadius` が既定値のままなら `<style>` の注入漏れ・クラス不一致を疑う。
注入された `<style>` 自体は `document.head` の `style[data-k]` を dump して検証できる。

## 注意

- 既に dev サーバーが起動中ならポートが競合する。起動前に
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` で 200 が返るなら起動済み。
- スクショは `fullPage: true` 推奨。スクロール下のレイアウトも捕捉できる。
- 認証や特定状態が必要なら `page.evaluate` で localStorage を設定するか
  `page.click` で UI 経由でセットアップしてから screenshot を撮る。
- 撮影後は必ず dev サーバーを停止。長時間放置するとポート 3000 を占有し続ける。
