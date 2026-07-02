/**
 * Preview the SSG output — and the harness the visual-regression lane points
 * at. `preview` (from `@kanabun/cli`) builds the site with `kanabun generate`
 * into a temp dir and serves it statically. Unlike the SSR example (which
 * renders per request), the pages here are prebuilt `.html` files.
 *
 *     bun examples/ssg/serve.ts   # http://localhost:3103 (or $PORT)
 */
import { preview } from "@kanabun/cli";

const server = await preview({
  entry: `${import.meta.dir}/ssg.tsx`,
  port: Number(process.env.PORT) || 3103,
  minify: false,
});
console.log(`SSG preview on ${server.url} (built to ${server.outdir})`);
