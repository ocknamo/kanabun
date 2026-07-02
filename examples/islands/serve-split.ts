/**
 * The per-island split, end to end:
 *
 *     bun examples/islands/serve-split.ts   # http://localhost:3020 (or $PORT)
 *
 * The `islands` map (instead of a single `client`) makes `serve` code-split the
 * islands into per-island chunks + a bootstrap (`buildIslands`) and serve them
 * next to the SSR'd page. Open the network tab: the static shell loads
 * `islands.js`, which pulls in only the chunks for the islands on the page
 * (here `counter.js` and `clock.js`) — an island registered but absent would
 * never be fetched. Compare with `server.tsx`, which ships one bundle with
 * every island's code.
 */
import { serve } from "@kanabun/cli";
import { App } from "./app";

const server = await serve(
  {
    render: () => App(),
    islands: { Counter: "./counter.tsx", Clock: "./clock.tsx" },
    title: "kanabun islands (split)",
  },
  { dir: import.meta.dir, minify: false, port: Number(process.env.PORT) || 3020 },
);
console.log(`islands split preview on ${server.url}`);
