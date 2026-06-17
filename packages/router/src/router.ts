/**
 * kanabun/router — components & hooks
 * ------------------------------------------------------------------
 * The reactive surface: `<Router>` provides a location signal over the owner
 * tree (reusing core's `context`); `<Route>` shows content while its pattern
 * matches; `<Link>` is an `<a>` that navigates without a full reload. Hooks
 * (`useNavigate` / `useLocation` / `useParams`) read the nearest provider.
 *
 * Everything rides the existing conventions — signals, the owner tree, and the
 * "functions are lazy" rule `<Show>`/`<For>` use — so there is no new machinery
 * and no compiler.
 */
import {
  signal,
  computed,
  createRoot,
  onCleanup,
  createContext,
  useContext,
  jsx,
} from "@kanabun/core";
import type { Accessor, JSXChild } from "@kanabun/core";
import { parsePath, matchRoute, resolvePath } from "./location";
import type { RouterLocation, RouteParams } from "./location";
import { createBrowserSource } from "./source";
import type { RouterSource } from "./source";

/** Options for a programmatic navigation. */
export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
}

/**
 * Imperatively navigate to `to` (an absolute path like `/users/42`, or a path
 * relative to the current location like `edit` / `../list`). Returned by
 * {@link useNavigate}.
 */
export type Navigate = (to: string, options?: NavigateOptions) => void;

interface RouterContextValue {
  location: Accessor<RouterLocation>;
  navigate: Navigate;
}

// The router context (a location accessor + navigate), and a nested route
// context carrying the matched params so descendants can read `useParams()`.
const RouterContext = createContext<RouterContextValue | null>(null);
const RouteContext = createContext<Accessor<RouteParams> | null>(null);
// The pathname a nested `<Route>` should match against: the leftover a matched
// ancestor (a `*`-wildcard "layout" route) didn't consume. `null` at the top
// level, where routes match the full pathname. This is what makes routing
// **nested** — see `decisions.md` "Nested routing (Phase 6)".
const RelPathContext = createContext<Accessor<string> | null>(null);

// A single shared "no params" object, so reads outside a match return a stable
// reference (a fresh `{}` each time would re-trigger any dependent computation).
const EMPTY_PARAMS: RouteParams = Object.freeze({}) as RouteParams;

function useRouter(api: string): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (ctx === null) {
    throw new Error(`kanabun/router: ${api} must be used inside a <Router>.`);
  }
  return ctx;
}

export interface RouterProps {
  /** History backend. Defaults to the browser history ({@link createBrowserSource}). */
  source?: RouterSource;
  /**
   * A **function** child (the "functions are lazy" convention), so routes
   * inside can read the router context: `<Router>{() => <App />}</Router>`.
   */
  children: unknown;
}

/**
 * Provide routing to a subtree. Owns a signal tracking the current path (driven
 * by the {@link RouterSource}), exposes it as a reactive location, and tears the
 * subscription down with its owner.
 */
export function Router(props: RouterProps): JSXChild {
  const source = props.source ?? createBrowserSource();
  const path = signal(source.location());
  onCleanup(source.subscribe(() => path.set(source.location())));

  const location = computed(() => parsePath(path()));
  const navigate: Navigate = (to, options) => {
    // Resolve relative targets (`edit`, `../x`, `?q`) against the current path,
    // exactly as a browser would — so `navigate("edit")` and `<Link href="edit">`
    // mean the same thing regardless of the history source. Absolute paths pass
    // through unchanged.
    const target = resolvePath(to, location().pathname);
    if (options?.replace) source.replace(target);
    else source.push(target);
    path.set(source.location());
  };

  return RouterContext.Provider({
    value: { location, navigate },
    children: props.children,
  }) as JSXChild;
}

/** The reactive current location. Throws if used outside a `<Router>`. */
export function useLocation(): Accessor<RouterLocation> {
  return useRouter("useLocation").location;
}

/** The imperative navigate function. Throws if used outside a `<Router>`. */
export function useNavigate(): Navigate {
  return useRouter("useNavigate").navigate;
}

/**
 * The matched params of the nearest enclosing `<Route>` (reactive). Returns an
 * empty object when read outside any matched route.
 */
export function useParams(): Accessor<RouteParams> {
  const params = useContext(RouteContext);
  return params ?? (() => EMPTY_PARAMS);
}

