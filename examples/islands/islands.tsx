import { defineIslands } from "@kanabun/core";
import { Counter } from "./counter";

// Declare the islands as a typed map and export the bound `<Island>` /
// `hydrateIslands`. Because the keys are known at compile time, `<Island name>`
// only accepts a registered name ("Counter" here) — a typo is a build error, not
// a runtime surprise — and `props` is checked against the component. Import this
// module from BOTH the server render and the client entry.
export const { Island, hydrateIslands } = defineIslands({ Counter });
