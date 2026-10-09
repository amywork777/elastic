/**
 * "Continue with …": a model from another agent or provider, picked in a
 * running chat. A different agent is a different session underneath, so it is
 * not faked into this transcript: the person confirms in one line above the
 * box, a new chat starts in the same folder on the model they picked, and its
 * first prompt is a handoff of this one (`lib/handoff.ts`). The two chats link
 * to each other (`LinkedChats`).
 */
import { ArrowRight, CornerDownRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@renderer/components/ui/button";
import { Spinner } from "@renderer/components/ui/spinner";
import { buildHandoff } from "@renderer/lib/handoff";
import { useAcp } from "@renderer/state/acp";
import { useAgentOptions } from "@renderer/state/agent-options";
import { useSessions } from "@renderer/state/sessions";
import type { SessionState } from "@shared/acp/types";
import { errorMessage } from "@shared/ipc/errors";
import type { Session } from "@shared/types";

/** What the new chat runs on: an agent's own model, or a provider's. */
export type ContinueTarget = {
  agentId: string;
  agentName: string;
  /** "Codex · GPT-6 Astra", "qwen3 · Ollama". */
  label: string;
  /** The agent's own model value, when it is one of its models. */
  model: string | null;
  provider: { id: string; model: string | null } | null;
};

/** Start the linked chat, hand it this one, and go there. Resolves with the new chat's id. */
export async function continueWith(session: Session, state: SessionState | null, from: { title: string; agentName: string }, target: ContinueTarget): Promise<string> {
  if (target.model && !target.provider) {
    // Main applies this agent's remembered model to the session it creates (`applyPreferences`).
    await useAgentOptions.getState().setDefaults(target.agentId, { model: target.model });
  }
  const id = await useAcp.getState().create({
    projectId: session.projectId,
    agentId: target.agentId,
    cwd: session.cwd,
    gitMode: session.gitMode,
    ...(target.provider ? { provider: target.provider } : {}),
    from: session.id,
  });
  useSessions.getState().setActive(id);
  const handoff = buildHandoff(state ?? { turns: [], plan: null } as unknown as SessionState, from);
  void useAcp.getState().prompt(id, handoff).catch((error: unknown) => toast.error(`The handoff did not reach ${target.agentName}: ${errorMessage(error)}`));
  return id;
}

/** The one-line confirm above the box. */
export function ContinueBar({ target, onConfirm, onCancel }: { target: ContinueTarget; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] leading-5" data-continue-with role="status">
      <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        Continue with <span className="font-medium">{target.label}</span>? It starts a new chat that picks up from a summary of this one.
      </span>
      <Button className="h-6 px-2 text-[12px]" disabled={busy} onClick={onCancel} size="sm" variant="ghost">
        Cancel
      </Button>
      <Button
        className="h-6 gap-1 px-2 text-[12px]"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onConfirm().finally(() => setBusy(false));
        }}
        size="sm"
      >
        {busy ? <Spinner className="size-3" /> : <ArrowRight className="size-3" />}
        Continue
      </Button>
    </div>
  );
}

/**
 * "Continued from …" / "Continued in …": the chats a Continue with linked to this one; "Edited
 * from …" / "Edited in …" for a chat an edit of a past prompt started (`EditPrompt.tsx`).
 */
export function LinkedChats({ session }: { session: Session }) {
  const sessions = useSessions((state) => state.sessions);
  const setActive = useSessions((state) => state.setActive);
  const from = session.links?.from ? (sessions.find((candidate) => candidate.id === session.links?.from) ?? null) : null;
  const to = session.links?.to ? (sessions.find((candidate) => candidate.id === session.links?.to) ?? null) : null;
  if (!from && !to) return null;
  return (
    <div className="flex shrink-0 flex-wrap justify-center gap-x-4 gap-y-1 px-6 pt-2 text-[12px] text-muted-foreground" data-linked-chats>
      {from ? (
        <span>
          {session.links?.kind === "edit" ? "Edited from" : "Continued from"}{" "}
          <button className="underline underline-offset-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none rounded-sm" onClick={() => setActive(from.id)} type="button">
            {from.title}
          </button>
        </span>
      ) : null}
      {to ? (
        <span>
          {to.links?.kind === "edit" ? "Edited in" : "Continued in"}{" "}
          <button className="underline underline-offset-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none rounded-sm" onClick={() => setActive(to.id)} type="button">
            {to.title}
          </button>
        </span>
      ) : null}
    </div>
  );
}