export interface RouteProps {
  /** Pattern to match against the current pathname (see {@link matchPath}). */
  path: string;
  /** A component rendered while matched; it receives the params accessor. */
  component?: (props: { params: Accessor<RouteParams> }) => unknown;
  /**
   * Content shown while matched: either plain children, or a function of the
   * params accessor — `{(params) => <User id={params().id} />}`.
   */
  children?: unknown;
  /** Content shown while the route does *not* match (default: nothing). */
  fallback?: unknown;
}

/**
 * The value a `<Route>` returns: a thunk you can drop straight into the tree
 * (it renders its content while matched, else its `fallback`) that *also*
 * carries its match state and a content factory. Standalone use only ever calls
 * the thunk; an enclosing `<Routes>` reads the `$`-prefixed fields instead to
 * pick a single route exclusively.
 */
export interface RouteHandle {
  /** Whether this route currently matches the location (memoized boolean). */
  readonly $matched: Accessor<boolean>;
  /** Build the route's content (inside its route context). */
  readonly $content: () => JSXChild;
}
export type RouteThunk = (() => JSXChild) & RouteHandle;

/**
 * Render content while `path` matches the current location. Like `<Show>`, the
 * match is memoized to a boolean, so content is built once on match (and
 * disposed on mismatch) while the params still update reactively underneath.
 *
 * Used standalone, a `<Route>` renders independently. Wrapped in `<Routes>`, the
 * routes become mutually exclusive (first match wins, with a shared fallback).
 *
 * **Nesting:** give a route a `*`-wildcard tail (`path="/users/*"`) to make it a
 * *layout* that matches a prefix; its content can render a nested `<Routes>` /
 * `<Route>`, which match against the leftover path and inherit its params. No
 * `<Outlet>` is needed — the nested router *is* the outlet, placed wherever the
 * layout wants it.
 */
export function Route(props: RouteProps): RouteThunk {
  const { location } = useRouter("<Route>");
  // Match against the relative path a matched ancestor left us (nested), or the
  // full pathname at the top level. Captured params merge with the ancestor's,
  // so a descendant `useParams()` sees the whole chain (`{ org, id }`).
  const parentParams = useContext(RouteContext);
  const relPath = useContext(RelPathContext);
  const base: Accessor<string> = relPath ?? (() => location().pathname);

  const matched = computed(() => matchRoute(props.path, base()));
  const isMatched = computed(() => matched() !== null);
  const params = computed<RouteParams>(() => {
    const local = matched()?.params ?? EMPTY_PARAMS;
    // Top level: hand back `local` directly (keeping the stable empty reference
    // for unmatched reads). Nested: merge the ancestor's params underneath.
    return parentParams === null ? local : { ...parentParams(), ...local };
  });
  // What a matched `*`-wildcard route leaves for its nested routes (`"/"` else).
  const rest: Accessor<string> = () => matched()?.rest ?? "/";

  // Build the content *inside* the route context, so the component (and any
  // descendants) can read `useParams()`, and pass the accessor directly too.
  // A second provider hands nested routes the leftover path to match against.
  const content = (): JSXChild =>
    RouteContext.Provider({
      value: params,
      children: () =>
        RelPathContext.Provider({
          value: rest,
          children: () => {
            if (props.component !== undefined) return props.component({ params });
            if (typeof props.children === "function") {
              return (props.children as (p: Accessor<RouteParams>) => unknown)(params);
            }
            return props.children;
          },
        }),
    }) as JSXChild;

  // Standalone use renders/​disposes its own content as the match toggles.
  const slot = disposableSlot();
  const thunk = (() => {
    if (isMatched()) return slot(content);
    slot(null); // matched → unmatched: tear the content down
    return (props.fallback ?? null) as JSXChild;
  }) as RouteThunk;
  // A function can carry properties: expose the match state so an enclosing
  // <Routes> can select this route without rendering it independently.
  (thunk as { $matched: Accessor<boolean> }).$matched = isMatched;
  (thunk as { $content: () => JSXChild }).$content = content;
  return thunk;
}

/**
 * A render slot that owns one piece of content at a time: each call disposes the
 * previously-built content's reactive root before building the next (and on the
 * owner's teardown). `null` clears the slot. This is what makes a route switch —
 * in `<Route>` or `<Routes>` — dispose the route it leaves, rather than leaking
 * it onto the (stable) Router owner the context wrap runs under.
 */
