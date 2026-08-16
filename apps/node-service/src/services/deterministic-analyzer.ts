import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface DeterministicFeatures {
  beatPositions: number[];
  bpm: number;
  dynamicRange: number;
  energyCurve: number[];
  extractor: string;
  key: string | null;
  loudness: number;
  mode: "major" | "minor" | null;
}

export interface DeterministicAnalyzer {
  analyze(filePath: string): Promise<DeterministicFeatures>;
}

interface DeterministicAnalyzerOptions {
  pythonExecutable?: string;
  run?: (command: string, arguments_: string[]) => Promise<string>;
  scriptPath?: string;
}

export function createDeterministicAnalyzer({
  pythonExecutable = process.env["MUSIC_ANALYZER_PYTHON"] ?? "python3",
  run = runCommand,
  scriptPath = process.env["MUSIC_ANALYZER_SCRIPT"] ??
    fileURLToPath(new URL("../../../../tools/music-analyzer/main.py", import.meta.url))
}: DeterministicAnalyzerOptions = {}): DeterministicAnalyzer {
  return {
    analyze: async (filePath) => {
      const output = await run(pythonExecutable, [
        scriptPath,
        "--input",
        filePath,
        "--output",
        "json"
      ]);
      return parseDeterministicFeatures(JSON.parse(output));
    }
  };
}

function parseDeterministicFeatures(value: unknown): DeterministicFeatures {
  if (!value || typeof value !== "object") {
    throw new Error("Music feature extractor did not return a JSON object");
  }
  const result = value as Record<string, unknown>;
  const bpm = finiteNumber(result["bpm"], "bpm");
  if (bpm < 0) throw new Error("Music feature extractor returned a negative bpm");
  const key = nullableString(result["key"], "key");
  const mode = result["mode"];
  if (mode !== null && mode !== "major" && mode !== "minor") {
    throw new Error("Music feature extractor returned an invalid mode");
  }
  const extractor = result["extractor"];
  if (typeof extractor !== "string" || extractor.length === 0) {
    throw new Error("Music feature extractor did not identify itself");
  }
  return {
    beatPositions: numberArray(result["beatPositions"], "beatPositions"),
    bpm,
    dynamicRange: finiteNumber(result["dynamicRange"], "dynamicRange"),
    energyCurve: numberArray(result["energyCurve"], "energyCurve", 0, 1),
    extractor,
    key,
    loudness: finiteNumber(result["loudness"], "loudness"),
    mode
  };
}

function finiteNumber(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Music feature extractor returned an invalid ${name}`);
  }
  return value;
}

function nullableString(value: unknown, name: string) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Music feature extractor returned an invalid ${name}`);
  }
  return value;
}

function numberArray(value: unknown, name: string, minimum = -Infinity, maximum = Infinity) {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "number" || !Number.isFinite(item) || item < minimum || item > maximum
    )
  ) {
    throw new Error(`Music feature extractor returned invalid ${name}`);
  }
  return value;
}

function runCommand(command: string, arguments_: string[]) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolveOutput(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(
        new Error(
          `Music feature extractor exited with ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 1_000)}`
        )
      );
    });
  });
}
