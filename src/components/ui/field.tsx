import * as React from "react";

import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
  required?: boolean;
}

/** Label + control + hint/error, with the error wired for screen readers. */
export function Field({ label, htmlFor, hint, error, className, children, required }: FieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
        {required && <span className="ml-0.5 text-accent">*</span>}
      </label>
      {React.isValidElement(children) && htmlFor
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": error ? errorId : undefined,
          })
        : children}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn("text-[11px] font-semibold tracking-wider text-faint uppercase", className)}>
      {children}
    </h3>
  );
}
