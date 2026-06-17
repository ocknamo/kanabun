/**
 * A tiny SSR server for the example. Run it with:
 *
 *     bun examples/ssr/server.tsx
 *     # open http://localhost:3000
 *
 * It renders <App/> to an HTML string per request (`renderToString`), inlines
 * the collected scoped-CSS into <head>, and ships the client bundle that calls
 * `hydrate` to make the page interactive. (This is the SSR path; SSG would run
 * the same `renderToString` at build time and write the HTML to a file instead.)
 *
 * Bun-only (it's a server / build entry) — exactly the kind of code that lives
 * outside `packages/core`.
 */
import { renderToString } from "@kanabun/core";
import { App } from "./app";

const PORT = Number(process.env.PORT) || 3000;

async function clientBundle(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [new URL("./main.tsx", import.meta.url).pathname],
    target: "browser",
  });
  return await built.outputs[0]!.text();
}

function page(html: string, head: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8" />\n<title>kanabun SSR</title>\n${head}\n` +
    `</head>\n<body>\n<div id="app">${html}</div>\n` +
    `<script type="module" src="/main.js"></script>\n` +
    `</body>\n</html>\n`
  );
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/main.js") {
      return new Response(await clientBundle(), {
        headers: { "content-type": "text/javascript" },
      });
    }
    const { html, head } = renderToString(() => <App />);
    return new Response(page(html, head), {
      headers: { "content-type": "text/html" },
    });
  },
});

console.log(`SSR example on http://localhost:${PORT}`);
