/**
 * @kanabun/testing — first-party test helpers for kanabun apps.
 *
 * An in-memory DOM mock (the same one the core suite runs against) plus
 * render/query/event/flush utilities, so components can be unit-tested in
 * any JS runtime without jsdom. Zero dependencies, like everything kanabun.
 */
export {
  MockEvent,
  MockNode,
  MockDocument,
  serialize,
  installDOM,
  createContainer,
  docHead,
  docBody,
  asEl,
  asNode,
  asMock,
} from "./dom-mock";
export { renderTest } from "./render";
export type { RenderTestOptions, RenderTestResult } from "./render";
export {
  walk,
  elements,
  childByTag,
  childById,
  queryByTag,
  queryAllByTag,
  queryById,
  hasClass,
  queryByClass,
  queryAllByClass,
  queryByText,
  getByTag,
  getByClass,
  getById,
  getByText,
  within,
} from "./queries";
export type { BoundQueries } from "./queries";
export { fireEvent, leftClick, setValue, typeAndEnter } from "./events";
export { tick, deferred } from "./async";
export type { Deferred } from "./async";
export { styles, ruleFor } from "./css";
export { captureWarnings } from "./warnings";
