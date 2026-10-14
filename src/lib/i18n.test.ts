import { describe, expect, it } from "vitest";

import { translate } from "./i18n";

describe("UI translations", () => {
  it("translates the connection workflow into Vietnamese", () => {
    expect(translate("Quick connect", "vietnamese")).toBe("Kết nối nhanh");
    expect(translate("Trust and connect", "vietnamese")).toBe("Tin cậy và kết nối");
  });

  it("keeps English and unknown strings readable", () => {
    expect(translate("Quick connect", "english")).toBe("Quick connect");
    expect(translate("A future label", "vietnamese")).toBe("A future label");
  });
});
