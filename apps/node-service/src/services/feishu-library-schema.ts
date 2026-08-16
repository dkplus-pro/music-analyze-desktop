import {
  cinematicStyleValues,
  instrumentationValues,
  narrativeFunctionValues,
  primaryEmotionValues,
  sceneTagValues,
  segmentTypeValues,
  textureValues,
  trajectoryValues
} from "@analyze-music/music-domain";

import type { FeishuMusicRecord } from "./feishu-exporter.js";
import type { FeishuExportTrack } from "./feishu-sync-service.js";

export interface FeishuFieldDefinition {
  field_name: string;
  property?: { options: Array<{ name: string }> };
  type: 1 | 2 | 3 | 4 | 5;
}

const audioFormatValues = ["aac", "flac", "m4a", "mp3", "ogg", "wav", "unknown"] as const;
const musicalModeValues = ["major", "minor"] as const;
const analysisStatusValues = [
  "NONE",
  "QUEUED",
  "EXTRACTING",
  "AI_ANALYZING",
  "VALIDATING",
  "COMPLETED",
  "FAILED"
] as const;
let cachedChineseLabels: Record<string, string> | undefined;

const text = (field_name: string): FeishuFieldDefinition => ({ field_name, type: 1 });
const number = (field_name: string): FeishuFieldDefinition => ({ field_name, type: 2 });
const date = (field_name: string): FeishuFieldDefinition => ({ field_name, type: 5 });
const singleSelect = (field_name: string, values: readonly string[]): FeishuFieldDefinition => ({
  field_name,
  property: { options: values.map((value) => ({ name: toChinese(value) })) },
  type: 3
});
const multipleSelect = (field_name: string, values: readonly string[]): FeishuFieldDefinition => ({
  field_name,
  property: { options: values.map((value) => ({ name: toChinese(value) })) },
  type: 4
});

export const feishuLibraryFields: FeishuFieldDefinition[] = [
  text("音乐 ID"),
  text("名称"),
  text("原始文件名"),
  text("文件哈希"),
  singleSelect("格式", audioFormatValues),
  number("文件大小（字节）"),
  number("时长（毫秒）"),
  number("采样率（Hz）"),
  number("比特率（bps）"),
  number("声道数"),
  number("BPM"),
  text("调性"),
  singleSelect("调式", musicalModeValues),
  singleSelect("分析状态", analysisStatusValues),
  singleSelect("人工主情绪", primaryEmotionValues),
  singleSelect("主情绪", primaryEmotionValues),
  multipleSelect("次情绪", primaryEmotionValues),
  multipleSelect("叙事功能", narrativeFunctionValues),
  multipleSelect("电影风格", cinematicStyleValues),
  number("电影感评分"),
  number("情绪正负向"),
  number("唤醒度"),
  number("张力"),
  number("尺度"),
  number("史诗感"),
  number("亲密感"),
  multipleSelect("乐器", instrumentationValues),
  multipleSelect("质感", textureValues),
  singleSelect("轨迹", trajectoryValues),
  number("对白适配度"),
  number("蒙太奇适配度"),
  number("节拍剪辑适配度"),
  number("循环适配度"),
  number("结尾质量"),
  multipleSelect("推荐场景", sceneTagValues),
  multipleSelect("不推荐场景", sceneTagValues),
  text("提示点（毫秒）"),
  number("分析置信度"),
  text("分析摘要"),
  text("分析版本"),
  text("模型"),
  text("提示词版本"),
  text("原始 AI 结果"),
  text("特征提取器"),
  number("响度（dB）"),
  number("动态范围（dB）"),
  text("节拍位置（毫秒）"),
  text("能量曲线"),
  multipleSelect("音乐结构类型", segmentTypeValues),
  text("音乐结构"),
  date("创建时间"),
  date("更新时间"),
  date("分析创建时间"),
  date("分析更新时间")
];

