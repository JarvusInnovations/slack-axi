import { describe, expect, it } from "vitest";
import { isBotToken, workspaceMode } from "../src/config.js";

describe("workspaceMode", () => {
  it("derives bot from a recorded bot_id", () => {
    expect(workspaceMode({ bot_id: "B1", token: "xoxb-1" })).toBe("bot");
  });
  it("derives bot from the xoxb- prefix when the record predates bot_id capture", () => {
    expect(isBotToken({ token: "xoxb-123" })).toBe(true);
    expect(workspaceMode({ token: "xoxb-123" })).toBe("bot");
  });
  it("derives human for a user token with no bot_id", () => {
    expect(workspaceMode({ token: "xoxp-123" })).toBe("human");
  });
  it("an explicit override wins over derivation", () => {
    expect(workspaceMode({ mode: "human", bot_id: "B1", token: "xoxb-1" })).toBe("human");
    expect(workspaceMode({ mode: "bot", token: "xoxp-1" })).toBe("bot");
  });
});
