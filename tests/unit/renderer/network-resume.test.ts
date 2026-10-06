import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTINUE_PROMPT,
  MAX_CONTINUES,
  check,
  isNetworkFailure,
  networkTurnEvent,
  resetNetworkResume,
  setNetworkResumeDeps,
} from "@renderer/state/network-resume";

let online = false;
let now = 0;
const submit = vi.fn(async () => {});

beforeEach(() => {
  resetNetworkResume();
  online = false;
  now = 0;
  submit.mockClear();
  setNetworkResumeDeps({ online: () => online, now: () => now, submit });
});

const fail = (message = "API Error: Connection error.") => networkTurnEvent("s1", { type: "prompt/error", message });

describe("continuing after the network comes back", () => {
  it("tells a network failure from the agent's own", () => {
    expect(isNetworkFailure("API Error: Connection error.")).toBe(true);
    expect(isNetworkFailure("request to https://api.anthropic.com failed, reason: getaddrinfo ENOTFOUND api.anthropic.com")).toBe(true);
    expect(isNetworkFailure("stream disconnected before completion")).toBe(true);
    expect(isNetworkFailure("Please run /login")).toBe(false);
    expect(isNetworkFailure("prompt is too long: 210000 tokens > 200000 maximum")).toBe(false);
  });

  it("waits while offline, then continues the chat once, when the Mac is back", () => {
    fail();
    expect(submit).not.toHaveBeenCalled();
    check();
    expect(submit).not.toHaveBeenCalled();
    online = true;
    check();
    expect(submit).toHaveBeenCalledWith("s1", CONTINUE_PROMPT);
    check();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("leaves a chat alone once the person writes to it", () => {
    fail();
    networkTurnEvent("s1", { type: "prompt/start" });
    online = true;
    check();
    expect(submit).not.toHaveBeenCalled();
  });

  it("ignores a failure that is not the network's", () => {
    online = true;
    fail("Please run /login");
    check();
    expect(submit).not.toHaveBeenCalled();
  });

  it("waits a little between tries while online, and stops after the cap", () => {
    online = true;
    for (let attempt = 0; attempt < MAX_CONTINUES; attempt += 1) {
      fail();
      // A second failure while online is not tried again at once.
      if (attempt > 0) {
        check();
        expect(submit).toHaveBeenCalledTimes(attempt);
        now += 25_000;
      }
      check();
      // The continue starts its own turn, which fails on the network again.
      networkTurnEvent("s1", { type: "prompt/start" });
    }
    expect(submit).toHaveBeenCalledTimes(MAX_CONTINUES);
    fail();
    now += 25_000;
    check();
    expect(submit).toHaveBeenCalledTimes(MAX_CONTINUES);
  });

  it("starts a new streak after a continue that finished", () => {
    online = true;
    fail();
    check();
    networkTurnEvent("s1", { type: "prompt/start" });
    networkTurnEvent("s1", { type: "prompt/end" });
    for (let attempt = 0; attempt < MAX_CONTINUES; attempt += 1) {
      fail();
      now += 25_000;
      check();
      networkTurnEvent("s1", { type: "prompt/start" });
    }
    expect(submit).toHaveBeenCalledTimes(1 + MAX_CONTINUES);
  });
});
