/**
 * kanabun — ecosystem primitives demo
 * ------------------------------------------------------------------
 * One small page exercising the four Phase 7 primitives, each in the situation
 * it's actually for:
 *
 *   <Dynamic>   — pick the rendered tag at runtime (a heading-level selector)
 *   <Portal>    — a modal that escapes the card's overflow / stacking context
 *   lazy()      — load a heavy panel's code only when it's first shown
 *   <Head>/<Title> — drive the browser tab title + <meta> from app state
 *
 * Run it with `kanabun dev examples/primitives` (or build main.tsx). Open the
 * browser tab, the Network panel, and try each card.
 */
import {
  render,
  signal,
  css,
  Show,
  Suspense,
  Dynamic,
  Portal,
  Head,
  Title,
  lazy,
} from "@kanabun/core";

// Code-split: this import() becomes its own chunk, fetched on first render.
const LazyPanel = lazy(() => import("./lazy-panel"));

// ── styles ───────────────────────────────────────────────────────
const shell = css`
  width: 100%;
  max-width: 34rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;

  h1 {
    margin: 0;
    font-size: 1.5rem;
    color: #b83f45;
  }
`;

const card = css`
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  padding: 1rem 1.25rem 1.25rem;
  /* A clipping context, to prove <Portal> escapes it. */
  overflow: hidden;

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    color: #333;
  }

  .hint {
    margin: 0 0 0.75rem;
    color: #888;
    font-size: 0.85rem;
  }

  label {
    font-size: 0.9rem;
    color: #555;
    margin-right: 0.5rem;
  }

  select,
  input,
  button {
    font: inherit;
    padding: 0.35rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #ccc;
  }

  button {
    cursor: pointer;
    background: #b83f45;
    color: #fff;
    border-color: #b83f45;
  }

  input {
    width: 16rem;
    max-width: 100%;
  }

  .preview {
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px dashed #eee;
  }
  .preview :where(h1, h2, h3) {
    margin: 0;
    color: #234;
  }
`;

const modalStyles = css`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);

  .dialog {
    background: #fff;
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    max-width: 22rem;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  }
  .dialog h3 {
    margin: 0 0 0.5rem;
  }
  .dialog p {
    margin: 0 0 1rem;
    color: #555;
  }
`;

// ── 1. <Dynamic>: choose the rendered tag at runtime ──────────────
function DynamicCard() {
  const level = signal(1);
  return (
    <section class={card}>
      <h2>&lt;Dynamic&gt;</h2>
      <p class="hint">
        Render a tag chosen at runtime — here the heading level. No switch
        statement; the host swaps reactively.
      </p>
      <label for="lvl">Heading level</label>
      <select
        id="lvl"
        onChange={(e) => level.set(Number((e.target as HTMLSelectElement).value))}
      >
        <option value="1">h1</option>
        <option value="2">h2</option>
        <option value="3">h3</option>
      </select>
      <div class="preview">
        <Dynamic component={() => `h${level()}`}>
          {() => `This is an <h${level()}>`}
        </Dynamic>
      </div>
    </section>
  );
}

// ── 2. <Portal>: a modal that escapes the card's overflow ─────────
function PortalCard() {
  const open = signal(false);
  return (
    <section class={card}>
      <h2>&lt;Portal&gt;</h2>
      <p class="hint">
        This card clips its overflow, yet the modal covers the whole screen — it
        renders into &lt;body&gt; while staying owned here (close it and it's
        gone, no leak).
      </p>
      <button onClick={() => open.set(true)}>Open modal</button>

      <Show when={open}>
        {() => (
          <Portal>
            <div class={modalStyles} onClick={() => open.set(false)}>
              <div class="dialog" onClick={(e) => e.stopPropagation()}>
                <h3>I escaped the card 🎉</h3>
                <p>
                  Rendered at document.body, but disposed with the component
                  that opened me.
                </p>
                <button onClick={() => open.set(false)}>Close</button>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </section>
  );
}

// ── 3. lazy(): load a heavy panel's code on demand ────────────────
function LazyCard() {
  const shown = signal(false);
  return (
    <section class={card}>
      <h2>lazy()</h2>
      <p class="hint">
        The panel's code lives in a separate chunk (watch the Network tab). It
        loads on first show; &lt;Suspense&gt; covers the wait.
      </p>
      <button onClick={() => shown.set(true)}>Load the panel</button>
      <Show when={shown}>
        {() => (
          <Suspense fallback={<p class="hint">loading chunk…</p>}>
            {() => <LazyPanel />}
          </Suspense>
        )}
      </Show>
    </section>
  );
}

// ── 4. <Head>/<Title>: drive the tab title + meta from state ──────
function HeadCard() {
  const title = signal("kanabun — primitives");
  return (
    <section class={card}>
      <h2>&lt;Head&gt; / &lt;Title&gt;</h2>
      <p class="hint">
        Type below and watch the browser tab update. On SSR/SSG this same markup
        lands in the served &lt;head&gt; (SEO).
      </p>
      <input
        value={() => title()}
        onInput={(e) => title.set((e.target as HTMLInputElement).value)}
      />

      <Title>{() => title()}</Title>
      <Head>
        <meta name="description" content={() => `Demo — ${title()}`} />
      </Head>
    </section>
  );
}

function App() {
  return (
    <div class={shell}>
      <h1>kanabun — ecosystem primitives</h1>
      <DynamicCard />
      <PortalCard />
      <LazyCard />
      <HeadCard />
    </div>
  );
}

const root = document.getElementById("app");
if (root) render(() => <App />, root);
