import type { InferRealtimeEvents } from "../server/realtime.ts";
import {
  systemEvent,
  type ConnectionStatus,
  type EventPayloadUnion,
  type RealtimeMessage,
  userEvent,
} from "../shared/types.ts";

const PING_TIMEOUT_MS = 75_000;
const CONNECT_DEBOUNCE_MS = 25;

type Subscriber = {
  channels: Set<string>;
  callback: (message: RealtimeMessage) => void;
};

type StatusListener = (status: ConnectionStatus) => void;

export type ResolveEvents<T> =
  InferRealtimeEvents<T> extends never ? T : InferRealtimeEvents<T>;

export interface UseRealtimeOpts<Events, Event extends string> {
  events?: readonly Event[];
  onData?: (payload: EventPayloadUnion<Events, Event>) => void;
  channels?: readonly (string | undefined)[];
  enabled?: boolean;
}

export interface RealtimeClientOptions {
  api?: {
    url?: string;
    withCredentials?: boolean;
  };
  maxReconnectAttempts?: number;
  eventSourceFactory?: (
    url: string,
    init: EventSourceInit,
  ) => RealtimeEventSource;
}

export interface RealtimeEventSource {
  close(): void;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onopen: ((event: Event) => void) | null;
}

export interface RealtimeClient {
  destroy(): void;
  getStatus(): ConnectionStatus;
  subscribeStatus(listener: StatusListener): () => void;
  subscribe<Events, Event extends string>(
    options: UseRealtimeOpts<Events, Event>,
  ): () => void;
}

export function createRealtimeClient(
  options: RealtimeClientOptions = {},
): RealtimeClient {
  const api = options.api ?? { url: "/api/realtime", withCredentials: false };
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
  const createEventSource =
    options.eventSourceFactory ??
    ((url: string, init: EventSourceInit) => new EventSource(url, init));

  let status: ConnectionStatus = "disconnected";

  const subscribers = new Map<string, Subscriber>();
  const statusListeners = new Set<StatusListener>();
  const lastAck = new Map<string, string>();

  let eventSource: RealtimeEventSource | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let pingTimeout: ReturnType<typeof setTimeout> | null = null;
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  const setStatus = (nextStatus: ConnectionStatus) => {
    if (status === nextStatus) {
      return;
    }

    status = nextStatus;
    for (const listener of statusListeners) {
      listener(status);
    }
  };

  const cleanup = () => {
    eventSource?.close();
    eventSource = null;

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (pingTimeout) {
      clearTimeout(pingTimeout);
      pingTimeout = null;
    }
  };

  const getChannels = () => {
    const channels = new Set<string>();

    for (const subscriber of subscribers.values()) {
      for (const channel of subscriber.channels) {
        channels.add(channel);
      }
    }

    return [...channels];
  };

  const resetPingTimeout = () => {
    if (pingTimeout) {
      clearTimeout(pingTimeout);
    }

    pingTimeout = setTimeout(() => {
      setStatus("disconnected");
      connect();
    }, PING_TIMEOUT_MS);
  };

  const connect = () => {
    const channels = getChannels();
    if (channels.length === 0) {
      cleanup();
      setStatus("disconnected");
      reconnectAttempts = 0;
      return;
    }

    if (reconnectAttempts >= maxReconnectAttempts) {
      setStatus("error");
      return;
    }

    cleanup();
    setStatus("connecting");

    const params = new URLSearchParams();
    for (const channel of channels) {
      params.append("channel", channel);

      const acknowledgedCursor = lastAck.get(channel);
      if (acknowledgedCursor) {
        params.set(`last_ack_${channel}`, acknowledgedCursor);
      }
    }

    const endpoint = api.url ?? "/api/realtime";
    const separator = endpoint.includes("?") ? "&" : "?";
    const nextEventSource = createEventSource(
      `${endpoint}${separator}${params.toString()}`,
      {
        withCredentials: api.withCredentials ?? false,
      },
    );

    eventSource = nextEventSource;

    nextEventSource.onopen = () => {
      reconnectAttempts = 0;
      setStatus("connected");
      resetPingTimeout();
    };

    nextEventSource.onmessage = (event) => {
      resetPingTimeout();

      const parsed = JSON.parse(event.data) as RealtimeMessage;
      const system = systemEvent.safeParse(parsed);

      if (system.success) {
        if (system.data.type === "connected" && system.data.cursor) {
          lastAck.set(system.data.channel, system.data.cursor);
        }

        if (system.data.type === "reconnect") {
          connect();
        }

        if (system.data.type === "error") {
          setStatus("error");
        }

        return;
      }

      const message = userEvent.safeParse(parsed);
      if (!message.success) {
        return;
      }

      lastAck.set(message.data.channel, message.data.id);

      for (const subscriber of subscribers.values()) {
        if (subscriber.channels.has(message.data.channel)) {
          subscriber.callback(message.data);
        }
      }
    };

    nextEventSource.onerror = () => {
      if (nextEventSource !== eventSource) {
        return;
      }

      setStatus("disconnected");
      reconnectAttempts += 1;

      reconnectTimeout = setTimeout(
        () => {
          connect();
        },
        Math.min(reconnectAttempts * 1_000, 10_000),
      );
    };
  };

  const debouncedConnect = () => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    debounceTimeout = setTimeout(() => {
      connect();
      debounceTimeout = null;
    }, CONNECT_DEBOUNCE_MS);
  };

  return {
    destroy() {
      cleanup();

      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        debounceTimeout = null;
      }

      subscribers.clear();
      statusListeners.clear();
      lastAck.clear();
      reconnectAttempts = 0;
      setStatus("disconnected");
    },

    getStatus() {
      return status;
    },

    subscribeStatus(listener) {
      listener(status);
      statusListeners.add(listener);

      return () => {
        statusListeners.delete(listener);
      };
    },

    subscribe<Events, Event extends string>(
      options: UseRealtimeOpts<Events, Event>,
    ) {
      const { channels = ["default"], enabled, events, onData } = options;
      const id = Math.random().toString(36).slice(2);
      const normalizedChannels = channels.filter((channel): channel is string =>
        Boolean(channel),
      );
      const normalizedEvents = events ? [...events] : undefined;

      if (enabled !== false && normalizedChannels.length > 0) {
        subscribers.set(id, {
          channels: new Set(normalizedChannels),
          callback(message) {
            const parsed = userEvent.safeParse(message);
            if (!parsed.success) {
              return;
            }

            if (
              normalizedEvents &&
              normalizedEvents.length > 0 &&
              !normalizedEvents.includes(parsed.data.event as Event)
            ) {
              return;
            }

            const payload = {
              id: parsed.data.id,
              channel: parsed.data.channel,
              event: parsed.data.event as Event,
              data: parsed.data.data as EventPayloadUnion<
                Events,
                Event
              >["data"],
            } as EventPayloadUnion<Events, Event>;

            onData?.(payload);
          },
        });

        debouncedConnect();
      }

      return () => {
        subscribers.delete(id);

        const activeChannels = new Set(getChannels());
        for (const channel of [...lastAck.keys()]) {
          if (!activeChannels.has(channel)) {
            lastAck.delete(channel);
          }
        }

        if (subscribers.size === 0) {
          cleanup();
          setStatus("disconnected");
          reconnectAttempts = 0;
          return;
        }

        debouncedConnect();
      };
    },
  };
}
