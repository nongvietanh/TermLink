import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Monospace detail block, e.g. a command about to run. */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** Require ticking a checkbox with this label before confirming. */
  acknowledge?: string;
}

interface ConfirmState {
  current: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
  open: (options: ConfirmOptions) => Promise<boolean>;
  settle: (ok: boolean) => void;
}

export const useConfirm = create<ConfirmState>()((set, get) => ({
  current: null,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      // Only one confirmation at a time; a new one cancels the previous.
      get().current?.resolve(false);
      set({ current: { ...options, resolve } });
    }),
  settle: (ok) => {
    const c = get().current;
    set({ current: null });
    c?.resolve(ok);
  },
}));

/** Asks the user to confirm an action. Resolves to false on cancel. */
export const confirm = (options: ConfirmOptions) => useConfirm.getState().open(options);
