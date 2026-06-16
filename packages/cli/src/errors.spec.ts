import { describe, expect, test } from "bun:test";
import { errorMessages } from "./errors";

describe("errorMessages", () => {
  test("expands an AggregateError into its sub-errors", () => {
    const error = new AggregateError([new Error("a"), "b"], "Bundle failed");
    expect(errorMessages(error)).toEqual(["Error: a", "b"]);
  });

  test("uses the message of a plain Error", () => {
    expect(errorMessages(new Error("boom"))).toEqual(["boom"]);
  });

  test("stringifies anything else", () => {
    expect(errorMessages("plain")).toEqual(["plain"]);
    expect(errorMessages(42)).toEqual(["42"]);
  });
});
