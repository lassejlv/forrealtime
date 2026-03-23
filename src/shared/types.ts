import z from "zod/v4";
import type * as core from "zod/v4/core";

export interface Schema {
  [key: string]: core.$ZodType | Schema;
}

export const systemEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("connected"),
    channel: z.string(),
    cursor: z.string().optional(),
  }),
  z.object({ type: z.literal("reconnect"), timestamp: z.number() }),
  z.object({ type: z.literal("error"), error: z.string() }),
  z.object({ type: z.literal("disconnected"), channels: z.array(z.string()) }),
  z.object({ type: z.literal("ping"), timestamp: z.number() }),
]);

export type SystemEvent = z.infer<typeof systemEvent>;

export const userEvent = z.object({
  id: z.string(),
  data: z.unknown(),
  event: z.string(),
  channel: z.string(),
});

export type UserEvent = z.infer<typeof userEvent>;

export type RealtimeMessage = SystemEvent | UserEvent;

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "connecting";

export type EventPaths<
  T,
  Prefix extends string = "",
  Depth extends readonly number[] = [],
> = Depth["length"] extends 10
  ? never
  : {
      [Key in keyof T & string]: T[Key] extends core.$ZodType
        ? `${Prefix}${Key}`
        : T[Key] extends Record<string, unknown>
          ? EventPaths<T[Key], `${Prefix}${Key}.`, [...Depth, 0]>
          : `${Prefix}${Key}`;
    }[keyof T & string];

type EventDataAtPath<
  T,
  Key extends string,
  Depth extends readonly number[] = [],
> = Depth["length"] extends 10
  ? never
  : Key extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? T[Head] extends core.$ZodType
        ? never
        : EventDataAtPath<T[Head], Tail, [...Depth, 0]>
      : never
    : Key extends keyof T
      ? T[Key] extends core.$ZodType
        ? T[Key]
        : never
      : never;

export type EventPayloadUnion<T, Event extends string> = Event extends unknown
  ? {
      id: string;
      event: Event;
      data: z.infer<EventDataAtPath<T, Event>>;
      channel: string;
    }
  : never;

export interface HistoryArgs {
  limit?: number;
  start?: number;
  end?: number;
}
