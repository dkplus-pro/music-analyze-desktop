import { z } from "zod";

import { analysisResultSchema } from "@analyze-music/music-domain";

export const musicIdSchema = z.string().uuid();

export const importMusicRequestSchema = z.object({
  sourcePath: z.string().min(1),
  originalFilename: z.string().min(1).optional()
});

export const musicTrackSchema = z.object({
  id: musicIdSchema,
  title: z.string(),
  originalFilename: z.string(),
  format: z.string(),
  durationMs: z.number().int().nullable(),
  primaryEmotion: analysisResultSchema.shape.primaryEmotion.nullable(),
  cinematicScore: z.number().int().min(1).max(10).nullable(),
  analysisStatus: z.enum([
    "NONE",
    "QUEUED",
    "EXTRACTING",
    "AI_ANALYZING",
    "VALIDATING",
    "COMPLETED",
    "FAILED"
  ])
});

export const patchMusicRequestSchema = z
  .object({
    manualPrimaryEmotion: analysisResultSchema.shape.primaryEmotion.nullable().optional(),
    title: z.string().trim().min(1).optional()
  })
  .refine((value) => value["manualPrimaryEmotion"] !== undefined || value.title !== undefined, {
    message: "At least one mutable field is required"
  });

export type ImportMusicRequest = z.infer<typeof importMusicRequestSchema>;
export type MusicTrackDto = z.infer<typeof musicTrackSchema>;
