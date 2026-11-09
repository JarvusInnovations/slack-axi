import { describe, expect, it } from "vitest";
import { addScopesHelp, missingScopes, REQUIRED_SCOPES } from "../src/slack/scopes.js";

describe("addScopesHelp", () => {
  it("names each missing scope and says the token is unchanged (no re-login)", () => {
    const [add, keep] = addScopesHelp(["files:write", "search:read"]);
    expect(add).toContain("`files:write`, `search:read`");
    expect(add).toContain("Reinstall to Workspace");
    expect(keep).toContain("token stays the same");
    expect(addScopesHelp([]).join(" ")).not.toMatch(/auth login|re-login/);
  });
});

describe("missingScopes", () => {
  it("includes files:write in the required set", () => {
    expect(REQUIRED_SCOPES).toContain("files:write");
    expect(missingScopes(REQUIRED_SCOPES.filter((s) => s !== "files:write"))).toEqual([
      "files:write",
    ]);
  });
});
