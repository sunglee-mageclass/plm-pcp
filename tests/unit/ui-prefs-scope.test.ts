import { describe, it, expect } from "vitest";
import type { UiPrefScope } from "@/hooks/useUiPrefs";
describe("UiPrefScope", () => {
  it("aceita 'export'", () => { const s: UiPrefScope = "export"; expect(s).toBe("export"); });
});
