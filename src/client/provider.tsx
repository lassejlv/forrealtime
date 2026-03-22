"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  systemEvent,
  type ConnectionStatus,
  type RealtimeMessage,
  userEvent,
  type EventPaths,
} from "../shared/types.ts";
import { useRealtime, type UseRealtimeOpts } from "./use-realtime.ts";

const PING_TIMEOUT_MS = 75_000;

type Subscriber = {
  channels: Set<string>;
  callback: (message: RealtimeMessage) => void;
};

type RealtimeContextValue = {
  status: ConnectionStatus;
  register: (
    id: string,
    channels: string[],
    callback: (message: RealtimeMessage) => void,
  ) => void;
  unregister: (id: string) => void;
};

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export interface RealtimeProviderProps {
  children: React.ReactNode;
  api?: {
    url?: string;
    withCredentials?: boolean;
  };
  maxReconnectAttempts?: number;
}

export function RealtimeProvider({
  children,
  api = { url: "/api/realtime", withCredentials: false },
  maxReconnectAttempts = 3,
}: RealtimeProviderProps) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  const subscribersRef = useRef<Map<string, Subscriber>>(new Map());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastAckRef = useRef<Map<string, string>>(new Map());
  const connectRef = useRef<() => void>(() => {});

  const cleanup = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
      pingTimeoutRef.current = null;
    }
  }, []);

  const getChannels = useCallback(() => {
    const channels = new Set<string>();

    for (const subscriber of subscribersRef.current.values()) {
      for (const channel of subscriber.channels) {
        channels.add(channel);
      }
    }

    return [...channels];
  }, []);

  const resetPingTimeout = useCallback(() => {
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
    }

    pingTimeoutRef.current = setTimeout(() => {
      setStatus("disconnected");
      connectRef.current();
    }, PING_TIMEOUT_MS);
  }, []);

  const connect = useCallback(() => {
    const channels = getChannels();
    if (channels.length === 0) {
      cleanup();
      setStatus("disconnected");
      reconnectAttemptsRef.current = 0;
      return;
    }

    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      setStatus("error");
      return;
    }

    cleanup();
    setStatus("connecting");

    const params = new URLSearchParams();
    for (const channel of channels) {
      params.append("channel", channel);

      const lastAck = lastAckRef.current.get(channel);
      if (lastAck) {
        params.set(`last_ack_${channel}`, lastAck);
      }
    }

    const endpoint = api.url ?? "/api/realtime";
    const separator = endpoint.includes("?") ? "&" : "?";
    const eventSource = new EventSource(
      `${endpoint}${separator}${params.toString()}`,
      {
        withCredentials: api.withCredentials ?? false,
      },
    );

    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setStatus("connected");
      resetPingTimeout();
    };

    eventSource.onmessage = (event) => {
      resetPingTimeout();

      const parsed = JSON.parse(event.data) as RealtimeMessage;
      const system = systemEvent.safeParse(parsed);

      if (system.success) {
        if (system.data.type === "connected" && system.data.cursor) {
          lastAckRef.current.set(system.data.channel, system.data.cursor);
        }

        if (system.data.type === "reconnect") {
          connectRef.current();
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

      lastAckRef.current.set(message.data.channel, message.data.id);

      for (const subscriber of subscribersRef.current.values()) {
        if (subscriber.channels.has(message.data.channel)) {
          subscriber.callback(message.data);
        }
      }
    };

    eventSource.onerror = () => {
      if (eventSource !== eventSourceRef.current) {
        return;
      }

      setStatus("disconnected");
      reconnectAttemptsRef.current += 1;

      reconnectTimeoutRef.current = setTimeout(
        () => {
          connectRef.current();
        },
        Math.min(reconnectAttemptsRef.current * 1_000, 10_000),
      );
    };
  }, [
    api.url,
    api.withCredentials,
    cleanup,
    getChannels,
    maxReconnectAttempts,
    resetPingTimeout,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const debouncedConnect = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      connectRef.current();
      debounceTimeoutRef.current = null;
    }, 25);
  }, []);

  useEffect(() => {
    return () => {
      cleanup();

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [cleanup]);

  const register = useCallback(
    (
      id: string,
      channels: string[],
      callback: (message: RealtimeMessage) => void,
    ) => {
      subscribersRef.current.set(id, {
        channels: new Set(channels),
        callback,
      });

      debouncedConnect();
    },
    [debouncedConnect],
  );

  const unregister = useCallback(
    (id: string) => {
      subscribersRef.current.delete(id);

      const activeChannels = new Set(getChannels());
      for (const channel of [...lastAckRef.current.keys()]) {
        if (!activeChannels.has(channel)) {
          lastAckRef.current.delete(channel);
        }
      }

      if (subscribersRef.current.size === 0) {
        cleanup();
        setStatus("disconnected");
        reconnectAttemptsRef.current = 0;
        return;
      }

      debouncedConnect();
    },
    [cleanup, debouncedConnect, getChannels],
  );

  return (
    <RealtimeContext.Provider value={{ status, register, unregister }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeContext() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error(
      "useRealtimeContext must be used within a RealtimeProvider",
    );
  }

  return context;
}

export const createRealtime = <Events extends Record<string, unknown>>() => ({
  useRealtime: <const Event extends EventPaths<Events>>(
    options: UseRealtimeOpts<Events, Event>,
  ) => useRealtime(options),
});
