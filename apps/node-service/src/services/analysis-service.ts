import type { AnalysisResult } from "@analyze-music/music-domain";

import type { DeterministicFeatures } from "./deterministic-analyzer.js";

export interface MusicAnalyzerInput {
  filePath: string;
  features?: DeterministicFeatures;
  metadata: Record<string, number | string | null | undefined>;
}

export interface MusicAnalyzer {
  analyze(input: MusicAnalyzerInput): Promise<AnalysisResult>;
}
