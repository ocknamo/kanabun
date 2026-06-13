/**
 * kanabun — prop helpers for component authors.
 *
 * Both helpers preserve reactivity: properties are defined as **forwarding
 * getters**, so reading a merged/split prop reads the live source value (and a
 * source whose prop is itself a getter stays reactive).
 */

type PropRecord = Record<string, unknown>;

type Spread<T extends unknown[]> = T extends [infer Head, ...infer Rest]
  ? (Head extends object ? Head : unknown) & Spread<Rest>
  : unknown;

/**
 * Merge prop objects left-to-right; later sources win. The result reads each
 * key live from the last source that defines it, so reactive props are kept.
 * `undefined`/`null` sources are ignored (handy for defaults).
 */
export function mergeProps<T extends Array<PropRecord | undefined | null>>(
  ...sources: T
): Spread<T> {
  const merged: PropRecord = {};
  // Walk sources in reverse so the first time we see a key it's the winning
  // (latest) source; the getter forwards to it, keeping the prop reactive.
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i];
    if (source == null) continue;
    for (const key of Object.keys(source)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) continue;
      Object.defineProperty(merged, key, {
        enumerable: true,
        configurable: true,
        get: () => source[key],
      });
    }
  }
  return merged as Spread<T>;
}

/**
 * Split `props` into one object per key group, plus a trailing "rest" object
 * with everything not taken. Each piece forwards to `props` via getters, so
 * reactivity is preserved (e.g. `const [local, rest] = splitProps(props,
 * ["class"])`).
 */
export function splitProps<T extends PropRecord>(
  props: T,
  ...keyGroups: Array<Array<keyof T>>
): Array<Partial<T>> {
  const taken = new Set<keyof T>();
  const forward = (target: Partial<T>, key: keyof T): void => {
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get: () => props[key],
    });
  };

  const groups: Array<Partial<T>> = keyGroups.map((keys) => {
    const piece: Partial<T> = {};
    for (const key of keys) {
      taken.add(key);
      if (key in props) forward(piece, key);
    }
    return piece;
  });

  const rest: Partial<T> = {};
  for (const key of Object.keys(props) as Array<keyof T>) {
    if (!taken.has(key)) forward(rest, key);
  }
  groups.push(rest);
  return groups;
}
