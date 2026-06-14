import { signal, computed, For, Show } from "@kanabun/core";
import type { Signal } from "@kanabun/core";

export interface Todo {
  id: number;
  title: string;
  done: Signal<boolean>;
}

export type Filter = "all" | "active" | "completed";

export function TodoApp() {
  const todos = signal<Todo[]>([]);
  const filter = signal<Filter>("all");
  let nextId = 1;
  let input: HTMLInputElement | undefined;

  const remaining = computed(() => todos().filter((t) => !t.done()).length);
  const anyDone = computed(() => todos().some((t) => t.done()));
  const visible = computed(() => {
    const f = filter();
    return todos().filter((t) =>
      f === "active" ? !t.done() : f === "completed" ? t.done() : true,
    );
  });

  function addTodo() {
    const title = (input?.value ?? "").trim();
    if (title === "") return;
    todos.update((list) => [
      ...list,
      { id: nextId++, title, done: signal(false) },
    ]);
    if (input) input.value = "";
  }

  const removeTodo = (todo: Todo) =>
    todos.update((list) => list.filter((t) => t !== todo));
  const clearCompleted = () =>
    todos.update((list) => list.filter((t) => !t.done()));

  return (
    <main class="app">
      <h1>todos</h1>

      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus
        ref={(el: Element) => (input = el as HTMLInputElement)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter") addTodo();
        }}
      />

      <ul class="todo-list">
        <For each={() => visible()} fallback={<li class="empty">Nothing here yet.</li>}>
          {(todo: Todo) => (
            <li class={() => (todo.done() ? "completed" : "")}>
              <input
                type="checkbox"
                checked={() => todo.done()}
                onChange={() => todo.done.update((d) => !d)}
              />
              <span class="title">{todo.title}</span>
              <button class="destroy" onClick={() => removeTodo(todo)}>
                ✕
              </button>
            </li>
          )}
        </For>
      </ul>

      <footer class="footer">
        <span class="todo-count">
          {() => remaining()} item{() => (remaining() === 1 ? "" : "s")} left
        </span>

        <span class="filters">
          {(["all", "active", "completed"] as const).map((f) => (
            <button
              class={() => (filter() === f ? "selected" : "")}
              onClick={() => filter.set(f)}
            >
              {f}
            </button>
          ))}
        </span>

        <Show when={() => anyDone()}>
          <button class="clear-completed" onClick={clearCompleted}>
            Clear completed
          </button>
        </Show>
      </footer>
    </main>
  );
}
