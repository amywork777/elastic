import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import { ArrowDown, ChevronRight, Paperclip } from "lucide-react";
import { memo, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useStickToBottomContext, type StickToBottomContext } from "use-stick-to-bottom";

import { focusComposerOf } from "@renderer/app/pane-focus";
import { isHandoff } from "@renderer/lib/handoff";
import { isPrimaryModifier } from "@renderer/lib/platform";
import { cn } from "@renderer/lib/utils";
import { useSessions } from "@renderer/state/sessions";
import { useUi } from "@renderer/state/ui";
import { Conversation, ConversationContent } from "@renderer/components/ai-elements/conversation";
import type { Part, SessionState, Turn } from "@shared/acp/types";

import { CopyReplyButton, replyMarkdown } from "./CopyReply";
import { drawnParts } from "./find";
import { FindBar } from "./FindBar";
import { PartsList } from "./parts/PartsList";
import { sentAtFull, sentAtLabel } from "./sent-at";
import { useSplitSide } from "./split-side";
import { StatusLine } from "./StatusLine";
import { statusLine } from "./view";

/**
 * The transcript (plan §2, §6): a vertical list of turns in one centred
 * column, user turns as compact bubbles on the right, agent turns as prose
 * and activity rows at full width, the live status line under the turn
 * that is running. Opens on the latest turn, with no animation down from
 * the top (a long chat's smooth scroll could stop short and leave the person
 * at the first turn), sticks to the bottom while streaming, and a "Jump to
 * latest" pill appears once the user scrolls up.
 *
 * Only the latest `TRANSCRIPT_WINDOW` turns are mounted when it opens: a
 * turn is some sixty nodes of markdown and activity rows, and switching back
 * to a forty-turn session spent its time in React mounting all of them, not
 * in layout (`content-visibility` measured no better). The rest mount a
 * window at a time as the person scrolls up to them (`EarlierTurns`). A turn
 * that arrives while it is open is added, and nothing mounted is dropped.
 */
