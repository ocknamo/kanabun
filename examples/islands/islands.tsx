import { registerIsland } from "@kanabun/core";
import { Counter } from "./counter";

// The island registry, imported by BOTH the server render (so `<Island>` can
// render the component into its wrapper) and the client entry (so
// `hydrateIslands` can resolve the same name). Importing this module for its
// side effect is all it takes.
registerIsland("Counter", Counter);
