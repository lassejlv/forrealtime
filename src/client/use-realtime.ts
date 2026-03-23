import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { EventPaths, EventPayloadUnion } from "../shared/types.ts";
import type { UseRealtimeOpts } from "./core.ts";
import { RealtimeContext } from "./provider.tsx";

export type { UseRealtimeOpts } from "./core.ts";

export function useRealtime<Events, Event extends EventPaths<Events>>(
  options: UseRealtimeOpts<Events, Event>,
) {
  const { channels = ["default"], events, onData, enabled } = options;

  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error(
      "useRealtime: No RealtimeProvider found. Wrap your app in <RealtimeProvider> to use forrealtime.",
    );
  }

  const status = useSyncExternalStore(
    (onStoreChange) => context.subscribeStatus(onStoreChange),
    () => context.getStatus(),
    () => context.getStatus(),
  );
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const channelKey = useMemo(
    () => channels.map((channel) => channel ?? "").join("\u001f"),
    [channels],
  );
  const eventKey = useMemo(() => (events ?? []).join("\u001f"), [events]);

  const normalizedChannels = useMemo(
    () => channels.filter((channel): channel is string => Boolean(channel)),
    [channelKey],
  );
  const normalizedEvents = useMemo(
    () => (events ? [...events] : undefined),
    [eventKey],
  );

  useEffect(() => {
    const unsubscribe = context.subscribe<Events, Event>({
      channels: normalizedChannels,
      enabled,
      events: normalizedEvents,
      onData(payload: EventPayloadUnion<Events, Event>) {
        onDataRef.current?.(payload);
      },
    });
    return unsubscribe;
  }, [context, enabled, normalizedChannels, normalizedEvents]);

  return { status };
}
