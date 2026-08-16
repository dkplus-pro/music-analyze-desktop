import { spawn } from "node:child_process";

export interface AudioWaveform {
  peaks: number[];
  sampleRate: number;
}

interface WaveformServiceOptions {
  points?: number;
  run?: (filePath: string) => Promise<Buffer>;
}

export function createWaveformService({
  points = 180,
  run = decodeMonoPcm
}: WaveformServiceOptions = {}) {
  return {
    waveform: async (filePath: string): Promise<AudioWaveform> => ({
      peaks: summarizePeaks(await run(filePath), points),
      sampleRate: 8_000
    })
  };
}

async function decodeMonoPcm(filePath: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-v", "error", "-i", filePath, "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let length = 0;
    const maximumBytes = 64 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > maximumBytes) {
        child.kill();
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (length > maximumBytes) {
        reject(new Error("Audio is too long to render a waveform"));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg waveform decode failed: ${Buffer.concat(errors).toString("utf8").slice(0, 1_000)}`
          )
        );
        return;
      }
      resolve(Buffer.concat(output));
    });
  });
}

function summarizePeaks(pcm: Buffer, points: number) {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) return [];
  const peakCount = Math.min(points, sampleCount);
  const peaks: number[] = [];
  for (let point = 0; point < peakCount; point += 1) {
    const start = Math.floor((point * sampleCount) / peakCount);
    const end = Math.max(start + 1, Math.floor(((point + 1) * sampleCount) / peakCount));
    let peak = 0;
    for (let sample = start; sample < end; sample += 1) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(sample * 2)) / 32_768);
    }
    peaks.push(Number(peak.toFixed(4)));
  }
  return peaks;
}
