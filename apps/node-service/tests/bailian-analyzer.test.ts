import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createBailianAnalyzer } from "../src/services/bailian-analyzer.js";

const samplePath = fileURLToPath(
  new URL("../../../tests/sample/10%20%E5%B8%8C%E6%9C%9B.mp3", import.meta.url)
);

describe("Bailian analyzer", () => {
  it("sends audio to the compatible chat endpoint and accepts a valid analysis", async () => {
    let requestUrl = "";
    let requestBody = "";
    const analyzer = createBailianAnalyzer({
      apiKey: "test-key",
      baseUrl: "https://example.test/compatible-mode/v1",
      fetchImplementation: async (url, init) => {
        requestUrl = String(url);
        requestBody = String(init?.body);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"primaryEmotion":"Nostalgic","secondaryEmotions":["Warm"],"narrativeFunctions":["Memory"],"cinematicStyles":["Drama"],"cinematicScore":8,"summary":"Warm piano memory cue"}'
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
    });

    await expect(
      analyzer.analyze({ filePath: samplePath, metadata: { format: "mp3" } })
    ).resolves.toMatchObject({
      cinematicScore: 8,
      primaryEmotion: "Nostalgic"
    });
    expect(requestUrl).toBe("https://example.test/compatible-mode/v1/chat/completions");
    expect(requestBody).toContain('"type":"input_audio"');
    expect(requestBody).toContain("data:audio/mpeg;base64,");
    expect(requestBody).toContain("instrumentation");
    expect(requestBody).toContain("cuePoints");
    expect(requestBody).toContain("Simplified Chinese");
  });

  it("rejects an unsupported taxonomy value inside fenced JSON", async () => {
    const analyzer = createBailianAnalyzer({
      complete: async () =>
        '```json\n{"primaryEmotion":"Invented","narrativeFunctions":[],"cinematicStyles":[],"cinematicScore":8,"summary":"x"}\n```'
    });

    await expect(
      analyzer.analyze({ filePath: "/tmp/sample.mp3", metadata: { format: "mp3" } })
    ).rejects.toThrow("primaryEmotion");
  });

  it("keeps an analysis when only optional taxonomy tags contain unknown values", async () => {
    let completions = 0;
    const analyzer = createBailianAnalyzer({
      complete: async () => {
        completions += 1;
        return JSON.stringify({
          cinematicScore: 8,
          cinematicStyles: ["Drama"],
          narrativeFunctions: ["Memory"],
          notRecommendedScenes: ["战争", "恐怖片", "追逐"],
          primaryEmotion: "Nostalgic",
          recommendedScenes: ["人物回忆", "婚礼"],
          secondaryEmotions: ["Warm", "Sentimental", "Sad"],
          summary: "Warm piano memory cue"
        });
      }
    });

    await expect(
      analyzer.analyze({ filePath: "/tmp/sample.mp3", metadata: { format: "mp3" } })
    ).resolves.toMatchObject({
      notRecommendedScenes: ["战争", "追逐"],
      recommendedScenes: ["人物回忆"],
      secondaryEmotions: ["Warm", "Sad"]
    });
    expect(completions).toBe(1);
  });
});
