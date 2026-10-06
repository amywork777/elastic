/**
 * The app's keyboard shortcuts, in one table: every menu accelerator of a
 * packaged build and the keys the renderer binds to its own commands. A
 * control's own keys — arrows in a list, Delete on a focused tab — are not in it.
 *
 * The Settings page renders this; the app menu (`src/main/menu.ts`) declares
 * the accelerators that make several of them work when focus is inside a
 * webview. Two declarations of the same key would drift, so this table is the
 * one a person reads and the menu is the one Electron reads — and
 * `tests/unit/main/shortcuts-menu.test.ts` holds them to the same keys: every
 * menu accelerator is a row here, and every Application row with a modifier
 * is a menu accelerator. Two bindings are left out. The development build's
 * `Reload App` (Mod+Alt+R), because a packaged app does not have it; and the
 * toast chord (`components/ui/sonner.tsx`: Cmd+Option+T on a Mac, Ctrl+Shift+T
 * elsewhere), because a row holds one portable binding and this one differs by
 * platform — the Settings page prints it as a footnote instead.
 *
 * A binding is written once, in the portable form (`Mod+K`), and rendered per
 * platform: `Mod` is ⌘ on macOS and Ctrl everywhere else. One row needs more
 * than that: the explorer's tab digits are ⌃1–9 on a Mac, and off a Mac Ctrl is
 * `Mod`, which the chats' digits already hold, so that row names its keys there
 * in `offMac`.
 */

/** The groups the page prints, in order. */
export const SHORTCUT_GROUPS = ["Application", "Session", "Explorer"] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export type Shortcut = {
  id: string;
  group: ShortcutGroup;
  label: string;
  /** `Mod`, `Alt`, `Shift`, `Ctrl` and a key, joined by `+`. */
  binding: string;
  /** The far end of a range, for the nine tab shortcuts that are one row. */
  through?: string;
  /** The keys on Windows and Linux, for the one row whose keys are not `Mod` there. */
  offMac?: { binding: string; through?: string };
};

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "new-session", group: "Application", label: "New session", binding: "Mod+N" },
  { id: "command-palette", group: "Application", label: "Command palette", binding: "Mod+K" },
  { id: "settings", group: "Application", label: "Settings", binding: "Mod+," },
  { id: "close-settings", group: "Application", label: "Close Settings or the palette", binding: "Escape" },
  { id: "toggle-sidebar", group: "Application", label: "Toggle sidebar", binding: "Mod+B" },
  { id: "toggle-explorer", group: "Application", label: "Toggle explorer", binding: "Mod+Alt+B" },
  // The top level only: the threads and new-session screens the session pane
  // has shown. The explorer's tabs have their own strip and are not in it.
  { id: "navigate-back", group: "Application", label: "Back", binding: "Mod+[" },
  { id: "navigate-forward", group: "Application", label: "Forward", binding: "Mod+]" },
  // Renderer-only, like Escape: focus between the sidebar, the session and the
  // explorer, skipping a pane that is shut (`Shell`).
  { id: "next-pane", group: "Application", label: "Focus the next pane", binding: "F6" },
  { id: "previous-pane", group: "Application", label: "Focus the previous pane", binding: "Shift+F6" },
  // The sidebar's rows top to bottom, as drawn (`listedSessions`); 9 is the last.
  {
    id: "switch-chat",
    group: "Application",
    label: "Switch to chat 1–9",
    binding: "Mod+1",
    through: "Mod+9",
  },
  // Renderer-only: two chats side by side (`useSplitShortcuts` in `Shell`).
  { id: "split-other-side", group: "Application", label: "Focus the other side of two chats", binding: "Mod+\\" },
  { id: "split-left", group: "Application", label: "Focus the left chat", binding: "Mod+Alt+Left" },
  { id: "split-right", group: "Application", label: "Focus the right chat", binding: "Mod+Alt+Right" },

  { id: "send", group: "Session", label: "Send", binding: "Enter" },
  {
    id: "newline",
    group: "Session",
    label: "New line in the composer",
    binding: "Shift+Enter",
  },
  { id: "stop", group: "Session", label: "Stop the current turn", binding: "Escape" },

  { id: "new-file-tab", group: "Explorer", label: "New file tab", binding: "Mod+T" },
  { id: "new-review-tab", group: "Explorer", label: "New review tab", binding: "Mod+Shift+R" },
  { id: "new-browser-tab", group: "Explorer", label: "New browser tab", binding: "Mod+Shift+B" },
  // Control on every platform, not `Mod`: ⌃` is what a person already presses
  // for a terminal, and it is the same key on the machine they came from.
  { id: "new-terminal-tab", group: "Explorer", label: "New terminal tab", binding: "Ctrl+`" },
  { id: "close-tab", group: "Explorer", label: "Close tab", binding: "Mod+W" },
  // The menu's `Reload Page`: the focused browser tab's page, never the app.
  { id: "reload-page", group: "Explorer", label: "Reload the browser page", binding: "Mod+R" },
  // Code and Markdown files, from their own editors.
  { id: "save-file", group: "Explorer", label: "Save the file", binding: "Mod+S" },
  // The file tree's focused row; Ctrl+Delete works off macOS too.
  { id: "rename-entry", group: "Explorer", label: "Rename in the file tree", binding: "F2" },
  { id: "trash-entry", group: "Explorer", label: "Move to Trash in the file tree", binding: "Mod+Backspace" },
  // Monaco's tab-focus mode, and the terminal's: while it is on, Tab leaves the
  // editor or the shell rather than typing into it. Control on every platform.
  {
    id: "tab-focus-mode",
    group: "Explorer",
    label: "Toggle Tab moving focus out of an editor or terminal",
    binding: "Ctrl+Shift+M",
  },
  // Control on a Mac, beside the chats' ⌘ digits; Alt off it, where Ctrl is the chats'.
  {
    id: "switch-tab",
    group: "Explorer",
    label: "Switch to tab 1–9",
    binding: "Ctrl+1",
    through: "Ctrl+9",
    offMac: { binding: "Alt+1", through: "Alt+9" },
  },
];

