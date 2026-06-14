// CI-only tooling: turn the lcov report into a shields.io endpoint badge.
//
// Reads the line-coverage totals from `coverage/lcov.info`, computes the
// overall percentage, and writes a shields.io "endpoint" JSON to
// `badge/coverage.json`. CI publishes that JSON to the orphan `badges` branch,
// and the README points an <img.shields.io/endpoint> badge at its raw URL — so
// the coverage badge is self-hosted, with no external coverage service.
//
// This lives under scripts/ (a Bun-only CI helper), never in packages/core,
// which stays runtime-independent.

const LCOV_PATH = "coverage/lcov.info";
const OUT_PATH = "badge/coverage.json";

const lcov = await Bun.file(LCOV_PATH).text();

let found = 0;
let hit = 0;
for (const line of lcov.split("\n")) {
  // LF = lines found, LH = lines hit (one pair per source file in lcov).
  if (line.startsWith("LF:")) found += Number(line.slice(3));
  else if (line.startsWith("LH:")) hit += Number(line.slice(3));
}

if (found === 0) {
  // No LF/LH records means the lcov is empty/missing — bail rather than
  // publish a bogus "0%" badge.
  console.error(`No coverage data found in ${LCOV_PATH}`);
  process.exit(1);
}

const pct = (hit / found) * 100;
// One decimal place, but drop a trailing ".0" so 100.0 -> "100%".
const rounded = Math.round(pct * 10) / 10;
const message = `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;

// Match the colour ramp shields.io uses for its own coverage badges.
function color(p: number): string {
  if (p >= 95) return "brightgreen";
  if (p >= 90) return "green";
  if (p >= 80) return "yellowgreen";
  if (p >= 70) return "yellow";
  if (p >= 60) return "orange";
  return "red";
}

const badge = {
  schemaVersion: 1,
  label: "coverage",
  message,
  color: color(rounded),
};

await Bun.write(OUT_PATH, `${JSON.stringify(badge)}\n`);
console.log(`coverage: ${message} (${hit}/${found} lines) -> ${OUT_PATH}`);

export {};
