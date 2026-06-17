import { hydrate } from "@kanabun/core";
import { App } from "./app";

// Client entry, bundled by `kanabun generate` and referenced from every page.
// `hydrate` clears the prerendered markup and mounts the live reactive tree in
// its place (same bytes, no flash; see `docs/decisions.md` → "SSR, hydration &
// SSG"). The route comes from the URL the static file was served at.
const root = document.getElementById("app");
if (root) hydrate(() => <App path={location.pathname} />, root);
