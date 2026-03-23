import { expect, test } from "bun:test";
import { createRealtimeClient } from "../src/client/core.ts";
import type { RealtimeEventSource } from "../src/client/core.ts";

class MockEventSource implements RealtimeEventSource {
  static instances: MockEventSource[] = [];

  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  closed = false;

  constructor(
    public readonly url: string,
    public readonly init: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.(new Event("open"));
  }

  emitMessage(payload: unknown) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }) as MessageEvent<string>,
    );
  }
}

test("realtime client delivers filtered events and tracks connection status", async () => {
  MockEventSource.instances = [];

  type Events = {
    chat: {
      message: {
        text: string;
      };
    };
  };

  const received: Array<{ event: string; text: string }> = [];
  const statuses: string[] = [];

  const client = createRealtimeClient({
    api: { url: "/api/realtime", withCredentials: true },
    eventSourceFactory(url, init) {
      return new MockEventSource(url, init);
    },
  });

  const stopStatus = client.subscribeStatus((status) => {
    statuses.push(status);
  });

  const unsubscribe = client.subscribe<Events, "chat.message">({
    channels: ["room-1"],
    events: ["chat.message"],
    onData(payload) {
      const data = payload.data as { text: string };
      received.push({
        event: payload.event,
        text: data.text,
      });
    },
  });

  await waitFor(() => MockEventSource.instances.length === 1);

  const eventSource = MockEventSource.instances[0];
  expect(eventSource.url).toContain("channel=room-1");
  expect(eventSource.init.withCredentials).toBe(true);

  eventSource.emitOpen();
  eventSource.emitMessage({
    type: "connected",
    channel: "room-1",
    cursor: "1-0",
  });
  eventSource.emitMessage({
    id: "2-0",
    channel: "room-1",
    event: "chat.message",
    data: { text: "hello" },
  });
  eventSource.emitMessage({
    id: "3-0",
    channel: "room-1",
    event: "chat.joined",
    data: { text: "ignored" },
  });

  expect(received).toEqual([{ event: "chat.message", text: "hello" }]);
  expect(statuses).toContain("connected");

  unsubscribe();
  stopStatus();

  expect(eventSource.closed).toBe(true);
  expect(client.getStatus()).toBe("disconnected");
});

test("realtime client reuses the last acknowledged cursor on reconnect", async () => {
  MockEventSource.instances = [];

  const client = createRealtimeClient({
    eventSourceFactory(url, init) {
      return new MockEventSource(url, init);
    },
  });

  const unsubscribe = client.subscribe({
    channels: ["room-1"],
    onData() {},
  });

  await waitFor(() => MockEventSource.instances.length === 1);

  const first = MockEventSource.instances[0];
  first.emitOpen();
  first.emitMessage({
    id: "5-0",
    channel: "room-1",
    event: "chat.message",
    data: { text: "hello" },
  });
  first.emitMessage({ type: "reconnect", timestamp: Date.now() });

  await waitFor(() => MockEventSource.instances.length === 2);

  const second = MockEventSource.instances[1];
  expect(second.url).toContain("last_ack_room-1=5-0");

  unsubscribe();
  client.destroy();
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await Bun.sleep(10);
  }
}
