import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiHostContext, McpUiStyles } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@renderer/components/ui/button";
import { Spinner } from "@renderer/components/ui/spinner";
import { useResolvedTheme } from "@renderer/hooks/use-theme";
import { APP_NAME } from "@shared/brand";

/** Which processes the app's requests reach: a session's, or the app's. */
export type FrameScope = { sessionId: string | null; projectId: string | null; root?: string | null };

/** What the app is shown first: the call that opened it. Null when the app starts on its own. */
export type FrameCall = { arguments: Record<string, unknown>; result: unknown } | null;

export type McpAppFrameProps = {
  pluginId: string;
  pluginName: string;
  server: string;
  tool: string;
  resourceUri: string;
  scope: FrameScope;
  /**
   * The call to show. A function, so the frame can make it (a tab opened by
   * the person calls the tool itself) or hand over one made already (an
   * agent's call, a file opened in a plugin). Called again on Reopen.
   */
  call: () => Promise<FrameCall>;
  /** Where the frame is: decides `displayMode` and how the app may lay out. */
  placement: "tab" | "page" | "file";
};

/** The host's design tokens as MCP Apps style variables, so an app can match the window it is in. */
function hostStyles(): McpUiStyles {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
  const variables: Partial<Record<keyof McpUiStyles, string | undefined>> = {
    "--color-background-primary": token("--background"),
    "--color-background-secondary": token("--muted"),
    "--color-background-tertiary": token("--accent"),
    "--color-background-inverse": token("--foreground"),
    "--color-background-danger": token("--destructive"),
    "--color-text-primary": token("--foreground"),
    "--color-text-secondary": token("--muted-foreground"),
    "--color-text-tertiary": token("--muted-foreground"),
    "--color-text-inverse": token("--background"),
    "--color-text-danger": token("--destructive"),
    "--color-border-primary": token("--border"),
    "--color-border-secondary": token("--border"),
    "--color-ring-primary": token("--ring"),
    "--font-sans": token("--font-sans") ?? "system-ui, sans-serif",
    "--font-mono": token("--font-mono") ?? "ui-monospace, monospace",
    "--border-radius-sm": "calc(var(--radius, 0.625rem) - 4px)",
    "--border-radius-md": token("--radius"),
    "--border-radius-lg": "calc(var(--radius, 0.625rem) + 4px)",
  };
  // The radius tokens are relative to the host's --radius; resolve it into the value.
  const radius = token("--radius") ?? "0.625rem";
  for (const key of ["--border-radius-sm", "--border-radius-lg"] as const) variables[key] = variables[key]!.replace("var(--radius, 0.625rem)", radius);
  return variables as McpUiStyles;
}

function textOf(contents: Array<{ text?: string; blob?: string; mimeType?: string }>): string {
  const first = contents[0];
  if (!first) throw new Error("the server returned no UI");
  if (typeof first.text === "string") return first.text;
  if (typeof first.blob === "string") return new TextDecoder().decode(Uint8Array.from(atob(first.blob), (char) => char.charCodeAt(0)));
  throw new Error("the server's UI resource is empty");
}

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

/** One load of the app's document: its key, then its staged URL or why there is none. */
type Staged = { key: string; url: string | null; error: string | null };

/**
 * An MCP App (a plugin tool's `ui://` resource), drawn borderless and full
 * size in whatever it is mounted in: a tab, a rail page, a file.
 *
 * The HTML is served from its own `mcp-app://` URL (main's
 * `plugins/app-protocol.ts`) in a sandboxed frame whose origin is its own, and
 * spoken to with the MCP Apps bridge over `postMessage`. The app's requests
 * (its own server's tools and resources) go to main as `plugins.request` in
 * this frame's scope. The host's theme goes in as style variables, and the
 * frame's background is the host's, so a third-party app does not sit in a
 * box of a different colour.
 *
 * Two loaders, as Codex does it: the host's until the app says it is
 * initialised, then whatever the app draws. A failure is a sentence and a
 * Reopen.
 */
