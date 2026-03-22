import type {
  RedisAdapter,
  StreamEntry,
  XAddOptions,
  XRangeArgs,
  XReadArgs,
  XReadResult,
} from "../../src/shared/redis-adapter.ts";
import { compareStreamIds } from "../../src/shared/stream.ts";

type Waiter = {
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class MemoryRedisAdapter implements RedisAdapter {
  private readonly streams = new Map<string, StreamEntry[]>();
  private readonly waiters = new Set<Waiter>();
  private currentTime = 1_000;
  private sequence = 0;

  async xadd(
    channel: string,
    payload: Record<string, unknown>,
    options: XAddOptions = {},
  ) {
    const entries = this.streams.get(channel) ?? [];
    const id = `${this.currentTime++}-${this.sequence++}`;
    entries.push({ id, payload });

    if (options.maxLen != null && entries.length > options.maxLen) {
      entries.splice(0, entries.length - options.maxLen);
    }

    this.streams.set(channel, entries);
    this.flushWaiters();

    return id;
  }

  async xrange(channel: string, args: XRangeArgs = {}) {
    const entries = this.streams.get(channel) ?? [];
    const start = args.start ?? "-";
    const end = args.end ?? "+";

    const filtered = entries.filter((entry) => {
      return isWithinRange(entry.id, start, end);
    });

    return args.count == null ? filtered : filtered.slice(0, args.count);
  }

  async xread(args: XReadArgs): Promise<XReadResult[]> {
    const immediate = this.readAvailable(args);
    if (immediate.length > 0 || (args.blockMs ?? 0) <= 0) {
      return immediate;
    }

    await new Promise<void>((resolve) => {
      const waiter: Waiter = {
        resolve: () => {
          clearTimeout(waiter.timeout);
          this.waiters.delete(waiter);
          resolve();
        },
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve();
        }, args.blockMs),
      };

      this.waiters.add(waiter);

      if (args.signal) {
        args.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(waiter.timeout);
            this.waiters.delete(waiter);
            resolve();
          },
          { once: true },
        );
      }
    });

    return this.readAvailable(args);
  }

  async getLatestCursor(channel: string) {
    const entries = this.streams.get(channel) ?? [];
    return entries[entries.length - 1]?.id ?? null;
  }

  private readAvailable(args: XReadArgs): XReadResult[] {
    return args.channels.flatMap((channel, index) => {
      const cursor = args.cursors[index] ?? "0-0";
      const entries = (this.streams.get(channel) ?? []).filter(
        (entry) => compareStreamIds(entry.id, cursor) > 0,
      );

      if (entries.length === 0) {
        return [];
      }

      return [
        {
          channel,
          messages: args.count == null ? entries : entries.slice(0, args.count),
        },
      ];
    });
  }

  private flushWaiters() {
    for (const waiter of [...this.waiters]) {
      waiter.resolve();
    }
  }
}

function isWithinRange(id: string, start: string, end: string) {
  const startExclusive = start.startsWith("(");
  const startValue = startExclusive ? start.slice(1) : start;

  const isAfterStart =
    start === "-"
      ? true
      : startExclusive
        ? compareStreamIds(id, startValue) > 0
        : compareStreamIds(id, startValue) >= 0;

  const isBeforeEnd = end === "+" ? true : compareStreamIds(id, end) <= 0;

  return isAfterStart && isBeforeEnd;
}
