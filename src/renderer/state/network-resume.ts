import { toast } from "sonner";

import { useComposer } from "./composer";

/**
 * A turn the network cut off carries on by itself once the Mac is back online.
 *
 * The agent runs on this machine, so losing Wi-Fi does not end it; its calls to the model do.
 * Claude Code and Codex retry those for a while on their own, and a short drop never reaches
 * here. A long one ends the turn with a connection error (`prompt/error`), the queue pauses
 * behind it, and nothing would happen until the person came back and acted: Retry sends the
 * original prompt again from the top, not "carry on".
 *
 * So a turn that failed on the network is remembered, and when the browser says the machine is
 * online again (`online`, or a periodic look for a drop that never went offline, such as a
 * captive portal), the chat is told to continue where it stopped. That message is sent the way
 * any message after a failure is (`submit`): first, ahead of the paused queue, which resumes
 * when it ends. A chat the person writes to meanwhile is theirs again and is not touched, and
 * no chat is continued more than `MAX_CONTINUES` times in a row, so a network that never comes
 * back properly cannot loop.
 */

export const CONTINUE_PROMPT =
  "The network connection dropped while you were working, and it is back now. Continue where you left off.";

/** How many automatic continues a chat gets before it waits for the person. */
export const MAX_CONTINUES = 3;
/** Online but the last attempt failed on the network again: wait this long before the next. */
const RETRY_WHILE_ONLINE_MS = 20_000;
const CHECK_EVERY_MS = 5_000;

/** The message of a failure that came from the network rather than the agent or the model. */
const NETWORK_FAILURE =
  /connection error|connection (?:was )?(?:reset|refused|closed|lost)|network|offline|internet|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|socket hang up|fetch failed|timed? ?out|stream disconnected|error sending request|\bdns\b/i;

export function isNetworkFailure(message: string): boolean {
  return NETWORK_FAILURE.test(message);
}

type Waiting = { failedAt: number; continues: number };
const waiting = new Map<string, Waiting>();
/** Chats the next `prompt/start` belongs to this module: its own continue, not the person's. */
const ownStart = new Set<string>();
/** How many continues each chat has had since the person last wrote to it. */
const streak = new Map<string, number>();

type Deps = { online: () => boolean; now: () => number; submit: (sessionId: string, text: string) => Promise<void> };
let deps: Deps = {
  online: () => navigator.onLine,
  now: () => Date.now(),
  submit: (sessionId, text) => useComposer.getState().submit(sessionId, text, [{ type: "text", text }]),
};

/** The bridge's hand-off of a turn's lifecycle. */
export function networkTurnEvent(sessionId: string, event: { type: string; message?: string }): void {
  if (event.type === "prompt/start") {
    // The person's own message: the chat is theirs again, and its streak starts over.
    if (!ownStart.delete(sessionId)) {
      waiting.delete(sessionId);
      streak.delete(sessionId);
    }
    return;
  }
  if (event.type === "prompt/end") {
    // A continue that finished cleanly: the network held, so the next drop starts a new streak.
    if (!waiting.has(sessionId)) streak.delete(sessionId);
    return;
  }
  if (event.type !== "prompt/error" || !isNetworkFailure(event.message ?? "")) return;
  const continues = streak.get(sessionId) ?? 0;
  if (continues >= MAX_CONTINUES) {
    waiting.delete(sessionId);
    toast.error("The connection keeps dropping", { description: "This chat stopped continuing by itself. Send a message when the network is steady." });
    return;
  }
  const first = !waiting.has(sessionId);
  waiting.set(sessionId, { failedAt: deps.now(), continues });
  if (first && continues === 0) {
    toast("Connection lost", { description: "This chat continues by itself when you are back online." });
  }
  check();
}

/** Continue every waiting chat if the machine is online and its wait is over. */
export function check(): void {
  if (!deps.online()) return;
  for (const [sessionId, entry] of [...waiting]) {
    // The first try is at once; one that failed on the network again while online waits a little.
    if (entry.continues > 0 && deps.now() - entry.failedAt < RETRY_WHILE_ONLINE_MS) continue;
    waiting.delete(sessionId);
    streak.set(sessionId, entry.continues + 1);
    ownStart.add(sessionId);
    void deps.submit(sessionId, CONTINUE_PROMPT).catch(() => {
      ownStart.delete(sessionId);
    });
  }
}

/** Listen for the machine coming back online. Returns the unsubscribe. */
export function watchNetwork(): () => void {
  const online = () => check();
  window.addEventListener("online", online);
  const timer = setInterval(check, CHECK_EVERY_MS);
  return () => {
    window.removeEventListener("online", online);
    clearInterval(timer);
  };
}

/** The tests' own clock, network and send. */
export function setNetworkResumeDeps(next: Partial<Deps>): void {
  deps = { ...deps, ...next };
}
export function resetNetworkResume(): void {
  waiting.clear();
  ownStart.clear();
  streak.clear();
}
