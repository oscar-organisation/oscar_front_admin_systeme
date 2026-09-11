import { describe, expect, it } from "vitest";
import { buildCockpitUrl } from "./cockpitLink.js";

describe("buildCockpitUrl", () => {
  it("place les accès dans le fragment et jamais dans la query string", () => {
    const result = new URL(buildCockpitUrl({
      token: "signed-jwt",
      livekit_url: "wss://stream-livekit.oscar-bot.com",
      room: "oscar-oscar-02-d97da823",
    }, "https://cockpit.example.test"));

    expect(result.search).toBe("");
    expect(new URLSearchParams(result.hash.slice(1)).get("token")).toBe("signed-jwt");
    expect(new URLSearchParams(result.hash.slice(1)).get("room")).toBe("oscar-oscar-02-d97da823");
  });

  it("refuse une session incomplète", () => {
    expect(() => buildCockpitUrl({ token: "signed-jwt" })).toThrow("Session cockpit incomplète");
  });
});
