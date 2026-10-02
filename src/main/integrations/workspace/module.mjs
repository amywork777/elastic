import { z, tool, path, tabId } from "../definition.mjs";
export default { rendererCommands: {"open_tool": "open-tool", "list_open_tabs": "list-tabs", "show_tab": "show-tab", "close_tab": "close-tab"}, id: "workspace", description: "Open, reveal and navigate this workspace's tabs.", tools: [
  tool("open_file", "Open a workspace file in the app's registered renderer (a plugin's, when one renders the format). Use the generated artifact, after it exists; do not launch another viewer.", { path }),
  tool("open_tool", "Open a tool an enabled plugin contributes (its MCP App view) as a tab in this session's explorer. list_open_tabs shows what is open.", { pluginId: z.string().min(1), toolId: z.string().min(1) }),
  tool("reveal", "Reveal a workspace file or directory without changing the file being viewed.", { path }),
  tool("list_open_tabs", "List tabs belonging to the calling session only, within its workspace root, including background tabs."),
  tool("show_tab", "Select an existing tab in this session's explorer; never switch the user's active session.", { tabId }),
  tool("close_tab", "Close a tab. Terminal tabs stop their app-owned process. Dirty documents must be saved or explicitly discarded first.", { tabId }),
  tool("attach_snapshot", "Read an existing workspace image into this tool result so the agent and user can inspect it.", { path }, "image"),
  tool("list_skills", "List the focused skills supplied to this session."),
  tool("read_skill", "Read a supplied skill or a file within it.", { name: z.string().min(1), path: z.string().optional() }),
] };
