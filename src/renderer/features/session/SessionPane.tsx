import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { FolderOpen } from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { useOpenFolderOrToast } from "@renderer/hooks/use-open-folder";
import { isPrimaryModifier } from "@renderer/lib/platform";
import { cn } from "@renderer/lib/utils";
import { useActiveProject } from "@renderer/state/projects";
import { useSessions, type SplitSide } from "@renderer/state/sessions";
import { useSettings } from "@renderer/state/settings";

import { NewSession } from "./NewSession";
import { SessionHeader } from "./SessionHeader";
import { SessionView } from "./SessionView";
import { SplitSideContext } from "./split-side";

/** Each side's least width. A pane narrower than two of them (a narrow window, or the explorer
 * open) shows the focused side only; the other returns when there is room. */
const SIDE_MIN = 360;
/** The window width that stands in before the pane has been measured. */
const SPLIT_MIN_WINDOW = 1100;
const RATIO_MIN = 0.25;
const RATIO_MAX = 0.75;
const clampRatio = (ratio: number) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));

/** The pane's own width, measured (0 until it has been), and the ref that measures it. */
function useMeasuredWidth() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(() => setWidth(node.getBoundingClientRect().width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [width, ref] as const;
}

function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/**
 * One thread, one agent (plan §3). Three states: no project yet, the
 * new-session state for the active project, and a session.
 *
 * Cmd/Ctrl+N is bound here as well as in the app menu — the menu's
 * accelerator is the one that works while focus is in a webview, this one
 * works when the menu is hidden — and both end at the same store action.
 *
 * Two chats side by side (`split`): one side each, a divider between them, and the side last
 * clicked or typed into is the focused one (`activeId`, the explorer's chat).
 */
export function SessionPane() {
  const activeId = useSessions((state) => state.activeId);
  const split = useSessions((state) => state.split);
  const setActiveSession = useSessions((state) => state.setActive);
  const [paneWidth, pane] = useMeasuredWidth();
  const windowWidth = useWindowWidth();
  const wide = paneWidth > 0 ? paneWidth >= SIDE_MIN * 2 + 1 : windowWidth >= SPLIT_MIN_WINDOW;
  const { ratio, dragging, onPointerDown, onKeyDown } = useSplitRatio();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "n" && isPrimaryModifier(event) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setActiveSession(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setActiveSession]);

  // One row of frames keyed by their chat, whether one chat or two: a chat keeps its view (its
  // scroll, its paged-in history, its composer) as the split opens or closes, and a side the pane
  // is too narrow for is hidden rather than unmounted.
  const frames = split
    ? (["left", "right"] as const).map((side) => ({ side, id: split[side] }))
    : [{ side: null, id: activeId }];
  const divider = split && wide ? (
    <div
      aria-label="Resize the two chats"
      aria-orientation="vertical"
      aria-valuemax={RATIO_MAX * 100}
      aria-valuemin={RATIO_MIN * 100}
      aria-valuenow={Math.round(ratio * 100)}
      className={cn("relative z-10 w-px shrink-0 cursor-col-resize bg-border outline-none after:absolute after:inset-y-0 after:-inset-x-[3px] focus-visible:bg-ring", dragging && "bg-ring")}
      data-split-divider
      key="divider"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={0}
    />
  ) : null;

  return (
    <div className="flex h-full min-w-0" data-session-pane data-split={split ? "" : undefined} ref={pane}>
      {frames.flatMap(({ side, id }, index) => [
        index === 1 ? divider : null,
        <Frame
          hidden={Boolean(split && !wide && split.focus !== side)}
          id={id}
          key={id ?? `new-${side ?? "left"}`}
          share={!split || !wide ? 1 : side === "left" ? ratio : 1 - ratio}
          side={side}
        />,
      ])}
    </div>
  );
}

/** The divider's share: follows a drag as it happens, and is written once, at its end. */
function useSplitRatio() {
  const stored = useSettings((state) => state.settings?.layout.splitRatio ?? 0.5);
  const setLayout = useSettings((state) => state.setLayout);
  const [ratio, setRatio] = useState(stored);
  const [dragging, setDragging] = useState(false);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setRatio(stored);
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const row = event.currentTarget.parentElement;
    if (!row || event.button !== 0) return;
    // As the shell's separators do: listeners on the window, no pointer capture, and no text
    // selection while the gesture lasts, so a drag across a transcript does not highlight it.
    event.preventDefault();
    document.body.style.setProperty("user-select", "none");
    const box = row.getBoundingClientRect();
    let latest = ratio;
    setDragging(true);
    const move = (moved: PointerEvent) => {
      latest = clampRatio((moved.clientX - box.left) / Math.max(1, box.width));
      setRatio(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.removeProperty("user-select");
      setDragging(false);
      void setLayout({ splitRatio: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowLeft" ? -0.02 : event.key === "ArrowRight" ? 0.02 : 0;
    if (!step) return;
    event.preventDefault();
    const next = clampRatio(Math.round((ratio + step) * 100) / 100);
    setRatio(next);
    void setLayout({ splitRatio: next });
  };
  return { ratio, dragging, onPointerDown, onKeyDown };
}

/** One chat's place in the pane: the whole of it, or one side of a split. */
function Frame({ side, id, share, hidden }: { side: SplitSide | null; id: string | null; share: number; hidden: boolean }) {
  const focusSide = useSessions((state) => state.focusSide);
  const focused = useSessions((state) => side !== null && state.split?.focus === side);
  const take = () => { if (side && useSessions.getState().split?.focus !== side) focusSide(side); };
  return (
    <SplitSideContext.Provider value={side}>
      <div
        className={cn("flex h-full min-w-0 flex-col overflow-hidden", side && "min-w-[360px]", hidden && "hidden")}
        data-split-focused={focused ? "" : undefined}
        data-split-side={side ?? undefined}
        hidden={hidden}
        onFocusCapture={take}
        onPointerDownCapture={take}
        style={{ flex: `${share} 1 0%` }}
      >
        <OneChat id={id} side={side} />
      </div>
    </SplitSideContext.Provider>
  );
}

/**
 * One chat, or the new-chat screen when `id` is null: for the active project, or, in the side of
 * a split that does not have focus, for the folder that side was left on.
 */
function OneChat({ id, side }: { id: string | null; side: SplitSide | null }) {
  const active = useActiveProject();
  const kept = useSessions((state) => (side && state.split?.focus !== side ? state.splitProjects[side] : undefined));
  const project = kept ?? active;
  const session = useSessions((state) => (id ? state.sessions.find((candidate) => candidate.id === id) ?? null : null));
  const openFolder = useOpenFolderOrToast();

  if (session) {
    return <SessionView key={session.id} session={session} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* No folder yet: nothing to name — the main area's Open folder… is the whole message. */}
      <SessionHeader session={null} title={project ? project.name : ""} />
      {project ? (
        <NewSession key={project.id} project={project} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-10" data-no-project>
          <div className="w-full max-w-[720px]">
            <h1 className="text-center text-[22px] leading-tight font-medium tracking-tight text-balance">
              Choose a folder to get started
            </h1>
            <p className="mt-2 text-center text-[13px] text-balance text-muted-foreground">
              A session always belongs to a folder.
            </p>
            {/* The chooser itself, not a sentence pointing at one: with no
                project there is no project chip to open `Open folder…` from,
                and this screen is the whole app until there is. */}
            <div className="mt-4 flex justify-center">
              <Button onClick={() => void openFolder()} size="sm" variant="secondary">
                <FolderOpen className="size-3.5" />
                Open folder…
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
