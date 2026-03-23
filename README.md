# forrealtime

Framework-agnostic realtime primitives powered by Redis Streams.

`forrealtime` keeps the server and client API close to `@upstash/realtime`, but swaps the Redis layer for adapters so you can use `ioredis`, `Bun.redis`, or your own client.

## Why

- framework-agnostic SSE handler that accepts a standard `Request`
- typed events from a nested Zod schema
- Redis Streams for history replay and reconnects
- adapter-based Redis integration instead of a hard Upstash dependency
- React client with a small API: `RealtimeProvider`, `createRealtime`, `useRealtime`
- Svelte client support via `forrealtime/client/svelte`

## Install

### ioredis

```bash
bun add forrealtime ioredis zod
```

### Bun Redis

```bash
bun add forrealtime zod
```

## Core ideas

- `Realtime` owns your schema, Redis adapter, history settings, and channel API
- `handle({ realtime })` turns that into a server-sent events endpoint
- `RealtimeProvider` opens one shared `EventSource` for the active channels in your app
- `createRealtime<typeof realtime>()` gives you a typed `useRealtime()` hook inferred from your server schema
- messages are stored in Redis Streams so reconnects can replay from the last acknowledged id

## Server quickstart

```ts
import Redis from "ioredis";
import z from "zod/v4";
import { Realtime, handle } from "forrealtime";
import { createIORedisAdapter } from "forrealtime/adapters/ioredis";

const schema = {
  notification: {
    alert: z.string(),
  },
  chat: {
    message: z.object({
      text: z.string(),
      user: z.string(),
    }),
  },
};

const realtime = new Realtime({
  schema,
  redis: createIORedisAdapter(new Redis(process.env.REDIS_URL)),
  history: {
    maxLength: 1000,
  },
});

export const GET = handle({ realtime });
```

## Emit events

```ts
await realtime.emit("notification.alert", "Welcome");

await realtime.emit("chat.message", {
  text: "Hello world",
  user: "lasse",
});
```

## Use channels

```ts
const room = realtime.channel("room:123");

await room.emit("chat.message", {
  text: "Room message",
  user: "ada",
});

const history = await room.history({ limit: 20 });
```

## Bun Redis adapter

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

## Hono example

```ts
import { Hono } from "hono";
import z from "zod/v4";
import { Realtime, handle } from "forrealtime";
import { createBunRedisAdapter } from "forrealtime/adapters/bun";

const app = new Hono();

const realtime = new Realtime({
  schema: {
    notification: {
      alert: z.string(),
    },
  },
  redis: createBunRedisAdapter(Bun.redis),
});

const realtimeHandler = handle({ realtime });

app.get("/api/realtime", (context) => realtimeHandler(context.req.raw));
```

## React client

The React client has two steps:

1. wrap part of your app in `RealtimeProvider`
2. create a typed `useRealtime()` hook with `createRealtime<typeof realtime>()`

### Infer types from your server

Pass `typeof realtime` to `createRealtime` and the hook types are inferred directly from your Zod schema — no need to duplicate types on the client.

Export `realtime` from your server file:

```ts
// server.ts
export const realtime = new Realtime({ schema, redis });
export const GET = handle({ realtime });
```

Then import it as a type on the client — TypeScript resolves the type without pulling in any server code:

```tsx
// realtime.ts (client)
import { createRealtime } from "forrealtime/client";
import type { realtime } from "./server"; // type-only — no server code in bundle

export const { useRealtime } = createRealtime<typeof realtime>();
```

If you need the inferred event types elsewhere (e.g. to type a function parameter), use `InferRealtimeEvents`:

```ts
import type { InferRealtimeEvents } from "forrealtime";
import type { realtime } from "./server";

type Events = InferRealtimeEvents<typeof realtime>;
// { notification: { alert: string }; chat: { message: { text: string; user: string } } }
```

You can also pass a plain events type if you prefer:

```tsx
type Events = {
  notification: {
    alert: string;
  };
  chat: {
    message: {
      text: string;
      user: string;
    };
  };
};

export const { useRealtime } = createRealtime<Events>();
```

### Add the provider

```tsx
import { RealtimeProvider } from "forrealtime/client";

export function App({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider api={{ url: "/api/realtime" }}>
      {children}
    </RealtimeProvider>
  );
}
```

### Subscribe inside a component

```tsx
import { useState } from "react";
import { useRealtime } from "./realtime";

export function Notifications() {
  const [messages, setMessages] = useState<string[]>([]);

  const { status } = useRealtime({
    channels: ["default"],
    events: ["notification.alert", "chat.message"],
    onData(payload) {
      if (payload.event === "notification.alert") {
        setMessages((prev) => [...prev, `alert: ${payload.data}`]);
      }

      if (payload.event === "chat.message") {
        setMessages((prev) => [
          ...prev,
          `${payload.data.user}: ${payload.data.text}`,
        ]);
      }
    },
  });

  return (
    <div>
      <div>Status: {status}</div>
      <pre>{JSON.stringify(messages, null, 2)}</pre>
    </div>
  );
}
```

### `useRealtime()` options

- `channels`: array of channel names, defaults to `"default"`
- `events`: optional list of event names to filter on
- `onData`: callback for typed messages
- `enabled`: lets you pause the subscription

### Returned state

`useRealtime()` returns:

- `status`: one of `"connecting"`, `"connected"`, `"disconnected"`, or `"error"`

