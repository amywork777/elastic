import { useProjects } from "./projects";
import { useSessions } from "./sessions";
import { useSettings } from "./settings";

/**
 * Folders hidden from the sidebar (`settings.hiddenProjects`). A project is a directory its
 * sessions name, not a saved thing, so hiding one deletes and archives nothing: its sections stop
 * being drawn (`lib/sidebar.ts`), and its sessions are where they were.
 */
export function hiddenFolders(): readonly string[] {
  return useSettings.getState().settings?.hiddenProjects ?? [];
}

export function hideFolder(projectId: string): void {
  const hidden = hiddenFolders();
  if (hidden.includes(projectId)) return;
  void useSettings.getState().patch({ hiddenProjects: [...hidden, projectId] });
}

export function unhideFolder(projectId: string): void {
  const hidden = hiddenFolders();
  if (!hidden.includes(projectId)) return;
  void useSettings.getState().patch({ hiddenProjects: hidden.filter((id) => id !== projectId) });
}

/**
 * A hidden folder comes back when the person goes to it to start something: opened from the
 * folder chooser or the palette, or a new session begun in it. All of those leave its new-session
 * screen up (the project active, no session). Opening one of its pinned sessions does not.
 * Checked a tick later: the palette sets the project, then clears the session. Returns the stop.
 */
export function unhideOnOpen(): () => void {
  const check = () => queueMicrotask(() => {
    const projectId = useProjects.getState().activeId;
    if (projectId && useSessions.getState().activeId === null) unhideFolder(projectId);
  });
  const stopProjects = useProjects.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId || state.draft !== previous.draft) check();
  });
  const stopSessions = useSessions.subscribe((state, previous) => {
    if (state.activeId === null && previous.activeId !== null) check();
  });
  return () => {
    stopProjects();
    stopSessions();
  };
}
