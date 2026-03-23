import type { RealtimePlugin, RealtimePluginContext } from "../server/plugin.ts";

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(
      `[postgres-sync] Invalid ${label} "${value}". Only alphanumeric characters and underscores are allowed.`,
    );
  }
}

export type TableConfig = {
  name: string;
  /**
   * Filter which row changes get emitted as realtime events.
   * Return `false` to drop the event.
   *
   * @param row  The affected row (`NEW` for INSERT/UPDATE, `OLD` for DELETE).
   * @param op   The operation type: "INSERT", "UPDATE", or "DELETE".
   *
   * @example
   * // Only emit changes for active users
   * filter: (row, op) => row.active === true
   *
   * @example
   * // Skip deletes entirely
   * filter: (row, op) => op !== "DELETE"
   */
  filter?: (
    row: Record<string, unknown>,
    op: "INSERT" | "UPDATE" | "DELETE",
  ) => boolean;
  /**
   * Override the realtime channel this table emits on.
   * Falls back to the global `realtimeChannel` option, then to the table name.
   */
  realtimeChannel?: string;
};

export interface PostgresSyncOptions {
  /** A Bun.sql connection instance */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any;
  /**
   * Tables to watch. Each entry is either a table name string or a `TableConfig`
   * object for per-table filter and channel overrides.
   */
  tables: Array<string | TableConfig>;
  /** PostgreSQL schema, defaults to "public" */
  pgSchema?: string;
  /**
   * Default realtime channel name for all tables.
   * Defaults to the individual table name.
   */
  realtimeChannel?: string;
}

export interface PostgresSyncApi {
  pg: {
    /** Install triggers and start listening for Postgres table changes */
    start(): Promise<void>;
    /** Stop listening for Postgres table changes */
    stop(): void;
  };
}

type Subscription = { unlisten(): Promise<void> };

function normalizeTable(entry: string | TableConfig): TableConfig {
  return typeof entry === "string" ? { name: entry } : entry;
}

async function installTriggers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  tables: TableConfig[],
  pgSchema: string,
): Promise<void> {
  for (const { name: table } of tables) {
    assertIdentifier(table, "table");
    assertIdentifier(pgSchema, "schema");

    const fnName = `forrealtime_${table}_notify`;
    const triggerName = `forrealtime_${table}_trigger`;
    const pgChannel = `forrealtime_${table}`;

    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION ${fnName}()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify(
          '${pgChannel}',
          json_build_object(
            'table', TG_TABLE_NAME,
            'op',    TG_OP,
            'new',   CASE WHEN TG_OP <> 'DELETE' THEN row_to_json(NEW) ELSE NULL END,
            'old',   CASE WHEN TG_OP <> 'INSERT' THEN row_to_json(OLD) ELSE NULL END
          )::text
        );
        RETURN COALESCE(NEW, OLD);
      END;
      $$;
    `);

    // CREATE OR REPLACE TRIGGER requires PostgreSQL 14+
    await sql.unsafe(`
      CREATE OR REPLACE TRIGGER ${triggerName}
      AFTER INSERT OR UPDATE OR DELETE ON ${pgSchema}.${table}
      FOR EACH ROW EXECUTE FUNCTION ${fnName}();
    `);
  }
}

export function postgresSync(
  options: PostgresSyncOptions,
): RealtimePlugin<PostgresSyncApi> {
  return {
    name: "postgres-sync",
    init(context: RealtimePluginContext) {
      const pgSchema = options.pgSchema ?? "public";
      const tables = options.tables.map(normalizeTable);
      let subscriptions: Subscription[] = [];

      function handlePayload(config: TableConfig, rawPayload: string): void {
        let change: {
          table: string;
          op: "INSERT" | "UPDATE" | "DELETE";
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        };
        try {
          change = JSON.parse(rawPayload) as typeof change;
        } catch {
          context.logger.error(
            "[postgres-sync] failed to parse notification payload",
            rawPayload,
          );
          return;
        }

        const row =
          change.op === "DELETE"
            ? (change.old ?? {})
            : (change.new ?? {});

        if (config.filter && !config.filter(row, change.op)) {
          return;
        }

        const eventName = `${change.table}.${change.op.toLowerCase()}`;
        const channel =
          config.realtimeChannel ?? options.realtimeChannel ?? config.name;

        void context.emit(channel, eventName, row).catch((err: unknown) => {
          context.logger.error(
            "[postgres-sync] failed to emit event",
            eventName,
            err,
          );
        });
      }

      const api: PostgresSyncApi = {
        pg: {
          async start() {
            if (subscriptions.length > 0) {
              context.logger.warn(
                "[postgres-sync] already started, call stop() first",
              );
              return;
            }

            await installTriggers(options.sql, tables, pgSchema);

            subscriptions = await Promise.all(
              tables.map((config) => {
                const pgChannel = `forrealtime_${config.name}`;
                return options.sql.listen(
                  pgChannel,
                  (payload: string) => handlePayload(config, payload),
                ) as Promise<Subscription>;
              }),
            );

            context.logger.log(
              "[postgres-sync] started, watching tables:",
              tables.map((t) => t.name),
            );
          },

          stop() {
            const subs = subscriptions;
            subscriptions = [];
            for (const sub of subs) {
              void sub.unlisten().catch((err: unknown) => {
                context.logger.error(
                  "[postgres-sync] error during unlisten",
                  err,
                );
              });
            }
            context.logger.log("[postgres-sync] stopped");
          },
        },
      };

      return { api };
    },
  };
}
