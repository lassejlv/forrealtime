import type {
  RedisAdapter,
  StreamEntry,
  XAddOptions,
  XRangeArgs,
  XReadArgs,
  XReadResult,
} from "../shared/redis-adapter.ts";

type BunRangeResponse = Array<[string, string[]]>;
type BunReadResponse = Array<[string, Array<[string, string[]]>]> | null;

type BunRedisReader = Pick<Bun.RedisClient, "send">;

type BunRedisLike = {
  send: Bun.RedisClient["send"];
  expire: Bun.RedisClient["expire"];
  duplicate: () => Promise<BunRedisReader>;
};

export interface BunRedisAdapterOptions {
  reader?: BunRedisReader | Promise<BunRedisReader>;
  prefix?: string;
}

export function createBunRedisAdapter(
  client: BunRedisLike = Bun.redis,
  options: BunRedisAdapterOptions = {},
): RedisAdapter {
  const readerPromise = options.reader
    ? Promise.resolve(options.reader)
    : client.duplicate();
  const prefix = options.prefix ?? "";

  const toKey = (channel: string) => `${prefix}${channel}`;

  return {
    async xadd(
      channel: string,
      payload: Record<string, unknown>,
      addOptions?: XAddOptions,
    ) {
      const args = [toKey(channel)];

      if (addOptions?.maxLen != null) {
        args.push("MAXLEN", "~", String(addOptions.maxLen));
      }

      args.push("*", "message", JSON.stringify(payload));

      const id = await client.send("XADD", args);
      if (typeof id !== "string") {
        throw new Error("Expected XADD to return a stream id.");
      }

      if (addOptions?.expireAfterSecs != null) {
        await client.expire(toKey(channel), addOptions.expireAfterSecs);
      }

      return id;
    },

    async xrange(channel: string, rangeOptions: XRangeArgs = {}) {
      const response = (await client.send("XRANGE", [
        toKey(channel),
        rangeOptions.start ?? "-",
        rangeOptions.end ?? "+",
        ...(rangeOptions.count == null
          ? []
          : ["COUNT", String(rangeOptions.count)]),
      ])) as BunRangeResponse;

      return parseRangeResponse(response);
    },

    async xread(readOptions: XReadArgs) {
      const reader = await readerPromise;
      const response = (await reader.send("XREAD", [
        ...(readOptions.blockMs == null
          ? []
          : ["BLOCK", String(readOptions.blockMs)]),
        ...(readOptions.count == null
          ? []
          : ["COUNT", String(readOptions.count)]),
        "STREAMS",
        ...readOptions.channels.map(toKey),
        ...readOptions.cursors,
      ])) as BunReadResponse;

      return parseReadResponse(response, prefix);
    },

    async getLatestCursor(channel: string) {
      const response = (await client.send("XREVRANGE", [
        toKey(channel),
        "+",
        "-",
        "COUNT",
        "1",
      ])) as BunRangeResponse;

      const latest = response[0];
      return latest?.[0] ?? null;
    },
  };
}

function parseRangeResponse(response: BunRangeResponse): StreamEntry[] {
  return response.flatMap(([id, fields]) => {
    const payload = getMessagePayload(fields);
    return payload ? [{ id, payload }] : [];
  });
}

function parseReadResponse(
  response: BunReadResponse,
  prefix: string,
): XReadResult[] {
  if (!response) {
    return [];
  }

  return response.flatMap(([key, entries]) => {
    const channel =
      prefix.length > 0 && key.startsWith(prefix)
        ? key.slice(prefix.length)
        : key;

    const messages = parseRangeResponse(entries);
    return messages.length > 0 ? [{ channel, messages }] : [];
  });
}

function getMessagePayload(fields: string[]): Record<string, unknown> | null {
  const index = fields.findIndex((value) => value === "message");
  if (index === -1 || index === fields.length - 1) {
    return null;
  }

  const raw = fields[index + 1];
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as Record<string, unknown>;
}
