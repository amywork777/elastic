import { create } from "zustand";
import type { BrowserTarget } from "@shared/browser";
import { useExplorer } from "./explorer";
import { useSessions } from "./sessions";
import { errorMessage } from "@shared/ipc/errors";

type BrowserBinding = { sessionId: string; projectId: string; root: string | null; tabId: string };
type BrowserState = {
  targets: Record<string, BrowserTarget>;
  errors: Record<string, string | undefined>;
  /** Tabs whose console panel is open: only those poll for console lines. */
  consoles: Record<string, boolean | undefined>;
  setConsoleOpen: (tabId: string, open: boolean) => void;
  mount: (binding: BrowserBinding, url: string | null, element: HTMLElement) => () => void;
  navigate: (binding: BrowserBinding, navigation: { url?: string; direction?: "back" | "forward" | "reload" | "stop" }) => Promise<void>;
  clearConsole: (tabId: string) => void;
  contextAttachment: (binding: BrowserBinding, target: BrowserTarget, kind: "selection" | "screenshot") => Promise<Blob>;
};

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * Whether an overlay of the window's own covers the page. The page is a native view drawn over
 * the window, so a menu, dialog or toast that overlaps it can only show if the page steps aside.
 * A dialog always counts (its backdrop dims the whole window). A tooltip never does (it is a
 * hint, and hiding the page on every hover blanks the tab). A menu, popover or toast counts only
 * where its box overlaps the page.
 */
export function pageOccluded(overlays: Iterable<Element>, view: Box): boolean {
  for (const overlay of overlays) {
    if (overlay.matches('[role="tooltip"]') || overlay.querySelector('[role="tooltip"], [data-slot="tooltip-content"]')) continue;
    // A dialog dims the whole window behind it, the page included, wherever its box sits.
    if (overlay.matches('[role="dialog"], [role="alertdialog"]')) return true;
    const box = overlay.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (box.left < view.right && box.right > view.left && box.top < view.bottom && box.bottom > view.top) return true;
  }
  return false;
}

