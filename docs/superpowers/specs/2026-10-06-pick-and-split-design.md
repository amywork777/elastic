# Click-to-prompt and two chats side by side

Date: 2026-10-06. Status: designs approved in conversation; spec awaiting review.

Two features from the parity audit (Claude and ChatGPT desktop apps). They share nothing but the
release, so they are two parts with separate tasks.

## Part 1: click-to-prompt (pick an element)

**Why.** Pointing beats describing for design work. Today a browser tab (and the live preview) can
add its selected text or a whole-page screenshot to the prompt; it cannot say "this button".

**What.**
- A crosshair button in the browser tab's toolbar, beside "Add selected text" and "Add page
  screenshot", starts **pick mode**. While on: hovering outlines the element under the pointer
  with a label (tag and size); a click picks it; Shift-click picks several, one chip each; Esc,
  the button again, or navigating away stops it. Picking never clicks the page's own controls.
- Each pick becomes one composer chip: a cropped screenshot of the element (its bounding box,
  4 px padding, clamped to the viewport) and, alongside it in the prompt, the element's outer
  HTML (trimmed to 4 KB, scripts and styles removed), a CSS selector that finds it, the page URL
  and the element's size. In the prompt this reads as "Element on <url>: `<selector>` …" plus
  the image, so the agent can find it in the source or drive it with Playwright.
- Works on every page in the browser tab, the live preview included.

**How.**
- Main injects the picker into the page in an **isolated world** (`executeJavaScriptInIsolatedWorld`),
  so the page's scripts can neither see nor forge it. The picker draws its own overlay (a
  positioned outline in a closed shadow root), listens on capture-phase pointer events with
  `preventDefault`, and resolves with `{ rect, html, selector, size }` per pick.
- Main crops with `webContents.capturePage(rect)` (device pixels handled by Electron).
- The renderer reuses the existing capture-to-prompt path (`browser.capture`, `kind` gains
  `"element"`, `addContext` in `BrowserTab.tsx`) so the chip, its removal and the prompt blocks
  work as selection and screenshot already do. The page's generation check applies: a pick from
  a page that has since navigated is refused, as captures are today.
- New IPC: `browser.pick({ ..., active: boolean })` starts or stops pick mode; picks arrive as a
  `browser.picked` event `{ tabId, picks: [...] }` (the person can pick several before the mode
  ends). The agent's own CDP input is refused while pick mode is on.

**Tests.** Unit: selector builder (id, unique class path, nth-of-type fallback) and the HTML trim
(scripts/styles out, cap). Main: picking resolves rect/html/selector from a fixture page; a page
script cannot read the overlay or call the picker. e2e: start pick mode on a local page, click a
button, a chip with an image appears; the page's own click handler did not run; Esc ends it.

## Part 2: two chats side by side

**Why.** Running several agents at once; comparing two chats; one chat building while another
reviews. Both rival apps now tile.

**What.**
- ⌘-click a chat in the sidebar (Ctrl elsewhere), or **Open beside** in its right-click menu,
  opens it to the right of the current chat. Each side has its own header, transcript and
  composer. A vertical divider between them drags (each side at least 360 px; the split ratio is
  remembered in `layout`).
- The **focused side** is the one last clicked into (or typed in). The explorer pane (files,
  browser, preview, terminals) belongs to the focused side's chat and swaps when focus moves.
  The focused side's header carries a quiet accent so it is clear whose tabs are showing.
- Each side's header has **Close** (✕); closing one side returns to a single chat (the other).
  Clicking a chat in the sidebar normally replaces the **focused** side; a chat already open on
  the other side just takes focus there.
- Sidebar: both open chats show as selected (the focused one stronger). Recents' unread rule
  counts both as on screen while the window has focus.
- Shortcuts act on the focused side: ⌘N replaces the focused side with a new chat, ⌘1..9 opens
  into the focused side, ⌘W in the composer closes the focused side when split. ⌘\ (toggle) and
  ⌘⌥←/→ move focus between sides.
- Below about 1100 px of window width the split collapses to the focused chat (the other side
  stays remembered and returns when the window widens).

**How.**
- `useSessions` gains `split: { left: string; right: string } | null` (in memory, plus
  `lastSplit` persisted in settings with the ratio). `activeId` keeps its meaning: the chat the
  keyboard and the explorer are about, now always one of `split`'s two when split. Everything
  that binds to `activeId` today (explorer `bindSession`, where-you-were, viewed tracking,
  shortcuts) follows the focused side without change.
- `SessionPane` renders one `SessionView` per side inside a resizable group (the same panel
  primitives the shell uses for the explorer); a side reports focus with `pointerdown` and
  `focusin` on its root, which calls `select(id)` for that side.
- `viewed.ts` marks both sides viewed; `sidebarSections`/row selection reads `split` too.
- Session-level effects that assume one visible chat are audited: `focusComposerOf` (targets
  the focused side's view), the composer's focus requests (keyed by session, already),
  `ensureLoaded` (both sides load), keep-alive (both sides are "recently used").

**Tests.** Unit: the split store (open beside, replace focused side, focus swap, close each side,
open a chat that is already on the other side). Renderer: two `SessionView`s render; clicking
into the right side makes it active and the explorer binds to it; ⌘1 opens into the focused
side; closing a side. e2e: ⌘-click a second chat, send a message in each side, both transcripts
update; the explorer follows focus; drag the divider; narrow window collapses and restores.

## Out of scope

Three or more chats; split inside the explorer pane; dragging tabs between sides; picking
elements inside cross-origin iframes (the picker sees the top frame and same-origin frames).
