import {
  encodeServerSentEvent,
  toExclusiveStreamId,
} from "../shared/stream.ts";
import { systemEvent, userEvent, type SystemEvent } from "../shared/types.ts";
import type { Opts, Realtime } from "./realtime.ts";

const DEFAULT_PING_INTERVAL_MS = 30_000;

export interface MiddlewareContext {
  request: Request;
  channels: string[];
}

export interface HandleOptions<T extends Opts> {
  realtime: Realtime<T>;
  middleware?: (
    context: MiddlewareContext,
  ) => Response | void | Promise<Response | void>;
}

export function handle<T extends Opts>({
  realtime,
  middleware,
}: HandleOptions<T>): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const { searchParams } = new URL(request.url);
    const requestedChannels = searchParams.getAll("channel");
    const channels = [
      ...new Set(
        requestedChannels.length > 0 ? requestedChannels : ["default"],
      ),
    ];

    if (middleware) {
      const result = await middleware({ request, channels });
      if (result) {
        return result;
      }
    }

    const redis = realtime._redis;
    if (!redis) {
      return new Response(
        JSON.stringify({ error: "Redis adapter not configured" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    const logger = realtime._logger;
    const maxDurationMs = realtime._maxDurationSecs * 1000;

    let closeStream = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const startedAt = Date.now();
        const loopController = new AbortController();
        let closed = false;

        const cursors = new Map<string, string>();
        let pingInterval: ReturnType<typeof setInterval> | undefined;

        const safeEnqueue = (value: unknown) => {
          if (closed) {
            return;
          }

          try {
            controller.enqueue(encodeServerSentEvent(value));
          } catch (error) {
            logger.error("failed to enqueue SSE payload", error);
          }
        };

        const close = () => {
          if (closed) {
            return;
          }

          closed = true;
          loopController.abort();

          if (pingInterval) {
            clearInterval(pingInterval);
          }

          request.signal.removeEventListener("abort", abort);

          try {
            controller.close();
          } catch {
            logger.log("stream already closed");
          }
        };

        closeStream = close;

        const abort = () => {
          close();
        };

        request.signal.addEventListener("abort", abort);

        pingInterval = setInterval(() => {
          safeEnqueue({
            type: "ping",
            timestamp: Date.now(),
          } satisfies SystemEvent);
        }, DEFAULT_PING_INTERVAL_MS);

        void (async () => {
          try {
            for (const channel of channels) {
              const lastAck = searchParams.get(`last_ack_${channel}`);
              const liveCursor =
                (await redis.getLatestCursor(channel)) ?? "0-0";

              cursors.set(channel, liveCursor);
              safeEnqueue({
                type: "connected",
                channel,
                cursor: liveCursor === "0-0" ? undefined : liveCursor,
              } satisfies SystemEvent);

              if (!lastAck || liveCursor === "0-0") {
                continue;
              }

              const replayEntries = await redis.xrange(channel, {
                start: toExclusiveStreamId(lastAck),
                end: liveCursor,
              });

              for (const entry of replayEntries) {
                if (closed) {
                  return;
                }

                const parsed = userEvent.safeParse({
                  id: entry.id,
                  ...entry.payload,
                });
                if (!parsed.success) {
                  continue;
                }

                safeEnqueue(parsed.data);
                cursors.set(channel, entry.id);
              }
            }

            while (!closed) {
              if (Date.now() - startedAt >= maxDurationMs - 1_000) {
                safeEnqueue({
                  type: "reconnect",
                  timestamp: Date.now(),
                } satisfies SystemEvent);
                close();
                return;
              }

              const results = await redis.xread({
                channels,
                cursors: channels.map(
                  (channel) => cursors.get(channel) ?? "0-0",
                ),
                blockMs: realtime._readBlockMs,
                signal: loopController.signal,
              });

              for (const result of results) {
                for (const message of result.messages) {
                  if (closed) {
                    return;
                  }

                  cursors.set(result.channel, message.id);

                  const parsed = userEvent.safeParse({
                    id: message.id,
                    ...message.payload,
                  });
                  if (!parsed.success) {
                    continue;
                  }

                  safeEnqueue(parsed.data);
                }
              }
            }
          } catch (error) {
            if (!closed) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Unknown realtime error";
              safeEnqueue({
                type: "error",
                error: message,
              } satisfies SystemEvent);
              close();
            }
          }
        })();
      },
      cancel() {
        closeStream();
      },
    });

    return new StreamingResponse(stream);
  };
}

export class StreamingResponse extends Response {
  constructor(stream: ReadableStream<Uint8Array>, init?: ResponseInit) {
    super(stream, {
      ...init,
      status: init?.status ?? 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
        ...init?.headers,
      },
    });
  }
}

export function parseRealtimeMessage(raw: string) {
  const parsed = JSON.parse(raw);
  const system = systemEvent.safeParse(parsed);
  if (system.success) {
    return system.data;
  }

  const user = userEvent.safeParse(parsed);
  if (user.success) {
    return user.data;
  }

  return null;
}
