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
  queryByTag,
  queryAllByTag,
  hasClass,
  queryByClass,
  queryAllByClass,
} from "./queries";
export { fireEvent, leftClick, setValue, typeAndEnter } from "./events";
export { tick } from "./async";
