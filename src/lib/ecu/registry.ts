import type { EcuAdapter } from "./types";
import { haltechAdapter } from "./haltech";

const ADAPTERS: Record<string, EcuAdapter> = {
  [haltechAdapter.ecuType]: haltechAdapter,
};

export function registerEcuAdapter(adapter: EcuAdapter): void {
  ADAPTERS[adapter.ecuType] = adapter;
}

export function getEcuAdapter(ecuType: string): EcuAdapter | undefined {
  return ADAPTERS[ecuType];
}

export function listEcuAdapters(): EcuAdapter[] {
  return Object.values(ADAPTERS);
}

/** The only ECU shipping today; call sites pass this rather than a literal. */
export const DEFAULT_ECU_TYPE = haltechAdapter.ecuType;
