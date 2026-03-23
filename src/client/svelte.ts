import { getContext, onDestroy, setContext } from "svelte";
import { readable, type Readable } from "svelte/store";
import type { EventPaths } from "../shared/types.ts";
import type {
  RealtimeClient,
  RealtimeClientOptions,
  ResolveEvents,
  UseRealtimeOpts,
} from "./core.ts";
import { createRealtimeClient } from "./core.ts";

const REALTIME_CONTEXT = Symbol.for("forrealtime.svelte-client");

type MaybeStore<T> = T | Readable<T>;

function isStore<T>(value: MaybeStore<T>): value is Readable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "subscribe" in value &&
    typeof value.subscribe === "function"
  );
}

export function provideRealtime(
  options: RealtimeClientOptions = {},
): RealtimeClient {
  const client = createRealtimeClient(options);
  setContext(REALTIME_CONTEXT, client);
  onDestroy(() => {
    client.destroy();
  });
  return client;
}

export function getRealtimeContext(): RealtimeClient {
  const client = getContext<RealtimeClient | undefined>(REALTIME_CONTEXT);
  if (!client) {
    throw new Error(
      "No realtime client found. Call provideRealtime() in a parent component first.",
    );
  }

  return client;
}

export function useRealtime<Events, Event extends EventPaths<Events>>(
  options: MaybeStore<UseRealtimeOpts<Events, Event>>,
) {
  const client = getRealtimeContext();
  const status = readable(client.getStatus(), (set) =>
    client.subscribeStatus(set),
  );

  if (isStore(options)) {
    let cleanup = () => {};
    const stop = options.subscribe((next) => {
      cleanup();
      cleanup = client.subscribe(next);
    });

    onDestroy(() => {
      cleanup();
      stop();
    });
  } else {
    const cleanup = client.subscribe(options);
    onDestroy(cleanup);
  }

  return { status };
}

export const createRealtime = <T extends object>() => ({
  useRealtime: <Event extends EventPaths<ResolveEvents<T>>>(
    options: MaybeStore<UseRealtimeOpts<ResolveEvents<T>, Event>>,
  ) => useRealtime(options),
});

export type { UseRealtimeOpts } from "./core.ts";