export function Transcript({
  state,
  onRetry,
  onReconnect,
}: {
  state: SessionState;
  onRetry: () => void;
  onReconnect: () => void;
}) {
  const status = statusLine(state);
  // How many of the earliest turns are not mounted. It is set once, when the
  // transcript opens (SessionView is keyed by session), and only shrinks, so
  // turns that arrive later are mounted rather than sliding the window along.
  const [unmounted, setUnmounted] = useState(() => Math.max(0, state.turns.length - TRANSCRIPT_WINDOW));
  // A list that came back shorter (a reload) still mounts a full window; an
  // unanswered permission request is mounted wherever it is, and with it
  // every turn after it, so the transcript stays in order.
  const pending = state.turns.findIndex((turn) => turn.role === "agent" && awaitsAnswer(turn.parts));
  // Answering it must not hand those turns back: the window only grows, so a
  // request that pulled it down keeps what it pulled in (a state set while
  // drawing is React's own way to derive this from the props).
  if (pending !== -1 && pending < unmounted) {
    setUnmounted(pending);
  }
  const start = Math.min(unmounted, Math.max(0, state.turns.length - TRANSCRIPT_WINDOW), pending === -1 ? Infinity : pending);
  // Where the window began when the transcript opened. The conversation is a
  // live region (`role=log`), and the turns mounted above that line arrive by
  // the person's own scroll or click: a screen reader must not read a window
  // of old turns aloud as if they were news. They sit in a container that is
  // there from the start and says `aria-live="off"`, so mounting into it is
  // silent while a turn that arrives later, below the line, is announced.
  const [opened] = useState(start);
  const draw = (item: Turn, index: number) => {
    // Only the last turn is handed the callbacks (they are fresh
    // closures per render), so every other turn's props are equal from
    // one token to the next and `TurnView`'s memo holds.
    const last = index === state.turns.length - 1;
    return (
      <TurnView
        foldWork={!last}
        key={item.id}
        onReconnect={last && state.status === "error" ? onReconnect : undefined}
        onRetry={last ? onRetry : undefined}
        sessionId={state.sessionId}
        turn={item}
      />
    );
  };
  const boundary = Math.max(start, opened);

  // Streamdown animates a reply word by word, so every token is a DOM addition in a polite
  // live region; `aria-busy` holds the announcements back until the turn settles and then reads
  // what arrived once. Not while it waits on the person: a permission card must be announced.
  const last = state.turns.at(-1);
  const streaming = last?.role === "agent" && last.endedAt === null && state.status !== "waiting";

  const find = useFindKey(state.sessionId);
  const frame = useRef<HTMLDivElement | null>(null);
  const stick = useRef<StickToBottomContext | null>(null);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" ref={frame}>
      {/* Outside the log: the bar is chrome over the transcript, not a message in it. */}
      {find.open ? (
        <div className="absolute top-2 right-4 z-10">
          <FindBar
            container={frame}
            firstMounted={start}
            focusToken={find.token}
            onClose={find.close}
            onMountFrom={(index) => setUnmounted((current) => Math.min(current, index))}
            onReveal={(range) => revealRange(range, stick.current)}
            owner={state.sessionId}
            turns={state.turns}
          />
        </div>
      ) : null}
    <Conversation aria-busy={streaming} className="min-h-0 min-w-0 flex-1" data-transcript initial="instant">
      <StickBridge intoRef={stick} />
      <ConversationContent className="mx-auto min-w-0 w-full max-w-[720px] gap-4 px-6 pt-6 pb-4">
        {/* Room above the first turn while the bar is open, so a match at the very top is not under it. */}
        {find.open ? <div aria-hidden className="h-8 shrink-0" data-find-room /> : null}
        {/* A box of its own, with the column's gap: a `display: contents` element has been dropped
            from Chromium's accessibility tree, and the silence would go with it. Empty it is
            `hidden` (`EarlierTurns` draws nothing for a transcript that opened whole): a
            childless flex item would still take the column's gap above the first turn. */}
        <div aria-live="off" className="flex min-w-0 w-full flex-col gap-4 empty:hidden" data-earlier-region>
          <EarlierTurns count={start} onMount={() => setUnmounted(Math.max(0, start - TRANSCRIPT_WINDOW))} />
          {state.turns.slice(start, boundary).map((item, offset) => draw(item, start + offset))}
        </div>
        {state.turns.slice(boundary).map((item, offset) => draw(item, boundary + offset))}
        {status ? <StatusLine active={state.status !== "waiting"} text={status} /> : null}
      </ConversationContent>
      <JumpToLatest />
    </Conversation>
    </div>
  );
}

/**
 * Mod+F in a chat: open the find bar, or, open already, put the keyboard back
 * in its box with the query selected. Only for the chat that has focus — the
 * focused side of two — and only from the session pane or the sidebar: with
 * focus in the explorer, Mod+F is the editor's, the terminal's or the page's
 * own find (Monaco binds it; a browser tab's page has the key before this
 * window does), and a dialog over the window keeps its keys. Bound here, not
 * as a menu accelerator, for the same reason: an accelerator fires before
 * Monaco sees the key. Closing hands focus back to what had it.
 */
function useFindKey(sessionId: string): { open: boolean; token: number; close: () => void } {
  const side = useSplitSide();
  const focused = useSessions((store) => side === null || store.split === null || store.split.focus === side);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(0);
  const returnTo = useRef<HTMLElement | null>(null);
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!focused || event.defaultPrevented || !isPrimaryModifier(event) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
    if (useUi.getState().surface.kind !== "home") return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest("#explorer, [role=dialog], [role=alertdialog]")) return;
    event.preventDefault();
    if (!open && active instanceof HTMLElement && !active.closest("[data-find-bar]")) returnTo.current = active;
    setOpen(true);
    setToken((value) => value + 1);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const close = () => {
    setOpen(false);
    const back = returnTo.current;
    returnTo.current = null;
    // The bar unmounts under the focus it holds: back where it came from, else this chat's box.
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus();
      else focusComposerOf(sessionId, 2);
    });
  };
  return { open, token, close };
}

/** Hands the transcript's stick-to-bottom context out, for the find bar's scroll. */
function StickBridge({ intoRef }: { intoRef: React.RefObject<StickToBottomContext | null> }) {
  const context = useStickToBottomContext();
  useLayoutEffect(() => {
    intoRef.current = context;
  });
  return null;
}

