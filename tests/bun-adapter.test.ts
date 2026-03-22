import { expect, test } from "bun:test";
import { createBunRedisAdapter } from "../src/adapters/bun.ts";

test("bun redis adapter serializes commands and parses stream responses", async () => {
  const calls: Array<{ method: string; command?: string; args: string[] }> = [];

  const reader = {
    async send(
      command: string,
      args: string[],
    ): Promise<Array<[string, Array<[string, string[]]>]>> {
      calls.push({ method: "reader.send", command, args });

      return [
        [
          "rt:room-1",
          [
            [
              "1-0",
              [
                "message",
                JSON.stringify({
                  event: "chat.message",
                  data: { text: "hello" },
                  channel: "room-1",
                }),
              ],
            ],
          ],
        ],
      ];
    },
  };

  const client = {
    async send(command: string, args: string[]) {
      calls.push({ method: "client.send", command, args });

      if (command === "XADD") {
        return "2-0";
      }

      if (command === "XRANGE") {
        return [
          [
            "1-0",
            [
              "message",
              JSON.stringify({
                event: "chat.message",
                data: { text: "hello" },
                channel: "room-1",
              }),
            ],
          ],
        ];
      }

      if (command === "XREVRANGE") {
        return [["9-0", ["message", JSON.stringify({})]]];
      }

      throw new Error(`Unexpected command: ${command}`);
    },
    async expire(key: string, seconds: number) {
      calls.push({ method: "client.expire", args: [key, String(seconds)] });
      return 1;
    },
    async duplicate() {
      calls.push({ method: "client.duplicate", args: [] });
      return reader;
    },
  };

  const adapter = createBunRedisAdapter(client, { prefix: "rt:" });

  const id = await adapter.xadd(
    "room-1",
    { event: "chat.message" },
    { maxLen: 100, expireAfterSecs: 60 },
  );
  const history = await adapter.xrange("room-1", {
    start: "-",
    end: "+",
    count: 10,
  });
  const latest = await adapter.getLatestCursor("room-1");
  const live = await adapter.xread({
    channels: ["room-1"],
    cursors: ["1-0"],
    blockMs: 500,
  });

  expect(id).toBe("2-0");
  expect(history[0]).toMatchObject({
    id: "1-0",
    payload: { event: "chat.message" },
  });
  expect(latest).toBe("9-0");
  expect(live[0]).toMatchObject({ channel: "room-1" });

  expect(calls).toEqual([
    { method: "client.duplicate", args: [] },
    {
      method: "client.send",
      command: "XADD",
      args: [
        "rt:room-1",
        "MAXLEN",
        "~",
        "100",
        "*",
        "message",
        '{"event":"chat.message"}',
      ],
    },
    { method: "client.expire", args: ["rt:room-1", "60"] },
    {
      method: "client.send",
      command: "XRANGE",
      args: ["rt:room-1", "-", "+", "COUNT", "10"],
    },
    {
      method: "client.send",
      command: "XREVRANGE",
      args: ["rt:room-1", "+", "-", "COUNT", "1"],
    },
    {
      method: "reader.send",
      command: "XREAD",
      args: ["BLOCK", "500", "STREAMS", "rt:room-1", "1-0"],
    },
  ]);
});
