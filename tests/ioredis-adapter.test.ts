import { expect, test } from "bun:test";
import { createIORedisAdapter } from "../src/adapters/ioredis.ts";

test("ioredis adapter serializes commands and parses stream responses", async () => {
  const calls: Array<{ method: string; args: string[] }> = [];

  const reader = {
    async xread(
      ...args: string[]
    ): Promise<Array<[string, Array<[string, string[]]>]>> {
      calls.push({ method: "xread", args });
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
    async xadd(...args: string[]) {
      calls.push({ method: "xadd", args });
      return "2-0";
    },
    async xrange(...args: string[]): Promise<Array<[string, string[]]>> {
      calls.push({ method: "xrange", args });
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
    },
    async xrevrange(...args: string[]): Promise<Array<[string, string[]]>> {
      calls.push({ method: "xrevrange", args });
      return [["9-0", ["message", JSON.stringify({})]]];
    },
    async expire(...args: [string, number]) {
      calls.push({ method: "expire", args: [args[0], String(args[1])] });
      return 1;
    },
    async xread(...args: string[]): Promise<null> {
      calls.push({ method: "xread:unexpected", args });
      return null;
    },
    duplicate() {
      return reader;
    },
  };

  const adapter = createIORedisAdapter(client, { prefix: "rt:" });

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
    {
      method: "xadd",
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
    {
      method: "expire",
      args: ["rt:room-1", "60"],
    },
    {
      method: "xrange",
      args: ["rt:room-1", "-", "+", "COUNT", "10"],
    },
    {
      method: "xrevrange",
      args: ["rt:room-1", "+", "-", "COUNT", "1"],
    },
    {
      method: "xread",
      args: ["BLOCK", "500", "STREAMS", "rt:room-1", "1-0"],
    },
  ]);
});
