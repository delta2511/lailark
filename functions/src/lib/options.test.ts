import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_INSTANCES, REGION } from "./options";

describe("shared Cloud Functions options", () => {
  it("sets the region to asia-south1 (brief §19.1, ST3)", () => {
    expect(REGION).toBe("asia-south1");
  });

  it("sets a positive maxInstances ceiling no greater than 10", () => {
    expect(Number.isInteger(DEFAULT_MAX_INSTANCES)).toBe(true);
    expect(DEFAULT_MAX_INSTANCES).toBeGreaterThan(0);
    expect(DEFAULT_MAX_INSTANCES).toBeLessThanOrEqual(10);
  });
});
