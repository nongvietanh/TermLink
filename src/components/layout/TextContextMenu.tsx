// A lightweight right-click menu with the usual text actions (Cut, Copy, Paste,
// Select all). It works on any editable field and on selected text anywhere in
// the app, giving a consistent, themed menu instead of the webview's native one.
// The terminal keeps its own menu, so it is left untouched here.
import { Clipboard, Copy, Scissors, TextSelect } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "@/lib/i18n";
import { notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";

type Editable = HTMLInputElement | HTMLTextAreaElement;

interface Item {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  run: () => void;
}

interface MenuState {
  x: number;
  y: number;
  items: Item[];
}

const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "button",
  "submit",
  "reset",
  "image",
  "hidden",
]);

/** Returns the editable input/textarea the event targets, or null. */
function editableOf(target: HTMLElement): Editable | null {
  const node = target.closest("input, textarea") as Editable | null;
  if (!node || node.disabled || node.readOnly) return null;
  if (node.tagName === "INPUT" && NON_TEXT_INPUTS.has((node as HTMLInputElement).type)) return null;
  return node;
}

/** Sets a React-controlled field's value so its onChange still fires. */
function setValue(el: Editable, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    notifyError({ kind: "internal", message: "The clipboard is not available" });
  }
}

async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    notifyError({ kind: "internal", message: "Clipboard access was denied" });
    return null;
  }
}

export function TextContextMenu() {
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // The terminal provides its own copy/paste menu.
      if (target.closest(".xterm, .tl-terminal-host")) return;

      const tr = tRef.current;
      const editable = editableOf(target);
      const selection = window.getSelection()?.toString() ?? "";
      const items: Item[] = [];

      if (editable) {
        const start = editable.selectionStart ?? 0;
        const end = editable.selectionEnd ?? 0;
        const selected = editable.value.slice(start, end);
        const hasSelection = end > start;
        items.push(
          {
            label: tr("Cut"),
            icon: <Scissors />,
            disabled: !hasSelection,
            run: () =>
              void writeClipboard(selected).then(() => {
                const v = editable.value;
                setValue(editable, v.slice(0, start) + v.slice(end));
                editable.focus();
                editable.setSelectionRange(start, start);
              }),
          },
          {
            label: tr("Copy"),
            icon: <Copy />,
            disabled: !hasSelection,
            run: () => void writeClipboard(selected),
          },
          {
            label: tr("Paste"),
            icon: <Clipboard />,
            run: () =>
              void readClipboard().then((text) => {
                if (text == null) return;
                const v = editable.value;
                setValue(editable, v.slice(0, start) + text + v.slice(end));
                const caret = start + text.length;
                editable.focus();
                editable.setSelectionRange(caret, caret);
              }),
          },
          {
            label: tr("Select all"),
            icon: <TextSelect />,
            disabled: editable.value.length === 0,
            run: () => editable.select(),
          },
        );
      } else if (selection.trim()) {
        items.push({
          label: tr("Copy"),
          icon: <Copy />,
          run: () => void writeClipboard(selection),
        });
      } else {
        return; // nothing actionable; leave default handling in place
      }

      e.preventDefault();
      e.stopPropagation();
      setPos(null);
      setMenu({ x: e.clientX, y: e.clientY, items });
    };
    // Capture phase so this wins over the terminal/native handling.
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  // Clamp the menu inside the viewport once its size is known.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const left = Math.min(menu.x, window.innerWidth - rect.width - 8);
    const top = Math.min(menu.y, window.innerHeight - rect.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[100] min-w-44 overflow-hidden rounded-lg border border-line-strong bg-surface-2 p-1 text-[13px] shadow-panel animate-pop-in"
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={cn(
            "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-fg transition-colors",
            "hover:bg-hover disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted",
          )}
          onClick={() => {
            item.run();
            setMenu(null);
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