/**
 * Scroll a match to the middle of the transcript. The pane stops sticking to
 * the bottom first, or a reply still streaming would pull it straight back down.
 */
function revealRange(range: Range, stick: StickToBottomContext | null): void {
  const scroller = stick?.scrollRef.current;
  if (!scroller) return;
  stick.stopScroll();
  const box = range.getBoundingClientRect();
  const pane = scroller.getBoundingClientRect();
  // The top band is under the find bar.
  if (box.top >= pane.top + 56 && box.bottom <= pane.bottom - 24) return;
  scroller.scrollTop += box.top - pane.top - (pane.height - box.height) / 2;
}

/** How many turns a transcript mounts when it opens, and how many more each step up mounts. */
export const TRANSCRIPT_WINDOW = 12;

/** Whether a turn's parts, a subagent's or a tool call's children included, hold a request still waiting on the person. */
function awaitsAnswer(parts: Part[]): boolean {
  return parts.some((part) =>
    part.type === "permission_request"
      ? part.outcome.state === "pending"
      : part.type === "tool_call"
        ? awaitsAnswer(part.children)
        : part.type === "subagent"
          ? awaitsAnswer(part.parts)
          : false,
  );
}

/**
 * The top of a transcript whose earliest turns are not mounted: a quiet
 * button naming how many there are, and the sentinel that mounts the next
 * window when the person scrolls to within a screen of it. Opening at the
 * bottom does not count — the pane lays out at the top for a frame before it
 * lands on the bottom, so the sentinel is in reach for a moment on every
 * switch — only a scroll that has left the bottom does, or a pane too short
 * to scroll at all.
 *
 * Mounting above what the person is reading would push it down the screen,
 * so the distance from the bottom is kept across the mount. It stays in the
 * tree once everything is mounted so the last of those corrections still runs.
 */
function EarlierTurns({ count, onMount }: { count: number; onMount: () => void }) {
  const { isAtBottom, scrollRef } = useStickToBottomContext();
  const sentinel = useRef<HTMLDivElement | null>(null);
  const fromBottom = useRef<number | null>(null);
  const [inReach, setInReach] = useState(false);
  // Whether the person has reached for the scroll since the pane was last at the bottom. State,
  // not a ref: a reach that lands while the sentinel is already in reach is what mounts.
  const [reached, setReached] = useState(false);
  const present = count > 0;

  const mountMore = () => {
    const scroller = scrollRef.current;
    fromBottom.current = scroller ? scroller.scrollHeight - scroller.scrollTop : null;
    // Out of reach until the observer, started afresh for the new count, says otherwise.
    setInReach(false);
    onMount();
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    const node = sentinel.current;
    if (!present || !scroller || !node) {
      setInReach(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInReach(entry?.isIntersecting ?? false), {
      root: scroller,
      rootMargin: "100% 0px 0px 0px",
    });
    observer.observe(node);
    return () => observer.disconnect();
    // A fresh observer per count: it reports once on observe, which is how a
    // sentinel still in reach after a window mounted is known to be.
  }, [present, count, scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const reach = () => setReached(true);
    // Only a press on the pane itself, which is its scrollbar: a press on a
    // button or a turn inside it, or on the pane while it is still opening, is
    // not a reach for what is above.
    const pointer = (event: PointerEvent) => {
      if (event.target === scroller) reach();
    };
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) reach();
    };
    const key = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) reach();
    };
    scroller.addEventListener("wheel", wheel, { passive: true });
    scroller.addEventListener("touchmove", reach, { passive: true });
    scroller.addEventListener("pointerdown", pointer, { passive: true });
    scroller.addEventListener("keydown", key);
    return () => {
      scroller.removeEventListener("wheel", wheel);
      scroller.removeEventListener("touchmove", reach);
      scroller.removeEventListener("pointerdown", pointer);
      scroller.removeEventListener("keydown", key);
    };
  }, [scrollRef]);
  // Back at the bottom, the reach is spent: adjusted as the render sees the flip, not in an effect.
  const [wasAtBottom, setWasAtBottom] = useState(isAtBottom);
  if (isAtBottom !== wasAtBottom) {
    setWasAtBottom(isAtBottom);
    if (isAtBottom) setReached(false);
  }

  const mountIfInReach = useEffectEvent(() => {
    const scroller = scrollRef.current;
    const scrolls = !!scroller && scroller.scrollHeight > scroller.clientHeight;
    if (present && inReach && ((!isAtBottom && reached) || !scrolls)) {
      mountMore();
    }
  });
  useEffect(() => mountIfInReach(), [present, inReach, isAtBottom, reached]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (fromBottom.current === null || !scroller) return;
    // Chromium's scroll anchoring usually has done this already; setting the
    // same offset again is no scroll at all, and it covers the top edge, where
    // there is nothing above the viewport to anchor to.
    scroller.scrollTop = scroller.scrollHeight - fromBottom.current;
    fromBottom.current = null;
  }, [count, scrollRef]);

  if (!present) return null;
  return (
    <div className="flex justify-center" data-earlier-turns ref={sentinel}>
      <button
        className="inline-flex h-7 items-center rounded-full px-3 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={mountMore}
        type="button"
      >
        Show {count} earlier {count === 1 ? "turn" : "turns"}
      </button>
    </div>
  );
}

