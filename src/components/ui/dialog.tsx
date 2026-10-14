import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  size = "md",
  hideClose,
  ...props
}: React.ComponentProps<typeof D.Content> & {
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[min(88vh,820px)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-panel outline-none data-[state=open]:animate-pop-in",
          size === "sm" && "max-w-md",
          size === "md" && "max-w-lg",
          size === "lg" && "max-w-2xl",
          size === "xl" && "max-w-4xl",
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <D.Close
            className="absolute top-3 right-3 rounded p-1 text-faint transition-colors hover:bg-hover hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({
  className,
  icon,
  tone = "accent",
  children,
}: {
  className?: string;
  icon?: React.ReactNode;
  tone?: "accent" | "danger" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b border-line px-5 pt-4 pr-12 pb-3.5",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            tone === "accent" && "bg-accent-soft text-accent",
            tone === "danger" && "bg-danger-soft text-danger",
            tone === "warning" && "bg-warning-soft text-warning",
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-[15px] font-semibold text-fg", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("mt-0.5 text-xs text-muted", className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
