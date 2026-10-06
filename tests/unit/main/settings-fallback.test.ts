/**
 * A branch prefix git refuses, stored before the check existed, reads as the
 * default (`SettingsSchema`). That fallback is said once in main's log, stays
 * stored until a prefix is set — a write of some other setting does not
 * replace it behind the person's back — and `settings.fallbacks` names it so
 * the Git page can say so.
 */
import { afterEach, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, string>());
vi.mock("@main/db/index", () => ({
  db: () => ({
    prepare: () => ({
      all: () => [...rows].map(([key, value]) => ({ key, value })),
      run: (key: string, value: string) => void rows.set(key, value),
    }),
    transaction: (write: () => void) => write,
  }),
}));

import { settings } from "@main/db/repositories";
import { defaultSettings } from "@shared/types";

afterEach(() => {
  rows.clear();
  vi.restoreAllMocks();
});

it("reads a refused stored prefix as the default, logs it once, and keeps it until a prefix is set", () => {
  rows.set("branchPrefix", JSON.stringify("a b/"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  expect(settings.get().branchPrefix).toBe("elastic/");
  settings.get();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]!.join(" ")).toContain("“a b/”");
  expect(settings.fallbacks()).toEqual({ branchPrefix: "a b/" });

  settings.set({ theme: "dark" });
  expect(settings.fallbacks()).toEqual({ branchPrefix: "a b/" });

  settings.set({ branchPrefix: "me/" });
  expect(settings.fallbacks()).toEqual({});
  expect(settings.get().branchPrefix).toBe("me/");
});

it("reads one unparsable field as its own default without throwing, and lists it", () => {
  rows.set("sidebar", JSON.stringify({ status: "bogus" }));
  rows.set("theme", JSON.stringify("dark"));
  vi.spyOn(console, "warn").mockImplementation(() => {});

  const read = settings.get();
  expect(read.sidebar).toEqual(defaultSettings().sidebar);
  expect(read.theme).toBe("dark");
  expect(Object.keys(settings.fallbacks())).toEqual(["sidebar"]);
  expect(() => settings.set({ theme: "light" })).not.toThrow();
});

it("reads a colour theme this build does not have as the default one", () => {
  rows.set("colorTheme", JSON.stringify("neon"));
  rows.set("theme", JSON.stringify("dark"));
  vi.spyOn(console, "warn").mockImplementation(() => {});

  expect(settings.get().colorTheme).toBe("default");
  expect(settings.get().theme).toBe("dark");
  expect(settings.fallbacks()).toEqual({ colorTheme: "neon" });
  settings.set({ colorTheme: "nord" });
  expect(settings.get().colorTheme).toBe("nord");
  expect(settings.fallbacks()).toEqual({});
});

it("moves a stored Project grouping to Recents once, and leaves a later choice alone", () => {
  settings.set({ sidebar: { ...settings.get().sidebar, groupBy: "project" } });
  settings.defaultSidebarToRecentsOnce();
  expect(settings.get().sidebar.groupBy).toBe("recents");
  settings.set({ sidebar: { ...settings.get().sidebar, groupBy: "project" } });
  settings.defaultSidebarToRecentsOnce();
  expect(settings.get().sidebar.groupBy).toBe("project");
  expect(settings.get().sidebar.foldersCollapsed).toBe(true);
});

it("starts a new install on Recents", () => {
  expect(defaultSettings().sidebar.groupBy).toBe("recents");
});
