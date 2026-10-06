# Two Chats Side by Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a second chat beside the current one; each side has its own header, transcript and composer; the explorer pane follows the focused side.

**Architecture:** `useSessions` gains `split: { left: string | null; right: string | null; focus: "left" | "right" } | null`. `activeId` keeps its meaning and is always `split[split.focus]` while split, so everything bound to `activeId` (explorer `bindSession`, where-you-were, shortcuts) follows the focused side unchanged. `SessionPane` renders one side per entry with a ratio divider; a side takes focus on `pointerdown`/`focusin`.

**Tech Stack:** React, zustand, zod 4 (settings), vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-pick-and-split-design.md` (Part 2)

## Global Constraints

- Each side at least 360 px; below a 1100 px window width only the focused side shows (the split stays in memory and returns when wider).
- The split ratio is saved in `settings.layout.splitRatio` (0.25 to 0.75, default 0.5).
- ⌘-click (Ctrl elsewhere) a chat row, or its menu's **Open beside**, opens it on the right; ⌘\ and ⌘⌥←/→ move focus between sides. (⌘W is the explorer's close-tab; split uses each side's Close button.)
- Copy: "Open beside", "Close this side". No em-dashes, emoji or arrow glyphs in copy.
- Node 24 for tests.

## Review Focus

1. **Opening a chat that is already on the other side**: focus moves there; the chat is never shown twice (Task 1 test).
2. **Creating a new chat while split** (⌘N): the focused side shows the new-chat screen and the created chat lands in that side (Task 1 test).
3. **Deleting or archiving a chat shown on one side**: that side closes, the other remains (Task 1 test).
4. **Two chats both running**: both transcripts stream; unread does not mark either while visible (Task 4 e2e).
5. **The explorer swaps with focus** and a browser tab of the unfocused chat is not left drawn over the other chat's (Task 4 e2e).

---

### Task 1: The split in the sessions store

**Files:**
- Modify: `src/renderer/state/sessions.ts` (state type, `select`, `setActive`, `remove`, `archive` paths, new actions)
- Test: `tests/unit/renderer/split.test.ts`

**Interfaces:**
- Produces: `split: SplitState | null` where `type SplitState = { left: string | null; right: string | null; focus: "left" | "right" }`; actions `openBeside(id: string): void`, `focusSide(side: "left" | "right"): void`, `closeSide(side: "left" | "right"): void`; `select(id)` and `setActive(id | null)` write into the focused side while split; `isOnScreen(id): boolean` helper exported as `sessionsOnScreen(state): string[]`.

- [ ] **Step 1: Failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { sessionsOnScreen, useSessions } from "@renderer/state/sessions";

const s = () => useSessions.getState();
beforeEach(() => useSessions.setState({ sessions: ["a", "b", "c"].map((id) => ({ id, projectId: "p", archived: false })) as never, activeId: "a", split: null }));

describe("two chats side by side", () => {
  it("opens a chat beside the current one and focuses it", () => {
    s().openBeside("b");
    expect(s().split).toEqual({ left: "a", right: "b", focus: "right" });
    expect(s().activeId).toBe("b");
    expect(sessionsOnScreen(s())).toEqual(["a", "b"]);
  });
  it("moves focus to a chat already on the other side instead of showing it twice", () => {
    s().openBeside("b");
    s().select("a");
    expect(s().split).toEqual({ left: "a", right: "b", focus: "left" });
    expect(s().activeId).toBe("a");
  });
  it("replaces the focused side when another chat is picked", () => {
    s().openBeside("b");
    s().select("c");
    expect(s().split).toEqual({ left: "a", right: "c", focus: "right" });
  });
  it("shows the new-chat screen in the focused side, and the created chat lands there", () => {
    s().openBeside("b");
    s().setActive(null);
    expect(s().split).toEqual({ left: "a", right: null, focus: "right" });
    s().setActive("c");
    expect(s().split).toEqual({ left: "a", right: "c", focus: "right" });
  });
  it("closes a side and keeps the other", () => {
    s().openBeside("b");
    s().closeSide("right");
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("a");
  });
  it("closes the side of a chat that is deleted or archived", () => {
    s().openBeside("b");
    useSessions.getState().receive([{ id: "a", projectId: "p", archived: false }, { id: "c", projectId: "p", archived: false }] as never);
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("a");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** in `sessions.ts`: `openBeside(id)`: if not split → `split = { left: activeId, right: id, focus: "right" }`, `activeId = id`; if `id` is already a side → `focusSide`; else replace the unfocused side and focus it. `select(id)`: when split and `id` is the other side → `focusSide(other)`; when split → `split[focus] = id`. `setActive(id)`: when split → `split[focus] = id`, `activeId = id`. `closeSide(side)`: `split = null`, `activeId = split[other]`. In `receive`: when a split side's chat is gone or archived, close that side. `sessionsOnScreen(state)`: `[split.left, split.right]` (non-null) or `[activeId]`.
- [ ] **Step 4: Run, expect PASS**, plus `npx vitest run tests/unit/renderer/sidebar.test.tsx tests/unit/renderer/viewed.test.ts`.
- [ ] **Step 5: Commit** — "Sessions: a split of two chats, the focused side driving activeId".

---

### Task 2: SessionPane draws two sides

**Files:**
- Modify: `src/renderer/features/session/SessionPane.tsx`, `src/renderer/features/session/SessionHeader.tsx` (Close this side; focused accent), `src/shared/types.ts` (`LayoutSchema.splitRatio`), `src/renderer/app/pane-focus.ts` (`focusSessionHome` targets the active view)
- Test: `tests/unit/renderer/split-pane.test.tsx`

**Interfaces:**
- Consumes: `split`, `focusSide`, `closeSide` (Task 1).
- Produces: DOM hooks `[data-split-side="left"|"right"]`, `[data-split-focused]`, `[data-split-divider]`, header button `aria-label="Close this side"`.

- [ ] **Step 1: Failing test**: with `split = { left: "a", right: "b", focus: "right" }` and two sessions, render `SessionPane`: two `[data-split-side]` each containing a `[data-session-view]` for its chat; the right has `data-split-focused`; `pointerDown` on the left side → `split.focus === "left"`, `activeId === "a"`; clicking the right header's "Close this side" → `split === null`, `activeId === "a"`; with `split.right === null` the right side renders the new-chat screen; with `window.innerWidth = 900` only the focused side renders.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: when `split`, render a flex row: each side `style={{ flexBasis: ratio% }}` with `min-width: 360px`, `onPointerDownCapture`/`onFocusCapture` → `focusSide(side)`; a 6 px `[data-split-divider]` (role="separator", aria-orientation="vertical", keyboard ←/→ by 2 %) dragging updates a local ratio and commits `setLayout({ splitRatio })` on release, clamped 0.25–0.75. Each side renders `<SessionView key={id} session={...} />` or the `NewSession` screen for null. The focused side's header gets `data-split-focused` and a `border-b-2 border-primary/40` accent; both headers show "Close this side" when split. Narrow window (`useWindowWidth() < 1100`): render the focused side only. `focusSessionHome` queries `[data-session-view="${activeId}"]` before `#session`.
- [ ] **Step 4: Run, expect PASS**; `npx vitest run tests/unit/renderer/no-native-title.test.tsx tests/unit/renderer/a11y-source.test.ts`.
- [ ] **Step 5: Commit** — "Session pane: two chats side by side, a divider, focus by click".

