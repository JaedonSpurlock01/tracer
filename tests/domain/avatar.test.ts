/**
 * -------------------------------------------------------------------------
 * @file   avatar.test.ts
 * @brief  Covers mapping a stored avatar choice to a DiceBear Gaze URL.
 *
 * @description
 *  Checks the seed token round trip, the user-id default for missing
 *  values, that untrusted stored values never reach the rendered URL, the
 *  shape of random seeds, and initials.
 *
 * @see
 *  data/avatar.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { avatarImageToken, avatarInitials, avatarSeedFromImage, avatarUrl, randomAvatarSeed } from "@/data/avatar";

const userId = "40b955e2-8675-4c77-805a-f3a3937058ae";

describe("avatar", () => {
  it("round-trips a random seed and the user id through the stored token", () => {
    const seed = randomAvatarSeed();
    expect(avatarSeedFromImage(avatarImageToken(seed), userId)).toBe(seed);
    expect(avatarSeedFromImage(avatarImageToken(userId), "someone-else")).toBe(userId);
  });

  it("falls back to the user id for missing, unknown, or untrusted values", () => {
    for (const image of [
      null,
      undefined,
      "",
      "dicebear:gaze:",
      "dicebear:gaze",
      "dicebear:rings",
      "https://evil.example/pixel.png",
      "dicebear:gaze:../../x",
      "dicebear:gaze:a&style=rings",
      `dicebear:gaze:${"a".repeat(65)}`,
    ]) {
      expect(avatarSeedFromImage(image, userId)).toBe(userId);
    }
  });

  it("always builds a Gaze URL with the seed encoded", () => {
    expect(avatarUrl("operator-1")).toBe("https://api.dicebear.com/10.x/gaze/svg?seed=operator-1");
    expect(avatarUrl("a b/c")).toBe("https://api.dicebear.com/10.x/gaze/svg?seed=a%20b%2Fc");
  });

  it("makes distinct 10-character lowercase alphanumeric seeds", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomAvatarSeed()));
    expect(seeds.size).toBe(50);
    for (const seed of seeds) expect(seed).toMatch(/^[a-z0-9]{10}$/);
  });

  it("derives up to two initials", () => {
    expect(avatarInitials("Jaedon Spurlock")).toBe("JS");
    expect(avatarInitials("ada")).toBe("A");
    expect(avatarInitials("Mary Ann Lee")).toBe("MA");
  });
});
