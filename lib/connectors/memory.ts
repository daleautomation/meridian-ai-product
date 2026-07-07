// Meridian Command — MemoryConnector (read-only). Observes strategic memory.
//
// Memory behaves like another Reality Layer input: active memories emit
// Observations that flow into the stream. They are context, not activity — the
// Belief Engine excludes memory types from momentum/stage, and ranking influence
// happens transparently in lib/beliefs/recommend (never silently).

import { getAllMemories } from "@/lib/memory/store";
import { memoriesToObservations } from "@/lib/memory/observations";
import type { Memory } from "@/lib/memory/types";
import { runConnector } from "./base";
import {
  type AuthStatus,
  type Capabilities,
  type Connector,
  type ConnectorHealth,
  type Observation,
  type SyncResult,
} from "./types";

export interface MemoryInput {
  memories?: Memory[]; // pre-loaded to avoid a second store read
  ownerId?: string;
}

const ID = "memory";

export class MemoryConnector implements Connector<MemoryInput> {
  capabilities(): Capabilities {
    return {
      id: ID,
      emits: ["strategic_memory_active", "preference_active", "fact_active", "memory_updated", "memory_conflict_detected", "memory_stale"],
      readOnly: true,
      inputMode: "file",
      description: "Emits strategic memory (facts/preferences/lessons) as context observations. Never scrapes; never affects momentum.",
    };
  }

  private async load(input?: MemoryInput): Promise<Memory[]> {
    return input?.memories ?? (await getAllMemories(input?.ownerId ?? "dylan"));
  }

  async health(input?: MemoryInput): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    const memories = await this.load(input);
    return { id: ID, state: memories.length ? "ok" : "degraded", detail: `${memories.length} memories`, checkedAt };
  }

  async authenticate(): Promise<AuthStatus> {
    return { id: ID, authenticated: true, method: "file", detail: "Founder-curated memory; no external auth." };
  }

  async lastSync(): Promise<string | null> {
    return null;
  }

  async collectObservations(input: MemoryInput, nowMs: number): Promise<Observation[]> {
    const memories = await this.load(input);
    return memoriesToObservations(memories, nowMs);
  }

  run(input: MemoryInput, nowMs: number): Promise<SyncResult> {
    return runConnector(this, input, nowMs);
  }
}
