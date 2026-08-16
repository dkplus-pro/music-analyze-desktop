import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AudioMetadata {
  bitRate: number | null;
  channels: number | null;
  durationMs: number | null;
  format: string;
  sampleRate: number | null;
}

interface FfprobeOutput {
  format?: {
    bit_rate?: string;
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    bit_rate?: string;
    channels?: number;
    codec_type?: string;
    sample_rate?: string;
  }>;
}

export async function readAudioMetadata(sourcePath: string): Promise<AudioMetadata> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,format_name,bit_rate:stream=codec_type,sample_rate,bit_rate,channels",
    "-of",
    "json",
    sourcePath
  ]);
  const probe = JSON.parse(stdout) as FfprobeOutput;
  const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");

  return {
    bitRate: toNumber(audioStream?.bit_rate ?? probe.format?.bit_rate),
    channels: audioStream?.channels ?? null,
    durationMs: toMilliseconds(probe.format?.duration),
    format: probe.format?.format_name?.split(",")[0] ?? "unknown",
    sampleRate: toNumber(audioStream?.sample_rate)
  };
}

function toMilliseconds(value: string | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

function toNumber(value: string | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
