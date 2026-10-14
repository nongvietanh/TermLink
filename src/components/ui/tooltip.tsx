import { Tooltip as T } from "radix-ui";
import * as React from "react";

import { Kbd } from "./kbd";

export const TooltipProvider = T.Provider;

export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  children,
}: {
  content: React.ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-panel data-[state=delayed-open]:animate-fade-in"
        >
          {content}
          {shortcut && <Kbd keys={shortcut} />}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
