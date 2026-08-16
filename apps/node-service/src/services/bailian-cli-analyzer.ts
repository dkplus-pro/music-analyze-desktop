import { spawn } from "node:child_process";

import { analysisResultSchema, type AnalysisResult } from "@analyze-music/music-domain";

import type { MusicAnalyzer, MusicAnalyzerInput } from "./analysis-service.js";
import { analysisInstruction } from "./bailian-analyzer.js";

interface BailianCliAnalyzerOptions {
  command?: string;
  model?: string;
  run?: (command: string, arguments_: string[]) => Promise<string>;
}

export function createBailianCliAnalyzer({
  command = process.env["BAILIAN_CLI_PATH"] || "bl",
  model = process.env["BAILIAN_MODEL"] || "qwen3.5-omni-plus",
  run = runCommand
}: BailianCliAnalyzerOptions = {}): MusicAnalyzer {
  return {
    analyze: async (input) => analyzeWithRepair({ command, input, model, run })
  };
}

async function analyzeWithRepair({
  command,
  input,
  model,
  run
}: {
  command: string;
  input: MusicAnalyzerInput;
  model: string;
  run: (command: string, arguments_: string[]) => Promise<string>;
}): Promise<AnalysisResult> {
  const first = await complete({
    command,
    filePath: input.filePath,
    instruction: analysisInstruction,
    model,
    run
  });
  const parsed = parseAnalysis(first);
  if (parsed.success) return parsed.data;

  const repaired = await complete({
    command,
    filePath: input.filePath,
    instruction: `${analysisInstruction}\nYour previous response was invalid: ${parsed.error.message}\nReturn corrected JSON only.`,
    model,
    run
  });
  const repairedResult = parseAnalysis(repaired);
  if (repairedResult.success) return repairedResult.data;
  throw repairedResult.error;
}

async function complete({
  command,
  filePath,
  instruction,
  model,
  run
}: {
  command: string;
  filePath: string;
  instruction: string;
  model: string;
  run: (command: string, arguments_: string[]) => Promise<string>;
}) {
  const output = await run(command, [
    "omni",
    "--model",
    model,
    "--audio",
    filePath,
    "--text-only",
    "--max-tokens",
    "1800",
    "--temperature",
    "0.1",
    "--message",
    instruction,
    "--output",
    "json",
    "--timeout",
    "120",
    "--verbose"
  ]);
  return extractCompletionContent(output);
}

function parseAnalysis(
  raw: string
): { data: AnalysisResult; success: true } | { error: Error; success: false } {
  try {
    const parsed = analysisResultSchema.safeParse(JSON.parse(extractJson(raw)));
    if (parsed.success) return { data: parsed.data, success: true };
    return {
      error: new Error(parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")),
      success: false
    };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), success: false };
  }
}

function extractCompletionContent(output: string) {
  const start = output.lastIndexOf('{\n  "content"');
  if (start === -1) throw new Error("Bailian CLI did not return a completion payload");
  const payload = JSON.parse(extractObjectAt(output, start)) as { content?: string };
  if (!payload.content) throw new Error("Bailian CLI completion did not contain content");
  return payload.content;
}

function extractObjectAt(source: string, start: number) {
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("Bailian CLI returned an incomplete completion payload");
}

function extractJson(raw: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw)?.[1];
  if (fenced) return fenced;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("Bailian response did not contain JSON");
  return raw.slice(start, end + 1);
}

function runCommand(command: string, arguments_: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const output = `${Buffer.concat(stdout).toString("utf8")}\n${Buffer.concat(stderr).toString("utf8")}`;
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`Bailian CLI exited with ${code}: ${output.slice(0, 2_000)}`));
    });
  });
}
