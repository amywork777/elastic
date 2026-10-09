import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "cn";

import { searchPrompts } from "./prompt-history";

/** How many matches the list shows at once. */
const SHOWN = 50;

/**
 * Ctrl+R in the composer: a search through the prompts Up walks (`prompt-history.ts`), drawn above
 * the box where the slash and `@` lists are, and kept by the same keys. Typing filters; ↑ and ↓
 * move, and Ctrl+R again moves to the next older match, as a shell's does; Enter puts the prompt
 * in the box; Escape closes. Focus is in its own field while it is open, so the box's own keys
 * (Enter's send, the arrows' history) are not in play; closing hands focus back to the box
 * (`onClose(true)`), except when focus already left for somewhere else (`onClose(false)`).
 */
export function PromptSearch({
  prompts,
  onPick,
  onClose,
}: {
  /** Newest first, as `sentPrompts` lists them. */
  prompts: readonly string[];
  onPick: (prompt: string) => void;
  onClose: (refocus: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  // The selection is remembered with the query it was made for, so a new query starts at the top.
  const [selection, setSelection] = useState<{ query: string; index: number }>({ query: "", index: 0 });
  const matches = useMemo(() => searchPrompts(prompts, query, SHOWN), [prompts, query]);
  const selected = selection.query === query ? Math.min(selection.index, Math.max(0, matches.length - 1)) : 0;
  const move = (delta: number) =>
    setSelection({ query, index: matches.length === 0 ? 0 : (selected + delta + matches.length) % matches.length });
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    list.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }, [selected, matches]);

  return (
    <div
      className="absolute right-0 bottom-full left-0 z-20 mb-2 flex max-h-72 flex-col rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
      data-prompt-search
    >
      <input
        aria-activedescendant={matches.length > 0 ? optionId(selected) : undefined}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded
        aria-label="Search earlier prompts"
        // The field is the only thing in the list that takes focus, and focus is on it the whole
        // time the list is open: its caret, inside the list's border, is the focus indication.
        autoFocus
        className="mb-1 w-full border-b bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground"
        onBlur={() => onClose(false)}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "r") {
            event.preventDefault();
            move(1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const prompt = matches[selected];
            if (prompt !== undefined) onPick(prompt);
          } else if (event.key === "Escape") {
            event.preventDefault();
            // Not on to Shell's Escape (Settings, the palette) or the composer's stop.
            event.stopPropagation();
            onClose(true);
          }
        }}
        placeholder="Search earlier prompts"
        role="combobox"
        spellCheck={false}
        value={query}
      />
      <div aria-label="Earlier prompts" className="min-h-0 overflow-y-auto" id={listId} ref={list} role="listbox">
        {matches.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
            {prompts.length === 0 ? "No earlier prompts yet" : "No prompt matches"}
          </div>
        ) : null}
        {matches.map((prompt, index) => (
          <button
            aria-selected={index === selected}
            className={cn(
              "flex w-full rounded-md px-2 py-1.5 text-left text-[13px]",
              index === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
            )}
            id={optionId(index)}
            key={prompt}
            onMouseDown={(event) => {
              // Before the field loses focus, which would close the list.
              event.preventDefault();
              onPick(prompt);
            }}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span className="line-clamp-2 min-w-0 break-words whitespace-pre-wrap">{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
