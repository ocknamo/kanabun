// The typed `<Island>` bound to the declared map — `name` is checked against the
// registered islands at compile time.
import { Island } from "./islands";

/**
 * A mostly static page with two interactive islands. The heading and paragraphs
 * are plain server-rendered HTML — they ship and run no client JS. Only the two
 * `<Island name="Counter">` boundaries hydrate on the client (each independently,
 * with its own `start` passed as JSON).
 */
export function App() {
  return (
    <main style={{ "font-family": "system-ui, sans-serif", "max-width": "40rem" }}>
      <h1>kanabun islands</h1>
      <p>
        This text is static server-rendered HTML — no client JavaScript runs for
        it. Only the counters below are <em>islands</em>: they hydrate on the
        client and become interactive.
      </p>
      <Island name="Counter" props={{ start: 0 }} />
      <p>Another static paragraph sitting between two independent islands.</p>
      <Island name="Counter" props={{ start: 100 }} />
      <p>A different island type — its own code-split chunk:</p>
      <Island name="Clock" props={{ label: "time" }} />
    </main>
  );
}