export function toFeishuRecord(track: FeishuExportTrack, recordId?: string): FeishuMusicRecord {
  return {
    fields: {
      BPM: track.bpm,
      分析创建时间: timestamp(track.analysisCreatedAt),
      分析摘要: track.summary,
      分析更新时间: timestamp(track.analysisUpdatedAt),
      分析版本: track.analysisVersion,
      分析状态: toChinese(track.analysisStatus),
      分析置信度: track.confidence,
      人工主情绪: selection(track.manualPrimaryEmotion),
      亲密感: track.intimacy,
      "原始 AI 结果": track.rawAiResult,
      原始文件名: track.originalFilename,
      唤醒度: track.arousal,
      声道数: track.channels,
      "动态范围（dB）": track.dynamicRange,
      创建时间: timestamp(track.createdAt),
      文件哈希: track.fileHash,
      "文件大小（字节）": track.fileSize,
      格式: selection(track.format),
      "提示点（毫秒）": stringifyCuePoints(track.cuePoints),
      提示词版本: track.promptVersion,
      推荐场景: selections(track.recommendedScenes),
      更新时间: timestamp(track.updatedAt),
      "时长（毫秒）": track.durationMs,
      次情绪: selections(track.secondaryEmotions),
      模型: track.model,
      乐器: selections(track.instrumentation),
      "比特率（bps）": track.bitRate,
      特征提取器: track.featureExtractor,
      电影感评分: track.cinematicScore,
      电影风格: selections(track.cinematicStyles),
      蒙太奇适配度: track.montageFriendly,
      "节拍位置（毫秒）": stringify(track.beatPositions),
      节拍剪辑适配度: track.beatEditability,
      循环适配度: track.loopability,
      结尾质量: track.endingQuality,
      能量曲线: stringify(track.energyCurve),
      "音乐 ID": track.id,
      音乐结构: formatSegments(track.segments),
      音乐结构类型: selections(unique(track.segments.map((segment) => segment.type))),
      调式: selection(track.musicalMode),
      调性: track.musicalKey,
      质感: selections(track.textures),
      轨迹: selection(track.trajectory),
      主情绪: selection(track.primaryEmotion),
      名称: track.title,
      不推荐场景: selections(track.notRecommendedScenes),
      史诗感: track.epicness,
      尺度: track.scale,
      情绪正负向: track.valence,
      "采样率（Hz）": track.sampleRate,
      对白适配度: track.dialogueFriendly,
      叙事功能: selections(track.narrativeFunctions),
      张力: track.tension,
      "响度（dB）": track.loudness
    },
    recordId,
    trackId: track.id
  };
}

function timestamp(value: Date | null | undefined) {
  return value?.getTime() ?? null;
}

function selection(value: string | null | undefined) {
  return value ? toChinese(value) : null;
}

function selections(values: string[] | null | undefined) {
  return (values ?? []).map(toChinese);
}

function stringify(value: unknown) {
  return JSON.stringify(value ?? null);
}

function stringifyCuePoints(value: Record<string, number> | null | undefined) {
  if (!value) return "{}";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).map(([key, milliseconds]) => [toChinese(key), milliseconds])
    )
  );
}

