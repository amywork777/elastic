import { describe, expect, it } from "vitest";

import { parsePs, treeBytes } from "@main/acp/process-memory";

describe("process memory", () => {
  it("parses ps rows and skips lines that are not three numbers", () => {
    expect(parsePs("  1     0   100\n 42     1  2048\nnot a row\n\n")).toEqual([
      { pid: 1, ppid: 0, rssKb: 100 },
      { pid: 42, ppid: 1, rssKb: 2048 },
    ]);
  });

  it("sums the whole tree under the root, not the root alone", () => {
    const rows = parsePs("10 1 100\n11 10 200\n12 11 300\n13 1 9999\n");
    expect(treeBytes(rows, 10)).toBe((100 + 200 + 300) * 1024);
    expect(treeBytes(rows, 12)).toBe(300 * 1024);
  });

  it("is null for a root that has exited, never zero", () => {
    expect(treeBytes(parsePs("10 1 100\n"), 99)).toBeNull();
  });

  it("survives a cycle in the table", () => {
    const rows = [
      { pid: 5, ppid: 6, rssKb: 1 },
      { pid: 6, ppid: 5, rssKb: 1 },
    ];
    expect(treeBytes(rows, 5)).toBe(2 * 1024);
  });
});
