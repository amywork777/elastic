import { CornerDownRight, GripVertical, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemContent,
} from "@renderer/components/ai-elements/queue";
import { useComposer, type QueuedPrompt } from "@renderer/state/composer";
import { TooltipHint } from "@workbench/ui/primitives/tooltip";

/**
 * One prompt waiting in the queue. Click its text (or Edit) to change it in place: Enter saves,
 * Shift+Enter is a new line, Escape puts it back as it was. While it is open the queue does not
 * send it (`editingQueued`), so it never goes out with the text being replaced. Drag a row onto
 * another to reorder (the grip on hover says so). Send now (or Cmd/Ctrl+Enter while editing) puts it into the
 * running turn when the agent steers, else stops the turn and sends it next.
 */
export function QueuedPromptRow({ sessionId, item, index, onRemove }: {
  sessionId: string;
  item: QueuedPrompt;
  index: number;
  onRemove: () => void;
}) {
  const editing = useComposer((state) => state.editingQueued[sessionId] === item.id);
  const [text, setText] = useState(item.text);
  const [dropping, setDropping] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const label = (item.text || "attachments").slice(0, 40);

  useEffect(() => {
    if (!editing) return;
    const box = field.current;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, [editing]);

  const open = () => {
    setText(item.text);
    useComposer.getState().beginEditQueued(sessionId, item.id);
  };
  const close = (save: boolean) => {
    if (save) useComposer.getState().updateQueued(sessionId, item.id, text);
    useComposer.getState().endEditQueued(sessionId);
  };

  return (
    <QueueItem
      className={dropping ? "py-0.5 text-[12px] ring-1 ring-border" : "py-0.5 text-[12px]"}
      draggable={!editing}
      onDragLeave={() => setDropping(false)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-elastic-queued")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-elastic-queued", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData("application/x-elastic-queued");
        setDropping(false);
        if (!id || id === item.id) return;
        event.preventDefault();
        useComposer.getState().moveQueued(sessionId, id, index);
      }}
    >
      {editing ? (
        <div className="flex flex-col gap-1.5 py-1">
          <textarea
            aria-label="Edit queued prompt"
            className="min-h-[3.5rem] w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Escape") {
                event.preventDefault();
                close(false);
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                // Save and send now, ahead of the queue.
                event.preventDefault();
                close(true);
                void useComposer.getState().sendNow(sessionId, item.id);
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                close(true);
              }
            }}
            ref={field}
            rows={2}
            value={text}
          />
          <div className="flex justify-end gap-1.5">
            <button
              className="rounded-md px-2 py-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => close(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-foreground px-2 py-0.5 font-medium text-background outline-none hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              disabled={!text.trim()}
              onClick={() => close(true)}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {/* "Comes next", and on hover or focus the grip the row is dragged by. Not the queue's
              stock hollow dot, which read as a box to tick. */}
          <span aria-hidden className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
            <CornerDownRight className="size-3.5 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
            <GripVertical className="absolute size-3.5 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
          </span>
          <button
            className="min-w-0 grow cursor-text rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={open}
            type="button"
          >
            <QueueItemContent>{item.text || "(attachments)"}</QueueItemContent>
          </button>
          <QueueItemActions className="items-center gap-0.5">
            {/* Words for the one that changes what happens next; icons for the two everyone knows. */}
            <QueueItemAction
              aria-label={`Send now: ${label}`}
              className="h-6 rounded-md px-2 text-[11px] font-medium"
              onClick={() => void useComposer.getState().sendNow(sessionId, item.id)}
            >
              Send now
            </QueueItemAction>
            <TooltipHint content="Edit"><QueueItemAction aria-label={`Edit queued prompt: ${label}`} className="flex size-6 items-center justify-center rounded-md p-0" onClick={open}>
              <Pencil className="size-3.5" />
            </QueueItemAction></TooltipHint>
            <TooltipHint content="Remove from queue"><QueueItemAction aria-label={`Remove from queue: ${label}`} className="flex size-6 items-center justify-center rounded-md p-0" onClick={onRemove}>
              <X className="size-3.5" />
            </QueueItemAction></TooltipHint>
          </QueueItemActions>
        </div>
      )}
    </QueueItem>
  );
}
