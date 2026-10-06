/**
 * The composer's dictation helpers (`features/session/composer/dictation.ts`):
 * where the words go, how samples cross to main, and what a person is told
 * when the microphone will not open.
 */
import { describe, expect, it } from "vitest";

import { microphoneRefusal, toBase64, withDictation } from "@renderer/features/session/composer/dictation";

describe("withDictation", () => {
  it("puts the words after what the box held, one space between", () => {
    expect(withDictation("", "open the review tab")).toBe("open the review tab");
    expect(withDictation("Please", "open it")).toBe("Please open it");
    expect(withDictation("Please ", "open it")).toBe("Please open it");
    expect(withDictation("line one\n", "line two")).toBe("line one\nline two");
    // Nothing heard yet: the box is as it was.
    expect(withDictation("Please", "")).toBe("Please");
  });
});

describe("toBase64", () => {
  it("encodes bytes, including a buffer larger than one slice", () => {
    expect(toBase64(new Uint8Array([0, 1, 2, 255]))).toBe("AAEC/w==");
    const big = new Uint8Array(0x8000 * 2 + 3).map((_, index) => index % 256);
    expect(atob(toBase64(big)).length).toBe(big.length);
  });
});

describe("microphoneRefusal", () => {
  it("names the setting for a refusal, and says so plainly for no microphone", () => {
    expect(microphoneRefusal(new DOMException("denied", "NotAllowedError"))).toMatch(
      /System Settings › Privacy & Security › Microphone/,
    );
    expect(microphoneRefusal(new DOMException("none", "NotFoundError"))).toBe("No microphone was found.");
    expect(microphoneRefusal(new Error("busy"))).toBe("The microphone could not be opened: busy");
  });
});
