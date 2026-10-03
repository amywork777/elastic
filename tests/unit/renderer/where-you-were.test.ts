import { describe, expect, it } from "vitest";

import { sessionToRestore, surfaceToRestore } from "@renderer/state/where-you-were";
import { readToolUi, safeToRepeat, type PluginRecord } from "@shared/plugins";
import { SettingsSchema, TOOL_TAB_ARGUMENTS_MAX, ToolTabSchema, toolTabArguments, type Session } from "@shared/types";

const tab = { id: "t1", sessionId: "s1", projectId: "/p", order: 0, kind: "tool" as const, pluginId: "text-to-cad", toolId: "cad/cad_open" };

describe("a tool tab keeps its last call's arguments", () => {
  it("keeps an object of arguments and drops one too large to keep, never the tab", () => {
    expect(ToolTabSchema.parse({ ...tab, arguments: { path: "parts/a.step" } }).arguments).toEqual({ path: "parts/a.step" });
    const huge = { blob: "x".repeat(TOOL_TAB_ARGUMENTS_MAX + 1) };
    const parsed = ToolTabSchema.parse({ ...tab, arguments: huge });
    expect(parsed.arguments).toBeUndefined();
    expect(parsed.pluginId).toBe("text-to-cad");
    // A stored value of the wrong shape falls back the same way.
    expect(ToolTabSchema.parse({ ...tab, arguments: ["not", "an", "object"] }).arguments).toBeUndefined();
    expect(ToolTabSchema.parse(tab).arguments).toBeUndefined();
  });

  it("caps what a call hands it the same way", () => {
    expect(toolTabArguments({ path: "a.step" })).toEqual({ path: "a.step" });
    expect(toolTabArguments({ blob: "x".repeat(TOOL_TAB_ARGUMENTS_MAX) })).toBeUndefined();
    expect(toolTabArguments(null)).toBeUndefined();
    expect(toolTabArguments([1])).toBeUndefined();
  });
});

describe("which tools a relaunch calls again", () => {
  const ui = { _meta: { ui: { resourceUri: "ui://cad/app.html" } } };
  it("calls again a tool that only reads, or one only the app calls", () => {
    expect(safeToRepeat(readToolUi("cad", { name: "cad_open", annotations: { readOnlyHint: true }, ...ui })!)).toBe(true);
    expect(safeToRepeat(readToolUi("cad", { name: "cad_tab", _meta: { ui: { resourceUri: "ui://cad/app.html", visibility: ["app"] } } })!)).toBe(true);
  });
  it("does not call again a tool that may change things", () => {
    expect(safeToRepeat(readToolUi("review", { name: "submit_review", ...ui })!)).toBe(false);
    expect(safeToRepeat(readToolUi("review", { name: "submit_review", annotations: { readOnlyHint: false }, ...ui })!)).toBe(false);
  });
});

describe("a relaunch opens where the person was", () => {
  const session = (id: string, archived = false) => ({ id, archived }) as Session;
  it("reopens the last session unless it was archived or is gone", () => {
    expect(sessionToRestore("s1", [session("s1"), session("s2")])).toBe("s1");
    expect(sessionToRestore("s1", [session("s1", true)])).toBeNull();
    expect(sessionToRestore("gone", [session("s1")])).toBeNull();
    expect(sessionToRestore(null, [session("s1")])).toBeNull();
  });

  it("reopens the last rail page, and home when its plugin or tool is gone", () => {
    const plugins = [{ id: "text-to-cad", enabled: true, tools: [{ id: "cad/cad_home" }] }] as unknown as PluginRecord[];
    const cad = { kind: "app" as const, pluginId: "text-to-cad", toolId: "cad/cad_home" };
    expect(surfaceToRestore(cad, plugins)).toEqual(cad);
    expect(surfaceToRestore({ ...cad, toolId: "cad/gone" }, plugins)).toEqual({ kind: "home" });
    expect(surfaceToRestore(cad, [{ ...plugins[0]!, enabled: false }])).toEqual({ kind: "home" });
    expect(surfaceToRestore({ kind: "plugins", view: "browse" }, plugins)).toEqual({ kind: "plugins", view: "browse" });
    expect(surfaceToRestore(null, plugins)).toEqual({ kind: "home" });
  });

  it("stores both as settings that default to nothing", () => {
    const defaults = SettingsSchema.parse({});
    expect([defaults.lastSessionId, defaults.lastSurface]).toEqual([null, null]);
    expect(SettingsSchema.safeParse({ lastSurface: { kind: "nowhere" } }).success).toBe(false);
  });
});
