import { signal, onMount, onCleanup, css } from "@kanabun/core";

const clock = css`
  font: inherit;
  font-variant-numeric: tabular-nums;
  padding: 0.5rem 1rem;
  border: 1px solid #ccc;
  border-radius: 8px;
  background: #f0f7ff;
  display: inline-block;
`;

/**
 * A second, distinct island — proof the split is per-component: this lands in its
 * own chunk, downloaded only when a page contains a Clock island. It ticks on the
 * client (the server renders a single static timestamp).
 *
 * `label` arrives as JSON across the boundary, like every island prop.
 */
export function Clock(props: { label?: string }) {
  const now = signal(new Date().toLocaleTimeString());
  onMount(() => {
    const id = setInterval(() => now.set(new Date().toLocaleTimeString()), 1000);
    onCleanup(() => clearInterval(id));
  });
  return (
    <span class={clock}>
      {() => props.label ?? "now"}: {now}
    </span>
  );
}

export default Clock;
