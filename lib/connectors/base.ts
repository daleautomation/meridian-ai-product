// Meridian Command — shared connector helpers (keep connectors tiny).

import type { Connector, ConnectorHealth, Observation, SyncResult } from "./types";

/** Build a SyncResult by running health + collect. Connectors reuse this so their
 *  only real code is collectObservations(). */
export async function runConnector<I>(
  connector: Connector<I>,
  input: I,
  nowMs: number,
): Promise<SyncResult> {
  const id = connector.capabilities().id;
  const syncedAt = new Date(nowMs).toISOString();
  let health: ConnectorHealth;
  try {
    health = await connector.health(input);
  } catch (err) {
    health = { id, state: "unavailable", detail: String(err), checkedAt: syncedAt };
  }
  if (health.state === "unauthenticated" || health.state === "unavailable") {
    return { connector: id, ok: false, observations: [], collected: 0, syncedAt, health };
  }
  let observations: Observation[] = [];
  try {
    observations = await connector.collectObservations(input, nowMs);
  } catch (err) {
    return {
      connector: id, ok: false, observations: [], collected: 0, syncedAt,
      health: { ...health, state: "degraded", detail: `collect failed: ${String(err)}` },
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { connector: id, ok: true, observations, collected: observations.length, syncedAt, health };
}
