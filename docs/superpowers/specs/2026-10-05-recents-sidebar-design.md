# Recents sidebar

Date: 2026-10-05. Status: approved in conversation (interview + mockup), spec awaiting review.
Mockup: https://claude.ai/artifact/CqgkBJtkDPCcMvhPHKfWyK

## Why

Two problems Amy named: she loses track of **what each chat was for** and **which chats are
done, waiting on her, or need review**. Today the sidebar is folders of chats sorted by
activity, which answers "where is it" but not "what needs me".

## What it is

Recents becomes the sidebar's main list. Top to bottom:

1. **Pinned** chats, as today.
2. **Recents**: every chat that is not pinned or archived, in this order:
   - chats with a turn going or waiting on the person (tags Working, Waiting on you) first;
   - then the rest by last activity, newest first;
   - chats tagged **Done** after all the others, title dimmed.
   The first 10 rows show; a **Show N more** row expands the list (expanded for the rest of the
   launch, not saved).
3. **Folders**: the existing per-project sections, under one **Folders (n)** header, collapsed by
   default. Everything the folder sections do today (pinned folders, hide, `+`, menus) is
   unchanged inside it.

The separate **Running** strip (`RunningNow.tsx`) is not drawn in Recents mode: Recents already
puts running chats on top. It stays in Folders mode.

### Row

Glyph, title, folder name (dim), status tag at the end.

- **Glyph**: the pulsing dot while Working; a blue **unread dot** when something happened since
  the person last saw the chat; otherwise the idle ring.
- **Unread** also sets the title in semibold.
- **Tag**, a small pill: Working, Waiting on you, Needs review, Failed, Done. A tag set by hand
  carries a trailing `·`.

### Tags

Automatic, from what the app already knows:

| Tag | When |
| --- | --- |
| Working | status `running` (or `connecting` during a turn) |
| Waiting on you | status `waiting` (a permission or a question) |
| Failed | status `error` (the last turn failed) |
| Needs review | finished, unread, and the chat has changed files (`changedFiles > 0`) |
| Done | finished and not "Needs review" |

"Finished" is `idle` or `closed`. A manual tag (right-click: Done, Needs review, Waiting on you,
or Automatic) replaces the automatic one until the chat **starts its next turn**, when main
clears it. Working, Waiting on you and Failed are never hidden by a manual tag while true: a
manual tag only applies to a finished chat.

### Unread

A chat is unread when `updatedAt > lastViewedAt`. It is viewed when it is the open chat **and
the window has focus**: on opening it, on the window gaining focus with it open, and when one of
its turns ends while it is on screen. Viewing never stamps `updatedAt` (it is not activity), so
opening a chat does not reorder the list. A chat never viewed (`lastViewedAt` null, every chat on
upgrade) counts as read, so the upgrade does not paint every chat unread.

## Data

Migration 14, `session-recents`, on `sessions`:

```sql
ALTER TABLE sessions ADD COLUMN last_viewed_at INTEGER;
ALTER TABLE sessions ADD COLUMN status_override TEXT;
```

`Session` gains `lastViewedAt: number | null` and `statusOverride: "done" | "review" |
"waiting" | null` (unknown stored values read as null).

New `sessions.*` channels (`src/shared/ipc/acp.ts`, handlers in `src/main/ipc/acp.ts`, through
`SessionManager`):

- `markViewed({ id })`: writes `last_viewed_at = now` without touching `updatedAt`; broadcasts
  `sessions.changed` like `setPinned` does.
- `setTag({ id, tag })`: writes `status_override` (null for Automatic), same broadcast rules.

`SessionManager` clears `status_override` when a prompt starts (the same place a turn marks
`running`).

Settings: `SidebarGroupBySchema` gains `"recents"` and it becomes the default. `SidebarSettings`
gains `foldersCollapsed: boolean` (default true). Existing installs store
`groupBy: "project"` explicitly, so the first launch of this version moves a stored `"project"`
to `"recents"` once, recorded under the internal settings key `__recentsDefaulted` so a person who
switches back to Folders stays there. The filter menu's Group by offers Recents, Folders, None.

## Renderer

- `src/renderer/lib/sidebar.ts`: `statusTag(session)` and `recentsSections(input)` as pure
  functions next to `sidebarSections`, with the order and tag rules above. The existing rules
  (filters first, hidden folders, archived) apply to Recents too. `listedSessions` (Mod+1..9)
  counts the rows on screen in the new order, Show more included.
- `src/renderer/features/sidebar/`: a `StatusTag` pill and the unread glyph in `SessionRow`; a
  Recents section with Show more; the Folders header wrapping the existing `SessionSection`s.
  The right-click and `…` menus gain a **Tag** submenu.
- `src/renderer/state/sessions.ts`: `markViewed` and `setTag`, optimistic like `setPinned`.
  The view tracking (open chat + window focus) lives beside `trackWhereYouWere`.

Design follows `DESIGN.md`: neutral tokens; the only colour is semantic (waiting amber,
review blue, failed red), with both themes checked. Tags and dots carry text for screen readers
(the row's `aria-describedby`, as the status glyph does now).

## Out of scope

Auto-written one-line gists per chat (considered; tags chosen instead). Auto-archiving Done chats.
Saving Show more across launches.

## Testing

- `lib/sidebar` unit tests: tag table above; order (pinned, live, activity, Done last); 10-row
  cut and Show more; never-viewed reads as read; manual tag ignored while Working/Waiting/Failed.
- Main: migration 14 up from a v13 database with rows; `markViewed` leaves `updatedAt` alone;
  `setTag` round trip; a prompt start clears the override.
- Settings: the one-time `project` to `recents` move, and that a later switch back sticks.
- Renderer: sidebar renders Recents with tags and the unread dot; opening a chat clears unread;
  the Tag menu sets and clears an override; Folders header collapses and expands.
- e2e: a chat that finishes while another is open shows unread + Needs review, and reads Done
  after it is opened. Existing sidebar e2e specs updated for the new default layout.