export function McpAppFrame({ pluginId, pluginName, server, tool, resourceUri, scope, call, placement }: McpAppFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [staged, setStaged] = useState<Staged | null>(null);
  /** The URL whose app said it is initialised, or the failure connecting to it. */
  const [connected, setConnected] = useState<{ url: string; error: string | null } | null>(null);
  const theme = useResolvedTheme();
  const callRef = useRef(call);
  useLayoutEffect(() => { callRef.current = call; }, [call]);
  const scopeKey = JSON.stringify(scope);
  const loadKey = JSON.stringify([pluginId, server, resourceUri, scopeKey, attempt]);
  const url = staged?.key === loadKey ? staged.url : null;
  const phase: Phase = staged?.key !== loadKey ? { kind: "loading" }
    : staged.error ? { kind: "error", message: staged.error }
      : connected?.url === url && connected.error ? { kind: "error", message: connected.error }
        : connected?.url === url ? { kind: "ready" } : { kind: "loading" };

  // Stage the document.
  useEffect(() => {
    let cancelled = false;
    let stagedUrl: string | null = null;
    void (async () => {
      const read = await window.workbench.plugins.request({ pluginId, server, method: "resources/read", params: { uri: resourceUri }, scope: JSON.parse(scopeKey) as FrameScope }) as {
        contents: Array<{ text?: string; blob?: string; mimeType?: string; _meta?: { ui?: { csp?: unknown } } }>;
      };
      const html = textOf(read.contents);
      const { url: next } = await window.workbench.plugins.stageApp({ html, csp: read.contents[0]?._meta?.ui?.csp });
      stagedUrl = next;
      if (cancelled) { void window.workbench.plugins.releaseApp({ url: next }); return; }
      setStaged({ key: loadKey, url: next, error: null });
    })().catch((error: unknown) => {
      if (!cancelled) setStaged({ key: loadKey, url: null, error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
      if (stagedUrl) void window.workbench.plugins.releaseApp({ url: stagedUrl });
    };
  }, [pluginId, server, resourceUri, scopeKey, loadKey]);

  // Connect as soon as the frame exists, before its document runs: an app sends
  // `ui/initialize` from its first script, before the frame's load event fires.
  // The frame's window proxy outlives the navigation, so the transport bound to it
  // here hears the document that loads into it.
  useEffect(() => {
    const frame = frameRef.current;
    const target = frame?.contentWindow;
    if (!frame || !target || !url) return;
    const box = boxRef.current?.getBoundingClientRect();
    const context: McpUiHostContext = {
      theme,
      styles: { variables: hostStyles() },
      displayMode: placement === "page" ? "fullscreen" : "inline",
      availableDisplayModes: [placement === "page" ? "fullscreen" : "inline"],
      containerDimensions: { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) },
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: APP_NAME,
      platform: "desktop",
    };
    const bridge = new AppBridge(null, { name: APP_NAME, version: "1" }, {
      openLinks: {},
      serverTools: {},
      serverResources: {},
      logging: {},
    }, { hostContext: context });
    bridgeRef.current = bridge;
    const request = (method: "tools/call" | "resources/read" | "resources/list" | "resources/templates/list" | "prompts/list", params: Record<string, unknown>) =>
      window.workbench.plugins.request({ pluginId, server, method, params, scope });
    bridge.oncalltool = async (params) => await request("tools/call", params as Record<string, unknown>) as CallToolResult;
    bridge.onreadresource = async (params) => await request("resources/read", params as Record<string, unknown>) as never;
    bridge.onlistresources = async (params) => await request("resources/list", (params ?? {}) as Record<string, unknown>) as never;
    bridge.onlistresourcetemplates = async (params) => await request("resources/templates/list", (params ?? {}) as Record<string, unknown>) as never;
    bridge.onlistprompts = async (params) => await request("prompts/list", (params ?? {}) as Record<string, unknown>) as never;
    bridge.onopenlink = async ({ url: link }) => {
      try { await window.workbench.shell.openExternal({ url: link }); return {}; } catch { return { isError: true }; }
    };
    bridge.onloggingmessage = ({ level, data }) => {
      if (level === "error" || level === "critical" || level === "alert" || level === "emergency") console.error(`[${pluginName}]`, data);
      else console.info(`[${pluginName}]`, data);
    };
    bridge.onrequestdisplaymode = async () => ({ mode: placement === "page" ? "fullscreen" : "inline" });
    bridge.oninitialized = () => {
      setConnected({ url, error: null });
      void (async () => {
        const shown = await callRef.current();
        if (!shown || bridgeRef.current !== bridge) return;
        await bridge.sendToolInput({ arguments: shown.arguments });
        await bridge.sendToolResult(shown.result as CallToolResult);
      })().catch((error: unknown) => {
        if (bridgeRef.current !== bridge) return;
        const message = error instanceof Error ? error.message : String(error);
        void bridge.sendToolResult({ isError: true, content: [{ type: "text", text: message }] }).catch(() => {});
      });
    };
    void bridge.connect(new PostMessageTransport(target, target)).catch((error: unknown) => {
      setConnected({ url, error: error instanceof Error ? error.message : String(error) });
    });
    // Torn down with the frame, so the app can save what it holds.
    return () => {
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      void bridge.teardownResource({}).catch(() => {}).finally(() => void bridge.close().catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one bridge per staged document; theme and size reach it below
  }, [url]);

  // Theme and size changes reach the app.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (bridge && phase.kind === "ready") void Promise.resolve(bridge.sendHostContextChange({ theme, styles: { variables: hostStyles() } })).catch(() => {});
  }, [theme, phase.kind]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const bridge = bridgeRef.current;
      if (!bridge || !entry) return;
      void Promise.resolve(bridge.sendHostContextChange({ containerDimensions: { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) } })).catch(() => {});
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);


  return (
    <div className="relative h-full w-full bg-background" data-plugin-frame={`${pluginId}/${server}/${tool}`} ref={boxRef}>
      {url && phase.kind !== "error" ? (
        <iframe
          className="absolute inset-0 size-full border-0 bg-background"
          ref={frameRef}
          // allow-same-origin keeps the frame's own mcp-app://<id> origin real (workers, storage);
          // it is never the app's origin (main's plugins/app-protocol.ts), so the app stays postMessage-only.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          src={url}
          title={`${pluginName}: ${tool}`}
        />
      ) : null}
      {phase.kind === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-muted-foreground text-xs" role="status">
          <Spinner className="size-4" /> Opening {pluginName}…
        </div>
      ) : null}
      {phase.kind === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center" role="alert">
          <div className="font-medium text-sm">{pluginName} is unavailable</div>
          <div className="max-w-md whitespace-pre-wrap break-words text-muted-foreground text-xs">{phase.message}</div>
          <Button onClick={() => setAttempt((value) => value + 1)} size="sm" variant="secondary">
            <RotateCw className="size-3.5" /> Reopen {pluginName}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
