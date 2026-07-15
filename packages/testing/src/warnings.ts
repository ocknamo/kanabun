/**
 * Capture kanabun's dev-time warnings in a test. Installs a collecting sink
 * via core's `setWarnHandler` and returns the (live) array the messages land
 * in, so the console stays clean. The sink stays installed until the caller
 * restores the default with `setWarnHandler(null)` — this package registers
 * no test-runner hooks (it never imports `bun:test`), so cleanup is wired by
 * the caller, like `installDOM`'s teardown.
 *
 * Note that core deduplicates warnings for the *process* (each message fires
 * at most once), and that memory is out of this helper's reach — a warning
 * already seen in an earlier test won't be captured again.
 */
import { setWarnHandler } from "@kanabun/core";

export function captureWarnings(): string[] {
  const messages: string[] = [];
  setWarnHandler((message) => messages.push(message));
  return messages;
}
