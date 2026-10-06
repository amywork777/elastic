import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { cn } from "cn";
import { TooltipHint } from "@workbench/ui/primitives/tooltip";

import { Button } from "@renderer/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { StateGlyph } from "@renderer/features/sidebar/SessionRow";
import { runningSessions } from "@renderer/features/sidebar/RunningNow";
import { useAcp } from "@renderer/state/acp";
import { useAgents } from "@renderer/state/agents";
import { useSessions } from "@renderer/state/sessions";
import type { AgentProcess } from "@shared/ipc/acp";

/** How often the open panel asks main again: statuses change by the second, memory slower. */
const REFRESH_MS = 2_000;

export function formatMemory(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Every agent process the app is running, behind a button in the sidebar's footer: the chats
 * with a turn going, the idle ones kept alive so switching back is instant (`acp/live.ts`), and
 * the spare started ahead of the next chat (`acp/warm.ts`). None of these were visible before;
 * a chat's row only says whether its turn is going, not whether a process is still behind it.
 *
 * Opens on click and stays open, like the context meter, and asks main again every two seconds
 * while it is open (never while shut). A row with a turn going offers Stop, an idle chat's
 * offers Close (the row stays in the sidebar and reconnects when opened), a spare offers
 * nothing: it is replaced the moment it is closed.
 */
export function AgentsPanel() {
  const [open, setOpen] = useState(false);
  const runningCount = useSessions((state) => runningSessions(state.sessions).length);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <TooltipHint content="Agents running" side="top">
        <PopoverTrigger asChild>
          <Button
            aria-label={runningCount > 0 ? `Agents running, ${runningCount} working` : "Agents running"}
            className="h-7 gap-1 px-1.5 text-muted-foreground"
            data-agents-panel-trigger
            size="sm"
            variant="ghost"
          >
            <Activity className="size-4" />
            {runningCount > 0 ? <span className="text-xs tabular-nums">{runningCount}</span> : null}
          </Button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="start" className="w-80 p-0" side="top">
        {open ? <AgentsList onOpenChat={() => setOpen(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function AgentsList({ onOpenChat }: { onOpenChat: () => void }) {
  const [data, setData] = useState<{ processes: AgentProcess[]; keepAlive: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const read = () =>
      window.workbench.sessions.activity().then(
        (next) => {
          if (!live) return;
          setData(next);
          setFailed(false);
        },
        () => live && setFailed(true),
      );
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [tick]);

  const processes = data?.processes ?? [];
  const measured = processes.flatMap((process) => (process.memoryBytes === null ? [] : [process.memoryBytes]));
  const total = measured.reduce((sum, bytes) => sum + bytes, 0);

  return (
    <div data-agents-panel>
      <div className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">Agents</span>
        {data ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {processes.length} {processes.length === 1 ? "process" : "processes"}
            {measured.length > 0 ? ` · ${formatMemory(total)}` : ""}
          </span>
        ) : null}
      </div>
      {failed && !data ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">Could not read the running agents.</p>
      ) : !data ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">Checking…</p>
      ) : processes.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">No agents are running.</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto py-1">
          {processes.map((process) => (
            <AgentRow
              key={process.sessionId ?? `spare:${process.agentId}`}
              onChanged={() => setTick((value) => value + 1)}
              onOpenChat={onOpenChat}
              process={process}
            />
          ))}
        </ul>
      )}
      {data ? (
        <p className="border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          Up to {data.keepAlive} idle chats stay open so switching back is instant; past that the oldest is closed.
        </p>
      ) : null}
    </div>
  );
}

function AgentRow({ process, onChanged, onOpenChat }: { process: AgentProcess; onChanged: () => void; onOpenChat: () => void }) {
  const session = useSessions((state) => (process.sessionId ? state.sessions.find((candidate) => candidate.id === process.sessionId) : undefined));
  const select = useSessions((state) => state.select);
  const agentName = useAgents((state) => state.agents.find((agent) => agent.id === process.agentId)?.name ?? process.agentId);
  const cancel = useAcp((state) => state.cancel);
  const close = useAcp((state) => state.close);
  const [busy, setBusy] = useState(false);

  const turnGoing = process.status === "running" || process.status === "waiting";
  const title = process.kind === "spare" ? `Spare ${agentName}` : (session?.title ?? "Untitled chat");
  const folder = process.cwd.split(/[\\/]/).filter(Boolean).pop() ?? process.cwd;
  const detail = [
    process.kind === "spare" ? "ready for the next chat" : turnGoing ? (process.status === "waiting" ? "waiting for you" : "working") : "idle",
    agentName,
    folder,
    process.memoryBytes === null ? null : formatMemory(process.memoryBytes),
  ].filter(Boolean).join(" · ");

  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work().finally(() => {
      setBusy(false);
      onChanged();
    });
  };

  return (
    <li className="group flex min-w-0 items-center gap-2 px-2" data-agent-process={process.kind} data-agent-session={process.sessionId ?? undefined}>
      <button
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left outline-none",
          process.sessionId ? "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50" : "cursor-default",
        )}
        disabled={!process.sessionId}
        onClick={() => {
          if (!process.sessionId) return;
          select(process.sessionId);
          onOpenChat();
        }}
        type="button"
      >
        <StateGlyph status={process.status} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px]">{title}</span>
          <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
        </span>
      </button>
      {process.sessionId ? (
        <Button
          className="h-6 shrink-0 px-2 text-xs"
          disabled={busy}
          onClick={() => act(() => (turnGoing ? cancel(process.sessionId!) : close(process.sessionId!)))}
          size="sm"
          variant="ghost"
        >
          {turnGoing ? "Stop" : "Close"}
        </Button>
      ) : null}
    </li>
  );
}
