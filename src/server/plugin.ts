export interface RealtimePluginContext {
  emit: (channel: string, event: string, data: unknown) => Promise<void>;
  logger: {
    log(...v: unknown[]): void;
    warn(...v: unknown[]): void;
    error(...v: unknown[]): void;
  };
}

export interface RealtimePlugin<Api extends object = object> {
  name: string;
  init(context: RealtimePluginContext): { api: Api };
}

type InferPluginApi<P> = P extends RealtimePlugin<infer Api> ? Api : never;

export type InferPlugins<Plugins extends readonly RealtimePlugin[]> =
  Plugins extends readonly [
    infer Head,
    ...infer Tail extends readonly RealtimePlugin[],
  ]
    ? InferPluginApi<Head> & InferPlugins<Tail>
    : object;
