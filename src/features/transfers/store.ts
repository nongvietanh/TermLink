// Transfer queue: uploads and downloads run one at a time, with live progress,
// cancellation and retry. Only the backend touches the network; this store
// tracks state and drives the queue.
import { create } from "zustand";

import type { TransferDirection } from "@/domain/types";
import { api, toAppError } from "@/lib/ipc";

export type TransferStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TransferItem {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  name: string;
  status: TransferStatus;
  transferred: number;
  total: number | null;
  bytesPerSecond: number;
  error: string | null;
  createdAt: number;
}

export interface NewTransfer {
  sessionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  name: string;
}

interface TransfersState {
  items: TransferItem[];
  /** Bumped whenever a transfer completes, so panels can refresh their listings. */
  completedTick: number;
  enqueue: (transfers: NewTransfer[]) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  clearFinished: () => void;
}

const isFinished = (s: TransferStatus) =>
  s === "completed" || s === "failed" || s === "cancelled";

export const useTransfers = create<TransfersState>()((set, get) => {
  const patch = (id: string, p: Partial<TransferItem>) =>
    set({ items: get().items.map((i) => (i.id === id ? { ...i, ...p } : i)) });

  let running = false;
  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = get().items.find((i) => i.status === "queued");
        if (!next) break;
        patch(next.id, { status: "running", error: null });
        try {
          await api.transferStart(
            {
              sessionId: next.sessionId,
              transferId: next.id,
              direction: next.direction,
              localPath: next.localPath,
              remotePath: next.remotePath,
            },
            (p) =>
              patch(next.id, {
                transferred: p.transferred,
                total: p.total,
                bytesPerSecond: p.bytesPerSecond,
              }),
          );
          patch(next.id, { status: "completed" });
        } catch (err) {
          const e = toAppError(err);
          patch(next.id, {
            status: e.kind === "cancelled" ? "cancelled" : "failed",
            error: e.kind === "cancelled" ? null : e.message,
          });
        }
        set({ completedTick: get().completedTick + 1 });
      }
    } finally {
      running = false;
    }
  };

  return {
    items: [],
    completedTick: 0,

    enqueue: (transfers) => {
      const items: TransferItem[] = transfers.map((t) => ({
        id: crypto.randomUUID(),
        sessionId: t.sessionId,
        direction: t.direction,
        localPath: t.localPath,
        remotePath: t.remotePath,
        name: t.name,
        status: "queued",
        transferred: 0,
        total: null,
        bytesPerSecond: 0,
        error: null,
        createdAt: Date.now(),
      }));
      set({ items: [...get().items, ...items] });
      void pump();
    },

    cancel: (id) => {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      if (item.status === "running") {
        void api.transferCancel(id).catch(() => {});
      } else if (item.status === "queued") {
        patch(id, { status: "cancelled" });
      }
    },

    remove: (id) => {
      const item = get().items.find((i) => i.id === id);
      if (item && !isFinished(item.status)) return; // cancel it first
      set({ items: get().items.filter((i) => i.id !== id) });
    },

    retry: (id) => {
      const item = get().items.find((i) => i.id === id);
      if (!item || !isFinished(item.status)) return;
      const fresh: TransferItem = {
        ...item,
        id: crypto.randomUUID(),
        status: "queued",
        transferred: 0,
        total: null,
        bytesPerSecond: 0,
        error: null,
        createdAt: Date.now(),
      };
      set({ items: [...get().items.filter((i) => i.id !== id), fresh] });
      void pump();
    },

    clearFinished: () => set({ items: get().items.filter((i) => !isFinished(i.status)) }),
  };
});

export const activeTransferCount = (items: TransferItem[]) =>
  items.filter((i) => i.status === "queued" || i.status === "running").length;
