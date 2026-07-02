/**
 * The SSR example server. Run it with:
 *
 *     bun examples/ssr/server.tsx
 *     # open http://localhost:3000 (or $PORT)
 *
 * `serve` (from `@kanabun/cli`) owns the Bun plumbing — it bundles the client
 * entry once, renders <App/> to HTML per request (`renderToString`) with the
 * collected scoped-CSS inlined into <head>, and ships the bundle so `hydrate`
 * makes the page interactive. The config mirrors the SSG one (`examples/ssg`),
 * which runs the same render at build time instead.
 */
import { serve } from "@kanabun/cli";
import { App } from "./app";

const server = await serve(
  { render: () => <App />, client: "./main.tsx", title: "kanabun SSR" },
  { dir: import.meta.dir },
);
console.log(`SSR example on ${server.url}`);
