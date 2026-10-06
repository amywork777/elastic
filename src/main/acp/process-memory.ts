/**
 * How much memory an adapter holds, counted the way the person would: the
 * whole process tree under the pid this app spawned. An adapter is never one
 * process — `npm exec` starts Node, which starts the agent's own binary, which
 * may start MCP servers — so the spawned pid alone is the smallest part of it.
 *
 * One `ps` for every pid on the machine, then the trees are summed here: the
 * Agents panel asks for every live adapter at once, and one exec answers all of
 * them. Not on Windows (no `ps`): the sizes are null and the panel says nothing.
 */
import { execFile } from "node:child_process";

import { trackChild } from "../children";

/** One row of `ps -A -o pid=,ppid=,rss=`: rss in kilobytes. */
export type ProcessRow = { pid: number; ppid: number; rssKb: number };

const PS_TIMEOUT_MS = 3_000;

/** Parse `ps -A -o pid=,ppid=,rss=` output. Lines that do not read as three numbers are skipped. */
export function parsePs(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split("\n")) {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(rss)) {
      rows.push({ pid: pid!, ppid: ppid!, rssKb: rss! });
    }
  }
  return rows;
}

/**
 * Bytes held by `root` and everything under it. Null when `root` is not in the
 * table: it has exited, and a size of zero would read as a process that holds nothing.
 */
export function treeBytes(rows: readonly ProcessRow[], root: number): number | null {
  const children = new Map<number, ProcessRow[]>();
  let rootRow: ProcessRow | undefined;
  for (const row of rows) {
    if (row.pid === root) rootRow = row;
    const siblings = children.get(row.ppid);
    if (siblings) siblings.push(row);
    else children.set(row.ppid, [row]);
  }
  if (!rootRow) return null;
  let kb = 0;
  const seen = new Set<number>();
  const stack = [rootRow];
  while (stack.length > 0) {
    const row = stack.pop()!;
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    kb += row.rssKb;
    stack.push(...(children.get(row.pid) ?? []));
  }
  return kb * 1024;
}

/** The process table, or null where there is no `ps` or it failed. */
export function readProcessTable(platform: NodeJS.Platform = process.platform): Promise<ProcessRow[] | null> {
  if (platform === "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    trackChild(
      execFile("ps", ["-A", "-o", "pid=,ppid=,rss="], { timeout: PS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
        resolve(error ? null : parsePs(stdout));
      }),
      "probe",
    );
  });
}
