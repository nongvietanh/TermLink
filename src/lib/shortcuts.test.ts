import { describe, expect, it } from "vitest";

import { formatKeys, isComposingKeyEvent, matches, matchShortcut, SHORTCUTS } from "./shortcuts";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcut matching", () => {
  it("leaves Vietnamese and other IME composition keystrokes alone", () => {
    expect(isComposingKeyEvent(key({ key: "Process", isComposing: true }))).toBe(true);
    expect(isComposingKeyEvent(key({ key: "Process", keyCode: 229 }))).toBe(true);
    expect(isComposingKeyEvent(key({ key: "a" }))).toBe(false);
  });

  it("matches physical keys with exact modifiers", () => {
    expect(
      matches(key({ code: "KeyP", key: "P", ctrlKey: true, shiftKey: true }), "Mod+Shift+P"),
    ).toBe(true);
    expect(matches(key({ code: "KeyP", key: "p", ctrlKey: true }), "Mod+Shift+P")).toBe(false);
    expect(
      matches(
        key({ code: "KeyP", key: "P", ctrlKey: true, shiftKey: true, altKey: true }),
        "Mod+Shift+P",
      ),
    ).toBe(false);
    expect(matches(key({ code: "Comma", key: ",", ctrlKey: true }), "Mod+,")).toBe(true);
    expect(matches(key({ code: "Tab", key: "Tab", ctrlKey: true }), "Ctrl+Tab")).toBe(true);
  });

  it("never captures keys shells rely on", () => {
    // Ctrl+C, Ctrl+D, Ctrl+K, Ctrl+L, Ctrl+R, Ctrl+W, Ctrl+B, Ctrl+N must reach the terminal.
    for (const code of [
      "KeyC",
      "KeyD",
      "KeyK",
      "KeyL",
      "KeyR",
      "KeyW",
      "KeyB",
      "KeyN",
      "KeyT",
      "KeyP",
      "KeyF",
    ]) {
      const e = key({ code, key: code.slice(3).toLowerCase(), ctrlKey: true });
      for (const id of Object.keys(SHORTCUTS) as (keyof typeof SHORTCUTS)[]) {
        expect(matchShortcut(e, id), `${id} must not match Ctrl+${code.slice(3)}`).toBe(false);
      }
    }
  });

  it("has no duplicate bindings", () => {
    const keys = Object.values(SHORTCUTS).map((s) => s.keys.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("formats keys for display", () => {
    expect(formatKeys("Mod+Shift+P")).toEqual(["Ctrl", "Shift", "P"]);
    expect(formatKeys("Ctrl+Tab")).toEqual(["Ctrl", "Tab"]);
  });
});
