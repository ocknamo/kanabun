import type { SSGConfig } from "@kanabun/cli";
import { App } from "./app";

/**
 * SSG config consumed by `kanabun generate examples/ssg/ssg.tsx`. Each route is
 * prerendered to `<outdir>/<route>/index.html`; `client` is bundled once and
 * referenced from every page so the static HTML hydrates into a live app.
 *
 *   bun packages/cli/bin/kanabun.ts generate examples/ssg/ssg.tsx --outdir /tmp/ssg
 */
const config: SSGConfig = {
  routes: ["/", "/about/"],
  title: "kanabun SSG",
  client: "./main.tsx",
  render: (path) => <App path={path} />,
};

export default config;
