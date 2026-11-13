/**
 * Small path helpers shared across the CLI's build/generate/serve commands.
 */
import { isAbsolute, join, relative } from "node:path";

/**
 * Where `dev` and `preview` listen unless told otherwise. Loopback only: they
 * hand out the project's files to whoever can reach them. An address, not
 * `localhost`: where that resolves to `::1` first, Bun binds IPv6 alone and a
 * client trying `127.0.0.1` is refused. Browsers asked for `localhost` fall back.
 */
export const DEFAULT_DEV_HOST = "127.0.0.1";

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
