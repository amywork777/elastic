/**
 * The adapters that are still running, most recently used last.
 *
 * Selecting another session does not close the one before it: switching back
 * is then a paint, with no spawn, no `initialize` and no replay (README,
 * "Opening a session"). What that costs is a process per session ever
 * clicked, so the set is bounded — the oldest beyond `KEEP_ALIVE_LIMIT` is
 * closed.
 *
 * Two things are never evicted: the most recently used connection (the one
 * on screen) and a busy one. Busy is a turn going (`running`, `waiting`), a
 * connection still `connecting`, and anything the manager holds (`held`): a
 * create from its spawn until it returns, a prompt from its refusal check until
 * its turn ends. An agent halfway through a turn killed to make room would
 * lose the work and the reason both, so if the only candidates are busy the
 * limit is exceeded rather than enforced — and it comes back down when they
 * finish.
 *
 * A `Map` iterates in insertion order, which is what makes this a few lines:
 * `touch` deletes and re-inserts, so the first key is always the oldest.
 */

/**
 * How many adapters stay alive behind the sessions that are not on screen. Measured: one live
 * Claude Code adapter's process tree is 0.7 to 0.85 GB (`npm exec`, the ACP adapter, the agent's
 * binary, its MCP servers), so each one kept is most of a gigabyte.
 */
export const KEEP_ALIVE_LIMIT = 3;

/**
 * How long an adapter may sit unused behind the sessions on screen before it is closed. Switching
 * back within this is a paint; after it, a reconnect, which paints the snapshot at once anyway.
 */
export const IDLE_CLOSE_MS = 10 * 60_000;

/** What this needs of a connection: whether it still works, and how to end it. */
export interface Closable {
  readonly alive: boolean;
  close(): void;
}

export type LiveConnectionsOptions<C extends Closable> = {
  limit?: number;
  /** True while a turn is running, a connection is connecting or the manager holds it: never evicted. */
  busy?: (connection: C) => boolean;
  /** Called after an eviction closed one, so the index row can be marked. */
  onEvict?: (sessionId: string, connection: C) => void;
  /** The clock, for the idle close; the tests' own. */
  now?: () => number;
};

export class LiveConnections<C extends Closable> {
  private readonly connections = new Map<string, C>();
  /** When each was last used: set, touched, or seen busy by `closeIdle`. */
  private readonly usedAt = new Map<string, number>();
  private readonly limit: number;

  constructor(private readonly options: LiveConnectionsOptions<C> = {}) {
    this.limit = options.limit ?? KEEP_ALIVE_LIMIT;
  }

  get(sessionId: string): C | undefined {
    return this.connections.get(sessionId);
  }

  /** Move a session to the front of the queue: it is the one in use. */
  touch(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      this.connections.delete(sessionId);
      this.connections.set(sessionId, connection);
      this.usedAt.set(sessionId, this.now());
    }
  }

  /**
   * Close every adapter unused for `idleMs`, but the one on screen and any that is busy: the
   * limit bounds how many are kept, this how long. A busy one counts as used now, so its idle
   * time starts when its turn ends, not when it was opened. Returns the ids closed.
   */
  closeIdle(idleMs: number): string[] {
    const now = this.now();
    const keys = [...this.connections.keys()];
    const closed: string[] = [];
    // The last key is the one in use; it is never closed for idling.
    for (const sessionId of keys.slice(0, -1)) {
      const connection = this.connections.get(sessionId);
      if (!connection) continue;
      if (!connection.alive) {
        this.connections.delete(sessionId);
        this.usedAt.delete(sessionId);
        continue;
      }
      if (this.options.busy?.(connection)) {
        this.usedAt.set(sessionId, now);
        continue;
      }
      if (now - (this.usedAt.get(sessionId) ?? now) < idleMs) continue;
      this.connections.delete(sessionId);
      this.usedAt.delete(sessionId);
      connection.close();
      this.options.onEvict?.(sessionId, connection);
      closed.push(sessionId);
    }
    return closed;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Take the newest place in the queue, then close whatever no longer fits. */
  set(sessionId: string, connection: C): void {
    this.connections.delete(sessionId);
    this.connections.set(sessionId, connection);
    this.usedAt.set(sessionId, this.now());
    this.evict();
  }

  /** Forget without closing — the caller owns the connection from here. */
  delete(sessionId: string): C | undefined {
    const connection = this.connections.get(sessionId);
    this.connections.delete(sessionId);
    this.usedAt.delete(sessionId);
    return connection;
  }

  keys(): string[] {
    return [...this.connections.keys()];
  }

  entries(): [string, C][] {
    return [...this.connections.entries()];
  }

  get size(): number {
    return this.connections.size;
  }

  /**
   * Close the least recently used beyond the limit, oldest first, skipping
   * any that is busy. Dead connections are dropped first and for free —
   * a crashed adapter holds a slot nobody can use.
   */
  private evict(): void {
    for (const [sessionId, connection] of [...this.connections]) {
      if (!connection.alive) {
        this.connections.delete(sessionId);
      }
    }
    const keep = [...this.connections.keys()];
    // The last key is the one just used; it is never a candidate.
    for (const sessionId of keep.slice(0, -1)) {
      if (this.connections.size <= this.limit) {
        return;
      }
      const connection = this.connections.get(sessionId);
      if (!connection || this.options.busy?.(connection)) {
        continue;
      }
      this.connections.delete(sessionId);
      this.usedAt.delete(sessionId);
      connection.close();
      this.options.onEvict?.(sessionId, connection);
    }
  }
}
