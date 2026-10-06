import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { FolderOpen } from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { useOpenFolderOrToast } from "@renderer/hooks/use-open-folder";
import { isPrimaryModifier } from "@renderer/lib/platform";
import { cn } from "@renderer/lib/utils";
import { useActiveProject } from "@renderer/state/projects";
import { useSessions, type SplitSide, type SplitState } from "@renderer/state/sessions";
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

  return (
    <div className="h-full min-w-0" data-session-pane ref={pane}>
      {split && wide ? <SplitPane split={split} /> : <OneChat id={activeId} />}
    </div>
  );
}

function SplitPane({ split }: { split: SplitState }) {
  const focusSide = useSessions((state) => state.focusSide);
  const stored = useSettings((state) => state.settings?.layout.splitRatio ?? 0.5);
  const setLayout = useSettings((state) => state.setLayout);
  // The ratio on screen: follows a drag as it happens, and the setting once written (a drag's end
  // writes it once, not on every move).
  const [ratio, setRatio] = useState(stored);
  const [dragging, setDragging] = useState(false);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setRatio(stored);
  }
  const row = useRef<HTMLDivElement | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = row.current;
    if (!element || event.button !== 0) return;
    // As the shell's separators do: listeners on the window, no pointer capture, and no text
    // selection while the gesture lasts, so a drag across a transcript does not highlight it.
    event.preventDefault();
    document.body.style.setProperty("user-select", "none");
    const box = element.getBoundingClientRect();
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

  const sideOf = (side: SplitSide) => (
    <SplitSideContext.Provider value={side}>
      <div
        className="flex h-full min-w-[360px] flex-col overflow-hidden"
        data-split-focused={split.focus === side ? "" : undefined}
        data-split-side={side}
        onFocusCapture={() => { if (useSessions.getState().split?.focus !== side) focusSide(side); }}
        onPointerDownCapture={() => { if (useSessions.getState().split?.focus !== side) focusSide(side); }}
        style={{ flex: `${side === "left" ? ratio : 1 - ratio} 1 0%` }}
      >
        <OneChat id={split[side]} />
      </div>
    </SplitSideContext.Provider>
  );

  return (
    <div className="flex h-full min-w-0" data-split ref={row}>
      {sideOf("left")}
      <div
        aria-label="Resize the two chats"
        aria-orientation="vertical"
        aria-valuemax={RATIO_MAX * 100}
        aria-valuemin={RATIO_MIN * 100}
        aria-valuenow={Math.round(ratio * 100)}
        className={cn("relative w-px shrink-0 cursor-col-resize bg-border outline-none after:absolute after:inset-y-0 after:-inset-x-[3px] focus-visible:bg-ring", dragging && "bg-ring")}
        data-split-divider
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        role="separator"
        tabIndex={0}
      />
      {sideOf("right")}
    </div>
  );
}

/** One chat, or the new-chat screen for the active project when `id` is null. */
function OneChat({ id }: { id: string | null }) {
  const project = useActiveProject();
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