function disposableSlot(): (produce: (() => JSXChild) | null) => JSXChild {
  let dispose: (() => void) | null = null;
  onCleanup(() => dispose?.());
  return (produce) => {
    if (dispose !== null) {
      dispose();
      dispose = null;
    }
    if (produce === null) return null;
    let view!: JSXChild;
    dispose = createRoot((d) => {
      view = produce();
      return d;
    });
    return view;
  };
}

export interface RoutesProps {
  /** Content shown when no child `<Route>` matches — the natural home for a 404. */
  fallback?: unknown;
  /**
   * One or more `<Route>` elements. **Only `<Route>` children are rendered** —
   * any other element placed directly inside `<Routes>` is ignored (put shared
   * chrome like a `<nav>` outside `<Routes>`).
   */
  children: unknown;
}

function isRouteHandle(value: unknown): value is RouteThunk {
  return typeof value === "function" && "$matched" in (value as object);
}

/** Flatten children (arrays/fragments) down to the `<Route>` handles among them. */
function collectRoutes(value: unknown, out: RouteThunk[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRoutes(item, out);
  } else if (isRouteHandle(value)) {
    out.push(value);
  }
}

/**
 * Exclusive routing: render the **first** child `<Route>` that matches the
 * current location, or `fallback` when none do. Switching the selected route
 * disposes the previous one (via the owner tree), while params keep updating
 * reactively as long as a route stays selected. A child `<Route>`'s own
 * `fallback` is unused here — `<Routes>` owns the unmatched case.
 *
 * Only `<Route>` children participate; any other element placed directly inside
 * is ignored, so keep shared chrome (nav, headings) outside `<Routes>`.
 */
export function Routes(props: RoutesProps): () => JSXChild {
  const routes: RouteThunk[] = [];
  collectRoutes(props.children, routes);
  const slot = disposableSlot();
  return () => {
    for (const route of routes) {
      if (route.$matched()) return slot(route.$content);
    }
    slot(null); // no match: tear down the previously selected route
    return (props.fallback ?? null) as JSXChild;
  };
}

export interface LinkProps {
  /**
   * Destination path. Absolute (`/users/42`) or **relative to the current
   * location** (`edit`, `./edit`, `../list`, `?tab=bio`), resolved with the same
   * semantics a browser uses for an `<a href>`. External/scheme hrefs
   * (`https:`, `mailto:`, `//host`) are left to the browser untouched.
   */
  href: string;
  /** Replace the current history entry instead of pushing. */
  replace?: boolean;
  /** Any other props (class, children, target, onClick, …) pass to the `<a>`. */
  [key: string]: unknown;
}

// A link is an *external* navigation (let the browser handle it) when the href
// carries a scheme (`mailto:`, `https:`) or is protocol-relative (`//host`).
function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/**
 * An `<a>` that navigates client-side. A plain left-click is intercepted and
 * routed through {@link useNavigate}; modified clicks, non-left buttons,
 * `target` other than `_self`, and external/Mailto links fall through to the
 * browser's default behaviour.
 */
export function Link(props: LinkProps): JSXChild {
  const navigate = useNavigate();
  const location = useLocation();

  const handleClick = (event: MouseEvent): void => {
    const onClick = props.onClick;
    if (typeof onClick === "function") (onClick as (e: MouseEvent) => void)(event);
    if (
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      (props.target === undefined || props.target === "_self") &&
      !isExternal(props.href)
    ) {
      event.preventDefault();
      navigate(props.href, { replace: props.replace });
    }
  };

  // Pass every prop through to the anchor except our own (`replace`, `href`),
  // with our click handler wrapping any user-supplied one.
  const attrs: Record<string, unknown> = {};
  for (const key in props) {
    if (key === "replace" || key === "onClick" || key === "href") continue;
    attrs[key] = props[key];
  }
  attrs.onClick = handleClick;
  // The rendered `href` is the *resolved* absolute path (so middle-click, copy
  // link, and the no-JS fallback all behave), and stays reactive for a relative
  // href whose meaning shifts as the location changes. External hrefs are left
  // verbatim — resolving would strip their origin.
  attrs.href = isExternal(props.href)
    ? props.href
    : () => resolvePath(props.href, location().pathname);
  return jsx("a", attrs) as JSXChild;
}
