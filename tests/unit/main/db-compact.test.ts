import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

import { compactIfMostlyFree } from "@main/db";

function bloated() {
  const database = new Database(":memory:");
  database.exec("CREATE TABLE t (v TEXT)");
  const insert = database.prepare("INSERT INTO t VALUES (?)");
  for (let index = 0; index < 400; index += 1) insert.run("x".repeat(20_000));
  database.exec("DELETE FROM t");
  return database;
}

describe("compactIfMostlyFree", () => {
  it("gives the free pages back when most of the file is free", () => {
    const database = bloated();
    const before = Number(database.pragma("freelist_count", { simple: true }));
    expect(before).toBeGreaterThan(0);
    const result = compactIfMostlyFree(database, { minFreeBytes: 1024 });
    expect(result.compacted).toBe(true);
    expect(Number(database.pragma("freelist_count", { simple: true }))).toBe(0);
  });

  it("leaves a file alone below either threshold", () => {
    expect(compactIfMostlyFree(bloated(), { minFreeBytes: 1024 ** 3 }).compacted).toBe(false);
    const full = new Database(":memory:");
    full.exec("CREATE TABLE t (v TEXT)");
    full.prepare("INSERT INTO t VALUES (?)").run("x".repeat(100_000));
    expect(compactIfMostlyFree(full, { minFreeBytes: 0 }).compacted).toBe(false);
  });
});
