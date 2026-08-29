// -------------------------------------------------------------------
// The portal registry that lets an imperative core render through React.
// -------------------------------------------------------------------
//
// Both cores create their own DOM container (a per-scope host for dialogs, the stack for
// toasts) and hand it to an adapter. A React adapter can't write into that container
// itself without a second React root; instead it registers the container here, and the
// provider renders one portal per entry. That is what makes `render()` a setState.

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

export interface PortalEntry {
  id: number;
  container: Element;
  node: ReactNode;
}

export interface PortalStore {
  /** Register or replace what is rendered into one container. */
  set(id: number, container: Element, node: ReactNode): void;
  remove(id: number): void;
  /** A fresh id per adapter instance (one dialog scope, or one toast stack). */
  nextId(): number;
  subscribe(listener: () => void): () => void;
  snapshot(): readonly PortalEntry[];
}

export function createPortalStore(): PortalStore {
  // Replaced, never mutated: useSyncExternalStore compares snapshots by identity, so an
  // in-place edit would not re-render.
  let entries: readonly PortalEntry[] = [];
  let ids = 0;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    set(id, container, node) {
      const index = entries.findIndex((entry) => entry.id === id);
      const next = { id, container, node };
      entries =
        index < 0
          ? [...entries, next]
          : entries.map((entry, i) => (i === index ? next : entry));
      emit();
    },
    remove(id) {
      const next = entries.filter((entry) => entry.id !== id);
      if (next.length !== entries.length) {
        entries = next;
        emit();
      }
    },
    nextId: () => ++ids,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => entries,
  };
}

export function usePortalEntries(store: PortalStore): readonly PortalEntry[] {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