/** A row's keys on this platform: its own, or `offMac` off a Mac. */
export function bindingOn(shortcut: Shortcut, mac: boolean): { binding: string; through?: string } {
  return !mac && shortcut.offMac ? shortcut.offMac : { binding: shortcut.binding, through: shortcut.through };
}

/** Every chord a row stands for, a range spelled out: `Mod+1` through `Mod+9` is nine. */
export function bindingsOf(shortcut: Pick<Shortcut, "binding" | "through">): string[] {
  const last = shortcut.through?.at(-1);
  const first = shortcut.binding.at(-1);
  if (!shortcut.through || !last || !first) return [shortcut.binding];
  const prefix = shortcut.binding.slice(0, -1);
  const keys: string[] = [];
  for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code += 1) {
    keys.push(prefix + String.fromCharCode(code));
  }
  return keys;
}

/** How a modifier prints on each platform. */
const GLYPHS: Record<string, { mac: string; other: string }> = {
  Mod: { mac: "⌘", other: "Ctrl" },
  Ctrl: { mac: "⌃", other: "Ctrl" },
  Alt: { mac: "⌥", other: "Alt" },
  Shift: { mac: "⇧", other: "Shift" },
  Enter: { mac: "⏎", other: "Enter" },
  // "esc" rather than ⎋: the glyph exists, but it is drawn at cap height in
  // most mono faces and reads as a smudge next to ⌘K. Apple's own keycaps say
  // esc.
  Escape: { mac: "esc", other: "Esc" },
  Backspace: { mac: "⌫", other: "Backspace" },
  // Keycaps, as Apple prints them; spelled out elsewhere.
  Left: { mac: "←", other: "Left" },
  Right: { mac: "→", other: "Right" },
};

/**
 * The binding as one string: `⌘K` on macOS, `Ctrl+K` elsewhere.
 *
 * macOS runs the glyphs together, which is how every macOS menu prints them;
 * every other platform joins with `+`, which is how every other platform does.
 */
export function shortcutKeys(binding: string, mac: boolean): string {
  const parts = binding.split("+").map((part) => {
    const glyph = GLYPHS[part];
    if (glyph) {
      return mac ? glyph.mac : glyph.other;
    }
    return part.length === 1 ? part.toUpperCase() : part;
  });
  return mac ? parts.join("") : parts.join("+");
}

/** The shortcuts of one group, in declaration order. */
export function shortcutsIn(group: ShortcutGroup): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.group === group);
}

/**
 * A hint's words with the control's keys, as the tooltips show them: "Settings ⌘,". Read from the
 * table, so a hint never names a key the app does not bind.
 */
export function hintWith(label: string, id: string, mac: boolean): string {
  const shortcut = SHORTCUTS.find((candidate) => candidate.id === id);
  return shortcut ? `${label}  ${shortcutKeys(bindingOn(shortcut, mac).binding, mac)}` : label;
}
