import { render } from "@kanabun/core";
import { TodoApp } from "./app";

const root = document.getElementById("app");
if (root) render(() => <TodoApp />, root);
