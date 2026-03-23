import * as z from "zod/v4/core";
import type { RedisAdapter } from "../shared/redis-adapter.ts";
import { toHistoryEnd, toHistoryStart } from "../shared/stream.ts";
import {
  type EventPaths,
  type EventPayloadUnion,
  type HistoryArgs,
  type Schema,
  userEvent,
} from "../shared/types.ts";

const DEFAULT_MAX_DURATION_SECONDS = 300;
const DEFAULT_READ_BLOCK_MS = 1000;

export interface Opts {
  schema?: Schema;
  redis?: RedisAdapter;
  maxDurationSecs?: number;
  verbose?: boolean;
  history?:
    | {
        maxLength?: number;
        expireAfterSecs?: number;
      }
    | boolean;
}

type HistoryConfig = {
  maxLength?: number;
  expireAfterSecs?: number;
};

type SubscribeArgs<T extends Opts, Event extends EventName<T>> = {
  events: readonly Event[];
  onData: (payload: SubscriptionPayload<T, Event>) => void | Promise<void>;
  history?: boolean | HistoryArgs;
};

type RealtimeChannel<T extends Opts> = {
  subscribe: <Event extends EventName<T>>(
    args: SubscribeArgs<T, Event>,
  ) => Promise<() => void>;
  unsubscribe: () => void;
  emit: <Event extends EventPath<T>>(
    event: Event,
    data: EventData<T, Event>,
  ) => Promise<void>;
  history: (args?: HistoryArgs) => Promise<HistoryMessage[]>;
};

class RealtimeBase<T extends Opts> {
  private readonly channels = new Map<string, RealtimeChannel<T>>();
  private readonly schema: Schema;
  private readonly verbose: boolean;
  private readonly historyConfig: HistoryConfig;
  private readonly activeUnsubscribes = new Map<string, () => void>();

  public readonly _redis?: RedisAdapter;
  public readonly _maxDurationSecs: number;
  public readonly _readBlockMs = DEFAULT_READ_BLOCK_MS;
  public readonly _logger = {
    log: (...values: unknown[]) => {
      if (this.verbose) {
        console.log(...values);
      }
    },
    warn: (...values: unknown[]) => {
      if (this.verbose) {
        console.warn(...values);
      }
    },
    error: (...values: unknown[]) => {
      if (this.verbose) {
        console.error(...values);
      }
    },
  };

  constructor(options: T = {} as T) {
    this.schema = options.schema ?? {};
    this._redis = options.redis;
    this._maxDurationSecs =
      options.maxDurationSecs ?? DEFAULT_MAX_DURATION_SECONDS;
    this.verbose = options.verbose ?? false;
    this.historyConfig =
      typeof options.history === "boolean" ? {} : (options.history ?? {});

    Object.assign(this, this.createChannel("default"));
  }

  channel(channel: string): RealtimeChannel<T> {
    const cached = this.channels.get(channel);
    if (cached) {
      return cached;
    }

    const created = this.createChannel(channel);
    this.channels.set(channel, created);
    return created;
  }

