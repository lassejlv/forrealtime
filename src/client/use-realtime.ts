import { useContext, useEffect, useMemo, useRef } from "react";
import {
  type EventPaths,
  type EventPayloadUnion,
  userEvent,
} from "../shared/types.ts";
import { RealtimeContext } from "./provider.tsx";

export interface UseRealtimeOpts<
  Events extends Record<string, unknown>,
  Event extends string,
> {
  events?: readonly Event[];
  onData?: (payload: EventPayloadUnion<Events, Event>) => void;
  channels?: readonly (string | undefined)[];
  enabled?: boolean;
}

export function useRealtime<
  Events extends Record<string, unknown>,
  const Event extends EventPaths<Events>,
>(options: UseRealtimeOpts<Events, Event>) {
  const { channels = ["default"], events, onData, enabled } = options;

  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error(
      "useRealtime: No RealtimeProvider found. Wrap your app in <RealtimeProvider> to use forrealtime.",
    );
  }

  const { register, unregister, status } = context;

  const registrationId = useRef(Math.random().toString(36).slice(2)).current;
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
    if (enabled === false) {
      unregister(registrationId);
      return;
    }

    if (normalizedChannels.length === 0) {
      return;
    }

    register(registrationId, normalizedChannels, (message) => {
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
        data: parsed.data.data as EventPayloadUnion<Events, Event>["data"],
      } as EventPayloadUnion<Events, Event>;

      onDataRef.current?.(payload);
    });

    return () => {
      unregister(registrationId);
    };
  }, [
    enabled,
    normalizedChannels,
    normalizedEvents,
    register,
    registrationId,
    unregister,
  ]);

  return { status };
}
