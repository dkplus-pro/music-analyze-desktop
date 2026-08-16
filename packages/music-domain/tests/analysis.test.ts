import { describe, expect, it } from "vitest";

import { analysisResultSchema, effectiveValue } from "../src/index";

describe("analysisResultSchema", () => {
  it("accepts a fixed-taxonomy analysis result", () => {
    const result = analysisResultSchema.safeParse({
      primaryEmotion: "Nostalgic",
      narrativeFunctions: ["Memory"],
      cinematicStyles: ["Drama"],
      cinematicScore: 8,
      instrumentation: ["Piano", "Strings"],
      textures: ["Warm", "Intimate"],
      trajectory: "Build → Climax → Resolve",
      dialogueFriendly: 9,
      montageFriendly: 7,
      recommendedScenes: ["人物回忆", "纪录片"],
      cuePoints: { climaxStartMs: 82_000, outroStartMs: 128_000 },
      segments: [
        { description: "Piano introduction", endMs: 14_000, startMs: 0, type: "Intro" },
        { description: "String lift", endMs: 128_000, startMs: 14_000, type: "Build" }
      ],
      summary: "Warm piano"
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invented primary emotion", () => {
    expect(
      analysisResultSchema.safeParse({
        primaryEmotion: "Invented",
        narrativeFunctions: [],
        cinematicStyles: [],
        cinematicScore: 8,
        summary: "x"
      }).success
    ).toBe(false);
  });

  it("rejects an invalid cue segment", () => {
    expect(
      analysisResultSchema.safeParse({
        primaryEmotion: "Calm",
        narrativeFunctions: [],
        cinematicStyles: [],
        cinematicScore: 3,
        segments: [{ description: "Broken", endMs: 10, startMs: 10, type: "Intro" }],
        summary: "x"
      }).success
    ).toBe(false);
  });

  it("accepts a null optional cue point when that musical moment does not exist", () => {
    expect(
      analysisResultSchema.safeParse({
        primaryEmotion: "Calm",
        narrativeFunctions: [],
        cinematicStyles: [],
        cinematicScore: 3,
        cuePoints: { dropMs: null },
        summary: "x"
      }).success
    ).toBe(true);
  });
});

describe("effectiveValue", () => {
  it("uses an operator override instead of the AI value", () => {
    expect(effectiveValue("Nostalgic", "Sad")).toBe("Nostalgic");
  });
});