/**
 * One turn, memoised: the reducer keeps a turn it did not touch
 * referentially equal, so while the last turn streams the others are not
 * drawn again — their markdown, activity rows and diff badges included.
 */
const TurnView = memo(function TurnView({
  turn,
  sessionId,
  onRetry,
  onReconnect,
  foldWork = false,
}: {
  turn: Turn;
  /** A finished turn that is not the latest folds its work under "Worked for …", as Codex does. */
  foldWork?: boolean;
  sessionId: string;
  /** Given to the last turn only: its error row's Retry. */
  onRetry?: () => void;
  /** Given to the last turn only, while the session is in error. */
  onReconnect?: () => void;
}) {
  if (turn.role === "user") {
    return <UserTurn turn={turn} />;
  }
  const open = turn.endedAt === null;
  // A finished reply with words in it can be copied; one still streaming is not done saying them.
  const reply = open ? "" : replyMarkdown(turn.parts);
  return (
    <div className="group/turn flex min-w-0 w-full flex-col" data-turn={turn.id} data-role="agent" data-stop-reason={turn.stopReason ?? undefined}>
      <WorkFold fold={foldWork && !open} turn={turn}>
        {(parts) => (
          <PartsList
            onReconnect={onReconnect}
            onRetry={onRetry}
            open={open}
            parts={parts}
            prefix={turn.id}
            sessionId={sessionId}
          />
        )}
      </WorkFold>
      {turn.stopReason === "cancelled" ? (
        <p className="not-prose mt-1 px-1.5 text-[13px] leading-5 text-muted-foreground italic" data-stopped>
          Stopped
        </p>
      ) : turn.stopReason === "refusal" ? (
        <p className="not-prose mt-1 px-1.5 text-[13px] leading-5 text-muted-foreground italic">The agent declined.</p>
      ) : turn.stopReason === "max_tokens" || turn.stopReason === "max_turn_requests" ? (
        <p className="not-prose mt-1 px-1.5 text-[13px] leading-5 text-muted-foreground italic">
          Stopped at the agent&apos;s limit. Send &quot;continue&quot; to go on.
        </p>
      ) : null}
      {reply ? (
        <CopyReplyButton latest={!foldWork} markdown={reply}>
          <SentAt at={turn.endedAt ?? turn.startedAt} />
        </CopyReplyButton>
      ) : null}
    </div>
  );
});

