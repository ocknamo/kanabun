/**
 * Small path helpers shared across the CLI's build/generate/serve commands.
 */
import { isAbsolute, join, relative } from "node:path";

/** Normalize a base path to a single leading and trailing slash (`/` ⇒ `/`). */
export function normalizeBase(base: string): string {
  const trimmed = base.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * Join `pathname` under `root` and return the absolute result, or `undefined`
 * when it escapes `root` (`join` normalizes any `..`, then the result must
 * still sit under `root`). The lexical containment check every static-file
 * path in the CLI goes through before touching the filesystem.
 */
export function resolveWithin(root: string, pathname: string): string | undefined {
  const filePath = join(root, pathname);
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return filePath;
}
