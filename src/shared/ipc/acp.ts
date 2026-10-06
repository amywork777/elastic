/**
 * `sessions.*`: the session index plus the live ACP connection behind each
 * row, and the events that carry a session's state to the renderer.
 *
 * The renderer never sees the connection. It asks for a session to be
 * created or loaded, sends prompts, answers permission requests — and folds
 * `session.update` through the same reducer main runs (`src/shared/acp`).
 */
import { z } from "zod";

import { SessionProviderSchema } from "../providers";

import {
  PendingPermissionSchema,
  PromptBlockSchema,
  SessionEventSchema,
  SessionStateSchema,
} from "../acp/types";
import { GitModeSchema, SessionSchema, SessionStatusSchema } from "../types";
import { invoke } from "./define";

const Id = z.object({ id: z.string().min(1) });

/**
 * One adapter process this app is running (`SessionManager.activity`): a chat's, kept alive
 * behind the one on screen, or an idle spare spawned ahead of the next chat (`acp/warm.ts`).
 */
export const AgentProcessSchema = z.object({
  kind: z.enum(["session", "spare"]),
  /** The chat it serves; null for a spare. */
  sessionId: z.string().nullable(),
  agentId: z.string(),
  cwd: z.string(),
  status: SessionStatusSchema,
  pid: z.number().int().nullable(),
  /** The whole process tree under `pid`; null where it could not be measured. */
  memoryBytes: z.number().nonnegative().nullable(),
});
export type AgentProcess = z.infer<typeof AgentProcessSchema>;

