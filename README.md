# forrealtime

Framework-agnostic realtime primitives powered by Redis Streams.

The server API stays close to `@upstash/realtime`, but the Redis layer is adapter-based so you can plug in `ioredis` or roll your own adapter for another client.

## Install

```bash
bun install forrealtime ioredis zod
```

## Quickstart

```ts
import Redis from "ioredis";
import z from "zod/v4";
import { Realtime, handle } from "forrealtime";
import { createIORedisAdapter } from "forrealtime/adapters/ioredis";

const schema = {
  notification: {
    alert: z.string(),
  },
};

const realtime = new Realtime({
  schema,
  redis: createIORedisAdapter(new Redis()),
});

export const GET = handle({ realtime });
```

## Bun Redis

```ts
import z from "zod/v4";
import { Realtime, handle } from "forrealtime";
import { createBunRedisAdapter } from "forrealtime/adapters/bun";

const realtime = new Realtime({
  schema: {
    notification: {
      alert: z.string(),
    },
  },
  redis: createBunRedisAdapter(Bun.redis),
});

export default handle({ realtime });
```

## Hono

```ts
import { Hono } from "hono";
import { handle } from "forrealtime";

const app = new Hono();

app.get("/realtime", async (context) => {
  return handle({ realtime })(context.req.raw);
});
```

## Client

```tsx
"use client";

import { RealtimeProvider, createRealtime } from "forrealtime/client";

type Events = {
  notification: {
    alert: string;
  };
};

const { useRealtime } = createRealtime<Events>();
```

## Scripts

```bash
bun run build
bun test
bun run typecheck
```
