import { describe, expect, it } from "vitest";

import { createWaveformService } from "../src/services/waveform-service.js";

describe("waveform service", () => {
  it("converts signed PCM samples into normalized peak buckets", async () => {
    const pcm = Buffer.alloc(12);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(16_384, 2);
    pcm.writeInt16LE(-32_768, 4);
    pcm.writeInt16LE(8_192, 6);
    pcm.writeInt16LE(-4_096, 8);
    pcm.writeInt16LE(0, 10);
    const service = createWaveformService({ points: 3, run: async () => pcm });

    await expect(service.waveform("/tmp/music.mp3")).resolves.toEqual({
      peaks: [0.5, 1, 0.125],
      sampleRate: 8_000
    });
  });
});
