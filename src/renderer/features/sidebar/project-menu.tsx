import { EyeOff, FolderOpen, MessageSquarePlus } from "lucide-react";

import { MenuItem, MenuSeparator } from "@renderer/features/sidebar/menu";
import { hideFolder } from "@renderer/state/hidden-folders";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import type { Project } from "@shared/types";

/**
 * A project's actions, written once: right-clicking the project's section
 * header, which is where a list puts them.
 *
 * The header itself carries only what belongs on a header — the collapse and
 * `+` — so these are not a `…` button of their own. They were also the
 * bottom of the filter menu (`Project…`) while that menu hung off a project's
 * header; the menu is the panel's now, and a global menu is no place for one
 * folder's actions. Drawn through `menu.tsx` so the list is not written twice
 * for Radix's two menu components.
 */
export function ProjectMenuItems({
  project,
}: {
  project: Project;
}) {
  const setActiveProject = useProjects((state) => state.setActive);
  const setActiveSession = useSessions((state) => state.setActive);

  return (
    <>
      <MenuItem
        icon={<MessageSquarePlus />}
        label="New session here"
        onSelect={() => {
          setActiveProject(project.id);
          setActiveSession(null);
        }}
      />
      <MenuItem
        label="Copy path"
        onSelect={() => void navigator.clipboard.writeText(project.path)}
      />
      <MenuItem
        icon={<FolderOpen />}
        label="Reveal in Finder"
        onSelect={() => void window.workbench.shell.showItemInFolder({ projectId: project.id })}
      />
      <MenuSeparator />
      <MenuItem icon={<EyeOff />} label="Hide folder" onSelect={() => hideFolderKeepingFocus(project.id)} />
    </>
  );
}

/**
 * Hide a folder and hand focus on: its header goes with it, and the menu would give focus back
 * to a control that is no longer there. The next folder's header takes it, else the previous
 * one's, else the sidebar's New.
 */
function hideFolderKeepingFocus(projectId: string): void {
  const sections = [...document.querySelectorAll<HTMLElement>("[data-sidebar-section]")];
  const at = sections.findIndex((section) => section.dataset.sidebarSection === projectId);
  const neighbour = sections[at + 1] ?? sections[at - 1] ?? null;
  const neighbourId = neighbour?.dataset.sidebarSection ?? null;
  hideFolder(projectId);
  // After the menu has closed and returned focus, and the section has gone.
  window.setTimeout(() => {
    const target =
      (neighbourId ? document.querySelector<HTMLElement>(`[data-sidebar-section="${CSS.escape(neighbourId)}"] [data-sidebar-section-header] button`) : null) ??
      document.querySelector<HTMLElement>('[data-sidebar-link="New"]');
    target?.focus();
  }, 0);
}
