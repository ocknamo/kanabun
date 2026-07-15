# @kanabun/router

A history-based, signal-driven router for
[kanabun](https://github.com/ocknamo/kanabun). Built entirely on
`@kanabun/core`'s signals + owner-tree context, with **zero runtime
dependencies** (standard Web APIs only). No virtual DOM, no compiler.

## Install

```sh
bun add @kanabun/router @kanabun/core
```

`@kanabun/core` is a peer dependency.

## Usage

```tsx
import { Router, Routes, Route, Link } from "@kanabun/router";

function App() {
  return (
    <Router>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
      </nav>
      <Routes>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
      </Routes>
    </Router>
  );
}
```

## What's inside

Components (`Router`, `Routes`, `Route`, `Link`), hooks (`useNavigate`,
`useLocation`, `useParams`), pluggable sources (`createBrowserSource`,
`createHashSource`, `createMemorySource`), and path matching helpers
(`matchPath`, `matchRoute`, `resolvePath`).

## License

MIT
