import { hydrateIslands } from "@kanabun/core";
// The same registry the server used — so `hydrateIslands` resolves each
// `[data-island]` by name.
import "./islands";

// Client entry: scan the page for `[data-island]` wrappers and hydrate only
// those. Everything outside an island is left as the static server markup and
// never re-rendered. (The *payload* win — shipping only the islands' code — is a
// CLI bundle-splitting follow-up; this demonstrates the execution model.)
hydrateIslands();
