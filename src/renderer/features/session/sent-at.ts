/**
 * When a message in the transcript was sent, as the quiet label a hover shows
 * beside it and the full date its tooltip gives (`SentAt` in `Transcript.tsx`).
 *
 * The label is as short as the distance allows, ChatGPT's and Codex's way: a
 * time today ("3:42 PM"), "Yesterday 3:42 PM", a weekday within the week
 * ("Mon 3:42 PM"), the day and month this year ("Mar 4") and the year after
 * that ("Mar 4, 2025"). Days are calendar days in the person's own time zone,
 * not 24-hour spans: a message from 11 PM is "Yesterday" at 1 AM. Pure, and
 * `now` is a parameter, so the unit test needs no clock.
 */

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const FULL = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short" });

/** Midnight at the start of `at`'s day, local time. */
function dayStart(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole calendar days from `at`'s day to `now`'s; 0 for today. DST-proof: rounded, not floored. */
function daysAgo(at: number, now: number): number {
  return Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
}

/** The short label: "3:42 PM", "Yesterday 3:42 PM", "Mon 3:42 PM", "Mar 4", "Mar 4, 2025". */
export function sentAtLabel(at: number, now: number = Date.now()): string {
  const days = daysAgo(at, now);
  // A clock that is behind (a message stamped a moment in the future) reads as today.
  if (days <= 0) return CLOCK.format(at);
  if (days === 1) return `Yesterday ${CLOCK.format(at)}`;
  if (days < 7) return `${WEEKDAY.format(at)} ${CLOCK.format(at)}`;
  return new Date(at).getFullYear() === new Date(now).getFullYear() ? DAY.format(at) : DAY_YEAR.format(at);
}

/** The whole date and time, for the tooltip and the screen reader: "Monday, March 4, 2026 at 3:42 PM". */
export function sentAtFull(at: number): string {
  return FULL.format(at);
}
