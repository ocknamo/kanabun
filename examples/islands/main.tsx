// The `hydrateIslands` bound to the same typed map the server used.
import { hydrateIslands } from "./islands";

// Client entry: scan the page for `[data-island]` wrappers and hydrate only
// those. Everything outside an island is left as the static server markup and
// never re-rendered. (The *payload* win — shipping only the islands' code — is a
// CLI bundle-splitting follow-up; this demonstrates the execution model.)
hydrateIslands();
