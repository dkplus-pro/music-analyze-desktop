import { z } from "zod";

import {
  cinematicStyleValues,
  instrumentationValues,
  narrativeFunctionValues,
  primaryEmotionValues,
  sceneTagValues,
  segmentTypeValues,
  textureValues,
  trajectoryValues
} from "./taxonomy.js";

const scoreSchema = z.number().int().min(1).max(10);
const timestampSchema = z.number().int().min(0);
const optionalTimestampSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  timestampSchema.optional()
);

export const musicSegmentSchema = z
  .object({
    description: z.string().trim().min(1),
    endMs: timestampSchema,
    energy: scoreSchema.optional(),
    startMs: timestampSchema,
    tension: scoreSchema.optional(),
    type: z.enum(segmentTypeValues)
  })
  .refine((segment) => segment.endMs > segment.startMs, {
    message: "Segment end must be after start",
    path: ["endMs"]
  });

export const cuePointsSchema = z.object({
  buildStartMs: optionalTimestampSchema,
  climaxStartMs: optionalTimestampSchema,
  dropMs: optionalTimestampSchema,
  introEndMs: optionalTimestampSchema,
  outroStartMs: optionalTimestampSchema,
  peakMs: optionalTimestampSchema,
  themeStartMs: optionalTimestampSchema
});

export const analysisResultSchema = z.object({
  primaryEmotion: z.enum(primaryEmotionValues),
  secondaryEmotions: z.array(z.enum(primaryEmotionValues)).default([]),
  valence: z.number().min(-5).max(5).optional(),
  arousal: scoreSchema.optional(),
  tension: scoreSchema.optional(),
  narrativeFunctions: z.array(z.enum(narrativeFunctionValues)),
  cinematicStyles: z.array(z.enum(cinematicStyleValues)),
  cinematicScore: scoreSchema,
  scale: scoreSchema.optional(),
  epicness: scoreSchema.optional(),
  intimacy: scoreSchema.optional(),
  instrumentation: z.array(z.enum(instrumentationValues)).optional(),
  textures: z.array(z.enum(textureValues)).optional(),
  trajectory: z.enum(trajectoryValues).optional(),
  dialogueFriendly: scoreSchema.optional(),
  montageFriendly: scoreSchema.optional(),
  beatEditability: scoreSchema.optional(),
  loopability: scoreSchema.optional(),
  endingQuality: scoreSchema.optional(),
  recommendedScenes: z.array(z.enum(sceneTagValues)).optional(),
  notRecommendedScenes: z.array(z.enum(sceneTagValues)).optional(),
  cuePoints: cuePointsSchema.optional(),
  segments: z.array(musicSegmentSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().trim().min(1)
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/**
 * AI providers occasionally return descriptive tags outside the fixed taxonomy.
 * These three fields are optional discovery aids, so retaining only their known
 * values keeps an otherwise valid analysis usable without weakening the schema
 * for required fields.
 */
export function normalizeOptionalTaxonomyTags(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const result: Record<string, unknown> = { ...value };
  result["secondaryEmotions"] = filterTaxonomyValues(
    result["secondaryEmotions"],
    primaryEmotionValues
  );
  result["recommendedScenes"] = filterTaxonomyValues(result["recommendedScenes"], sceneTagValues);
  result["notRecommendedScenes"] = filterTaxonomyValues(
    result["notRecommendedScenes"],
    sceneTagValues
  );
  return result;
}

export function effectiveValue<T>(manual: T | null | undefined, ai: T | null | undefined) {
  return manual ?? ai;
}

function filterTaxonomyValues(value: unknown, allowedValues: readonly string[]) {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && allowedValues.includes(candidate)
  );
}
