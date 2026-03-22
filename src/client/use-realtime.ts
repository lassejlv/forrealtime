"use client";

import { useContext, useEffect, useRef } from "react";
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

  const registrationId = useRef(Math.random().toString(36).slice(2)).current;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (enabled === false) {
      context.unregister(registrationId);
      return;
    }

    const activeChannels = channels.filter(Boolean) as string[];
    if (activeChannels.length === 0) {
      return;
    }

    context.register(registrationId, activeChannels, (message) => {
      const parsed = userEvent.safeParse(message);
      if (!parsed.success) {
        return;
      }

      if (
        events &&
        events.length > 0 &&
        !events.includes(parsed.data.event as Event)
      ) {
        return;
      }

      const payload = {
        channel: parsed.data.channel,
        event: parsed.data.event as Event,
        data: parsed.data.data as EventPayloadUnion<Events, Event>["data"],
      } as EventPayloadUnion<Events, Event>;

      onDataRef.current?.(payload);
    });

    return () => {
      context.unregister(registrationId);
    };
  }, [channels, context, enabled, events, registrationId]);

  return { status: context.status };
}
