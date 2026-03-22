export interface StreamEntry {
  id: string;
  payload: Record<string, unknown>;
}

export interface XAddOptions {
  maxLen?: number;
  expireAfterSecs?: number;
}

export interface XRangeArgs {
  start?: string;
  end?: string;
  count?: number;
}

export interface XReadArgs {
  channels: string[];
  cursors: string[];
  blockMs?: number;
  count?: number;
  signal?: AbortSignal;
}

export interface XReadResult {
  channel: string;
  messages: StreamEntry[];
}

export interface RedisAdapter {
  xadd(
    channel: string,
    payload: Record<string, unknown>,
    options?: XAddOptions,
  ): Promise<string>;
  xrange(channel: string, args?: XRangeArgs): Promise<StreamEntry[]>;
  xread(args: XReadArgs): Promise<XReadResult[]>;
  getLatestCursor(channel: string): Promise<string | null>;
}