---

### Task 3: Sidebar, shortcuts, unread

**Files:**
- Modify: `src/renderer/features/sidebar/SessionRow.tsx` (⌘-click, Open beside, selected for both sides), `src/renderer/features/sidebar/SessionSection.tsx`, `src/renderer/features/sidebar/RecentsSection.tsx`, `src/renderer/state/viewed.ts`, `src/renderer/app/Shell.tsx` (⌘\, ⌘⌥←/→)
- Test: `tests/unit/renderer/split-sidebar.test.tsx`, `tests/unit/renderer/viewed.test.ts`

- [ ] **Step 1: Failing tests**: ⌘-click a row → `openBeside(id)`; the row menu has "Open beside"; with a split both rows carry `aria-current` (focused `"page"`, other `"true"`); ⌘\ swaps focus; `trackViewed` marks both on-screen chats viewed when the window has focus.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: row title `onClick(event)`: `isPrimaryModifier(event)` → `openBeside` else `onSelect`; menu item "Open beside"; `selected` from `sessionsOnScreen`. Shell keydown: `Mod+\` toggles `focusSide`, `Mod+Alt+ArrowLeft/Right` focus that side. `viewed.ts` iterates `sessionsOnScreen`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — "Split: open beside from the sidebar, shortcuts, both sides seen".

---

### Task 4: End to end, docs, release

- [ ] **Step 1: e2e** `tests/e2e/split-chats.spec.ts`: two chats; ⌘-click the second → two `[data-split-side]`; send a message in each composer → both reach idle with their replies; click the left side → the explorer's tab strip shows the left chat's tabs (open a File tab on the right first, check it disappears when focus moves left); drag `[data-split-divider]` → ratio persists after reopening Settings layout; close the right side → one view.
- [ ] **Step 2: Run** `npm run build && CI=1 npx playwright test tests/e2e/split-chats.spec.ts` → PASS.
- [ ] **Step 3: Full checks**, docs (`docs/design.md` "Two chats side by side"), version 0.1.13, merge, tag, CI, verify DMG, publish, install.
