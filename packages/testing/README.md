# @kanabun/testing

First-party test helpers for [kanabun](https://github.com/ocknamo/kanabun)
apps: an in-memory DOM mock (the same one the core suite runs against) plus
render/query/event/flush utilities, so components can be unit-tested in any
JS runtime **without jsdom**. Zero dependencies, like everything kanabun.

## Install

```sh
bun add -d @kanabun/testing @kanabun/core
```

`@kanabun/core` is a peer dependency.

## Usage

```tsx
import { test, expect } from "bun:test";
import { renderTest, queryByTag, fireEvent, tick } from "@kanabun/testing";
import { signal } from "@kanabun/core";

test("increments on click", async () => {
  const count = signal(0);
  const { container } = renderTest(() => (
    <button onclick={() => count.update((n) => n + 1)}>{count}</button>
  ));

  const button = queryByTag(container, "button")!;
  fireEvent(button, "click");
  await tick();

  expect(button.textContent).toBe("1");
});
```

## What's inside

`renderTest`, an installable DOM mock (`installDOM`, `MockNode`,
`MockDocument`, `serialize`), query helpers (`queryByTag`, `queryById`,
`elements`, `walk`), plus event and flush utilities.

## License

MIT
