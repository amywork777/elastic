/**
 * "Edit" on a past prompt (`lib/edit-prompt.ts` says what the new chat is given).
 *
 * The pencil under a prompt's bubble opens it here, in place of the bubble, as
 * text to change. Send starts over from that point in a new, linked chat —
 * "Edited from …" — never by rewriting this one: the agent's conversation is
 * a fork of this one up to the prompt where the agent can make one, and the
 * edited prompt is sent there. This chat is left as it was.
 *
 * The working tree is not part of a conversation, and is never changed
 * silently. For the chat's latest prompt there is a checkpoint of the files
 * from just before it was sent (the turn mark, `turnHead`), and "Also restore
 * files to before this prompt" — off by default — lists the files that would
 * change before Send does it (`git.restorePreview`, then `git.restoreTurn`).
 * An earlier prompt has no checkpoint left (each turn's mark replaces the
 * last), so it offers none. A latest prompt whose turn is still running is
 * stopped first.
 */
import { CornerDownRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@renderer/components/ui/button";
import { Spinner } from "@renderer/components/ui/spinner";
import { editHandoff, editPlan, editedBlocks, promptText } from "@renderer/lib/edit-prompt";
import { useAcp } from "@renderer/state/acp";
import { useSessions } from "@renderer/state/sessions";
import type { RestoreResult } from "@shared/ipc/git";
import { errorMessage } from "@shared/ipc/errors";
import type { SessionState, Turn } from "@shared/acp/types";
import type { Session } from "@shared/types";

/** How long a stop is waited on before an edit of the running prompt gives up. */
const STOP_WAIT_MS = 10_000;

/** Wait until the session is no longer running a turn (or waiting on the person in one). */
async function stopped(sessionId: string): Promise<boolean> {
  const busy = () => {
    const status = useAcp.getState().sessions[sessionId]?.status;
    return status === "running" || status === "waiting";
  };
  const deadline = Date.now() + STOP_WAIT_MS;
  while (busy()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/**
 * Send the edited prompt in a new chat linked to `session`, starting from just before `turn`.
 * Rejects (and changes nothing past what it reports) when the stop, the restore or the create
 * fails; resolves with the new chat's id once it is created and selected — the prompt itself is
 * on its way, and a failure to deliver it is a toast, as for "Continue with …".
 */
export async function editAndResend(input: {
  session: Session;
  state: SessionState;
  turn: Turn;
  text: string;
  restore: boolean;
  agentName: string;
}): Promise<string> {
  const { session, state, turn, text, restore, agentName } = input;
  const index = state.turns.findIndex((candidate) => candidate.id === turn.id);
  if (index === -1) throw new Error("that prompt is no longer in the chat");
  const plan = editPlan(state.turns, index);
  const acp = useAcp.getState();
  if (plan.latest && (state.status === "running" || state.status === "waiting")) {
    await acp.cancel(session.id);
    if (!(await stopped(session.id))) throw new Error("the current turn did not stop");
  }
  if (restore) {
    if (!plan.latest) throw new Error("only the latest prompt's files can be restored");
    const result = await window.workbench.git.restoreTurn({ projectId: session.projectId, sessionId: session.id });
    const changed = result.restored.length + result.removed.length;
    toast.success(changed === 1 ? "Restored 1 file" : `Restored ${changed} files`);
  }
  const id = await acp.create({
    projectId: session.projectId,
    agentId: session.agentId,
    cwd: session.cwd,
    gitMode: session.gitMode,
    ...(session.provider ? { provider: session.provider } : {}),
    from: session.id,
    edit: { forkAt: plan.forkAt },
  });
  useSessions.getState().setActive(id);
  const forked = useSessions.getState().sessions.find((candidate) => candidate.id === id)?.links?.forked === true;
  const handoff = plan.hasContext && !forked ? editHandoff(state, index, { title: session.title, agentName }) : null;
  void (async () => {
    // A refused fork, or nothing to fork at: the summary first, so the prompt lands on its context.
    if (handoff) await useAcp.getState().prompt(id, handoff);
    await useAcp.getState().prompt(id, editedBlocks(turn, text));
  })().catch((error: unknown) => toast.error(`The edited prompt did not reach ${agentName}: ${errorMessage(error)}`));
  return id;
}

/** The prompt open for editing, in place of its bubble. */
export function EditPromptCard({
  turn,
  latest,
  running,
  projectId,
  sessionId,
  onCancel,
  onSend,
}: {
  turn: Turn;
  /** The chat's latest prompt: the one whose files can be restored, and whose turn may still run. */
  latest: boolean;
  running: boolean;
  projectId: string;
  sessionId: string;
  onCancel: () => void;
  onSend: (text: string, restore: boolean) => Promise<void>;
}) {
  const [text, setText] = useState(() => promptText(turn));
  const [restore, setRestore] = useState(false);
  const [preview, setPreview] = useState<{ state: "loading" } | { state: "ready"; files: RestoreResult } | { state: "failed"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const restoreId = useId();

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  // As tall as what is in it, up to twelve lines, then it scrolls.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 12 * 24 + 16)}px`;
  }, [text]);

  const toggleRestore = (on: boolean) => {
    setRestore(on);
    if (!on) {
      setPreview(null);
      return;
    }
    setPreview({ state: "loading" });
    window.workbench.git.restorePreview({ projectId, sessionId }).then(
      (files) => setPreview({ state: "ready", files }),
      (error: unknown) => setPreview({ state: "failed", message: errorMessage(error) }),
    );
  };

  const files = preview?.state === "ready" ? preview.files : null;
  const changes = files ? [...files.restored.map((file) => ({ file, how: "restored" })), ...files.removed.map((file) => ({ file, how: "deleted" }))] : [];
  // The list is the confirmation: Send is not offered over a restore whose files are not yet shown.
  const restoreReady = !restore || files !== null;
  const empty = text.trim().length === 0;
  const send = () => {
    if (busy || empty || !restoreReady) return;
    setBusy(true);
    void onSend(text, restore && changes.length > 0).finally(() => setBusy(false));
  };

  return (
    <div className="flex w-full max-w-[85%] flex-col gap-2 rounded-2xl border bg-background px-3 py-2.5 focus-within:border-ring" data-edit-prompt-card>
      <textarea
        aria-label="Edit the prompt"
        className="min-h-12 w-full resize-none bg-transparent text-[14px] leading-6 outline-none"
        data-edit-prompt-input
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
        ref={box}
        rows={1}
        value={text}
      />
      {latest ? (
        <div className="flex flex-col gap-1 text-[12px] leading-5">
          <label className="flex w-fit items-center gap-1.5 text-muted-foreground" htmlFor={restoreId}>
            <input
              checked={restore}
              className="size-3.5 accent-foreground"
              data-edit-restore
              disabled={busy}
              id={restoreId}
              onChange={(event) => toggleRestore(event.target.checked)}
              type="checkbox"
            />
            Also restore files to before this prompt
          </label>
          {preview?.state === "loading" ? (
            <p className="flex items-center gap-1.5 pl-5 text-muted-foreground" role="status">
              <Spinner className="size-3" /> Checking which files would change…
            </p>
          ) : preview?.state === "failed" ? (
            <p className="pl-5 text-destructive" role="alert">
              Cannot restore files: {preview.message}
            </p>
          ) : files && changes.length === 0 ? (
            <p className="pl-5 text-muted-foreground" role="status">
              No files changed since this prompt.
            </p>
          ) : files ? (
            <div className="pl-5" data-edit-restore-files role="status">
              <p className="text-muted-foreground">
                {changes.length === 1 ? "This file goes back to how it was" : `These ${changes.length} files go back to how they were`} before this prompt:
              </p>
              <ul className="max-h-32 overflow-y-auto">
                {changes.map(({ file, how }) => (
                  <li className="truncate" key={file}>
                    {file} <span className="text-muted-foreground">({how})</span>
                  </li>
                ))}
              </ul>
              {files.kept.length > 0 ? (
                <p className="text-muted-foreground">
                  Left as they are (too large for the checkpoint): {files.kept.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] leading-5 text-muted-foreground">
          {latest && running ? "Stops the current turn, then sends" : "Sends"} in a new chat that starts from just before this prompt.
        </p>
        <Button className="h-6 px-2 text-[12px]" disabled={busy} onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button className="h-6 gap-1 px-2 text-[12px]" data-edit-send disabled={busy || empty || !restoreReady} onClick={send} size="sm">
          {busy ? <Spinner className="size-3" /> : <CornerDownRight className="size-3" />}
          {restore && changes.length > 0 ? `Restore ${changes.length === 1 ? "1 file" : `${changes.length} files`} and send` : "Send"}
        </Button>
      </div>
    </div>
  );
}
