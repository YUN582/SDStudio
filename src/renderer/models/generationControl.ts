import type { InpaintScene, Session } from './types';

export interface GenerationTarget {
  session: Session;
  scene: InpaintScene;
  queue: () => Promise<boolean>;
  disabled: boolean;
}
type Snapshot = { target: GenerationTarget | null; busy: boolean };

// The global bar and editor bar share one queue operation and one busy lock.
export const generationControlState = {
  snapshot: { target: null, busy: false } as Snapshot,
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    generationControlState.listeners.add(listener);
    return () => {
      generationControlState.listeners.delete(listener);
    };
  },
  getSnapshot() {
    return generationControlState.snapshot;
  },
  update(patch: Partial<Snapshot>) {
    generationControlState.snapshot = {
      ...generationControlState.snapshot,
      ...patch,
    };
    for (const listener of generationControlState.listeners) listener();
  },
};
