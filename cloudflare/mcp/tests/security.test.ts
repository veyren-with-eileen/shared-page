import { describe, expect, it } from "vitest";

import { constantTimeEqual, escapeHtml } from "../src/security";

describe("security helpers", () => {
  it("compares secrets without prefix or length shortcuts", () => {
    expect(constantTimeEqual("same-secret", "same-secret")).toBe(true);
    expect(constantTimeEqual("same-secret", "same-secrex")).toBe(false);
    expect(constantTimeEqual("same-secret", "same-secret-longer")).toBe(false);
  });

  it("escapes authorization-page content", () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;",
    );
  });
});
