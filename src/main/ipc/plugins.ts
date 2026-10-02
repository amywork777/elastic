/**
 * `plugins.*` handlers, over the one `PluginService` (`../integrations`).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow, dialog } from "electron";

import type { IpcHandlers } from "../../shared/ipc";
import type { pluginsContract } from "../../shared/ipc/plugins";
import { fileExtensionsOf } from "../../shared/plugins";
import { projects, sessions } from "../db/repositories";
import { resolveInRoot } from "../explorer/fs";
import { plugins } from "../integrations";
import { releaseApp, stageApp } from "../plugins/app-protocol";
import { rootOf } from "./explorer";
import { IpcError, type IpcContext } from "./register";

async function chooseFolder(ctx: IpcContext, title: string): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(ctx.sender);
  const options = { title, buttonLabel: "Choose", properties: ["openDirectory"] } as const satisfies Electron.OpenDialogOptions;
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
}

/** The directory a scope's processes see as their root: the session's cwd, else the project's. */
function rootsOf(scope: { sessionId: string | null; projectId: string | null; root?: string | null }): string[] {
  if (scope.sessionId) {
    const session = sessions.get(scope.sessionId);
    if (!session) throw new IpcError("that session is gone");
    return [session.cwd];
  }
  if (scope.projectId) return [rootOf(scope.projectId, scope.root ?? null)];
  return [];
}

function sentence(error: unknown): IpcError {
  return new IpcError(error instanceof Error ? error.message : String(error));
}

export const pluginsHandlers = {
  plugins: {
    list: () => plugins().snapshot(),
    refresh: () => plugins().refresh(),
    installFolder: async ({ path: given }, ctx) => {
      const folder = given ?? await chooseFolder(ctx, "Choose a plugin folder");
      if (!folder) return null;
      try { return await plugins().installFolder(folder); } catch (error) { throw sentence(error); }
    },
    installFromMarketplace: async ({ marketplace, name }) => {
      try { return await plugins().installFromMarketplace(marketplace, name); } catch (error) { throw sentence(error); }
    },
    uninstall: ({ id }) => plugins().uninstall(id),
    setEnabled: async ({ id, enabled }) => {
      try { return await plugins().setEnabled(id, enabled); } catch (error) { throw sentence(error); }
    },
    addMarketplace: async ({ path: given }, ctx) => {
      const folder = given ?? await chooseFolder(ctx, "Choose a marketplace folder");
      if (!folder) return null;
      try { return plugins().addMarketplace(folder); } catch (error) { throw sentence(error); }
    },
    removeMarketplace: ({ file }) => plugins().removeMarketplace(file),
    setFileHandler: ({ extension, handler }) => {
      if (handler && handler !== "builtin") {
        const [pluginId, ...rest] = handler.split("/");
        const tool = plugins().uiTool(pluginId!, rest.join("/"));
        if (!tool || !fileExtensionsOf(tool).includes(extension.replace(/^\./, "").toLowerCase())) {
          throw new IpcError(`${handler} does not open .${extension} files`);
        }
      }
      plugins().setFileHandler(extension, handler);
    },
    allowFiles: ({ projectId, pluginId }) => {
      const project = projects.get(projectId);
      if (!project) throw new IpcError("that project is no longer open");
      plugins().allowFiles(project.path, pluginId);
    },
    request: async ({ pluginId, server, method, params, scope }) => {
      try {
        return await plugins().request(scope.sessionId, pluginId, server, method, params, { roots: rootsOf(scope) });
      } catch (error) { throw sentence(error); }
    },
    openFile: async ({ pluginId, toolId, path: relative, scope }) => {
      const project = projects.get(scope.projectId);
      if (!project) throw new IpcError("that project is no longer open");
      if (!plugins().filesAllowed(project.path, pluginId)) throw new IpcError(`${pluginId} has not been allowed to open this project's files`);
      const tool = plugins().uiTool(pluginId, toolId);
      if (!tool) throw new IpcError(`no enabled plugin "${pluginId}" has the tool ${toolId}`);
      const extension = path.extname(relative).slice(1).toLowerCase();
      if (!fileExtensionsOf(tool).includes(extension)) throw new IpcError(`${tool.title} does not open .${extension} files`);
      const absolutePath = await resolveInRoot(rootOf(scope.projectId, scope.root ?? null), relative).catch(() => {
        throw new IpcError(`${relative} is outside the project`);
      });
      const args = { file: { name: path.basename(absolutePath), resourceUri: pathToFileURL(absolutePath).href } };
      try {
        const result = await plugins().request(scope.sessionId, pluginId, tool.server, "tools/call",
          { name: tool.tool, arguments: args, _meta: { "openai/resource": { path: absolutePath } } }, { roots: rootsOf(scope) });
        return { arguments: args, result, absolutePath };
      } catch (error) { throw sentence(error); }
    },
    stageApp: ({ html, csp }) => ({ url: stageApp(html, csp) }),
    releaseApp: ({ url }) => releaseApp(url),
  },
} satisfies IpcHandlers<typeof pluginsContract, IpcContext>;
