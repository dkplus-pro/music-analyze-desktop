import { describe, expect, it } from "vitest";

import { createBailianCliAnalyzer } from "../src/services/bailian-cli-analyzer.js";

describe("Bailian CLI analyzer", () => {
  it("passes the local audio path to the authenticated CLI and parses its verbose completion", async () => {
    let command = "";
    let arguments_: string[] = [];
    const analyzer = createBailianCliAnalyzer({
      command: "bl-test",
      run: async (receivedCommand, receivedArguments) => {
        command = receivedCommand;
        arguments_ = receivedArguments;
        return `${"[Model: qwen3.5-omni-plus] [text-only]\n"}{\n  "content": "{\\n  \\"primaryEmotion\\": \\"Nostalgic\\", \\"secondaryEmotions\\": [], \\"narrativeFunctions\\": [\\"Memory\\"], \\"cinematicStyles\\": [\\"Drama\\"], \\"cinematicScore\\": 8, \\"summary\\": \\"Warm piano\\"\\n}"\n}\nCLI diagnostic output`;
      }
    });

    await expect(
      analyzer.analyze({ filePath: "/tmp/remember-me.mp3", metadata: {} })
    ).resolves.toMatchObject({
      cinematicScore: 8,
      primaryEmotion: "Nostalgic"
    });
    expect(command).toBe("bl-test");
    expect(arguments_).toContain("/tmp/remember-me.mp3");
    expect(arguments_).toContain("--audio");
    expect(arguments_).toContain("--text-only");
  });
});
