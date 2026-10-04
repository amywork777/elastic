import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hideFolder, unhideFolder, unhideOnOpen } from "@renderer/state/hidden-folders";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import { useSettings } from "@renderer/state/settings";
import { SettingsSchema } from "@shared/types";

let patch: ReturnType<typeof vi.fn>;
let stop: () => void;

beforeEach(() => {
  patch = vi.fn(async (next: Record<string, unknown>) => {
    useSettings.setState((state) => ({ settings: { ...state.settings!, ...next } }));
  });
  useSettings.setState({ settings: SettingsSchema.parse({}), patch } as never);
  useProjects.setState({ activeId: "/code/b", draft: null } as never);
  useSessions.setState({ activeId: "s1" } as never);
  stop = unhideOnOpen();
});
afterEach(() => stop());

const hidden = () => useSettings.getState().settings!.hiddenProjects;

describe("hidden folders", () => {
  it("hides and unhides a folder, once each", () => {
    hideFolder("/code/a");
    hideFolder("/code/a");
    expect(hidden()).toEqual(["/code/a"]);
    unhideFolder("/code/a");
    expect(hidden()).toEqual([]);
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it("brings a folder back when its new-session screen opens, not when one of its sessions does", async () => {
    hideFolder("/code/a");
    // A pinned session of the hidden folder selected: still hidden.
    useSessions.setState({ activeId: "s2" } as never);
    useProjects.setState({ activeId: "/code/a" } as never);
    await Promise.resolve();
    expect(hidden()).toEqual(["/code/a"]);
    // Its new-session screen (Open folder, the palette, New session here): back.
    useSessions.setState({ activeId: null } as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(hidden()).toEqual([]);
  });

  it("parses a bad stored list as none, alone", () => {
    expect(SettingsSchema.shape.hiddenProjects.safeParse([1, 2]).success).toBe(false);
    expect(SettingsSchema.shape.hiddenProjects.parse(undefined)).toEqual([]);
  });
});
