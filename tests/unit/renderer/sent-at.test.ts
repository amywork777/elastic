import { describe, expect, it } from "vitest";

import { sentAtFull, sentAtLabel } from "@renderer/features/session/sent-at";

// Local times, so the calendar-day arithmetic is the machine's own, as it is in the app.
const at = (year: number, month: number, day: number, hour = 15, minute = 42) => new Date(year, month - 1, day, hour, minute).getTime();
const now = at(2026, 10, 9, 10, 0);

describe("when a message was sent", () => {
  it("is a time today, Yesterday the day before, a weekday within the week", () => {
    expect(sentAtLabel(at(2026, 10, 9, 8, 5), now)).toBe("8:05 AM");
    expect(sentAtLabel(at(2026, 10, 8), now)).toBe("Yesterday 3:42 PM");
    // Calendar days, not 24 hours: 11 PM last night is yesterday at 1 AM.
    expect(sentAtLabel(at(2026, 10, 8, 23, 0), at(2026, 10, 9, 1, 0))).toBe("Yesterday 11:00 PM");
    expect(sentAtLabel(at(2026, 10, 5), now)).toBe("Mon 3:42 PM");
  });

  it("is the day this year and the day with its year before that", () => {
    expect(sentAtLabel(at(2026, 3, 4), now)).toBe("Mar 4");
    expect(sentAtLabel(at(2025, 3, 4), now)).toBe("Mar 4, 2025");
  });

  it("reads a stamp a moment ahead of the clock as today", () => {
    expect(sentAtLabel(now + 60_000, now)).toBe("10:01 AM");
  });

  it("spells the whole date out for the tooltip", () => {
    expect(sentAtFull(at(2026, 3, 4))).toBe("Wednesday, March 4, 2026 at 3:42 PM");
  });
});
