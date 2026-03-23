import { describe, expect, it } from "vitest";

describe("mergeChannelLastIds", async () => {
  const { extractConfigChannelFallbackFromText, mergeChannelLastIds } = await import("../scripts/refresh-discord-last-ids.mjs");

  it("prefers downloaded JSON cursors while preserving channels missing from disk", () => {
    const discoveredByChannel = new Map<string, string>([
      ["108", "200"],
      ["777", "900"],
    ]);

    const { merged, warnings } = mergeChannelLastIds({
      discoveredByChannel,
      existingChannels: [
        { channel_id: "108", last_id: "250" },
        { channel_id: "555", last_id: "oldest" },
      ],
      configChannelId: "999",
      configAfterId: "123",
    });

    expect(merged).toEqual([
      { channel_id: "108", last_id: "200" },
      { channel_id: "555", last_id: "oldest" },
      { channel_id: "777", last_id: "900" },
      { channel_id: "999", last_id: "123" },
    ]);
    expect(warnings).toEqual([
      "channel 108 saved last_id 250 is ahead of downloaded JSON 200; using downloaded JSON cursor",
    ]);
  });

  it("preserves large numeric channel ids from config text without JS rounding", () => {
    const { channelId, afterId } = extractConfigChannelFallbackFromText(`{
      "channel_id": 965624155473063976,
      "after_id": "1399111585858982022"
    }`);

    expect(channelId).toBe("965624155473063976");
    expect(afterId).toBe("1399111585858982022");
  });
});
