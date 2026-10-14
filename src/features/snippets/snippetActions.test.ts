import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isPotentiallyDestructive } from "./snippetActions";

describe("destructive command detection", () => {
  it("flags common destructive commands", () => {
    for (const c of [
      "sudo rm -rf /var/www",
      "DROP DATABASE prod;",
      "shutdown -h now",
      "kubectl delete ns x",
      "git push --force",
    ]) {
      expect(isPotentiallyDestructive(c), c).toBe(true);
    }
    for (const c of ["ls -la", "df -h", "tail -f /var/log/syslog", "git status"]) {
      expect(isPotentiallyDestructive(c), c).toBe(false);
    }
  });

  it("uses the same pattern list as the Rust backend", () => {
    const rust = readFileSync(resolve(__dirname, "../../../src-tauri/src/domain/mod.rs"), "utf8");
    const block = rust.slice(
      rust.indexOf("const PATTERNS"),
      rust.indexOf("];", rust.indexOf("const PATTERNS")),
    );
    const rustPatterns = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(rustPatterns.length).toBeGreaterThan(20);
    for (const p of rustPatterns) expect(isPotentiallyDestructive(`x ${p} y`), p).toBe(true);
  });
});
