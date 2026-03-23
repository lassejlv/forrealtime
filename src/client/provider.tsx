import React, { createContext, useContext, useEffect, useMemo } from "react";
import type { EventPaths } from "../shared/types.ts";
import type {
  RealtimeClient,
  RealtimeClientOptions,
  ResolveEvents,
  UseRealtimeOpts,
} from "./core.ts";
import { createRealtimeClient } from "./core.ts";
import { useRealtime } from "./use-realtime.ts";

export const RealtimeContext = createContext<RealtimeClient | null>(null);

export interface RealtimeProviderProps extends RealtimeClientOptions {
  children: React.ReactNode;
}

export function RealtimeProvider({
  children,
  api = { url: "/api/realtime", withCredentials: false },
  maxReconnectAttempts = 3,
}: RealtimeProviderProps) {
  const client = useMemo(
    () =>
      createRealtimeClient({
        api,
        maxReconnectAttempts,
      }),
    [api, maxReconnectAttempts],
  );

  useEffect(() => {
    return () => {
      client.destroy();
    };
  }, [client]);

  return (
    <RealtimeContext.Provider value={client}>
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

export const createRealtime = <T extends object>() => ({
  useRealtime: <Event extends EventPaths<ResolveEvents<T>>>(
    options: UseRealtimeOpts<ResolveEvents<T>, Event>,
  ) => useRealtime(options),
});
