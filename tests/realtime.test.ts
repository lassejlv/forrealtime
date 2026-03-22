import { expect, test } from "bun:test";
import z from "zod/v4";
import { Realtime } from "../src/index.ts";
import { MemoryRedisAdapter } from "./helpers/memory-adapter.ts";

test("emit validates payloads and history returns stored messages", async () => {
  const redis = new MemoryRedisAdapter();
  const realtime = new Realtime({
    redis,
    schema: {
      chat: {
        message: z.object({ text: z.string() }),
      },
    },
  });

  await realtime.emit("chat.message", { text: "hello" });

  await expect(
    realtime.emit("chat.message", { text: 123 as unknown as string }),
  ).rejects.toThrow();

  const history = await realtime.history();

  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    event: "chat.message",
    channel: "default",
    data: { text: "hello" },
  });
});

test("channel subscribe replays history and continues with live messages", async () => {
  const redis = new MemoryRedisAdapter();
  const realtime = new Realtime({
    redis,
    schema: {
      chat: {
        message: z.object({ text: z.string() }),
        joined: z.object({ name: z.string() }),
      },
    },
  });

  const room = realtime.channel("room-1");
  await room.emit("chat.message", { text: "before" });
  await room.emit("chat.joined", { name: "Ada" });

  const seen: string[] = [];

  const unsubscribe = await room.subscribe({
    events: ["chat.message"],
    history: true,
    onData(payload) {
      seen.push(payload.data.text);
    },
  });

  await room.emit("chat.message", { text: "after" });

  await waitFor(() => seen.length === 2);

  unsubscribe();

  expect(seen).toEqual(["before", "after"]);
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
