import type { RendererRegistration } from "@workbench/ui/file-viewer";
import type { ExplorerRoot } from "@shared/types";
import { pluginRenderers } from "@renderer/plugins/file-renderers";
import { codeRenderer } from "./code";
import { imageRenderer } from "./image";
import { markdownRenderer } from "./markdown";
import { pdfRenderer } from "./pdf";
import { unsupportedRenderer } from "./unsupported";

/**
 * Application composition: the built-in renderers that live beside this file (Markdown, code,
 * image, PDF and the unsupported fallback) and the file renderers enabled plugins contribute
 * (`@renderer/plugins/file-renderers`). A plugin's renderer is picked over a built-in one by its
 * priority, which is how a plugin overrides how a format is shown (a STEP file in a CAD viewer
 * instead of as text).
 */
export function createDesktopRenderers(projectId: string, root: ExplorerRoot, tabId: string, plugins: readonly RendererRegistration[] = pluginRenderers({ projectId, root, tabId })) {
  return { renderers: [markdownRenderer, codeRenderer, ...plugins, imageRenderer, pdfRenderer, unsupportedRenderer], dispose: () => {} };
}