## Svelte client

The Svelte client uses the same typed `createRealtime<typeof realtime>()` helper, but exposes a provider function instead of a React component.

### Provide the client in a parent component

```svelte
<script lang="ts">
  import { provideRealtime } from "forrealtime/client/svelte";

  provideRealtime({
    api: { url: "/api/realtime" },
  });
</script>

<slot />
```

### Create a typed subscription helper

```ts
// realtime.ts
import { createRealtime } from "forrealtime/client/svelte";
import type { realtime } from "./server";

export const { useRealtime } = createRealtime<typeof realtime>();
```

### Subscribe in a component

```svelte
<script lang="ts">
  import { writable } from "svelte/store";
  import { useRealtime } from "./realtime";

  const messages = writable<string[]>([]);
  const { status } = useRealtime({
    channels: ["default"],
    events: ["chat.message"],
    onData(payload) {
      messages.update((current) => [...current, payload.data.text]);
    },
  });
</script>

<div>Status: {$status}</div>
<pre>{JSON.stringify($messages, null, 2)}</pre>
```

If your channels, events, or `enabled` flag are reactive, pass a Svelte store of options to `useRealtime(...)` and it will resubscribe when that store changes.

## TanStack Start example

This matches the setup from `forrealtime-test`.

### 1. Server route

`src/routes/api.realtime.ts`

```ts
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import Redis from "ioredis";
import { z } from "zod/v4";
import { Realtime, handle } from "forrealtime";
import { createIORedisAdapter } from "forrealtime/adapters/ioredis";

const realtime = new Realtime({
  schema: {
    notification: {
      alert: z.string(),
    },
  },
  redis: createIORedisAdapter(new Redis(process.env.REDIS_URL)),
});

export const Route = createFileRoute("/api/realtime")({
  server: {
    handlers: {
      GET: () => {
        const request = getRequest();
        return handle({ realtime })(request);
      },
    },
  },
});
```

### 2. Add the provider at the root

`src/routes/__root.tsx`

```tsx
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { RealtimeProvider } from "forrealtime/client";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <RealtimeProvider api={{ url: "/api/realtime" }}>
          {children}
        </RealtimeProvider>
        <Scripts />
      </body>
    </html>
  );
}
```

### 3. Use the hook in a route

`src/routes/index.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { createRealtime } from "forrealtime/client";
import type { realtime } from "./api.realtime"; // type-only import

const { useRealtime } = createRealtime<typeof realtime>();

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [messages, setMessages] = useState<string[]>([]);

  const { status } = useRealtime({
    channels: ["default"],
    events: ["notification.alert"],
    onData(payload) {
      if (payload.event === "notification.alert") {
        setMessages((prev) => [...prev, `alert: ${payload.data}`]);
      }
    },
  });

  return (
    <div>
      <div>Status: {status}</div>
      <pre>{JSON.stringify(messages, null, 2)}</pre>
    </div>
  );
}
```

### 4. Emit from anywhere on the server

```ts
await realtime.emit("notification.alert", "TanStack Start is live");
```

## Middleware

Use middleware to gate or reject connections before the SSE stream is opened. Return a `Response` to reject, or return nothing to allow.

```ts
import { handle } from "forrealtime";
import type { MiddlewareContext } from "forrealtime";

const auth = (ctx: MiddlewareContext) => {
  const authorized = ctx.request.headers.get("authorization") === "Bearer secret";

  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (ctx.channels.includes("admin")) {
    return new Response("Forbidden", { status: 403 });
  }
};

const realtimeHandler = handle({ realtime, middleware: auth });
```

`MiddlewareContext` has:

- `request`: the incoming `Request` object (headers, URL, cookies, etc.)
- `channels`: array of channel names the client is subscribing to

## History and reconnects

- every emitted event is written to a Redis Stream entry
- the client keeps track of the last acknowledged id per channel
- on reconnect, the server replays missing events from that stream
- `history()` lets you fetch stored messages on the server

```ts
const recent = await realtime.channel("room:123").history({ limit: 50 });
```

## Create your own Redis adapter

Adapters only need four methods:

```ts
type RedisAdapter = {
  xadd(
    channel: string,
    payload: Record<string, unknown>,
    options?: {
      maxLen?: number;
      expireAfterSecs?: number;
    },
  ): Promise<string>;

  xrange(
    channel: string,
    args?: {
      start?: string;
      end?: string;
      count?: number;
    },
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>>;

  xread(args: {
    channels: string[];
    cursors: string[];
    blockMs?: number;
    count?: number;
    signal?: AbortSignal;
  }): Promise<
    Array<{
      channel: string;
      messages: Array<{ id: string; payload: Record<string, unknown> }>;
    }>
  >;

  getLatestCursor(channel: string): Promise<string | null>;
};
```

## Exports

### Root

```ts
import { Realtime, handle } from "forrealtime";
import type { MiddlewareContext, HandleOptions, InferRealtimeEvents } from "forrealtime";
```

### React client

```ts
import {
  RealtimeProvider,
  createRealtime,
  useRealtime,
} from "forrealtime/client";
```

### Adapters

```ts
import { createIORedisAdapter } from "forrealtime/adapters/ioredis";
import { createBunRedisAdapter } from "forrealtime/adapters/bun";
```

## Scripts

```bash
bun run build
bun test
bun run typecheck
```
