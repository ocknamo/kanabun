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
 * The precise tuple {@link splitProps} returns: one `Pick` per key group (in
 * order), then a trailing `Omit` with every un-taken key. Built by mapping over
 * the key-group tuple `K`, so `splitProps(props, ["a"], ["b", "c"])` is typed
 * `[Pick<T,"a">, Pick<T,"b"|"c">, Omit<T,"a"|"b"|"c">]`.
 */
export type SplitProps<T, K extends ReadonlyArray<ReadonlyArray<keyof T>>> = [
  ...{ [I in keyof K]: Pick<T, Extract<K[I][number], keyof T>> },
  Omit<T, Extract<K[number][number], keyof T>>,
];

/**
 * Split `props` into one object per key group, plus a trailing "rest" object
 * with everything not taken. Each piece forwards to `props` via getters, so
 * values stay reactive (e.g. `const [local, rest] = splitProps(props,
 * ["class"])`). The *key set* of each piece is fixed at call time (values are
 * live, but keys added to `props` afterwards are not reflected).
 *
 * The return type is a precise tuple — `Pick` per group then `Omit` for the
 * rest (see {@link SplitProps}) — so each destructured piece carries exactly the
 * keys it holds. The `const` key-group inference is what makes the literal keys
 * survive into the type.
 */
export function splitProps<
  T extends PropRecord,
  const K extends ReadonlyArray<ReadonlyArray<keyof T>>,
>(props: T, ...keyGroups: K): SplitProps<T, K> {
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
  return groups as unknown as SplitProps<T, K>;
}
