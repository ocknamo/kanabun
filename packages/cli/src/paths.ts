/**
 * Small path helpers shared across the CLI's build/generate commands.
 */

/** Normalize a base path to a single leading and trailing slash (`/` ⇒ `/`). */
export function normalizeBase(base: string): string {
  const trimmed = base.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}
