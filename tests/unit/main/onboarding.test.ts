import { describe, expect, it } from "vitest";

import { onboardingEnabled } from "../../../src/main/onboarding";

describe("onboardingEnabled", () => {
  it("is on for a person and off under the test suites unless a spec asks for it", () => {
    expect(onboardingEnabled({})).toBe(true);
    expect(onboardingEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(onboardingEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(onboardingEnabled({ NODE_ENV: "test", WORKBENCH_ONBOARDING: "1" })).toBe(true);
  });
});
