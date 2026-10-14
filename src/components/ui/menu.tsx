import { Check, ChevronRight } from "lucide-react";
import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const contentCls =
  "z-50 min-w-44 overflow-hidden rounded-lg border border-line-strong bg-surface-2 p-1 text-[13px] text-fg shadow-panel data-[state=open]:animate-pop-in";
const itemCls =
  "relative flex h-7 cursor-default items-center gap-2 rounded px-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-3.5 [&_svg]:text-muted";

type ItemExtra = { shortcut?: string; danger?: boolean; icon?: React.ReactNode };

function ItemInner({
  icon,
  children,
  shortcut,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 text-[11px] text-faint">{shortcut}</span>}
    </>
  );
}

// Dropdown menu -------------------------------------------------------------

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={sideOffset} className={cn(contentCls, className)} {...props} />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  shortcut,
  danger,
  icon,
  children,
  ...props
}: React.ComponentProps<typeof DM.Item> & ItemExtra) {
  return (
    <DM.Item
      className={cn(itemCls, danger && "text-danger [&_svg]:text-danger", className)}
      {...props}
    >
      <ItemInner icon={icon} shortcut={shortcut}>
        {children}
      </ItemInner>
    </DM.Item>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DM.CheckboxItem>) {
  return (
    <DM.CheckboxItem className={cn(itemCls, "pl-7", className)} {...props}>
      <DM.ItemIndicator className="absolute left-2">
        <Check />
      </DM.ItemIndicator>
      {children}
    </DM.CheckboxItem>
  );
}

export function DropdownMenuSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DM.Label className="px-2 py-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
      {children}
    </DM.Label>
  );
}

export const DropdownMenuSub = DM.Sub;

export function DropdownMenuSubTrigger({
  className,
  icon,
  children,
  ...props
}: React.ComponentProps<typeof DM.SubTrigger> & { icon?: React.ReactNode }) {
  return (
    <DM.SubTrigger className={cn(itemCls, "data-[state=open]:bg-hover", className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight />
    </DM.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent className={cn(contentCls, "max-h-72 overflow-y-auto", className)} {...props} />
    </DM.Portal>
  );
}

// Context menu --------------------------------------------------------------

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(contentCls, className)} {...props} />
    </CM.Portal>
  );
}

export function ContextMenuItem({
  className,
  shortcut,
  danger,
  icon,
  children,
  ...props
}: React.ComponentProps<typeof CM.Item> & ItemExtra) {
  return (
    <CM.Item
      className={cn(itemCls, danger && "text-danger [&_svg]:text-danger", className)}
      {...props}
    >
      <ItemInner icon={icon} shortcut={shortcut}>
        {children}
      </ItemInner>
    </CM.Item>
  );
}

export function ContextMenuSeparator() {
  return <CM.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export const ContextMenuSub = CM.Sub;

export function ContextMenuSubTrigger({
  className,
  icon,
  children,
  ...props
}: React.ComponentProps<typeof CM.SubTrigger> & { icon?: React.ReactNode }) {
  return (
    <CM.SubTrigger className={cn(itemCls, "data-[state=open]:bg-hover", className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight />
    </CM.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent className={cn(contentCls, "max-h-72 overflow-y-auto", className)} {...props} />
    </CM.Portal>
  );
}
