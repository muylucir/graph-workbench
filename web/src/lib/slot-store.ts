import 'server-only';

/**
 * In-memory slot store. V0.5 scope — single-process dev server.
 * For production, swap for DynamoDB or file-backed.
 */

export type SlotState = {
  slot: 'A' | 'B' | 'C';
  yaml: string | null;
  mappingName: string | null;
  loadedAt: string | null;
  stats: { vertexCount: number; edgeCount: number } | null;
  lastResults: Array<{ id: string; passed: boolean; elapsedMs: number }> | null;
};

const store: Record<'A' | 'B' | 'C', SlotState> = {
  A: { slot: 'A', yaml: null, mappingName: null, loadedAt: null, stats: null, lastResults: null },
  B: { slot: 'B', yaml: null, mappingName: null, loadedAt: null, stats: null, lastResults: null },
  C: { slot: 'C', yaml: null, mappingName: null, loadedAt: null, stats: null, lastResults: null },
};

export function getSlot(slot: 'A' | 'B' | 'C'): SlotState {
  return store[slot];
}

export function setSlot(slot: 'A' | 'B' | 'C', state: Partial<SlotState>) {
  store[slot] = { ...store[slot], ...state };
}

export function getAllSlots(): SlotState[] {
  return [store.A, store.B, store.C];
}
