import { describe, expect, it } from "vitest";

import { createDeterministicAnalyzer } from "../src/services/deterministic-analyzer.js";

describe("deterministic analyzer", () => {
  it("passes the managed audio path to the Python extractor and validates its output", async () => {
    let command = "";
    let arguments_: string[] = [];
    const analyzer = createDeterministicAnalyzer({
      pythonExecutable: "python-test",
      run: async (receivedCommand, receivedArguments) => {
        command = receivedCommand;
        arguments_ = receivedArguments;
        return JSON.stringify({
          beatPositions: [0.4, 1.2],
          bpm: 76.4,
          dynamicRange: 12.1,
          energyCurve: [0.1, 0.9],
          extractor: "librosa",
          key: "D",
          loudness: -16.3,
          mode: "minor"
        });
      },
      scriptPath: "/tmp/music-analyzer.py"
    });

    await expect(analyzer.analyze("/tmp/remember-me.mp3")).resolves.toMatchObject({
      bpm: 76.4,
      key: "D"
    });
    expect(command).toBe("python-test");
    expect(arguments_).toEqual([
      "/tmp/music-analyzer.py",
      "--input",
      "/tmp/remember-me.mp3",
      "--output",
      "json"
    ]);
  });

  it("locates the extractor from the service module instead of the process working directory", async () => {
    let arguments_: string[] = [];
    const analyzer = createDeterministicAnalyzer({
      run: async (_command, receivedArguments) => {
        arguments_ = receivedArguments;
        return JSON.stringify({
          beatPositions: [],
          bpm: 76.4,
          dynamicRange: 12.1,
          energyCurve: [],
          extractor: "librosa",
          key: "D",
          loudness: -16.3,
          mode: "minor"
        });
      }
    });

    await analyzer.analyze("/tmp/remember-me.mp3");
    expect(arguments_[0]).toMatch(/tools\/music-analyzer\/main\.py$/);
  });
});