/** Renderer chrome borrows a page; unmount hides it and never destroys its document. */
export const useBrowser = create<BrowserState>((set, get) => {
  /** Wakes a mounted tab's poll now (the console was just opened). */
  const wakers = new Map<string, () => void>();
  const accept = (incoming: BrowserTarget, withLogs = true) => {
    const state = get();
    const previous = state.targets[incoming.tabId];
    // A poll without console lines keeps the lines already shown.
    const target = withLogs ? incoming : { ...incoming, logs: previous?.logs ?? [] };
    if (!previous || !sameTarget(previous, target) || state.errors[target.tabId] !== undefined) {
      set(current => ({ targets: { ...current.targets, [target.tabId]: target }, errors: { ...current.errors, [target.tabId]: undefined } }));
    }
    const explorer = useExplorer.getState();
    const tab = explorer.tabs.find(tab => tab.id === target.tabId);
    if (explorer.sessionId === target.sessionId && explorer.projectId === target.projectId && tab?.kind === "browser" && target.url && target.url !== "about:blank" && tab.url !== target.url) {
      explorer.update(tab.id, { url: target.url });
    }
  };
  const failed = (tabId: string, error: unknown) => {
    const message = errorMessage(error);
    // The same failure again is not a change: no new state, no re-render.
    if (get().errors[tabId] !== message) set(state => ({ errors: { ...state.errors, [tabId]: message } }));
  };
  return {
    targets: {}, errors: {}, consoles: {},
    setConsoleOpen: (tabId, open) => {
      if (Boolean(get().consoles[tabId]) === open) return;
      set(state => ({ consoles: { ...state.consoles, [tabId]: open } }));
      if (open) wakers.get(tabId)?.();
    },
    mount: (binding, url, element) => {
      const lease = crypto.randomUUID();
      // `stopped`: the workspace refused this tab (archived, deleted, its
      // worktree removed). Every later poll would fail the same way.
      let disposed = false, ready = false, pending = false, stopped = false;
      let previousBox = "";
      let frame = 0;
      // The page shows only while its tab is the selected one of the chat on screen. Read from the
      // stores, not from this element still being mounted: the tab that replaces it is rendered
      // first, and a heavy one (an editor, a review) left the native page over it for a second.
      const selected = () => {
        const explorer = useExplorer.getState();
        return explorer.activeId === binding.tabId && explorer.sessionId === binding.sessionId
          && useSessions.getState().activeId === binding.sessionId;
      };
      const hideNow = () => {
        if (disposed || !ready || previousBox === "null") return;
        previousBox = "null";
        void window.workbench.browser.present({ ...binding, lease, bounds: null }).catch(() => {});
      };
      const present = () => {
        if (disposed || !ready) return;
        if (!selected()) { hideNow(); return; }
        const rect = element.getBoundingClientRect();
        const pageURL = get().targets[binding.tabId]?.url;
        const occluded = pageOccluded(document.querySelectorAll('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], [data-sonner-toast]'), rect);
        const bounds = !occluded && pageURL && pageURL !== "about:blank" && rect.width > 0 && rect.height > 0
          ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height } : null;
        const key = JSON.stringify(bounds);
        if (key === previousBox) return;
        previousBox = key;
        void window.workbench.browser.present({ ...binding, lease, bounds }).catch(error => failed(binding.tabId, error));
      };
      // Layout and overlays are read at most once per frame, however many
      // mutations a streamed transcript makes in it.
      const schedule = () => {
        if (disposed || frame) return;
        frame = requestAnimationFrame(() => { frame = 0; present(); });
      };
      const poll = async () => {
        if (disposed || !ready || pending || stopped) return;
        pending = true;
        const logs = Boolean(get().consoles[binding.tabId]);
        try { const target = await window.workbench.browser.metadata({ ...binding, logs }); if (!disposed) { accept(target, logs); schedule(); } }
        catch (error) {
          // A workspace refusal will not change by asking again; anything else
          // (a transient failure) keeps polling.
          if (!disposed) { if (isScopeRefusal(error)) stopped = true; failed(binding.tabId, error); }
        } finally { pending = false; }
      };
      const wake = () => { stopped = false; void poll(); };
      wakers.set(binding.tabId, wake);
      void window.workbench.browser.ensure({ ...binding, url }).then(target => {
        if (disposed) return;
        ready = true;
        accept(target);
        present();
      }).catch(error => { if (!disposed) failed(binding.tabId, error); });
      // On the click itself: a store write runs its subscribers before React renders anything.
      const follow = () => { if (!selected()) hideNow(); else if (previousBox === "null") schedule(); };
      const stopExplorer = useExplorer.subscribe(follow);
      const stopSessions = useSessions.subscribe(follow);
      // Earlier still: on the press of another tab or another chat, not its click, which comes a
      // tenth of a second later when the button is let go. A press that selects nothing (a drag
      // to reorder, a press let go elsewhere) shows the page again on release.
      const pressed = (event: PointerEvent) => {
        if (event.button !== 0 || !(event.target instanceof Element)) return;
        const tab = event.target.closest<HTMLElement>("[data-tab]")?.dataset.tab;
        const chat = event.target.closest<HTMLElement>("[data-session-row]")?.dataset.sessionRow;
        if ((tab && tab !== binding.tabId) || (chat && chat !== binding.sessionId)) hideNow();
      };
      const released = () => { if (selected() && previousBox === "null") schedule(); };
      window.addEventListener("pointerdown", pressed, true);
      window.addEventListener("pointerup", released, true);
      window.addEventListener("pointercancel", released, true);
      const resize = new ResizeObserver(schedule);
      resize.observe(element);
      const overlays = new MutationObserver(schedule);
      overlays.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("resize", schedule);
      // A sibling pane moving changes our origin even when this element's size is unchanged.
      const timer = window.setInterval(() => { schedule(); void poll(); }, 500);
      return () => {
        disposed = true;
        if (wakers.get(binding.tabId) === wake) wakers.delete(binding.tabId);
        if (frame) cancelAnimationFrame(frame);
        resize.disconnect(); overlays.disconnect(); window.removeEventListener("resize", schedule); clearInterval(timer);
        stopExplorer(); stopSessions();
        window.removeEventListener("pointerdown", pressed, true);
        window.removeEventListener("pointerup", released, true);
        window.removeEventListener("pointercancel", released, true);
        void window.workbench.browser.present({ ...binding, lease, bounds: null }).catch(() => {});
      };
    },
    navigate: async (binding, navigation) => {
      try { accept(await window.workbench.browser.navigate({ ...binding, ...navigation })); wakers.get(binding.tabId)?.(); }
      catch (error) { failed(binding.tabId, error); }
    },
    contextAttachment: async (binding, target, kind) => {
      const captured = await window.workbench.browser.capture({ ...binding, url: target.url, generation: target.generation, kind });
      return new Blob([Uint8Array.from(atob(captured.base64), character => character.charCodeAt(0))], { type: captured.mimeType });
    },
    clearConsole: tabId => set(state => {
      const target = state.targets[tabId];
      if (target) void window.workbench.browser.clearConsole({ sessionId: target.sessionId, projectId: target.projectId, root: target.root, tabId }).catch(() => {});
      return target ? { targets: { ...state.targets, [tabId]: { ...target, logs: [], errors: 0 } } } : {};
    }),
  };
});

/**
 * Refusals asking again cannot change: the scope checks in
 * `src/main/ipc/browser.ts`, `rootOf`'s closed project, and the service's
 * closed or destroyed tab.
 */
const SCOPE_REFUSALS = [
  "This session is no longer active.", "This session's workspace is missing.", "This browser belongs to a different session workspace.",
  "that project is no longer open", "This browser tab is not available in this session's workspace.",
];
function isScopeRefusal(error: unknown) {
  const message = errorMessage(error);
  return SCOPE_REFUSALS.some(refusal => message.includes(refusal));
}

function sameTarget(a: BrowserTarget, b: BrowserTarget): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof BrowserTarget)[]);
  for (const key of keys) if (key !== "logs" && a[key] !== b[key]) return false;
  return a.logs.length === b.logs.length && a.logs.every((line, index) => line.level === b.logs[index]!.level && line.message === b.logs[index]!.message);
}
