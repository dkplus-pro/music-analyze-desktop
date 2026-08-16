import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  analysisResultSchema,
  cinematicStyleValues,
  instrumentationValues,
  narrativeFunctionValues,
  primaryEmotionValues,
  sceneTagValues,
  segmentTypeValues,
  textureValues,
  trajectoryValues,
  type AnalysisResult
} from "@analyze-music/music-domain";

import type { MusicAnalyzer, MusicAnalyzerInput } from "./analysis-service.js";

interface CompletionInput {
  input: MusicAnalyzerInput;
  instruction: string;
}

interface BailianAnalyzerOptions {
  apiKey?: string;
  baseUrl?: string;
  complete?: (input: CompletionInput) => Promise<string>;
  fetchImplementation?: typeof fetch;
  model?: string;
}

export function createBailianAnalyzer({
  apiKey,
  baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1",
  complete: injectedCompletion,
  fetchImplementation = fetch,
  model = "qwen3.5-omni-plus"
}: BailianAnalyzerOptions = {}): MusicAnalyzer {
  const complete =
    injectedCompletion ??
    (apiKey ? createHttpCompletion({ apiKey, baseUrl, fetchImplementation, model }) : undefined);

  return {
    analyze: async (input) => {
      if (!complete) {
        throw new Error("BAILIAN_API_KEY is not configured");
      }
      const first = await complete({ input, instruction: analysisInstruction });
      const parsed = parseAnalysis(first);
      if (parsed.success) {
        return parsed.data;
      }

      const repaired = await complete({
        input,
        instruction: `${analysisInstruction}\nYour previous response was invalid: ${parsed.error.message}\nReturn corrected JSON only.`
      });
      const repairedResult = parseAnalysis(repaired);
      if (repairedResult.success) {
        return repairedResult.data;
      }
      throw repairedResult.error;
    }
  };
}

function createHttpCompletion({
  apiKey,
  baseUrl,
  fetchImplementation,
  model
}: Required<Pick<BailianAnalyzerOptions, "apiKey" | "baseUrl" | "fetchImplementation" | "model">>) {
  return async ({ input, instruction }: CompletionInput) => {
    const audio = await readFile(input.filePath);
    const response = await fetchImplementation(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      body: JSON.stringify({
        model,
        messages: [
          {
            content: [
              {
                input_audio: {
                  data: `data:${audioMimeType(input.filePath)};base64,${audio.toString("base64")}`
                },
                type: "input_audio"
              },
              { text: instruction, type: "text" }
            ],
            role: "user"
          }
        ],
        stream: false
      }),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      method: "POST"
    });
    if (!response.ok) {
      throw new Error(`Bailian request failed with ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Bailian response did not contain a text completion");
    }
    return content;
  };
}

function parseAnalysis(
  raw: string
): { data: AnalysisResult; success: true } | { error: Error; success: false } {
  try {
    const parsedJson = JSON.parse(extractJson(raw));
    const parsed = analysisResultSchema.safeParse(parsedJson);
    if (parsed.success) {
      return { data: parsed.data, success: true };
    }
    return {
      error: new Error(parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")),
      success: false
    };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), success: false };
  }
}

function extractJson(raw: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw)?.[1];
  if (fenced) {
    return fenced;
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error("Bailian response did not contain JSON");
  }
  return raw.slice(start, end + 1);
}

function audioMimeType(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  return (
    {
      ".aac": "audio/aac",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".wav": "audio/wav"
    }[extension] ?? "application/octet-stream"
  );
}

export const analysisInstruction = `Analyze this music for cinematic editing. Return one JSON object only; never use Markdown. Include primaryEmotion, secondaryEmotions, valence (-5 to 5), arousal (1-10), tension (1-10), narrativeFunctions, cinematicStyles, cinematicScore (1-10), scale (1-10), epicness (1-10), intimacy (1-10), instrumentation, textures, trajectory, dialogueFriendly (1-10), montageFriendly (1-10), beatEditability (1-10), loopability (1-10), endingQuality (1-10), recommendedScenes, notRecommendedScenes, cuePoints, segments, confidence (0-1), and summary. Cue-point keys are introEndMs, themeStartMs, buildStartMs, climaxStartMs, peakMs, dropMs, outroStartMs; use integer milliseconds only when the moment exists. Each segment is {type,startMs,endMs,energy?,tension?,description}; never create overlapping or zero-length segments. Write summary and every segment description in fluent Simplified Chinese; taxonomy keys and their allowed values must remain unchanged.\nAllowed primaryEmotion values: ${primaryEmotionValues.join(", ")}.\nAllowed narrativeFunctions: ${narrativeFunctionValues.join(", ")}.\nAllowed cinematicStyles: ${cinematicStyleValues.join(", ")}.\nAllowed instrumentation values: ${instrumentationValues.join(", ")}.\nAllowed texture values: ${textureValues.join(", ")}.\nAllowed trajectory values: ${trajectoryValues.join(", ")}.\nAllowed scene values: ${sceneTagValues.join(", ")}.\nAllowed segment types: ${segmentTypeValues.join(", ")}.`;
