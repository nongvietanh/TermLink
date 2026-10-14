import { toast } from "sonner";

import type { AppError } from "@/domain/types";

import { toAppError } from "./ipc";

/** Shows an error toast. Messages come from the backend and never contain secrets. */
export function notifyError(err: unknown, title?: string): AppError {
  const e = toAppError(err);
  if (e.kind !== "cancelled") {
    toast.error(title ?? e.message, title ? { description: e.message } : undefined);
  }
  return e;
}

export function notifySuccess(message: string, description?: string) {
  toast.success(message, description ? { description } : undefined);
}

/** Runs an async action and reports failures as toasts. */
export async function attempt<T>(fn: () => Promise<T>, title?: string): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    notifyError(err, title);
    return undefined;
  }
}
