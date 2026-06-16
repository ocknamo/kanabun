import { render, For, css } from "@kanabun/core";
import {
  Router,
  Routes,
  Route,
  Link,
  useParams,
  useLocation,
  createMemorySource,
} from "@kanabun/router";

// A handful of demo "users", looked up by the `:id` route param.
const users: Record<string, { name: string; bio: string }> = {
  "1": { name: "Ada Lovelace", bio: "Wrote the first algorithm." },
  "2": { name: "Alan Turing", bio: "Asked whether machines can think." },
  "3": { name: "Grace Hopper", bio: "Found the first literal bug." },
};

const shell = css`
  width: 100%;
  max-width: 32rem;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  padding: 1.25rem 1.5rem 1.5rem;

  h1 {
    margin: 0 0 0.75rem;
    font-size: 1.5rem;
    color: #b83f45;
  }

  nav {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
    border-bottom: 1px solid #eee;
    padding-bottom: 0.75rem;
  }

  nav a {
    text-decoration: none;
    color: #555;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #ddd;
  }

  nav a:hover {
    background: #f0f0f0;
  }

  .users-layout {
    display: flex;
    gap: 1rem;
  }

  .users {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 10rem;
  }

  .detail {
    flex: 1;
    border-left: 1px solid #eee;
    padding-left: 1rem;
    color: #555;
  }

  .crumbs {
    color: #999;
    font-size: 0.85rem;
    margin-top: 1rem;
  }
`;

function Home() {
  return <p>A tiny client-side router: signals + history, no reload.</p>;
}

function User() {
  const params = useParams();
  return (
    <div>
      {() => {
        const user = users[params().id];
        return user ? (
          <article>
            <h2>{user.name}</h2>
            <p>{user.bio}</p>
          </article>
        ) : (
          <p>No such user.</p>
        );
      }}
    </div>
  );
}

// A *layout* route: matched on the `/users/*` prefix, it keeps the master list
// mounted while a nested <Routes> swaps the detail pane. No <Outlet> — the
// nested router (inside this layout's own element) *is* the outlet.
function UsersLayout() {
  return (
    <div class="users-layout">
      <ul class="users">
        <For each={() => Object.keys(users)}>
          {(id) => (
            <li>
              <Link href={`/users/${id}`}>{users[id]!.name}</Link>
            </li>
          )}
        </For>
      </ul>
      <div class="detail">
        <Routes fallback={<p>Pick a person.</p>}>
          <Route path="/:id" children={() => <User />} />
        </Routes>
      </div>
    </div>
  );
}

function Crumbs() {
  const location = useLocation();
  return <p class="crumbs">at {() => location().pathname}</p>;
}

function App() {
  return (
    <div class={shell}>
      <h1>kanabun router</h1>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/users">Users</Link>
        <Link href="/oops">Broken link</Link>
      </nav>

      <Routes fallback={<p>404 — nothing here.</p>}>
        <Route path="/" children={<Home />} />
        <Route path="/users/*" component={() => <UsersLayout />} />
      </Routes>

      <Crumbs />
    </div>
  );
}

// Use an in-memory history so the example runs anywhere (incl. file://) without
// touching the address bar. In a real app, omit `source` for the browser
// history, or use `createHashSource()` for static hosts like GitHub Pages (deep
// links/refreshes work with no server rewrites).
const source = createMemorySource("/");

const root = document.getElementById("app");
if (root) render(() => <Router source={source}>{() => <App />}</Router>, root);
