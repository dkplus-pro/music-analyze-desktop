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

export function effectiveValue<T>(manual: T | null | undefined, ai: T | null | undefined) {
  return manual ?? ai;
}
