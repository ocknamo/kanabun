/**
 * kanabun — context (dependency injection over the owner tree)
 * ------------------------------------------------------------------
 * Provide a value at an owner scope with `<Ctx.Provider value={…}>` and read
 * the nearest provided value by walking up the owner tree with `useContext`.
 *
 * Split out from `reactive.ts`: the engine owns the graph and exposes the
 * owner-scope primitives (`createDependentScope`, `runUnderOwner`); here we
 * layer the DI API on top of them.
 */
import {
  ReactiveNode,
  currentOwner,
  createDependentScope,
  runUnderOwner,
} from "./reactive";

/**
 * A context handle created by {@link createContext}. Carry the value down the
 * tree with `<Ctx.Provider value={…}>` and read it back with
 * {@link useContext}. Like the rest of kanabun, this is runtime-only — there is
 * no compiler — so a Provider's children must be a **function** (a thunk), the
 * same "functions are lazy" convention `<Show>` uses:
 *
 *     <Ctx.Provider value={v}>{() => <App />}</Ctx.Provider>
 *
 * The thunk runs *after* the Provider has set the value, so descendants read
 * the provided value rather than the default. (Plain JSX children are evaluated
 * eagerly — before the Provider runs — and therefore only ever see the default.)
 */
export interface Context<T> {
  /** Unique key under which the value is stored on the owner tree. */
  readonly id: symbol;
  /** Returned by `useContext` when no Provider is found above the reader. */
  readonly defaultValue: T;
  /** Component that provides `value` to the descendants in its function child. */
  readonly Provider: (props: { value: T; children: unknown }) => unknown;
}

/**
 * Create a fresh owner scope that provides `value` under `id`. The scope is
 * owned by the enclosing owner, so it (and anything created under it) is
 * disposed when that owner is, and `useContext` reads find it by walking up.
 */
function createContextScope(id: symbol, value: unknown): ReactiveNode {
  const owner = createDependentScope();
  owner.context = { [id]: value };
  return owner;
}

/**
 * Create a context with a default value. Returns a handle whose `Provider`
 * supplies a value to descendants and whose value is read with `useContext`.
 *
 * @example
 *   const Theme = createContext("light");
 *   // provide:  <Theme.Provider value="dark">{() => <App />}</Theme.Provider>
 *   // consume:  const theme = useContext(Theme);
 */
export function createContext<T>(defaultValue: T): Context<T> {
  const id = Symbol("context");
  return {
    id,
    defaultValue,
    Provider(props) {
      // One owner scope, tied to the enclosing owner, holds the value.
      const owner = createContextScope(id, props.value);
      const children = props.children;
      const view = runUnderOwner(owner, () =>
        typeof children === "function" ? (children as () => unknown)() : children,
      );
      // A component child (e.g. `<For>`/`<Show>`) returns a thunk whose body
      // runs *later*, inside an `insert` effect created outside this scope. Wrap
      // it so every invocation re-enters the scope — otherwise those deferred
      // reads would walk an owner chain that misses the provided value.
      return typeof view === "function"
        ? () => runUnderOwner(owner, view as () => unknown)
        : view;
    },
  };
}

/**
 * Read the nearest provided value for `context`, walking up the owner tree from
 * the current scope. Returns the context's `defaultValue` if no Provider is
 * found above the caller. Call it while an owner is active (during a component's
 * synchronous render, or inside an effect/computed).
 */
export function useContext<T>(context: Context<T>): T {
  for (let o = currentOwner; o !== null; o = o.owner) {
    if (o.context !== null && context.id in o.context) {
      return o.context[context.id] as T;
    }
  }
  return context.defaultValue;
}
