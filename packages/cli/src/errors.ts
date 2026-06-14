/**
 * Flatten an error into human-readable lines. `Bun.build` throws an
 * `AggregateError` whose own `message` collapses to a useless "Bundle failed";
 * the real diagnostics (e.g. "Could not resolve …") live in `.errors`.
 */
export function errorMessages(error: unknown): string[] {
  if (error instanceof AggregateError && Array.isArray(error.errors)) {
    return error.errors.map(String);
  }
  if (error instanceof Error) return [error.message];
  return [String(error)];
}
