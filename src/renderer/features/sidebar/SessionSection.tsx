import { useShallow } from "zustand/react/shallow";
import { Ellipsis, Plus, Folder, FolderOpen, Pin } from "lucide-react";
import { cn } from "cn";
import { TooltipHint } from "@workbench/ui/primitives/tooltip";

import { Button } from "@renderer/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@renderer/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { focusComposerOf } from "@renderer/app/pane-focus";
import { MenuKind } from "@renderer/features/sidebar/menu";
import { ProjectMenuItems } from "@renderer/features/sidebar/project-menu";
import { SessionRow } from "@renderer/features/sidebar/SessionRow";
import type { SidebarSection } from "@renderer/lib/sidebar";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import { useSettings, useSidebarSettings } from "@renderer/state/settings";

/**
 * One section of the sidebar: a grey header and a flat list of threads under
 * it (`lib/sidebar.ts` decides which sections exist and what is in them).
 *
 * The header is the project — its name, its collapse, and one control: `+`,
 * a thread in *this* project. Everything else a project can do is a
 * right-click away, because a header with four buttons on it is not a header.
 * Search and the filter menu are the panel's, in its own header
 * (`Sidebar.tsx`): the palette searches every thread and the filters are
 * `settings.sidebar`, so neither was ever a per-project control.
 *
 * `Pinned` and the one flat list `Group by › None` produces are sections too,
 * with no project behind them: no `+`, and nothing to collapse into a
 * preference.
 */
export function SessionSection({ section }: { section: SidebarSection }) {
  const project = section.project;
  const projects = useProjects(useShallow((state) => state.projects));
  const activeProjectId = useProjects((state) => state.activeId);
  const setActiveProject = useProjects((state) => state.setActive);
  const activeSessionId = useSessions((state) => state.activeId);
  const selectSession = useSessions((state) => state.select);
  const setActiveSession = useSessions((state) => state.setActive);
  const filters = useSidebarSettings();
  const setSidebar = useSettings((state) => state.setSidebar);

  // Only a project's section has somewhere to file a collapse, and only a
  // project's header is worth collapsing: `Pinned` is there because something
  // is in it, and the flat list is the whole list.
  const collapsible = project !== null;
  const collapsed = collapsible && filters.collapsedProjects.includes(section.id);
  const active = project !== null && project.id === activeProjectId;

  const toggle = () => {
    if (!project) {
      return;
    }
    void setSidebar({
      collapsedProjects: collapsed
        ? filters.collapsedProjects.filter((id) => id !== project.id)
        : [...filters.collapsedProjects, project.id],
    });
  };

  const newHere = () => {
    if (project) {
      setActiveProject(project.id);
      setActiveSession(null);
    }
  };

  const header = (
    <div
      className={cn(
        "group/section flex h-8 items-center gap-0.5 rounded-md pr-0.5",
        // The whole row is the collapse (Codex's): it lights like a session row does.
        collapsible && "hover:bg-sidebar-accent/60",
      )}
      data-sidebar-section-header
    >
      {/* Named for the section, always: the state is aria-expanded's to say, not the name's.
          No chevron: the row is the toggle, edge to edge up to its `…` and `+`, and the folder
          glyph is open or shut with it. */}
      <button
        aria-expanded={collapsible ? !collapsed : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pl-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        disabled={!collapsible}
        onClick={toggle}
        type="button"
      >
        {/* The project's folder, on the name rather than the button: the kit
            holds a hint back from an expanded control, and an open section's
            header is one. `Pinned` and the flat list have no folder to show. */}
        <TooltipHint content={project?.path}>
          {/* Codex's grammar: a project reads as a folder row, a group without one as a quiet label. */}
          <span className={cn("flex min-w-0 items-center gap-2 truncate", project ? "text-[13px] text-foreground/85" : "text-[11px] font-medium text-muted-foreground")}>
            {project ? (
              collapsed ? (
                <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" data-folder-glyph="shut" strokeWidth={1.75} />
              ) : (
                <FolderOpen aria-hidden className="size-4 shrink-0 text-muted-foreground" data-folder-glyph="open" strokeWidth={1.75} />
              )
            ) : null}
            <span className="min-w-0 shrink truncate">{section.name}</span>
            {/* Pinned to the top. A mark, not a word in the name, which stays the folder's alone
                (above); the menu's Unpin folder says it in words. */}
            {section.pinned ? (
              <Pin aria-hidden className="size-3 shrink-0 text-muted-foreground/80" data-folder-pin />
            ) : null}
            {/* The folder it sits in, dimmed: two projects with one name tell apart, and it gives
                way first when the row is narrow. The whole path is the hint. */}
            {project ? <span aria-hidden className="min-w-0 shrink-[4] truncate text-[11px] text-muted-foreground/80" data-project-parent>{parentName(project.path)}</span> : null}
          </span>
        </TooltipHint>
      </button>

      {project ? (
        /* `…` (the folder's own actions, Codex's: shown on hover and on focus) and `+`, which
           is always there. Search and the filters live in the panel's header: neither was
           ever about one project. */
        <DropdownMenu>
          <TooltipHint content="Folder actions">
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`More for ${project.name}`}
              className="size-5 shrink-0 text-muted-foreground opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              size="icon-xs"
              variant="ghost"
            >
              <Ellipsis className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end" className="w-48">
            <MenuKind.Provider value="dropdown">
              <ProjectMenuItems project={project} />
            </MenuKind.Provider>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {project ? (
        <TooltipHint content="New chat in this folder">
        <Button
          aria-label={`New session in ${project.name}`}
          className="size-5 shrink-0 text-muted-foreground"
          onClick={newHere}
          size="icon-xs"
          variant="ghost"
        >
          <Plus className="size-3" />
        </Button>
        </TooltipHint>
      ) : null}
    </div>
  );

  return (
    <section
      className="mt-2 first:mt-0"
      data-sidebar-section={section.id}
      data-sidebar-section-active={active ? "" : undefined}
      data-sidebar-section-collapsed={collapsed ? "" : undefined}
      data-sidebar-section-pinned={section.pinned ? "" : undefined}
    >
      {project ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <MenuKind.Provider value="context">
              <ProjectMenuItems project={project} />
            </MenuKind.Provider>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        header
      )}

      {collapsed ? null : section.sessions.length === 0 ? (
        // Only a pinned folder is listed with nothing in it (`lib/sidebar.ts`, rule 6): it is kept
        // at hand to start a chat in, and its `+` is right above.
        <p className="py-1 pr-2 pl-8 text-[12px] text-muted-foreground/80" data-sidebar-section-empty>
          No chats
        </p>
      ) : (
        <div className="mt-0.5 flex flex-col gap-px">
          {section.sessions.map((session) => (
            <SessionRow
              key={session.id}
              onSelect={() => {
                selectSession(session.id);
                focusComposerOf(session.id);
              }}
              projectName={
                // A pinned row has left its project's section, and a flat
                // list has no section to say it — so the row says it.
                section.kind === "project"
                  ? undefined
                  : projects.find((candidate) => candidate.id === session.projectId)?.name
              }
              selected={session.id === activeSessionId}
              session={session}
              showBranch={filters.showBranch}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** The last folder above a project's own: `~/code/text-to-cad` reads "code". */
function parentName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2]! : "";
}
