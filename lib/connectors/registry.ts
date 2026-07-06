// Meridian Command — connector registry + runner.
//
// Registering a connector is the ONLY step needed to add a new sensor. The runner
// executes each, collects Observation[], dedupes, and returns a unified stream —
// the Belief Engine never knows or cares which connector a signal came from.

import {
  dedupeObservations,
  type Connector,
  type ConnectorId,
  type Observation,
  type SyncResult,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConnector = Connector<any>;

export interface RegisteredConnector {
  connector: AnyConnector;
  /** Resolves the input this connector needs (a batch, a file path, etc.). */
  input: unknown;
}

export class ConnectorRegistry {
  private items = new Map<ConnectorId, RegisteredConnector>();

  register(connector: AnyConnector, input: unknown): this {
    this.items.set(connector.capabilities().id, { connector, input });
    return this;
  }

  list(): ConnectorId[] {
    return [...this.items.keys()];
  }

  async runAll(nowMs: number): Promise<{ observations: Observation[]; results: SyncResult[] }> {
    const results: SyncResult[] = [];
    for (const { connector, input } of this.items.values()) {
      try {
        results.push(await connector.run(input, nowMs));
      } catch (err) {
        const id = connector.capabilities().id;
        results.push({
          connector: id,
          ok: false,
          observations: [],
          collected: 0,
          syncedAt: new Date(nowMs).toISOString(),
          health: { id, state: "unavailable", detail: String(err), checkedAt: new Date(nowMs).toISOString() },
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const observations = dedupeObservations(results.flatMap((r) => r.observations));
    return { observations, results };
  }
}
