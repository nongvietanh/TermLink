import type { ITheme } from "@xterm/xterm";

export interface TerminalScheme {
  id: string;
  name: string;
  dark: boolean;
  theme: ITheme;
}

export const TERMINAL_SCHEMES: TerminalScheme[] = [
  {
    id: "termlink-dark",
    name: "TermLink Night",
    dark: true,
    theme: {
      background: "#0a0f1c",
      foreground: "#d8e1f2",
      cursor: "#22d3ee",
      cursorAccent: "#0a0f1c",
      selectionBackground: "#22d3ee40",
      selectionInactiveBackground: "#22d3ee22",
      black: "#1b2236",
      red: "#f7768e",
      green: "#5ee6a6",
      yellow: "#f5c36b",
      blue: "#6aa8ff",
      magenta: "#c79bff",
      cyan: "#22d3ee",
      white: "#c5cee0",
      brightBlack: "#4b5675",
      brightRed: "#ff8fa3",
      brightGreen: "#86f3c0",
      brightYellow: "#ffd98e",
      brightBlue: "#93c1ff",
      brightMagenta: "#dbbcff",
      brightCyan: "#7ae9f7",
      brightWhite: "#f2f6ff",
    },
  },
  {
    id: "termlink-light",
    name: "TermLink Day",
    dark: false,
    theme: {
      background: "#fbfcfe",
      foreground: "#1d2639",
      cursor: "#0891b2",
      cursorAccent: "#fbfcfe",
      selectionBackground: "#0891b233",
      selectionInactiveBackground: "#0891b21c",
      black: "#1d2639",
      red: "#c42b4b",
      green: "#16835a",
      yellow: "#9a6a00",
      blue: "#2457c5",
      magenta: "#8a3fc7",
      cyan: "#0e7f9a",
      white: "#c9d1df",
      brightBlack: "#5a667f",
      brightRed: "#e0405f",
      brightGreen: "#1fa06f",
      brightYellow: "#b88200",
      brightBlue: "#3a6fe0",
      brightMagenta: "#a157e0",
      brightCyan: "#1597b5",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    dark: true,
    theme: {
      background: "#002b36",
      foreground: "#93a1a1",
      cursor: "#93a1a1",
      cursorAccent: "#002b36",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#93a1a1",
      brightYellow: "#839496",
      brightBlue: "#657b83",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    dark: true,
    theme: {
      background: "#000000",
      foreground: "#ffffff",
      cursor: "#00ffff",
      cursorAccent: "#000000",
      selectionBackground: "#00ffff55",
      black: "#000000",
      red: "#ff5555",
      green: "#55ff55",
      yellow: "#ffff55",
      blue: "#5c9dff",
      magenta: "#ff55ff",
      cyan: "#55ffff",
      white: "#e5e5e5",
      brightBlack: "#7f7f7f",
      brightRed: "#ff8080",
      brightGreen: "#80ff80",
      brightYellow: "#ffff80",
      brightBlue: "#8cb8ff",
      brightMagenta: "#ff80ff",
      brightCyan: "#80ffff",
      brightWhite: "#ffffff",
    },
  },
];

export const AUTO_SCHEME = "auto";

/** Resolves a scheme id; "auto" (or unknown) follows the app theme. */
export function getScheme(id: string | null | undefined, appDark = true): TerminalScheme {
  const found = id && id !== AUTO_SCHEME ? TERMINAL_SCHEMES.find((s) => s.id === id) : undefined;
  return found ?? TERMINAL_SCHEMES[appDark ? 0 : 1]!;
}