  private createChannel(channel: string): RealtimeChannel<T> {
    const history = async (args?: HistoryArgs): Promise<HistoryMessage[]> => {
      const redis = this.requireRedis();
      const entries = await redis.xrange(channel, {
        start: toHistoryStart(args?.start),
        end: toHistoryEnd(args?.end),
        count: args?.limit == null ? 1000 : Math.min(args.limit, 1000),
      });

      return entries
        .map((entry) => userEvent.safeParse({ id: entry.id, ...entry.payload }))
        .filter((entry) => entry.success)
        .map((entry) => entry.data);
    };

    const emit = async <Event extends EventPath<T>>(
      event: Event,
      data: EventData<T, Event>,
    ): Promise<void> => {
      const redis = this.requireRedis();
      this.parseEventData(event, data);

      const payload = {
        channel,
        event,
        data,
      } as Record<string, unknown>;

      const id = await redis.xadd(channel, payload, {
        maxLen: this.historyConfig.maxLength,
        expireAfterSecs: this.historyConfig.expireAfterSecs,
      });

      this._logger.log("emitted event", { channel, event, id });
    };

    const unsubscribe = () => {
      const stop = this.activeUnsubscribes.get(channel);
      if (!stop) {
        return;
      }

      stop();
      this.activeUnsubscribes.delete(channel);
    };

    const subscribe = async <Event extends EventName<T>>({
      events,
      onData,
      history: historyOptions,
    }: SubscribeArgs<T, Event>): Promise<() => void> => {
      const redis = this.requireRedis();
      unsubscribe();

      const controller = new AbortController();
      const eventSet = new Set<string>(events);

      let cursor = (await redis.getLatestCursor(channel)) ?? "0-0";

      if (historyOptions) {
        const replayEnd = cursor;
        const replayEntries =
          replayEnd === "0-0"
            ? []
            : await redis.xrange(channel, {
                start:
                  typeof historyOptions === "object"
                    ? toHistoryStart(historyOptions.start)
                    : "-",
                end:
                  typeof historyOptions === "object" &&
                  historyOptions.end != null
                    ? toHistoryEnd(historyOptions.end)
                    : replayEnd,
                count:
                  typeof historyOptions === "object"
                    ? historyOptions.limit
                    : undefined,
              });

        for (const entry of replayEntries) {
          if (controller.signal.aborted) {
            break;
          }

          const parsed = userEvent.safeParse({
            id: entry.id,
            ...entry.payload,
          });
          if (!parsed.success || !eventSet.has(parsed.data.event)) {
            continue;
          }

          await onData(parsed.data as SubscriptionPayload<T, Event>);
        }
      }

      const stop = () => {
        controller.abort();
      };

      this.activeUnsubscribes.set(channel, stop);

      void (async () => {
        while (!controller.signal.aborted) {
          const results = await redis.xread({
            channels: [channel],
            cursors: [cursor],
            blockMs: this._readBlockMs,
            signal: controller.signal,
          });

          const result = results[0];
          if (!result) {
            continue;
          }

          for (const message of result.messages) {
            if (controller.signal.aborted) {
              return;
            }

            cursor = message.id;

            const parsed = userEvent.safeParse({
              id: message.id,
              ...message.payload,
            });
            if (!parsed.success || !eventSet.has(parsed.data.event)) {
              continue;
            }

            await onData(parsed.data as SubscriptionPayload<T, Event>);
          }
        }
      })().catch((error: unknown) => {
        if (!controller.signal.aborted) {
          this._logger.error("subscription loop failed", error);
        }
      });

      return () => {
        stop();
        if (this.activeUnsubscribes.get(channel) === stop) {
          this.activeUnsubscribes.delete(channel);
        }
      };
    };

    return {
      history,
      emit,
      subscribe,
      unsubscribe,
    };
  }

  private parseEventData(event: string, data: unknown) {
    const schema = this.findSchema(event);
    if (schema) {
      z.parse(schema, data);
    }
  }

  private findSchema(event: string): z.$ZodType | undefined {
    const parts = event.split(".");
    let current: Schema | z.$ZodType | undefined = this.schema;

    for (const part of parts) {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      current = (current as Schema)[part];
    }

    return current && ("_zod" in current || "_def" in current)
      ? (current as z.$ZodType)
      : undefined;
  }

  private requireRedis(): RedisAdapter {
    if (!this._redis) {
      throw new Error("Redis adapter not configured.");
    }

    return this._redis;
  }
}

type SchemaPaths<T, Prefix extends string = ""> = {
  [Key in keyof T]: Key extends string
    ? T[Key] extends z.$ZodType
      ? Prefix extends ""
        ? Key
        : `${Prefix}${Key}`
      : T[Key] extends object
        ? SchemaPaths<T[Key], `${Prefix}${Key}.`>
        : never
    : never;
}[keyof T];

type SchemaValue<
  T,
  Path extends string,
> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? SchemaValue<T[Head], Tail>
    : never
  : Path extends keyof T
    ? T[Path]
    : never;

export type EventPath<T extends Opts> = T["schema"] extends Schema
  ? SchemaPaths<T["schema"]>
  : string;

export type EventData<
  T extends Opts,
  Event extends string,
> = T["schema"] extends Schema
  ? SchemaValue<T["schema"], Event> extends z.$ZodType
    ? z.infer<SchemaValue<T["schema"], Event>>
    : unknown
  : unknown;

type EventName<T extends Opts> = T["schema"] extends Schema
  ? EventPaths<T["schema"]>
  : string;

type SubscriptionPayload<
  T extends Opts,
  Event extends string,
> = T["schema"] extends Schema
  ? EventPayloadUnion<T["schema"], Event>
  : {
      event: Event;
      data: unknown;
      channel: string;
    };

export interface HistoryMessage {
  id: string;
  event: string;
  channel: string;
  data: unknown;
}

export type Realtime<T extends Opts> = RealtimeBase<T> & {
  channel: (name: string) => RealtimeChannel<T>;
} & RealtimeChannel<T>;

export type InferRealtimeEvents<T> =
  T extends Realtime<infer Options>
    ? Options["schema"] extends Schema
      ? Options["schema"]
      : never
    : never;

export const Realtime = RealtimeBase as new <T extends Opts>(
  options?: T,
) => Realtime<T>;
