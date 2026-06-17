import { hydrate } from "@kanabun/core";
import { App } from "./app";

// Client entry: take over the server-rendered markup and make it interactive.
// `hydrate` clears the server HTML and mounts the live reactive tree in place
// (see `docs/decisions.md` → "SSR, hydration & SSG" for why it doesn't adopt
// the existing nodes in this compiler-less, eager runtime).
const root = document.getElementById("app");
if (root) hydrate(() => <App />, root);
