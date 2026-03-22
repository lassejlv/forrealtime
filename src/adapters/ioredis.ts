import type {
  RedisAdapter,
  StreamEntry,
  XAddOptions,
  XRangeArgs,
  XReadArgs,
  XReadResult,
} from "../shared/redis-adapter.ts";

type IORedisRangeResponse = Array<[string, string[]]>;
type IORedisReadResponse = Array<[string, Array<[string, string[]]>]> | null;

type IORedisReader = {
  xread: (...args: string[]) => Promise<IORedisReadResponse>;
};

type IORedisLike = {
  xadd: (...args: string[]) => Promise<string>;
  xrange: (...args: string[]) => Promise<IORedisRangeResponse>;
  xrevrange: (...args: string[]) => Promise<IORedisRangeResponse>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  duplicate: () => IORedisReader;
};

export interface IORedisAdapterOptions {
  reader?: IORedisReader;
  prefix?: string;
}

export function createIORedisAdapter(
  client: IORedisLike,
  options: IORedisAdapterOptions = {},
): RedisAdapter {
  const reader = options.reader ?? client.duplicate();
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

      const id = await client.xadd(...args);

      if (addOptions?.expireAfterSecs != null) {
        await client.expire(toKey(channel), addOptions.expireAfterSecs);
      }

      return id;
    },

    async xrange(channel: string, rangeOptions: XRangeArgs = {}) {
      const response = await client.xrange(
        toKey(channel),
        rangeOptions.start ?? "-",
        rangeOptions.end ?? "+",
        ...(rangeOptions.count == null
          ? []
          : ["COUNT", String(rangeOptions.count)]),
      );

      return parseRangeResponse(response);
    },

    async xread(readOptions: XReadArgs) {
      const response = await reader.xread(
        ...(readOptions.blockMs == null
          ? []
          : ["BLOCK", String(readOptions.blockMs)]),
        ...(readOptions.count == null
          ? []
          : ["COUNT", String(readOptions.count)]),
        "STREAMS",
        ...readOptions.channels.map(toKey),
        ...readOptions.cursors,
      );

      return parseReadResponse(response, prefix);
    },

    async getLatestCursor(channel: string) {
      const response = await client.xrevrange(
        toKey(channel),
        "+",
        "-",
        "COUNT",
        "1",
      );
      const latest = response[0];
      return latest?.[0] ?? null;
    },
  };
}

function parseRangeResponse(response: IORedisRangeResponse): StreamEntry[] {
  return response.flatMap(([id, fields]) => {
    const payload = getMessagePayload(fields);
    return payload ? [{ id, payload }] : [];
  });
}

function parseReadResponse(
  response: IORedisReadResponse,
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