/** "37s", "2m 37s", "1h 4m". */
export function workedFor(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Codex's "Worked for 2m 37s ›": everything a finished turn did before its answer, folded to one
 * row, the answer (the trailing text, and any error) left open under it. A turn with no work, or
 * whose last part is not an answer, is drawn whole.
 */
function WorkFold({ turn, fold, children }: { turn: Turn; fold: boolean; children: (parts: Part[]) => React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  // The rule lives in `find.ts`, which counts a turn that is not mounted by what it would draw.
  const drawn = drawnParts(turn, fold);
  if (!drawn.folded) return <>{children(turn.parts)}</>;
  return (
    <>
      <button
        aria-expanded={expanded}
        className="not-prose mb-2 flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-worked-for
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        Worked for {workedFor((turn.endedAt ?? turn.startedAt) - turn.startedAt)}
        <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
      </button>
      {children(expanded ? turn.parts : drawn.parts)}
    </>
  );
}

/** A compact bubble on the right, with the prompt's images and attachments under it. */
/**
 * The first prompt of a chat started by "Continue with …" (`lib/handoff.ts`): the
 * person did not type it, so it is a folded row that opens on the summary the
 * new agent was given.
 */
function HandoffTurn({ text, turnId }: { text: string; turnId: string }) {
  const [open, setOpen] = useState(false);
  const body = text.split("\n").slice(1).join("\n").trim();
  return (
    <div className="flex w-full flex-col gap-1.5" data-turn={turnId} data-role="user" data-handoff>
      <button
        aria-expanded={open}
        className="flex items-center gap-1 self-start rounded-sm text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Picked up from the earlier chat
      </button>
      {open ? (
        <div className="rounded-xl border px-3.5 py-2 text-[13px] leading-6 break-words whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{body}</div>
      ) : null}
    </div>
  );
}

function UserTurn({ turn }: { turn: Turn }) {
  const text = turn.parts
    .filter((part): part is Extract<Turn["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const images = turn.parts.filter((part): part is Extract<Turn["parts"][number], { type: "image" }> => part.type === "image");
  const links = turn.parts.filter(
    (part): part is Extract<Turn["parts"][number], { type: "resource_link" | "resource" }> =>
      part.type === "resource_link" || part.type === "resource",
  );
  if (isHandoff(text)) {
    return <HandoffTurn text={text} turnId={turn.id} />;
  }
  return (
    <div className="group/turn flex w-full flex-col items-end gap-1.5" data-turn={turn.id} data-role="user">
      {/* The bubble carries no `select-text` of its own: the whole transcript
          selects (`styles/globals.css`), which is what a person means when
          they drag across a reply and their own prompt in one go. */}
      {text ? (
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-[14px] leading-6 break-words whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]" data-find-text>
          {text}
        </div>
      ) : null}
      {images.length > 0 ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {images.map((image, index) => (
            <img
              alt=""
              className="max-h-48 rounded-lg border"
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
            />
          ))}
        </div>
      ) : null}
      {links.length > 0 ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {links.map((link, index) => (
            <TooltipHint content={link.uri} key={index}>
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]">
                <Paperclip className="size-3 text-muted-foreground" />
                {link.name}
              </span>
            </TooltipHint>
          ))}
        </div>
      ) : null}
      <div className="-mt-1 flex h-6 items-center gap-0.5" data-prompt-actions>
        <SentAt at={turn.startedAt} />
      </div>
    </div>
  );
}

/**
 * When a message was sent, quietly: a small muted time that shows while the
 * turn is hovered or holds keyboard focus (`sent-at.ts` says how short), the
 * whole date in its tooltip and in what a screen reader is told.
 */
function SentAt({ at }: { at: number }) {
  const full = sentAtFull(at);
  return (
    <TooltipHint content={full}>
      <time
        aria-label={`Sent ${full}`}
        className="px-1 text-[11px] leading-6 text-muted-foreground tabular-nums opacity-0 transition-opacity group-hover/turn:opacity-100 group-focus-within/turn:opacity-100"
        data-sent-at
        dateTime={new Date(at).toISOString()}
      >
        {sentAtLabel(at)}
      </time>
    </TooltipHint>
  );
}

function JumpToLatest() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute right-0 bottom-3 left-0 flex justify-center">
      <button
        className="pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full border bg-background px-3 text-[12px] shadow-md transition-colors hover:bg-accent"
        data-jump-to-latest
        onClick={() => void scrollToBottom()}
        type="button"
      >
        <ArrowDown className="size-3.5" />
        Jump to latest
      </button>
    </div>
  );
}
