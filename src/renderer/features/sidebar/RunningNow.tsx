import { useShallow } from "zustand/react/shallow";
import { cn } from "cn";

import { focusComposerOf } from "@renderer/app/pane-focus";
import { StateGlyph } from "@renderer/features/sidebar/SessionRow";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import type { Session, SessionStatus } from "@shared/types";

/** A chat is "running" to this list while its agent has a turn going or is waiting on the person. */
const RUNNING: ReadonlySet<SessionStatus> = new Set(["running", "waiting"]);

/** The chats with a turn going, newest activity first, archived ones aside. */
export function runningSessions(sessions: readonly Session[]): Session[] {
  return sessions
    .filter((session) => RUNNING.has(session.status) && !session.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Every chat that is working right now, at the top of the list: a turn going in a collapsed
 * folder, or in a folder scrolled out of sight, is still one glance away. The rows are
 * shortcuts, not the chats themselves (those stay in their folders, with their menus), so a
 * row here is the glyph, the title and the folder, and a click opens the chat. Absent when
 * nothing is running.
 */
export function RunningNow() {
  const running = useSessions(useShallow((state) => runningSessions(state.sessions)));
  const activeId = useSessions((state) => state.activeId);
  const select = useSessions((state) => state.select);
  const projects = useProjects((state) => state.projects);
  if (running.length === 0) return null;

  return (
    <section aria-label="Running now" className="mb-2" data-sidebar-running>
      <div className="flex h-7 items-center gap-1.5 px-2">
        <span className="text-[11px] font-medium text-muted-foreground">Running</span>
        <span className="text-[11px] text-muted-foreground/70 tabular-nums">{running.length}</span>
      </div>
      <div className="flex flex-col gap-px">
        {running.map((session) => {
          const folder = projects.find((project) => project.id === session.projectId)?.name;
          return (
            <button
              className={cn(
                "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none",
                "hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                session.id === activeId && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              data-running-session={session.id}
              key={session.id}
              onClick={() => {
                select(session.id);
                focusComposerOf(session.id);
              }}
              type="button"
            >
              <StateGlyph status={session.status} />
              <span className="min-w-0 shrink truncate">{session.title}</span>
              {folder ? <span className="min-w-0 shrink-[4] truncate text-[11px] text-muted-foreground/80">{folder}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
