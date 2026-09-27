import { primaryEmotionValues } from "@analyze-music/music-domain";
import { describe, expect, it } from "vitest";

import { feishuLibraryFields, toFeishuRecord } from "../src/services/feishu-library-schema.js";
import type { FeishuExportTrack } from "../src/services/feishu-sync-service.js";

describe("Feishu music library schema", () => {
  it("creates selectable taxonomy fields and exports every music business value", () => {
    const fieldsByName = new Map(feishuLibraryFields.map((field) => [field.field_name, field]));
    expect(fieldsByName.get("主情绪")).toMatchObject({
      property: {
        options: expect.arrayContaining([{ name: "平静" }, { name: "温暖" }, { name: "希望" }])
      },
      type: 3
    });
    expect(fieldsByName.get("主情绪")?.property?.options).toHaveLength(primaryEmotionValues.length);
    expect(fieldsByName.get("叙事功能")).toMatchObject({
      property: { options: expect.arrayContaining([{ name: "开场" }, { name: "高潮" }]) },
      type: 4
    });
    expect(fieldsByName.get("分析状态")).toMatchObject({
      property: { options: expect.arrayContaining([{ name: "已完成" }, { name: "失败" }]) },
      type: 3
    });
    expect(fieldsByName.get("音乐结构类型")).toMatchObject({ type: 4 });
    expect(fieldsByName.get("音乐结构")).toMatchObject({ type: 1 });
    expect(fieldsByName.get("原始 AI 结果")).toMatchObject({ type: 1 });

    const record = toFeishuRecord(fullTrack);

    expect(record.trackId).toBe("music-1");
    expect(record.fields).toMatchObject({
      BPM: 108.5,
      分析状态: "已完成",
      分析摘要: "温暖的钢琴主题逐步推进至明亮高潮。",
      分析版本: "v1",
      创建时间: fullTrack.createdAt.getTime(),
      "原始 AI 结果": '{"summary":"ok"}',
      原始文件名: "warm-theme.mp3",
      文件哈希: "sha256:music-1",
      "文件大小（字节）": 2048,
      格式: "MP3 音频",
      模型: "qwen3.5-omni-plus",
      "音乐 ID": "music-1",
      音乐结构:
        "引子：0:00–0:20；能量 2；张力 1；柔和钢琴进入。\n高潮：0:20–1:00；能量 8；张力 7；弦乐推向明亮高潮。",
      音乐结构类型: ["引子", "高潮"],
      调式: "大调"
    });
    expect(record.fields).not.toHaveProperty("sourcePath");
    expect(record.fields).not.toHaveProperty("managedPath");
  });
});

const fullTrack: FeishuExportTrack = {
  analysisCreatedAt: new Date("2026-08-11T08:00:30.000Z"),
  analysisStatus: "COMPLETED",
  analysisUpdatedAt: new Date("2026-08-11T08:01:00.000Z"),
  analysisVersion: "v1",
  arousal: 6,
  beatEditability: 7,
  beatPositions: [100, 600],
  bitRate: 320000,
  bpm: 108.5,
  channels: 2,
  cinematicScore: 8,
  cinematicStyles: ["Emotional Cinematic"],
  confidence: 0.91,
  createdAt: new Date("2026-08-11T08:00:00.000Z"),
  cuePoints: { climaxStartMs: 20000, introEndMs: 5000 },
  dialogueFriendly: 8,
  durationMs: 60000,
  dynamicRange: 12.4,
  endingQuality: 7,
  energyCurve: [0.1, 0.8],
  epicness: 4,
  featureExtractor: "librosa",
  fileHash: "sha256:music-1",
  fileSize: 2048,
  format: "mp3",
  id: "music-1",
  instrumentation: ["Piano", "Strings"],
  intimacy: 7,
  loopability: 6,
  loudness: -12.2,
  manualPrimaryEmotion: "Warm",
  model: "qwen3.5-omni-plus",
  montageFriendly: 7,
  musicalKey: "C",
  musicalMode: "major",
  narrativeFunctions: ["Opening", "Climax"],
  notRecommendedScenes: ["战争"],
  originalFilename: "warm-theme.mp3",
  primaryEmotion: "Warm",
  promptVersion: "v1",
  rawAiResult: '{"summary":"ok"}',
  recommendedScenes: ["人物回忆", "品牌片"],
  sampleRate: 44100,
  scale: 6,
  secondaryEmotions: ["Hopeful"],
  segments: [
    {
      description: "柔和钢琴进入。",
      endMs: 20000,
      energy: 2,
      startMs: 0,
      tension: 1,
      type: "Intro"
    },
    {
      description: "弦乐推向明亮高潮。",
      endMs: 60000,
      energy: 8,
      startMs: 20000,
      tension: 7,
      type: "Climax"
    }
  ],
  sourcePath: "/music/warm-theme.mp3",
  summary: "温暖的钢琴主题逐步推进至明亮高潮。",
  tension: 5,
  textures: ["Warm", "Spacious"],
  title: "Warm Theme",
  trajectory: "Build → Climax",
  updatedAt: new Date("2026-08-11T08:02:00.000Z"),
  valence: 3
};
