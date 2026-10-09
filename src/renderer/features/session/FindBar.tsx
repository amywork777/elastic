import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@renderer/components/ui/button";
import { isMac } from "@renderer/lib/platform";
import { shortcutKeys } from "@renderer/lib/shortcuts";
import type { Turn } from "@shared/acp/types";

import { domMatches, findMatches, paintMatches, type FindMatch } from "./find";

/**
 * Find in the chat: the bar Mod+F opens over the top of a transcript
 * (`Transcript.tsx` owns the key and the open state; `find.ts` the search).
 *
 * Typing paints every match and moves to the one nearest the bottom, where the
 * person usually is; Enter and ↓ go to the next match, Shift+Enter and ↑ to
 * the previous, wrapping at either end, with "3 of 12" between. The whole chat
 * is searched, not only the turns mounted: a match in a turn that is not
 * mounted is counted from the turn's data, and going to it mounts the window
 * down to that turn (`onMountFrom`) before it is scrolled to. Escape, or the
 * close button, closes the bar and hands focus back to where it was.
 */
export function FindBar({
  turns,
  firstMounted,
  onMountFrom,
  container,
  owner,
  focusToken,
  onClose,
  onReveal,
}: {
  turns: Turn[];
  /** The index of the first mounted turn; every turn from it on is in the DOM. */
  firstMounted: number;
  /** Mount every turn from this index on. */
  onMountFrom: (index: number) => void;
  /** The transcript's element: its `[data-turn]` children are the mounted turns. */
  container: React.RefObject<HTMLElement | null>;
  /** Whose highlights these are (`paintMatches`): two chats side by side each have their own. */
  owner: string;
  /** Changes each time Mod+F is pressed with the bar already open: focus and select the query again. */
  focusToken: number;
  onClose: () => void;
  /** Bring a match into view: the transcript leaves its stick-to-bottom and scrolls. */
  onReveal: (range: Range) => void;
}) {
  const [query, setQuery] = useState("");
  // The current match, by its turn and its place in that turn, so a turn that streams on or a
  // window that mounts above does not move it to another match.
  const [current, setCurrent] = useState<{ turnId: string; nth: number } | null>(null);
  // The mounted turns' DOM counts, each mounted turn's (a zero too); re-read when the DOM changes.
  const [mounted, setMounted] = useState<ReadonlyMap<string, number>>(() => new Map());
  const ranges = useRef(new Map<string, Range[]>());
  const reveal = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);
  const status = useId();

  const matches = useMemo(() => findMatches(turns, query, mounted), [turns, query, mounted]);
  // The pick, or — when its turn now counts fewer (its DOM replaced its data count) — the last
  // match in the same turn.
  const exact = current ? matches.findIndex((match) => match.turnId === current.turnId && match.nth === current.nth) : -1;
  const index = exact !== -1 || !current ? exact : matches.findLastIndex((match) => match.turnId === current.turnId);
  // No pick yet, or a pick that is gone (the text it was in changed): the match nearest the bottom.
  const at = index !== -1 ? index : matches.length - 1;
  const match: FindMatch | undefined = matches[at];

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  const currentRange = () => (match ? (ranges.current.get(match.turnId)?.[match.nth] ?? null) : null);
  // An effect event: the observer's callback, long after the effect that made it, paints the
  // match that is current then.
  const paint = useEffectEvent(() => {
    const all = [...ranges.current.values()].flat();
    const range = currentRange();
    paintMatches(owner, all, range);
    if (reveal.current && range) {
      reveal.current = false;
      onReveal(range);
    }
  });

  // Read the mounted turns' matches, now and whenever the transcript's DOM changes under them (a
  // reply streaming, a fold opening, a window mounting). Once a frame at most.
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = new Map<string, Range[]>();
      for (const element of root.querySelectorAll<HTMLElement>("[data-turn]")) {
        const id = element.dataset.turn;
        if (id && !next.has(id)) next.set(id, domMatches(element, query));
      }
      ranges.current = next;
      setMounted((previous) => {
        const same = previous.size === next.size && [...next].every(([id, found]) => previous.get(id) === found.length);
        return same ? previous : new Map([...next].map(([id, found]) => [id, found.length]));
      });
      paint();
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    read();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // The observer is re-made for a new query and for a window that mounted.
  }, [container, query, firstMounted]);


  // A new current match: mount down to it when its turn is not mounted, then paint and show it.
  useLayoutEffect(() => {
    if (!match) {
      paint();
      return;
    }
    if (match.index < firstMounted) {
      onMountFrom(match.index);
      return;
    }
    paint();
  }, [match?.turnId, match?.nth, match?.index, firstMounted, matches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => paintMatches(owner, [], null), [owner]);

  const go = (step: 1 | -1) => {
    if (matches.length === 0) return;
    const next = matches[(at + step + matches.length) % matches.length]!;
    reveal.current = true;
    setCurrent({ turnId: next.turnId, nth: next.nth });
  };

  const count = query ? (matches.length === 0 ? "No results" : `${at + 1} of ${matches.length}`) : "";
  return (
    <div
      className="flex items-center gap-1 rounded-lg border bg-background py-1 pr-1 pl-2.5 shadow-md"
      data-find-bar
      role="search"
    >
      <input
        aria-describedby={status}
        aria-label="Find in the chat"
        className="h-6 w-48 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        data-find-input
        onChange={(event) => {
          reveal.current = true;
          setQuery(event.target.value);
          setCurrent(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            go(event.shiftKey ? -1 : 1);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            go(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
        placeholder="Find in chat"
        ref={input}
        spellCheck={false}
        type="text"
        value={query}
      />
      <span aria-live="polite" className="min-w-14 px-1 text-right text-[12px] text-muted-foreground tabular-nums" data-find-count id={status} role="status">
        {count}
      </span>
      <TooltipHint content="Previous (⇧⏎)">
        <Button aria-label="Previous match" className="size-6" disabled={matches.length === 0} onClick={() => go(-1)} size="icon-sm" variant="ghost">
          <ChevronUp className="size-3.5" />
        </Button>
      </TooltipHint>
      <TooltipHint content="Next (⏎)">
        <Button aria-label="Next match" className="size-6" disabled={matches.length === 0} onClick={() => go(1)} size="icon-sm" variant="ghost">
          <ChevronDown className="size-3.5" />
        </Button>
      </TooltipHint>
      <TooltipHint content={`Close (${shortcutKeys("Escape", isMac)})`}>
        <Button aria-label="Close find" className="size-6" onClick={onClose} size="icon-sm" variant="ghost">
          <X className="size-3.5" />
        </Button>
      </TooltipHint>
    </div>
  );
}
