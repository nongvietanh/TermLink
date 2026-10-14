import * as React from "react";

import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-md border border-line-strong bg-surface-2 px-2.5 text-[13px] text-fg placeholder:text-faint transition-colors outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    spellCheck={false}
    autoComplete="off"
    className={cn(fieldBase, "h-8", className)}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    spellCheck={false}
    className={cn(fieldBase, "min-h-20 py-2", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