export const acpContract = {
  sessions: {
    /** Every session, or just one project's, newest first. */
    list: invoke(z.object({ projectId: z.string().optional() }), z.array(SessionSchema)),
    get: invoke(Id, SessionSchema.nullable()),
    /**
     * Spawn the agent, `initialize`, `session/new`. Answers once the agent has
     * a session id; the state snapshot follows on `session.state`.
     *
     * The working directory is **not** given: main resolves it from
     * `gitMode` (plan §9), which is the only place that knows where worktrees
     * go and what they are called. `cwd` is the one exception — Settings'
     * `New session in this worktree` — and main checks it belongs to the project
     * before running anything in it.
     */
    create: invoke(
      z.object({
        projectId: z.string().min(1),
        agentId: z.string().min(1),
        /** Omitted means the `defaultGitMode` setting. */
        gitMode: GitModeSchema.optional(),
        /** The first prompt, when there is one: a worktree's name comes from it. */
        name: z.string().optional(),
        /** An existing worktree of this project, or the project itself. */
        cwd: z.string().min(1).optional(),
        /** A provider from Settings › Models & keys, and its model (`src/shared/providers.ts`). */
        provider: SessionProviderSchema.nullable().optional(),
        /** The chat this one continues ("Continue with …"). */
        from: z.string().min(1).optional(),
      }),
      SessionSchema,
    ),
    /** Reconnect a session from the index: spawn the agent and `session/load`. */
    load: invoke(Id, SessionStateSchema),
    /**
     * What to draw for this session right now, and whether it is the truth.
     *
     * `live` is a connected adapter's own state and needs nothing else;
     * `live: false` is the snapshot main filed the last time this session
     * said anything (`src/main/acp/snapshots.ts`), which the renderer paints
     * at once — with `Reconnecting…` in the composer's row — while `load`
     * runs behind it. Null is a session with neither, and gets the spinner.
     */
    state: invoke(
      Id,
      z.object({ state: SessionStateSchema, live: z.boolean() }).nullable(),
    ),
    /**
     * Send a prompt. Resolves when the turn ends (the whole turn streams on
     * `session.update` in the meantime), with the agent's stop reason — or at
     * once with `refused`, the reason, when the prompt holds a block the agent
     * did not say it takes; no turn began and nothing was written.
     */
    prompt: invoke(
      Id.extend({ content: z.array(PromptBlockSchema).min(1) }),
      z.object({ stopReason: z.string(), refused: z.string().optional() }),
    ),
    cancel: invoke(Id, z.void()),
    /**
     * The session's mode — the app's one permission control. Also becomes
     * this agent's default, so the next thread starts where this one was
     * left (`agentOptions.setDefaults`).
     */
    setMode: invoke(Id.extend({ modeId: z.string().min(1) }), z.void()),
    setConfigOption: invoke(
      Id.extend({ configId: z.string().min(1), value: z.union([z.string(), z.boolean()]) }),
      z.void(),
    ),
    /**
     * Put a prompt into the running turn (`_session/steering`) rather than after it. Anything but
     * `injected` means nothing was sent: the caller sends it the ordinary way.
     */
    steer: invoke(
      Id.extend({ content: z.array(PromptBlockSchema).min(1) }),
      z.object({ outcome: z.enum(["injected", "unsupported", "idle", "failed"]) }),
    ),
    respondPermission: invoke(
      Id.extend({
        requestId: z.string().min(1),
        /** Null cancels the request instead of picking an option. */
        optionId: z.string().nullable(),
        /** A question's answers (form elicitation), by field key; the request is answered with them. */
        answers: z.record(z.string(), z.union([z.string().max(10_000), z.array(z.string().max(1_000)).max(100)])).optional(),
      }),
      z.void(),
    ),
    /**
     * Run the setup a create reported as failed (`session.status.error`) again on the live
     * session: null when it went through, else the note. Never a reconnect.
     */
    retrySetup: invoke(Id, z.object({ error: z.string().nullable() })),
    /**
     * A quick command beside the chat, on an adapter process of its own (`SessionManager.aside`):
     * `usage` and `context` are the agent's own commands, `btw` a side question about the chat.
     * Never queued behind a running turn, never written into the transcript. `sessionId` is the
     * chat it is about (needed for `context` and `btw`); without one, `projectId` names the folder.
     */
    aside: invoke(
      z.object({
        agentId: z.string().min(1),
        sessionId: z.string().min(1).nullable(),
        projectId: z.string().min(1).nullable(),
        command: z.enum(["usage", "context", "btw"]),
        question: z.string().trim().min(1).max(20_000).optional(),
      }).refine((request) => request.command !== "btw" || request.question, "/btw needs a question")
        .refine((request) => request.command === "usage" || request.sessionId, "this command is about a chat"),
      z.object({ markdown: z.string() }),
    ),
    /** Override the agent's title with a user-supplied name that later notifications preserve. */
    rename: invoke(Id.extend({ title: z.string().min(1).max(200) }), SessionSchema),
    /** Hide from (or restore to) the sidebar. Archiving closes the adapter. */
    archive: invoke(Id.extend({ archived: z.boolean() }), SessionSchema),
    /**
     * Lift the row into the sidebar's `Pinned` section, or put it back under
     * its project. Nothing about the thread itself changes — not even
     * `updatedAt`, so pinning does not reorder a list sorted by activity.
     */
    setPinned: invoke(Id.extend({ pinned: z.boolean() }), SessionSchema),
    /**
     * Every adapter process running now, chats first (most recently used first), then the
     * spares, and how many idle chats the app keeps alive before closing the oldest.
     */
    activity: invoke(z.void(), z.object({ processes: z.array(AgentProcessSchema), keepAlive: z.number().int() })),
    /** Kill the adapter; the index row stays and `load` brings it back. */
    close: invoke(Id, z.void()),
    /** Close and forget. The agent's own transcript store is not touched. */
    delete: invoke(Id, z.void()),
  },
} as const;

export const acpEvents = {
  /** One reducer event for one session — a raw ACP update, or the client's own narration. */
  "session.update": z.object({ sessionId: z.string(), event: SessionEventSchema }),
  /** A full snapshot, sent when a session connects or loads. */
  "session.state": z.object({ sessionId: z.string(), state: SessionStateSchema }),
  /** The index row's status changed (mirrors `sessions.changed` for one row). */
  "session.status": z.object({
    sessionId: z.string(),
    status: SessionStatusSchema,
    error: z.string().nullable(),
  }),
  /** The agent is blocked on the user; the options are the agent's, verbatim. */
  "session.permission": z.object({ sessionId: z.string(), request: PendingPermissionSchema }),
  /** A chunk from an agent-created terminal. */
  "terminal.output": z.object({
    sessionId: z.string(),
    terminalId: z.string(),
    data: z.string(),
    /** Set once on exit. */
    exit: z.object({ exitCode: z.number().nullable(), signal: z.string().nullable() }).nullable(),
    /** On the exit chunk: the command wrote nothing, ever. */
    silent: z.boolean().optional(),
  }),
  // An agent's `fs/write_text_file` is announced on the explorer's
  // `files.changed` (src/shared/ipc/explorer.ts), which owns that event.
} as const;
