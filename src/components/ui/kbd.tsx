import { formatKeys } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** Renders a key combination such as "Mod+Shift+P". */
export function Kbd({
  keys,
  className,
  onAccent,
}: {
  keys: string;
  className?: string;
  /** Use on accent-colored backgrounds (primary buttons). */
  onAccent?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {formatKeys(keys).map((k, i) => (
        <kbd
          key={i}
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border px-1 font-sans text-[10px] font-medium",
            onAccent
              ? "border-black/15 bg-black/10 text-accent-fg"
              : "border-line-strong bg-surface-2 text-muted",
          )}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
