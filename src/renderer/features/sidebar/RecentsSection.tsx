import { focusComposerOf } from "@renderer/app/pane-focus";
import { SessionRow } from "@renderer/features/sidebar/SessionRow";
import type { SidebarSection } from "@renderer/lib/sidebar";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import { useSettings, useSidebarSettings } from "@renderer/state/settings";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

/**
 * Recents, the sidebar's main list (`lib/sidebar.ts`, `recentsSections`): what is live on top,
 * then by activity, Done last, each row with its tag; ten rows, then Show more for this launch.
 */
export function RecentsSection({ section }: { section: SidebarSection }) {
  const activeId = useSessions((state) => state.activeId);
  const select = useSessions((state) => state.select);
  const expanded = useSessions((state) => state.recentsExpanded);
  const setExpanded = useSessions((state) => state.setRecentsExpanded);
  const projects = useProjects((state) => state.projects);
  const sidebar = useSidebarSettings();
  const { showBranch, recentsCollapsed } = sidebar;
  const setSidebar = useSettings((state) => state.setSidebar);
  const more = section.more ?? 0;
  return (
    <section aria-label="Recents" className="mb-1" data-sidebar-recents>
      {/* The header folds the list, as Folders' does; the state is kept with the other sidebar settings. */}
      <button
        aria-expanded={!recentsCollapsed}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-recents-header
        onClick={() => void setSidebar({ recentsCollapsed: !recentsCollapsed })}
        type="button"
      >
        <ChevronRight aria-hidden className={cn("size-3 transition-transform", !recentsCollapsed && "rotate-90")} />
        Recents
      </button>
      {recentsCollapsed ? null : (
      <>
      <div className="flex flex-col gap-px">
        {section.sessions.map((session) => (
          <SessionRow
            key={session.id}
            onSelect={() => {
              select(session.id);
              focusComposerOf(session.id);
            }}
            projectName={projects.find((project) => project.id === session.projectId)?.name}
            recents
            selected={session.id === activeId}
            session={session}
            showBranch={showBranch}
          />
        ))}
      </div>
      {more > 0 || expanded ? (
        <button
          className="mt-px flex h-7 w-full items-center rounded-md pl-8 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-recents-more
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? "Show less" : `Show ${more} more`}
        </button>
      ) : null}
      </>
      )}
    </section>
  );
}
