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
  onCleanup,
  createContext,
  useContext,
  jsx,
} from "@kanabun/core";
import type { Accessor, JSXChild } from "@kanabun/core";
import { parsePath, matchPath } from "./location";
import type { RouterLocation, RouteParams } from "./location";
import { createBrowserSource } from "./source";
import type { RouterSource } from "./source";

/** Options for a programmatic navigation. */
export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
}

/** Imperatively navigate to `to`. Returned by {@link useNavigate}. */
export type Navigate = (to: string, options?: NavigateOptions) => void;

interface RouterContextValue {
  location: Accessor<RouterLocation>;
  navigate: Navigate;
}

// The router context (a location accessor + navigate), and a nested route
// context carrying the matched params so descendants can read `useParams()`.
const RouterContext = createContext<RouterContextValue | null>(null);
const RouteContext = createContext<Accessor<RouteParams> | null>(null);

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
    if (options?.replace) source.replace(to);
    else source.push(to);
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
 * Render content while `path` matches the current location. Like `<Show>`, the
 * match is memoized to a boolean, so content is built once on match (and
 * disposed on mismatch) while the params still update reactively underneath.
 */
export function Route(props: RouteProps): () => JSXChild {
  const { location } = useRouter("<Route>");
  const matched = computed(() => matchPath(props.path, location().pathname));
  const isMatched = computed(() => matched() !== null);
  const params: Accessor<RouteParams> = () => matched() ?? EMPTY_PARAMS;

  // Build the content *inside* the route context, so the component (and any
  // descendants) can read `useParams()`, and pass the accessor directly too.
  const content = () =>
    RouteContext.Provider({
      value: params,
      children: () => {
        if (props.component !== undefined) return props.component({ params });
        if (typeof props.children === "function") {
          return (props.children as (p: Accessor<RouteParams>) => unknown)(params);
        }
        return props.children;
      },
    });

  return () =>
    (isMatched() ? content() : (props.fallback ?? null)) as JSXChild;
}

export interface LinkProps {
  /** Destination path (e.g. `/users/42`). */
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

  // Pass every prop through to the anchor except our own (`replace`), with our
  // click handler wrapping any user-supplied one.
  const attrs: Record<string, unknown> = {};
  for (const key in props) {
    if (key === "replace" || key === "onClick") continue;
    attrs[key] = props[key];
  }
  attrs.onClick = handleClick;
  return jsx("a", attrs) as JSXChild;
}
