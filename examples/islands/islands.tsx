import { defineIslands } from "@kanabun/core";
import { Counter } from "./counter";
import { Clock } from "./clock";

// Declare the islands as a typed map and export the bound `<Island>` /
// `hydrateIslands`. Because the keys are known at compile time, `<Island name>`
// only accepts a registered name ("Counter" / "Clock") — a typo is a build error,
// not a runtime surprise — and `props` is checked against the component. The
// server render imports this for `<Island>`; the per-island split build
// (`build-split.ts`) maps the same names to code-split chunks.
export const { Island, hydrateIslands } = defineIslands({ Counter, Clock });
