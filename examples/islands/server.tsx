/**
 * The islands SSR server. Run it with:
 *
 *     bun examples/islands/server.tsx
 *     # open http://localhost:3000 (or $PORT)
 *
 * `serve` renders <App/> per request — a mostly static page in which only the
 * `<Island>` boundaries carry a `data-island` wrapper — and ships the client
 * bundle, whose `hydrateIslands` call makes only those islands interactive; the
 * static shell runs no JS. This variant ships one bundle with every island's
 * code; compare with `serve-split.ts`, which builds a chunk per island.
 */
import { serve } from "@kanabun/cli";
import { App } from "./app";

const server = await serve(
  { render: () => <App />, client: "./main.tsx", title: "kanabun islands" },
  { dir: import.meta.dir },
);
console.log(`islands example on ${server.url}`);
