/**
 * The status code the Firebase client appends to every callable error is for
 * a log, and these sentences are read at the counter with a customer waiting.
 */
import { describe, expect, it } from "vitest";

import { callableMessage, stripStatusCode } from "./callableError";

describe("the line a person reads when a callable refuses", () => {
  it("takes the status code off the end", () => {
    expect(stripStatusCode("Someone just bought the last one. [409]")).toBe(
      "Someone just bought the last one.",
    );
    expect(stripStatusCode("A name must be 80 characters or fewer. [400]")).toBe(
      "A name must be 80 characters or fewer.",
    );
  });

  it("leaves a sentence that has no code alone", () => {
    expect(stripStatusCode("There is only 1 jar free on this batch.")).toBe(
      "There is only 1 jar free on this batch.",
    );
  });

  it("does not eat a number the sentence itself ends with", () => {
    expect(stripStatusCode("Check the jars in batch [001]")).toBe("Check the jars in batch [001]");
  });

  it("falls back when there is no sentence at all", () => {
    expect(callableMessage(null, "Could not save.")).toBe("Could not save.");
    expect(callableMessage({ message: "   " }, "Could not save.")).toBe("Could not save.");
    expect(callableMessage({ message: "[500]" }, "Could not save.")).toBe("Could not save.");
    expect(callableMessage(new Error("Sign in first. [401]"), "x")).toBe("Sign in first.");
  });
});
