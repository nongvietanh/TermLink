import { AlertTriangle, HelpCircle } from "lucide-react";
import { useState } from "react";

import { useConfirm } from "@/stores/confirm";

import { Button } from "./button";
import { Checkbox } from "./controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

/** Renders the active confirmation request (see stores/confirm.ts). */
export function ConfirmHost() {
  const current = useConfirm((s) => s.current);
  const settle = useConfirm((s) => s.settle);
  return (
    <Dialog open={!!current} onOpenChange={(open) => !open && settle(false)}>
      {current && (
        <ConfirmBody key={current.title + (current.detail ?? "")} {...current} settle={settle} />
      )}
    </Dialog>
  );
}

function ConfirmBody({
  title,
  description,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  acknowledge,
  settle,
}: NonNullable<ReturnType<typeof useConfirm.getState>["current"]> & {
  settle: (ok: boolean) => void;
}) {
  const [ack, setAck] = useState(false);
  const danger = tone === "danger";
  return (
    <DialogContent size="sm" hideClose>
      <DialogHeader
        icon={danger ? <AlertTriangle /> : <HelpCircle />}
        tone={danger ? "danger" : "accent"}
      >
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {(detail || acknowledge) && (
        <DialogBody className="space-y-3">
          {detail && (
            <pre className="selectable max-h-48 overflow-auto rounded-md border border-line bg-terminal p-2.5 font-mono text-xs whitespace-pre-wrap text-fg">
              {detail}
            </pre>
          )}
          {acknowledge && (
            <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
              <Checkbox
                checked={ack}
                onCheckedChange={(v) => setAck(v === true)}
                className="mt-px"
              />
              <span>{acknowledge}</span>
            </label>
          )}
        </DialogBody>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={() => settle(false)} autoFocus={danger}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={!!acknowledge && !ack}
          onClick={() => settle(true)}
          autoFocus={!danger}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
