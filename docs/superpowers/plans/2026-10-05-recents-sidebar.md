# Recents Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Recents the sidebar's main list: running chats on top, then the 10 most recently active with an unread dot and a status tag, Done chats sunk, folders folded below.

**Architecture:** Two new session columns (`last_viewed_at`, `status_override`) with two IPC calls (`sessions.markViewed`, `sessions.setTag`). Activity (`updatedAt`) is stamped only by real turn activity, not by reconnects or evictions. The ordering and tags are pure functions in `src/renderer/lib/sidebar.ts`; the sidebar renders them in a new `recents` group-by mode, which becomes the default once.

**Tech Stack:** Electron 40, TypeScript, React, zustand, zod 4, better-sqlite3, vitest (unit, jsdom), Playwright (e2e). Node 24: `export PATH=~/.nvm/versions/node/v24.15.0/bin:$PATH`.

**Spec:** `docs/superpowers/specs/2026-10-05-recents-sidebar-design.md` (mockup: https://claude.ai/artifact/CqgkBJtkDPCcMvhPHKfWyK)

## Global Constraints

- Read `AGENTS.md` first. Every IPC channel is declared once in `src/shared/ipc/*` with request and response schemas; add new channel names to `tests/unit/shared/ipc.test.ts` in contract order.
- The renderer imports from `src/shared` only types and pure modules (`tests/unit/main/renderer-shared-imports.test.ts`).
- Hints are `TooltipHint`, never `title=` (`tests/unit/renderer/no-native-title.test.tsx`). Revealed-on-hover controls need a `focus-visible` twin; `outline-none` buttons draw `focus-visible:ring-[3px] focus-visible:ring-ring/50` (`tests/unit/renderer/a11y-source.test.ts`).
- UI copy: no em-dashes, emoji or arrow glyphs. Tag labels exactly: `Working`, `Waiting on you`, `Needs review`, `Failed`, `Done`.
- Neutral tokens only (DESIGN.md); semantic colour for tags: waiting amber, review blue (`info`), failed red (`destructive`).
- 10 rows before **Show N more**. Manual tag values: `"done" | "review" | "waiting"`.
- Migrations are numbered contiguously; the next is **14**. Never edit a past migration.
- Run checks with Node 24; `npm test` needs network sandbox off for loopback tests.

## Review Focus

1. **Reconnects and evictions are not activity.** Opening a closed chat (connecting, then idle) or the keep-alive closing an idle one must not reorder Recents or mark the chat unread. Test in Task 2.
2. **The open chat while the window is in the background.** A turn that ends in the open chat while elastic is not focused leaves it unread; focusing the window clears it. Test in Task 5.
3. **A manual tag on a live chat.** Set Done while it is running: the row still says Working; when the next turn starts, the override is gone. Tests in Tasks 2 and 4.
4. **Filters and hidden folders still apply in Recents** (archived, Status, Environment, hidden folders), and pinned chats are not listed twice. Test in Task 4.
5. **Mod+1..9 counts the rows on screen** in Recents order, Show more collapsed or expanded. Test in Task 4.

---

## File Structure

- `src/main/db/migrations.ts`: migration 14.
- `src/shared/types.ts`: `Session.lastViewedAt`, `Session.statusOverride`, `SessionTagSchema`, `SidebarGroupBy` + `"recents"`, `SidebarSettings.foldersCollapsed`.
- `src/main/db/repositories.ts`: columns in `SESSION_COLUMNS`, `SessionRow`, `toSession`, `upsert`; `settings.defaultSidebarToRecentsOnce()`.
- `src/main/acp/sessions.ts`: `markViewed`, `setTag`, activity-only `updatedAt`, override cleared on `prompt/start`.
- `src/shared/ipc/acp.ts`, `src/main/ipc/acp.ts`: channels `sessions.markViewed`, `sessions.setTag`.
- `src/main/index.ts`: call `settings.defaultSidebarToRecentsOnce()` after the database opens.
- `src/renderer/lib/sidebar.ts`: `statusTag`, `isUnread`, `recentsSections`, `RECENTS_LIMIT`, `listedSessions` for recents.
- `src/renderer/state/sessions.ts`: `markViewed`, `setTag`, `recentsExpanded`.
- `src/renderer/state/viewed.ts` (new): marks the open chat viewed while the window has focus.
- `src/renderer/features/sidebar/StatusTag.tsx` (new): the pill.
- `src/renderer/features/sidebar/SessionRow.tsx`: unread glyph, tag, tag menu items.
- `src/renderer/features/sidebar/Sidebar.tsx`, `RecentsSection.tsx` (new): recents mode, Show more, Folders header.
- `src/renderer/features/sidebar/SidebarFilterMenu.tsx`: Group by Recents / Folders / None.
- `tests/setup-jsdom.ts`: mocks for the two channels.

---

### Task 1: Migration 14 and the Session fields

**Files:**
- Modify: `src/main/db/migrations.ts` (append after version 13)
- Modify: `src/shared/types.ts` (SessionSchema, around line 70)
- Modify: `src/main/db/repositories.ts:105-250` (SessionRow, SESSION_COLUMNS, toSession, upsert)
- Test: `tests/unit/main/session-repository.test.ts`

**Interfaces:**
- Produces: `SessionTagSchema = z.enum(["done", "review", "waiting"])`, `type SessionTag`; `Session.lastViewedAt: number | null` (default null); `Session.statusOverride: SessionTag | null` (default null; an unknown stored value reads as null).

- [ ] **Step 1: Write the failing test** (append to `tests/unit/main/session-repository.test.ts`, using that file's existing `session(...)`/db helpers; read its top to match names)

```ts
it("stores when a chat was last viewed and its manual tag, and reads unknown tags as none", () => {
  const row = sessions.upsert({ ...session({ id: "r1" }), lastViewedAt: 1234, statusOverride: "review" });
  expect(sessions.get("r1")).toMatchObject({ lastViewedAt: 1234, statusOverride: "review" });
  expect(row.lastViewedAt).toBe(1234);
  db().prepare("UPDATE sessions SET status_override = 'later' WHERE id = 'r1'").run();
  expect(sessions.get("r1")?.statusOverride).toBeNull();
  const fresh = sessions.upsert(session({ id: "r2" }));
  expect(fresh).toMatchObject({ lastViewedAt: null, statusOverride: null });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/main/session-repository.test.ts`
Expected: FAIL (`lastViewedAt` undefined / no such column).

- [ ] **Step 3: Implement**

`src/main/db/migrations.ts`, new last entry:

```ts
  {
    version: 14,
    name: "session-recents",
    // The Recents sidebar: when the person last saw the chat (unread is activity after it),
    // and the tag they set by hand ("done" | "review" | "waiting"), cleared by the next turn.
    up: `
      ALTER TABLE sessions ADD COLUMN last_viewed_at INTEGER;
      ALTER TABLE sessions ADD COLUMN status_override TEXT;
    `,
  },
```

`src/shared/types.ts`, above `SessionSchema`:

```ts
/** A tag the person set on a chat by hand (the sidebar's right-click Tag items). */
export const SessionTagSchema = z.enum(["done", "review", "waiting"]);
export type SessionTag = z.infer<typeof SessionTagSchema>;
```

and inside `SessionSchema` after `updatedAt`:

```ts
  /** When the person last saw this chat with the window focused; null before the first time. */
  lastViewedAt: z.number().int().nullable().default(null),
  /** The tag set by hand, until the chat's next turn starts; null when automatic. */
  statusOverride: SessionTagSchema.nullable().catch(null).default(null),
```

`src/main/db/repositories.ts`: add `last_viewed_at: number | null; status_override: string | null;` to `SessionRow`; append `, last_viewed_at, status_override` to `SESSION_COLUMNS`; in `toSession` add `lastViewedAt: row.last_viewed_at, statusOverride: row.status_override,`; in `upsert` add `@lastViewedAt, @statusOverride` to VALUES, `last_viewed_at = excluded.last_viewed_at, status_override = excluded.status_override` to the UPDATE SET list, and `lastViewedAt: parsed.lastViewedAt ?? null, statusOverride: parsed.statusOverride ?? null,` to the run object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/main/session-repository.test.ts tests/unit/shared/types.test.ts && npx tsc -p tsconfig.node.json --noEmit`
Expected: PASS; typecheck clean (fix any `Session` literal in tests that now lacks the defaulted fields only if tsc asks).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations.ts src/shared/types.ts src/main/db/repositories.ts tests/unit/main/session-repository.test.ts
git commit -m "Sessions remember when they were last viewed and a manual tag (migration 14)"
```

---

### Task 2: Main: markViewed, setTag, activity-only `updatedAt`

**Files:**
- Modify: `src/main/acp/sessions.ts` (`setPinned` at ~1372, `setStatus` at ~2088, `update` at ~2102, the `prompt/start` case at ~2006)
- Modify: `src/shared/ipc/acp.ts` (after `setPinned`), `src/main/ipc/acp.ts` (after `setPinned`)
- Modify: `tests/unit/shared/ipc.test.ts` (channel list), `tests/setup-jsdom.ts` (mocks)
- Test: `tests/unit/main/sessions.test.ts`

**Interfaces:**
- Consumes: Task 1 fields.
- Produces: `SessionManager.markViewed(id: string, at?: number): Session`; `SessionManager.setTag(id: string, tag: SessionTag | null): Session`; channels `sessions.markViewed: invoke(Id, SessionSchema)`, `sessions.setTag: invoke(Id.extend({ tag: SessionTagSchema.nullable() }), SessionSchema)`.

- [ ] **Step 1: Write the failing tests** (in `tests/unit/main/sessions.test.ts`, using its `setup()` and fake agent)

```ts
describe("recents bookkeeping", () => {
  it("marks a chat viewed without making it active", async () => {
    const { manager, cwd } = await setup();
    const session = await manager.create({ projectId: "p1", agentId: "claude-code", cwd, gitMode: "none" });
    const before = manager.get(session.id)!.updatedAt;
    const viewed = manager.markViewed(session.id, before + 5_000);
    expect(viewed.lastViewedAt).toBe(before + 5_000);
    expect(manager.get(session.id)!.updatedAt).toBe(before);
  });

  it("keeps a manual tag until the next turn starts", async () => {
    const { manager, cwd } = await setup();
    const session = await manager.create({ projectId: "p1", agentId: "claude-code", cwd, gitMode: "none" });
    expect(manager.setTag(session.id, "done").statusOverride).toBe("done");
    await manager.prompt(session.id, [{ type: "text", text: "hello" }]);
    expect(manager.get(session.id)!.statusOverride).toBeNull();
  });

  it("does not count a reconnect or an eviction as activity", async () => {
    const { manager, cwd } = await setup();
    const session = await manager.create({ projectId: "p1", agentId: "claude-code", cwd, gitMode: "none" });
    await manager.prompt(session.id, [{ type: "text", text: "hello" }]);
    const active = manager.get(session.id)!.updatedAt;
    manager.close(session.id);            // closed: not activity
    await manager.load(session.id);       // connecting, then idle: not activity
    expect(manager.get(session.id)!.updatedAt).toBe(active);
    await manager.prompt(session.id, [{ type: "text", text: "again" }]);
    expect(manager.get(session.id)!.updatedAt).toBeGreaterThan(active);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/main/sessions.test.ts -t "recents bookkeeping"`
Expected: FAIL (`markViewed` is not a function).

- [ ] **Step 3: Implement**

In `SessionManager`, beside `setPinned`:

```ts
  /** The person saw this chat (window focused, chat open). Not activity: `updatedAt` stays. */
  markViewed(id: string, at: number = Date.now()): Session {
    const session = this.require(id);
    const next = this.deps.repo.upsert({ ...session, lastViewedAt: at });
    this.broadcastIndex();
    return next;
  }

  /** A tag set by hand, or null for automatic; the next turn's start clears it. Not activity. */
  setTag(id: string, tag: SessionTag | null): Session {
    const session = this.require(id);
    const next = this.deps.repo.upsert({ ...session, statusOverride: tag });
    this.broadcastIndex();
    return next;
  }
```

Activity-only stamping. Change `update` to take an option and `setStatus` to decide:

```ts
  /**
   * What moves a chat in Recents and marks it unread: a turn starting, asking, failing, or ending.
   * A reconnect (connecting, then idle) and an eviction (closed) are the app's housekeeping.
   */
  private static isActivity(previous: SessionStatus, next: SessionStatus): boolean {
    if (next === "running" || next === "waiting" || next === "error") return true;
    return next === "idle" && (previous === "running" || previous === "waiting");
  }
```

In `setStatus`, replace `this.update(id, { status });` with `this.update(id, { status }, { touch: SessionManager.isActivity(session.status, status) });`. Change `update`'s signature to `private update(id: string, patch: Partial<Session>, { touch = true }: { touch?: boolean } = {}): Session` and its upsert to `this.deps.repo.upsert({ ...session, ...patch, ...(touch ? { updatedAt: Date.now() } : {}) })` (keep the rest of the body as it is). In the `prompt/start` case, before `this.setStatus(id, "running")`:

```ts
        // A tag set by hand speaks for a finished chat; a new turn makes it say nothing.
        if (this.deps.repo.get(id)?.statusOverride) {
          this.deps.repo.upsert({ ...this.deps.repo.get(id)!, statusOverride: null });
        }
```

Import `SessionTag` with the other types from `../../shared/types`.

IPC, `src/shared/ipc/acp.ts` after `setPinned` (import `SessionTagSchema` from `../types`):

```ts
    /** The person saw this chat; `updatedAt` stays (Recents' unread dot is activity after it). */
    markViewed: invoke(Id, SessionSchema),
    /** A Recents tag set by hand, null for automatic; cleared when the next turn starts. */
    setTag: invoke(Id.extend({ tag: SessionTagSchema.nullable() }), SessionSchema),
```

`src/main/ipc/acp.ts` after `setPinned`:

```ts
    markViewed: ({ id }) => surfacing(() => sessionManager.markViewed(id)),
    setTag: ({ id, tag }) => surfacing(() => sessionManager.setTag(id, tag)),
```

`tests/unit/shared/ipc.test.ts`: insert `"sessions.markViewed", "sessions.setTag",` right after `"sessions.setPinned",`. `tests/setup-jsdom.ts` in `sessions`: `markViewed: vi.fn(async () => undefined), setTag: vi.fn(async () => undefined),`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/main/sessions.test.ts tests/unit/shared/ipc.test.ts tests/unit/main/live.test.ts && npx tsc -p tsconfig.node.json --noEmit`
Expected: PASS. If an existing test asserted that `close`/`load` bumps `updatedAt`, it encodes the old rule: update it to the activity rule and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add src/main/acp/sessions.ts src/shared/ipc/acp.ts src/main/ipc/acp.ts tests/unit/main/sessions.test.ts tests/unit/shared/ipc.test.ts tests/setup-jsdom.ts
git commit -m "Mark chats viewed and tagged; only turns count as activity"
```

---

### Task 3: Settings: Recents grouping, folded Folders, one-time default

**Files:**
- Modify: `src/shared/types.ts:548-584` (`SidebarGroupBySchema`, `SidebarSettingsSchema`)
- Modify: `src/main/db/repositories.ts` (`settings` object, ~575)
- Modify: `src/main/index.ts` (after the database opens, beside `mark("db")`)
- Test: `tests/unit/main/settings-repository.test.ts` (create if absent; follow `session-repository.test.ts`'s db setup)

**Interfaces:**
- Produces: `SidebarGroupBy = "recents" | "project" | "none"` (default `"recents"`); `SidebarSettings.foldersCollapsed: boolean` (default `true`); `settings.defaultSidebarToRecentsOnce(): void`.

- [ ] **Step 1: Write the failing test**

```ts
it("moves a stored Project grouping to Recents once, and leaves a later choice alone", () => {
  settings.set({ sidebar: { ...settings.get().sidebar, groupBy: "project" } });
  settings.defaultSidebarToRecentsOnce();
  expect(settings.get().sidebar.groupBy).toBe("recents");
  settings.set({ sidebar: { ...settings.get().sidebar, groupBy: "project" } });
  settings.defaultSidebarToRecentsOnce();
  expect(settings.get().sidebar.groupBy).toBe("project");
  expect(settings.get().sidebar.foldersCollapsed).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/main/settings-repository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/shared/types.ts`: `export const SidebarGroupBySchema = z.enum(["recents", "project", "none"]);`, change `groupBy: SidebarGroupBySchema.default("recents"),` and add to `SidebarSettingsSchema`:

```ts
  /** In Recents, the Folders section below the list: folded until opened. */
  foldersCollapsed: z.boolean().default(true),
```

`src/main/db/repositories.ts`, a constant beside `QUEUES_KEY`: `const RECENTS_DEFAULTED_KEY = "__recentsDefaulted";` and in `settings`:

```ts
  /**
   * Recents arrives as the sidebar's main list. Installs before it stored `groupBy: "project"`
   * (the old default), so that one value moves to Recents, once; a person who goes back to
   * Folders afterwards stays there.
   */
  defaultSidebarToRecentsOnce(): void {
    const raw = readRaw();
    if (raw[RECENTS_DEFAULTED_KEY]) return;
    const sidebar = settings.get().sidebar;
    if (sidebar.groupBy === "project") settings.set({ sidebar: { ...sidebar, groupBy: "recents" } });
    writeRaw({ [RECENTS_DEFAULTED_KEY]: true });
  },
```

`src/main/index.ts`, right after `mark("db")`: `settings.defaultSidebarToRecentsOnce();` (import `settings` from `./db/repositories` if not already).

`src/renderer/features/sidebar/SidebarFilterMenu.tsx` `GROUP_BY`:

```ts
const GROUP_BY: readonly { value: SidebarGroupBy; label: string }[] = [
  { value: "recents", label: "Recents" },
  { value: "project", label: "Folders" },
  { value: "none", label: "None" },
];
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/main/settings-repository.test.ts tests/unit/shared/types.test.ts tests/unit/renderer/sidebar.test.tsx && npm run typecheck`
Expected: PASS (sidebar tests that render with default settings may now get `recents`; pass `filters({ groupBy: "project" })` in the ones that assert folder sections, until Task 6 adds Recents rendering).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/db/repositories.ts src/main/index.ts src/renderer/features/sidebar/SidebarFilterMenu.tsx tests/unit/main/settings-repository.test.ts tests/unit/renderer/sidebar.test.tsx
git commit -m "Recents grouping, folded Folders, and a one-time move to Recents"
```

---

### Task 4: Pure Recents rules in `lib/sidebar.ts`

**Files:**
- Modify: `src/renderer/lib/sidebar.ts`
- Test: `tests/unit/renderer/sidebar.test.tsx` (new `describe("recents")`, uses the file's `session()`, `project()`, `filters()` helpers)

**Interfaces:**
- Consumes: `Session.lastViewedAt`, `Session.statusOverride`, `SidebarSettings`.
- Produces:
  - `type StatusTag = "working" | "waiting" | "review" | "failed" | "done"`
  - `STATUS_TAG_LABELS: Record<StatusTag, string>` = Working / Waiting on you / Needs review / Failed / Done
  - `statusTag(session: Session): { tag: StatusTag; manual: boolean }`
  - `isUnread(session: Session): boolean`
  - `RECENTS_LIMIT = 10`
  - `recentsSections(input: { sessions; projects; filters; hidden?; expanded: boolean }): SidebarSection[]` returning, in order, `pinned` (if any), `{ id: "recents", kind: "recents", name: "Recents", sessions, more: number }`, then `{ id: "folders", kind: "folders", ... }` sections from `sidebarSections` with `groupBy: "project"` (their `kind: "project"`).
  - `SidebarSection.kind` gains `"recents"`; `SidebarSection` gains optional `more?: number` (rows beyond the cut, 0 when expanded).
  - `listedSessions(sections, collapsedProjects, { foldersCollapsed })` skips project sections when `foldersCollapsed`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("recents", () => {
  const projects = [project("p1", "elastic"), project("p2", "vizcom")];
  const at = (minutes: number) => 1_000_000 + minutes * 60_000;

  it("tags a chat from what is happening, and a hand-set tag only once it is finished", () => {
    expect(statusTag(session({ id: "a", title: "A", status: "running" })).tag).toBe("working");
    expect(statusTag(session({ id: "a", title: "A", status: "waiting" })).tag).toBe("waiting");
    expect(statusTag(session({ id: "a", title: "A", status: "error" })).tag).toBe("failed");
    expect(statusTag(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(1), changedFiles: 2 })).tag).toBe("review");
    expect(statusTag(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(9), changedFiles: 2 })).tag).toBe("done");
    expect(statusTag(session({ id: "a", title: "A", status: "running", statusOverride: "done" }))).toEqual({ tag: "working", manual: false });
    expect(statusTag(session({ id: "a", title: "A", statusOverride: "review" }))).toEqual({ tag: "review", manual: true });
  });

  it("reads a never-viewed chat as read, and activity after the last view as unread", () => {
    expect(isUnread(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: null }))).toBe(false);
    expect(isUnread(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(1) }))).toBe(true);
    expect(isUnread(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(6) }))).toBe(false);
  });

  it("orders pinned, then live chats, then by activity, Done last, and cuts at ten", () => {
    const rows = [
      session({ id: "pin", title: "Pinned", pinned: true, updatedAt: at(1) }),
      session({ id: "run", title: "Running", status: "running", updatedAt: at(2) }),
      session({ id: "done-new", title: "Done new", updatedAt: at(50), lastViewedAt: at(51) }),
      session({ id: "review", title: "Review", updatedAt: at(10), lastViewedAt: at(1), changedFiles: 1 }),
      ...Array.from({ length: 10 }, (_, index) => session({ id: `old${index}`, title: `Old ${index}`, updatedAt: at(3 + index), lastViewedAt: at(1), changedFiles: 1 })),
      session({ id: "archived", title: "Archived", archived: true, updatedAt: at(99) }),
    ];
    const sections = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), expanded: false });
    expect(sections[0]!.sessions.map((row) => row.id)).toEqual(["pin"]);
    const recents = sections.find((section) => section.kind === "recents")!;
    expect(recents.sessions.map((row) => row.id).slice(0, 3)).toEqual(["run", "review", "old9"]);
    expect(recents.sessions).toHaveLength(RECENTS_LIMIT);
    expect(recents.more).toBe(2);
    const all = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), expanded: true });
    const expandedIds = all.find((section) => section.kind === "recents")!.sessions.map((row) => row.id);
    expect(expandedIds.at(-1)).toBe("done-new");
    expect(expandedIds).not.toContain("archived");
    expect(expandedIds).not.toContain("pin");
  });

  it("applies hidden folders and the Environment filter to Recents", () => {
    const rows = [session({ id: "a", title: "A", projectId: "p1" }), session({ id: "b", title: "B", projectId: "p2", gitMode: "worktree" })];
    const hidden = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), hidden: ["p2"], expanded: true });
    expect(hidden.find((s) => s.kind === "recents")!.sessions.map((r) => r.id)).toEqual(["a"]);
    const local = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents", environment: "local" }), expanded: true });
    expect(local.find((s) => s.kind === "recents")!.sessions.map((r) => r.id)).toEqual(["a"]);
  });

  it("numbers Mod+1..9 by the rows on screen, folded Folders left out", () => {
    const rows = Array.from({ length: 12 }, (_, index) => session({ id: `s${index}`, title: `S${index}`, updatedAt: at(index) }));
    const sections = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), expanded: false });
    const listed = listedSessions(sections, [], { foldersCollapsed: true });
    expect(listed).toHaveLength(RECENTS_LIMIT);
    expect(listed[0]!.id).toBe("s11");
  });
});
```

(`session()` in this file defaults `status: "idle"`, `changedFiles: 0`; add `lastViewedAt: null, statusOverride: null` to its defaults.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/renderer/sidebar.test.tsx -t recents`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement** in `src/renderer/lib/sidebar.ts`

```ts
export type StatusTag = "working" | "waiting" | "review" | "failed" | "done";
export const STATUS_TAG_LABELS: Record<StatusTag, string> = {
  working: "Working",
  waiting: "Waiting on you",
  review: "Needs review",
  failed: "Failed",
  done: "Done",
};
export const RECENTS_LIMIT = 10;

/** Activity since the person last saw the chat. A chat never seen since Recents arrived reads as read. */
export function isUnread(session: Session): boolean {
  return session.lastViewedAt !== null && session.updatedAt > session.lastViewedAt;
}

/**
 * A chat's tag: what is happening wins (a turn going, a question, a failure); a finished chat
 * takes the person's own tag if they set one, else Needs review when it changed files they
 * have not seen, else Done.
 */
export function statusTag(session: Session): { tag: StatusTag; manual: boolean } {
  if (session.status === "running" || session.status === "connecting") return { tag: "working", manual: false };
  if (session.status === "waiting") return { tag: "waiting", manual: false };
  if (session.status === "error") return { tag: "failed", manual: false };
  if (session.statusOverride) return { tag: session.statusOverride, manual: true };
  return { tag: isUnread(session) && session.changedFiles > 0 ? "review" : "done", manual: false };
}

const LIVE: ReadonlySet<StatusTag> = new Set(["working", "waiting"]);

/**
 * Recents: pinned chats, then every other listed chat with what is live first, the rest by
 * activity and Done after them, cut at `RECENTS_LIMIT` unless expanded; then the folder sections.
 * The filters, hidden folders and archived rule are `sidebarSections`' own.
 */
export function recentsSections(input: {
  sessions: readonly Session[];
  projects: readonly Project[];
  filters: SidebarSettings;
  hidden?: readonly string[];
  expanded: boolean;
}): SidebarSection[] {
  const byFolder = sidebarSections({ ...input, filters: { ...input.filters, groupBy: "project" } });
  const pinned = byFolder.filter((section) => section.kind === "pinned");
  const listed = byFolder.filter((section) => section.kind === "project").flatMap((section) => section.sessions);
  const rank = (session: Session) => {
    const { tag } = statusTag(session);
    return LIVE.has(tag) ? 0 : tag === "done" ? 2 : 1;
  };
  const ordered = [...listed].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  const shown = input.expanded ? ordered : ordered.slice(0, RECENTS_LIMIT);
  return [
    ...pinned,
    { id: "recents", kind: "recents", name: "Recents", project: null, sessions: shown, pinned: false, more: ordered.length - shown.length },
    ...byFolder.filter((section) => section.kind === "project"),
  ];
}
```

Add `"recents"` to `SidebarSection["kind"]` and `more?: number` to `SidebarSection`. Update `listedSessions`:

```ts
export function listedSessions(
  sections: readonly SidebarSection[],
  collapsedProjects: readonly string[],
  { foldersCollapsed = false }: { foldersCollapsed?: boolean } = {},
): Session[] {
  const recents = sections.some((section) => section.kind === "recents");
  const collapsed = new Set(collapsedProjects);
  return sections.flatMap((section) => {
    if (section.kind !== "project") return section.sessions;
    if (recents && foldersCollapsed) return [];
    return collapsed.has(section.id) ? [] : section.sessions;
  });
}
```

Note: hidden folders drop out of `byFolder`'s project sections, so Recents leaves them out too; pinned rows come only from the pinned section, so no chat is listed twice.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/renderer/sidebar.test.tsx && npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/sidebar.ts tests/unit/renderer/sidebar.test.tsx
git commit -m "Recents ordering, status tags and unread as pure sidebar rules"
```

---

### Task 5: Renderer state: viewed tracking, tags, Show more

**Files:**
- Modify: `src/renderer/state/sessions.ts` (store type + `setPinned` neighbour; `useSidebarSections`; `listedSessionAt`)
- Create: `src/renderer/state/viewed.ts`
- Modify: `src/renderer/state/bridge.ts` (`hydrate`: start the tracker beside `trackWhereYouWere`)
- Test: `tests/unit/renderer/viewed.test.ts`

**Interfaces:**
- Consumes: channels from Task 2; `recentsSections`, `isUnread`, `RECENTS_LIMIT` from Task 4.
- Produces: store fields `markViewed(id: string): Promise<void>`, `setTag(id: string, tag: SessionTag | null): Promise<void>`, `recentsExpanded: boolean`, `setRecentsExpanded(expanded: boolean): void`; `trackViewed(): () => void` in `viewed.ts`. `useSidebarSections()` returns `recentsSections(...)` when `filters.groupBy === "recents"`.

- [ ] **Step 1: Write the failing test** (`tests/unit/renderer/viewed.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackViewed } from "@renderer/state/viewed";
import { useSessions } from "@renderer/state/sessions";
import type { Session } from "@shared/types";

const row = (overrides: Partial<Session>): Session => ({
  id: "s1", projectId: "p1", titleSource: "prompt", agentId: "claude-code", cwd: "/repo", gitMode: "none", title: "S1",
  createdAt: 0, updatedAt: 10, status: "idle", acpSessionId: "acp", changedFiles: 0, insertions: 0, deletions: 0,
  archived: false, pinned: false, sessionHead: null, turnHead: null, lastViewedAt: 5, statusOverride: null, ...overrides,
});

let focused = true;
let stop: () => void;
beforeEach(() => {
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.mocked(window.workbench.sessions.markViewed).mockClear();
  useSessions.setState({ sessions: [row({})], ready: true, activeId: null });
  stop = trackViewed();
});
afterEach(() => { stop(); vi.restoreAllMocks(); });

describe("marking the open chat viewed", () => {
  it("marks it when opened with the window focused", () => {
    useSessions.setState({ activeId: "s1" });
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledWith({ id: "s1" });
  });

  it("leaves it unread while the window is in the background, and marks it on focus", () => {
    focused = false;
    useSessions.setState({ activeId: "s1" });
    useSessions.setState({ sessions: [row({ updatedAt: 20 })] });
    expect(window.workbench.sessions.markViewed).not.toHaveBeenCalled();
    focused = true;
    window.dispatchEvent(new Event("focus"));
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledWith({ id: "s1" });
  });

  it("marks it again when a turn ends while it is open", () => {
    useSessions.setState({ activeId: "s1", sessions: [row({ lastViewedAt: 10 })] });
    vi.mocked(window.workbench.sessions.markViewed).mockClear();
    useSessions.setState({ sessions: [row({ updatedAt: 30, lastViewedAt: 10 })] });
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/renderer/viewed.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/renderer/state/viewed.ts`:

```ts
import { isUnread } from "@renderer/lib/sidebar";

import { useSessions } from "./sessions";

/**
 * The open chat counts as seen while the window has focus: when it is opened, when the window
 * comes back to the front with it open, and when something happens in it while it is on screen.
 * A chat that changed while elastic was in the background stays unread until then.
 * Returns the unsubscribe.
 */
export function trackViewed(): () => void {
  const check = () => {
    const { activeId, sessions, markViewed } = useSessions.getState();
    if (!activeId || !document.hasFocus()) return;
    const session = sessions.find((candidate) => candidate.id === activeId);
    if (!session) return;
    if (session.lastViewedAt === null || isUnread(session) || useSessions.getState().justOpened === activeId) {
      useSessions.setState({ justOpened: null });
      void markViewed(activeId).catch(() => {});
    }
  };
  const unsubscribe = useSessions.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId) useSessions.setState({ justOpened: state.activeId });
    if (state.activeId !== previous.activeId || state.sessions !== previous.sessions) check();
  });
  window.addEventListener("focus", check);
  return () => {
    unsubscribe();
    window.removeEventListener("focus", check);
  };
}
```

In `src/renderer/state/sessions.ts`, add to the state type and store:

```ts
  /** The chat just opened, until it has been marked viewed once (`state/viewed.ts`). */
  justOpened: string | null;
  markViewed: (id: string) => Promise<void>;
  setTag: (id: string, tag: SessionTag | null) => Promise<void>;
  /** Recents past its first ten rows, for this launch. */
  recentsExpanded: boolean;
  setRecentsExpanded: (expanded: boolean) => void;
```

```ts
  justOpened: null,
  recentsExpanded: false,
  setRecentsExpanded: (recentsExpanded) => set({ recentsExpanded }),
  markViewed: async (id) => {
    await window.workbench.sessions.markViewed({ id });
  },
  setTag: async (id, tag) => {
    // Optimistic, as rename is: the row says it at once; `sessions.changed` confirms it.
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? { ...session, statusOverride: tag } : session)) }));
    await window.workbench.sessions.setTag({ id, tag });
  },
```

In `useSidebarSections` and `listedSessionAt`, when `sidebar.groupBy === "recents"` use `recentsSections({ sessions, projects, filters: sidebar, hidden, expanded: recentsExpanded })` and call `listedSessions(sections, sidebar.collapsedProjects, { foldersCollapsed: sidebar.foldersCollapsed })`; otherwise keep the current `sidebarSections` path. Read `recentsExpanded` with a selector in the hook so the memo updates.

`src/renderer/state/bridge.ts` `hydrate`, after `stopTracking ??= trackWhereYouWere();`: `stopViewed ??= trackViewed();` with `let stopViewed: (() => void) | null = null;` beside `stopTracking` and the import.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/renderer/viewed.test.ts tests/unit/renderer/sidebar.test.tsx && npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/viewed.ts src/renderer/state/sessions.ts src/renderer/state/bridge.ts tests/unit/renderer/viewed.test.ts
git commit -m "Track the open chat as viewed while the window is focused"
```

---

### Task 6: Sidebar UI: Recents list, tags, unread, Folders header

**Files:**
- Create: `src/renderer/features/sidebar/StatusTag.tsx`, `src/renderer/features/sidebar/RecentsSection.tsx`
- Modify: `src/renderer/features/sidebar/SessionRow.tsx` (glyph, tag, menu items), `src/renderer/features/sidebar/Sidebar.tsx` (render by kind; hide `RunningNow` in recents)
- Test: `tests/unit/renderer/sidebar.test.tsx` (new `describe("Recents sidebar")`), `tests/unit/renderer/no-native-title.test.tsx` and `a11y-source.test.ts` must still pass

**Interfaces:**
- Consumes: `statusTag`, `STATUS_TAG_LABELS`, `isUnread` (Task 4); store `setTag`, `recentsExpanded`, `setRecentsExpanded`, `select` (Task 5); `focusComposerOf` (`@renderer/app/pane-focus`).
- Produces: rows with `data-status-tag={tag}`, `data-unread` when unread; `data-sidebar-recents`, `data-recents-more`, `data-sidebar-folders` hooks for tests.

- [ ] **Step 1: Write the failing tests**

```ts
describe("Recents sidebar", () => {
  beforeEach(() => {
    useProjects.setState({ projects: [project("p1", "elastic")], ready: true, activeId: "p1", draft: null });
    useSettings.setState({ settings: { ...defaultSettings(), sidebar: filters({ groupBy: "recents" }) }, ready: true });
    useSessions.setState({ recentsExpanded: false });
  });

  it("lists chats by recency with their tags and an unread mark, folders folded below", () => {
    useSessions.setState({
      ready: true, activeId: null,
      sessions: [
        session({ id: "a", title: "Alpha", updatedAt: 50, lastViewedAt: 10, changedFiles: 3 }),
        session({ id: "b", title: "Beta", status: "running", updatedAt: 20 }),
        session({ id: "c", title: "Gamma", updatedAt: 40, lastViewedAt: 45 }),
      ],
    });
    const view = wrap(<Sidebar />);
    const rows = [...view.container.querySelectorAll("[data-sidebar-recents] [data-session-row]")];
    expect(rows.map((row) => row.getAttribute("data-session-row"))).toEqual(["b", "a", "c"]);
    expect(rows.map((row) => row.getAttribute("data-status-tag"))).toEqual(["working", "review", "done"]);
    expect(rows[1]!.hasAttribute("data-unread")).toBe(true);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(view.container.querySelector("[data-sidebar-folders] [data-sidebar-section]")).toBeNull();
    expect(view.container.querySelector("[data-sidebar-running]")).toBeNull();
  });

  it("shows ten and offers the rest", async () => {
    const user = userEvent.setup();
    useSessions.setState({ ready: true, activeId: null, sessions: Array.from({ length: 13 }, (_, i) => session({ id: `s${i}`, title: `Chat ${i}`, updatedAt: i })) });
    const view = wrap(<Sidebar />);
    expect(view.container.querySelectorAll("[data-sidebar-recents] [data-session-row]")).toHaveLength(10);
    await user.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(view.container.querySelectorAll("[data-sidebar-recents] [data-session-row]")).toHaveLength(13);
  });

  it("sets a tag by hand from the row's menu", async () => {
    const user = userEvent.setup();
    useSessions.setState({ ready: true, activeId: null, sessions: [session({ id: "a", title: "Alpha" })] });
    wrap(<Sidebar />);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Alpha") });
    await user.click(await screen.findByRole("menuitem", { name: "Mark as Needs review" }));
    expect(window.workbench.sessions.setTag).toHaveBeenCalledWith({ id: "a", tag: "review" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/renderer/sidebar.test.tsx -t "Recents sidebar"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`StatusTag.tsx`:

```tsx
import { cn } from "cn";

import { STATUS_TAG_LABELS, type StatusTag as Tag } from "@renderer/lib/sidebar";

/** The row's tag pill. Semantic colour only where the tag asks for the person. */
export function StatusTag({ tag, manual }: { tag: Tag; manual: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 text-[10.5px] leading-4 whitespace-nowrap",
        tag === "waiting" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tag === "review" && "bg-info/15 text-info",
        tag === "failed" && "bg-destructive/15 text-destructive",
        (tag === "working" || tag === "done") && "bg-sidebar-accent text-muted-foreground",
        tag === "working" && "text-foreground",
      )}
      data-tag={tag}
    >
      {STATUS_TAG_LABELS[tag]}
      {manual ? <span aria-label=", set by hand"> ·</span> : null}
    </span>
  );
}
```

`SessionRow.tsx`: add props `recents?: boolean`. When `recents`, compute `const { tag, manual } = statusTag(session); const unread = isUnread(session);`, put `data-status-tag={tag}` and `data-unread={unread ? "" : undefined}` on the row root, render the leading glyph as the existing `StateGlyph` for running/waiting/error/connecting, else an unread dot (`<span aria-hidden className="size-1.5 rounded-full bg-info" />` in the same 16px box) when unread, else the idle ring; give the title `font-semibold` when unread; render `<StatusTag tag={tag} manual={manual} />` after the title (before the `…` button); include the tag label and "unread" in the row's existing `sr-only` status text. Add to `menuItems`, after Rename:

```tsx
      <MenuSeparator />
      <MenuItem label="Mark as Done" onSelect={() => void setTag(session.id, "done")} />
      <MenuItem label="Mark as Needs review" onSelect={() => void setTag(session.id, "review")} />
      <MenuItem label="Mark as Waiting on you" onSelect={() => void setTag(session.id, "waiting")} />
      {session.statusOverride ? <MenuItem label="Tag automatically" onSelect={() => void setTag(session.id, null)} /> : null}
```

with `const setTag = useSessions((state) => state.setTag);`. (The spec's "Tag submenu" is these four flat items: the shared `MenuItem` has no submenu kind, and four items read the same in both menus.)

`RecentsSection.tsx`:

```tsx
import { focusComposerOf } from "@renderer/app/pane-focus";
import { SessionRow } from "@renderer/features/sidebar/SessionRow";
import type { SidebarSection } from "@renderer/lib/sidebar";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import { useSidebarSettings } from "@renderer/state/settings";

/** Recents: the sidebar's main list (`lib/sidebar.ts`, `recentsSections`). */
export function RecentsSection({ section }: { section: SidebarSection }) {
  const activeId = useSessions((state) => state.activeId);
  const select = useSessions((state) => state.select);
  const expanded = useSessions((state) => state.recentsExpanded);
  const setExpanded = useSessions((state) => state.setRecentsExpanded);
  const projects = useProjects((state) => state.projects);
  const { showBranch } = useSidebarSettings();
  return (
    <section aria-label="Recents" className="mb-1" data-sidebar-recents>
      <div className="flex h-7 items-center px-2 text-[11px] font-medium text-muted-foreground">Recents</div>
      <div className="flex flex-col gap-px">
        {section.sessions.map((session) => (
          <SessionRow
            key={session.id}
            onSelect={() => {
              select(session.id);
              focusComposerOf(session.id);
            }}
            projectName={projects.find((project) => project.id === session.projectId)?.name}
            recents
            selected={session.id === activeId}
            session={session}
            showBranch={showBranch}
          />
        ))}
      </div>
      {(section.more ?? 0) > 0 || expanded ? (
        <button
          className="mt-px flex h-7 w-full items-center rounded-md pl-8 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-recents-more
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? "Show less" : `Show ${section.more} more`}
        </button>
      ) : null}
    </section>
  );
}
```

`Sidebar.tsx`: when `filters.groupBy === "recents"`: do not render `<RunningNow />`; render the pinned section with `SessionSection`, the `recents` section with `RecentsSection`, then a Folders header button (`data-sidebar-folders`, `aria-expanded={!filters.foldersCollapsed}`, a `ChevronRight` rotated when open, text `Folders` and a dim count of project sections) that calls `setSidebar({ foldersCollapsed: !filters.foldersCollapsed })`, and below it, only when not collapsed, the project sections with `SessionSection` and the existing `folderGroupLabel` labels. Other group-bys render exactly as today. The `empty` check counts the recents section's rows.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/renderer/ && npm run typecheck && npm run lint`
Expected: PASS, including `no-native-title` and `a11y-source`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/sidebar/ tests/unit/renderer/sidebar.test.tsx
git commit -m "Recents sidebar: tags, unread dot, Show more, folded Folders"
```

---

### Task 7: End to end, docs, release

**Files:**
- Create: `tests/e2e/recents.spec.ts` (follow `tests/e2e/shell.spec.ts`'s `launch` + fake agent setup)
- Modify: existing e2e specs that click folder sections by default (run the suite; where a spec relies on folder sections, set `groupBy: "project"` through the settings door it already uses, or expand Folders)
- Modify: `docs/design.md` (the sidebar section: Recents, tags, unread, activity rule), `VERSION`, `README.md` version line

- [ ] **Step 1: Write the e2e test** (`tests/e2e/recents.spec.ts`)

```ts
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const userData = scratch("recents");
  const project = scratch("recents-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Recents\n");
  ({ app, page } = await launch({ userData }));
  // Test windows never take OS focus; the app only counts a chat as seen while focused.
  await page.evaluate(() => { document.hasFocus = () => true; });
  await chooseDirectory(app, project);
});
test.afterAll(async () => { await app?.close(); });

const composer = () => page.locator("[data-session-view] .ProseMirror, [data-new-session] .ProseMirror").first();
const idle = () => expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });
const row = (id: string) => page.locator(`[data-sidebar-recents] [data-session-row="${id}"]`);

test("a chat that finishes while another is open is unread and needs review, and reads Done once opened", async () => {
  await composer().fill("write notes.md");
  await composer().press("Enter");
  await idle();
  await page.locator("[data-sidebar-link=New]").click();
  await composer().fill("hello");
  await composer().press("Enter");
  await idle();
  const [first] = await page.evaluate(async () =>
    (await window.workbench.sessions.list({})).sort((a, b) => a.createdAt - b.createdAt).map((s) => s.id));
  // The first chat works in the background while the second is open.
  await page.evaluate((id) => window.workbench.sessions.prompt({ id, content: [{ type: "text", text: "write more.md" }] }), first!);
  await expect(row(first!)).toHaveAttribute("data-status-tag", "review");
  await expect(row(first!)).toHaveAttribute("data-unread", "");
  await row(first!).locator("[data-session-row-title]").click();
  await expect(row(first!)).toHaveAttribute("data-status-tag", "done");
  await expect(row(first!)).not.toHaveAttribute("data-unread", "");
});
```

The fake agent writes the file named after `write` and reports a diff, so the chat's `changedFiles` is above zero.

- [ ] **Step 2: Run it**

Run: `npm run build && CI=1 npx playwright test tests/e2e/recents.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full checks**

Run: `npm run typecheck && npm run lint && npm test && CI=1 npx playwright test`
Expected: all pass (the machine runs at high load; re-run a single failing spec before treating it as a regression).

- [ ] **Step 4: Docs and version**

In `docs/design.md`'s sidebar section, add a paragraph: Recents is the default list (pinned, live, activity, Done last, 10 then Show more, Folders folded); tags and their rules; unread = activity after the last focused view; only turns stamp `updatedAt`. Bump `VERSION` to `0.1.6` and the README line.

- [ ] **Step 5: Commit, tag, release**

```bash
git add tests/e2e docs/design.md && git commit -m "Recents sidebar e2e and docs"
git add VERSION README.md && git commit -m "Release 0.1.6"
git push origin main && git tag -a v0.1.6 -m "elastic v0.1.6" && git push origin refs/tags/v0.1.6
```

Then wait for the Release and Test workflows, verify the DMG (`codesign --verify --deep --strict` on the mounted app), and publish the draft with notes.
