import { Check, ChevronDown } from "lucide-react";
import { Checkbox as CB, Select as S, Switch as SW, Tabs as TB } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

// Switch ----------------------------------------------------------------------

export function Switch({ className, ...props }: React.ComponentProps<typeof SW.Root>) {
  return (
    <SW.Root
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-3 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SW.Thumb className="block size-3 translate-x-0.5 rounded-full bg-fg/80 shadow transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent-fg" />
    </SW.Root>
  );
}

// Checkbox --------------------------------------------------------------------

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CB.Root>) {
  return (
    <CB.Root
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border border-line-strong bg-surface-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        className,
      )}
      {...props}
    >
      <CB.Indicator className="text-accent-fg">
        {props.checked === "indeterminate" ? (
          <span className="block h-0.5 w-2 bg-accent-fg" />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </CB.Indicator>
    </CB.Root>
  );
}

// Select ----------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  hint?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  id,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 data-[placeholder]:text-faint",
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown className="size-3.5 text-muted" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-[70] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-panel data-[state=open]:animate-pop-in"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-7 cursor-default items-center rounded pr-2 pl-7 text-[13px] outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover"
              >
                <S.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5 text-accent" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="ml-auto pl-3 text-[11px] text-faint">{o.hint}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

// Tabs ------------------------------------------------------------------------

export const Tabs = TB.Root;
export const TabsContent = TB.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TB.List>) {
  return (
    <TB.List className={cn("flex items-center gap-1 border-b border-line", className)} {...props} />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TB.Trigger>) {
  return (
    <TB.Trigger
      className={cn(
        "-mb-px border-b-2 border-transparent px-3 py-2 text-[13px] text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg",
        className,
      )}
      {...props}
    />
  );
}

// Segmented control -----------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; disabled?: boolean }[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-md border border-line-strong bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded px-2.5 text-xs whitespace-nowrap text-muted transition-colors hover:text-fg disabled:opacity-40 [&_svg]:size-3.5",
            value === o.value && "bg-surface-3 text-fg shadow-[0_0_0_1px_var(--tl-border-strong)]",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
