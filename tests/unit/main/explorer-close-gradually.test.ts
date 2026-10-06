import { describe, expect, it, vi } from "vitest";

import { closeGradually } from "@main/explorer/fs";

/**
 * chokidar's `close()` runs every directory's closer in one synchronous loop: measured, 2 s for
 * elastic's own 550 folders and about 10 s per chat switch on larger folders, which froze the
 * window (the beachball). `closeGradually` runs the closers in slices and hands the main thread
 * back between them.
 */
function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* a closer that blocks, as fs.watch's does */ }
}

function fakeWatcher(directories: number, closeMs: number) {
  const closed: string[] = [];
  const closers = new Map<string, Array<() => void>>();
  for (let index = 0; index < directories; index += 1) {
    const dir = `/root/d${index}`;
    closers.set(dir, [() => { busy(closeMs); closed.push(dir); }]);
  }
  const watcher = {
    closed: false,
    _closers: closers,
    close: vi.fn(async () => {
      // chokidar's own close runs whatever closers are left, all at once.
      for (const list of closers.values()) for (const closer of list) closer();
      closers.clear();
    }),
  };
  return { watcher, closed };
}

describe("closeGradually", () => {
  it("closes every directory's watch, then the watcher, without holding the main thread", async () => {
    const { watcher, closed } = fakeWatcher(600, 3);
    let longest = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 1);

    await closeGradually(watcher, { sliceMs: 8 });
    clearInterval(ticker);

    expect(closed).toHaveLength(600);
    expect(new Set(closed).size).toBe(600);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    // Marked closed first, so chokidar adds no new watches meanwhile.
    expect(watcher.closed).toBe(true);
    // 600 x 3 ms in one go would be 1.8 s; a slice is about 8 ms (plus the closer it ends on).
    expect(longest).toBeLessThan(150);
  });

  it("falls back to close() for a watcher without the closers map", async () => {
    const watcher = { close: vi.fn(async () => {}) };
    await closeGradually(watcher);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });
});