function formatSegments(segments: FeishuExportTrack["segments"]) {
  return segments
    .map((segment) => {
      const measurements = [
        segment.energy === null ? null : `能量 ${segment.energy}`,
        segment.tension === null ? null : `张力 ${segment.tension}`
      ].filter((measurement): measurement is string => Boolean(measurement));
      return [
        `${toChinese(segment.type)}：${formatDuration(segment.startMs)}–${formatDuration(segment.endMs)}`,
        ...measurements,
        segment.description
      ].join("；");
    })
    .join("\n");
}

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function chineseLabels(): Record<string, string> {
  if (cachedChineseLabels) return cachedChineseLabels;
  return (cachedChineseLabels = {
    AAC: "AAC 音频",
    "Acoustic Guitar": "原声吉他",
    "Ambient Cinematic": "氛围电影感",
    "Ambient Pad": "氛围铺底",
    Atmosphere: "氛围铺陈",
    Bass: "贝斯",
    Brass: "铜管",
    Bright: "明亮",
    Build: "推进",
    "Build → Climax": "渐强至高潮",
    "Build → Climax → Resolve": "渐强至高潮再舒缓",
    Calm: "平静",
    Cello: "大提琴",
    Choir: "人声合唱",
    Climax: "高潮",
    Clean: "清晰",
    Cold: "冷峻",
    COMPLETED: "已完成",
    Connection: "连接",
    Conflict: "冲突",
    "Continuous Fall": "持续回落",
    "Continuous Rise": "持续上扬",
    Dark: "黑暗",
    "Dark Cinematic": "黑暗电影感",
    Dense: "浓密",
    Discovery: "发现",
    Documentary: "纪录片",
    Drums: "鼓组",
    Dreamy: "梦幻",
    "Drop → Rebuild": "骤降再重建",
    "Electric Guitar": "电吉他",
    "Emotional Cinematic": "情感电影感",
    Ending: "收尾",
    Epic: "史诗",
    "Epic Cinematic": "史诗电影感",
    Ethereal: "空灵",
    EXTRACTING: "提取中",
    FAILED: "失败",
    "Fast Build": "快速渐强",
    Flat: "平稳",
    FLAC: "FLAC 音频",
    Hopeful: "希望",
    "Hybrid Cinematic": "混合电影感",
    Inspiring: "振奋",
    Intro: "引子",
    Intimate: "亲密",
    Joyful: "欢快",
    Lonely: "孤独",
    Loss: "失落",
    M4A: "M4A 音频",
    major: "大调",
    Melancholic: "忧郁",
    Memory: "记忆",
    "Minimal Cinematic": "极简电影感",
    minor: "小调",
    Mysterious: "神秘",
    "Multiple Peaks": "多重高潮",
    "Neo-Classical": "新古典",
    NONE: "未分析",
    Nostalgic: "怀旧",
    OGG: "OGG 音频",
    Opening: "开场",
    Oppressive: "压迫",
    Organic: "自然",
    "Orchestral Cinematic": "管弦电影感",
    Outro: "尾奏",
    Percussion: "打击乐",
    Piano: "钢琴",
    Powerful: "力量感",
    QUEUED: "排队中",
    Raw: "原始",
    Reflection: "沉思",
    Reflective: "沉思",
    Resolve: "舒缓",
    Resolution: "解决",
    Reveal: "揭示",
    Romance: "浪漫",
    Romantic: "浪漫",
    Sad: "悲伤",
    "Slow Build": "缓慢渐强",
    "Sound Design": "音效设计",
    Soundscape: "声音景观",
    Soft: "柔和",
    Spacious: "开阔",
    Strings: "弦乐",
    Suspense: "悬念",
    "Suspense Cinematic": "悬念电影感",
    Suspenseful: "悬疑",
    Synth: "合成器",
    Synthetic: "合成",
    Tense: "紧张",
    Theme: "主题",
    Trailer: "预告片",
    Triumphant: "凯旋",
    Triumph: "胜利",
    VALIDATING: "校验中",
    Violin: "小提琴",
    Warm: "温暖",
    WAV: "WAV 音频",
    Wave: "波浪式起伏",
    Wonder: "惊奇",
    Woodwinds: "木管",
    aac: "AAC 音频",
    beatEditability: "节拍剪辑点",
    buildStartMs: "推进开始",
    climaxStartMs: "高潮开始",
    dropMs: "骤降点",
    flac: "FLAC 音频",
    introEndMs: "引子结束",
    m4a: "M4A 音频",
    mp3: "MP3 音频",
    ogg: "OGG 音频",
    outroStartMs: "尾奏开始",
    peakMs: "峰值点",
    themeStartMs: "主题开始",
    unknown: "未知",
    wav: "WAV 音频"
  });
}

export function toChinese(value: string) {
  return chineseLabels()[value] ?? value;
}
