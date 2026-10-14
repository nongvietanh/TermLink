import * as React from "react";

import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3",
        tone === "neutral" && "bg-surface-3 text-muted",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "success" && "bg-success-soft text-success",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "danger" && "bg-danger-soft text-danger",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}
    >
      {icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-faint [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export type StatusTone = "idle" | "connecting" | "connected" | "error";

export function StatusDot({
  tone,
  className,
  title,
}: {
  tone: StatusTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      role="img"
      aria-label={title ?? tone}
      title={title}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "idle" && "bg-faint/60",
        tone === "connecting" && "animate-pulse-soft bg-warning",
        tone === "connected" && "bg-success shadow-[0_0_6px_var(--tl-success)]",
        tone === "error" && "bg-danger",
        className,
      )}
    />
  );
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent [&_svg]:size-[18px]">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-surface", className)} {...props} />;
}

export function Notice({
  tone = "info",
  icon,
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  icon?: React.ReactNode;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "note"}
      className={cn(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "info" && "border-info/30 bg-info/10 text-fg",
        tone === "warning" && "border-warning/35 bg-warning-soft text-fg",
        tone === "danger" && "border-danger/40 bg-danger-soft text-fg",
        tone === "success" && "border-success/35 bg-success-soft text-fg",
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            tone === "info" && "text-info",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-danger",
            tone === "success" && "text-success",
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("text-muted", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}
