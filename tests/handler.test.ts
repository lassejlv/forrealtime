import { expect, test } from "bun:test";
import z from "zod/v4";
import { handle, Realtime } from "../src/index.ts";
import { MemoryRedisAdapter } from "./helpers/memory-adapter.ts";

test("handle replays from last ack and streams live events", async () => {
  const redis = new MemoryRedisAdapter();
  const realtime = new Realtime({
    redis,
    schema: {
      chat: {
        message: z.object({ text: z.string() }),
      },
    },
  });

  const room = realtime.channel("room1");
  await room.emit("chat.message", { text: "first" });
  await room.emit("chat.message", { text: "second" });

  const history = await room.history();
  const lastAck = history[0]?.id;
  if (!lastAck) {
    throw new Error("Expected first history message");
  }

  const requestController = new AbortController();
  const response = await handle({ realtime })(
    new Request(
      `http://localhost/realtime?channel=room1&last_ack_room1=${encodeURIComponent(lastAck)}`,
      {
        signal: requestController.signal,
      },
    ),
  );

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Expected response body");
  }

  const connected = await readSseMessage(reader);
  expect(connected).toMatchObject({ type: "connected", channel: "room1" });

  const replayed = await readSseMessage(reader);
  expect(replayed).toMatchObject({
    event: "chat.message",
    data: { text: "second" },
  });

  await room.emit("chat.message", { text: "third" });

  const live = await readSseMessage(reader);
  expect(live).toMatchObject({
    event: "chat.message",
    data: { text: "third" },
  });

  requestController.abort();
  await reader.cancel();
});

async function readSseMessage(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      throw new Error("SSE stream closed before a message arrived");
    }

    buffer += new TextDecoder().decode(value);
    const separatorIndex = buffer.indexOf("\n\n");
    if (separatorIndex === -1) {
      continue;
    }

    const rawMessage = buffer.slice(0, separatorIndex);
    buffer = buffer.slice(separatorIndex + 2);

    const [, json] = rawMessage.split("data: ");
    return JSON.parse(json ?? "null");
  }
}
