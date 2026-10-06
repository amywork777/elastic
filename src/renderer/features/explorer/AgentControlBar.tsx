import { Hand, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@renderer/components/ui/button";
import { useAcp } from "@renderer/state/acp";
import { useAgents } from "@renderer/state/agents";
import { useSessions } from "@renderer/state/sessions";
import { errorMessage } from "@shared/ipc/errors";

/** How long after an agent's last input the bar still says it is using the page. */
export const AGENT_ACTIVE_MS = 5_000;

type At = { sessionId: string; projectId: string; root: string | null; tabId: string };

/**
 * The strip under a browser tab's toolbar while an agent drives the page (`browser.activity`,
 * from its input over the page's debugger, `BrowserService.agentInput`): who it is, Stop, which
 * ends the agent's turn the way the composer's stop does, and Take over, which refuses the
 * agent's input until the person hands the page back. The agent's cursor over the page itself is
 * main's (`pointAt`). Nothing is shown while no agent is acting.
 */
export function AgentControlBar({ at }: { at: At }) {
  const { sessionId, tabId } = at;
  const [activeAt, setActiveAt] = useState(0);
  const [takenOver, setTakenOver] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const cancel = useAcp((state) => state.cancel);
  const running = useAcp((state) => state.sessions[sessionId]?.status === "running");
  const agentName = useAgentName(sessionId);

  useEffect(
    () =>
      window.workbench.on("browser.activity", (event) => {
        if (event.tabId !== tabId || event.sessionId !== sessionId) return;
        const at = Date.now();
        setActiveAt(at);
        setNow(at);
      }),
    [tabId, sessionId],
  );
  // Ticks only while the strip could be fading out, so an idle tab sets no timer.
  const active = now - activeAt < AGENT_ACTIVE_MS;
  useEffect(() => {
    if (!activeAt) return;
    const timer = window.setTimeout(() => setNow(Date.now()), AGENT_ACTIVE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [activeAt]);

  if (!active && !takenOver) return null;

  const take = (value: boolean) => {
    void window.workbench.browser.takeOver({ ...at, takenOver: value }).then(
      (result) => setTakenOver(result.takenOver),
      (error: unknown) => toast.error(errorMessage(error)),
    );
  };

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 border-t bg-muted/50 px-3 text-[12px]"
      data-agent-control={takenOver ? "yours" : "agent"}
      role="status"
    >
      {takenOver ? (
        <>
          <Hand aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">You have this tab. {agentName} waits until you hand it back.</span>
          <Button className="h-6 px-2 text-[12px]" onClick={() => take(false)} size="sm" variant="secondary">
            Hand back
          </Button>
        </>
      ) : (
        <>
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground motion-safe:animate-pulse" />
          <span className="min-w-0 flex-1 truncate">{agentName} is using this tab</span>
          <Button className="h-6 px-2 text-[12px]" onClick={() => take(true)} size="sm" variant="ghost">
            <Hand className="size-3" />
            Take over
          </Button>
          <Button
            className="h-6 px-2 text-[12px]"
            disabled={!running}
            onClick={() => void cancel(sessionId).catch((error: unknown) => toast.error(errorMessage(error)))}
            size="sm"
            variant="secondary"
          >
            <Square className="size-3" />
            Stop
          </Button>
        </>
      )}
    </div>
  );
}

/** The agent's name for the chat that owns this page, as the sidebar and the drawer say it. */
function useAgentName(sessionId: string): string {
  const agentId = useSessions((state) => state.sessions.find((session) => session.id === sessionId)?.agentId);
  const name = useAgents((state) => state.agents.find((agent) => agent.id === agentId)?.name);
  return name ?? "The agent";
}
