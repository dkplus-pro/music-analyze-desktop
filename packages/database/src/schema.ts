import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
};

export const musicTracks = sqliteTable(
  "music_tracks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    originalFilename: text("original_filename").notNull(),
    sourcePath: text("source_path").notNull(),
    managedPath: text("managed_path").notNull(),
    fileHash: text("file_hash").notNull(),
    fileSize: integer("file_size").notNull(),
    format: text("format").notNull(),
    durationMs: integer("duration_ms"),
    sampleRate: integer("sample_rate"),
    bitRate: integer("bit_rate"),
    channels: integer("channels"),
    bpm: real("bpm"),
    musicalKey: text("musical_key"),
    musicalMode: text("musical_mode"),
    manualPrimaryEmotion: text("manual_primary_emotion"),
    ...timestamps
  },
  (table) => [uniqueIndex("music_tracks_file_hash_unique").on(table.fileHash)]
);

export const musicAnalysis = sqliteTable("music_analysis", {
  id: text("id").primaryKey(),
  musicId: text("music_id")
    .notNull()
    .references(() => musicTracks.id, { onDelete: "cascade" }),
  primaryEmotion: text("primary_emotion").notNull(),
  secondaryEmotions: text("secondary_emotions", { mode: "json" }).$type<string[]>().notNull(),
  narrativeFunctions: text("narrative_functions", { mode: "json" }).$type<string[]>().notNull(),
  cinematicStyles: text("cinematic_styles", { mode: "json" }).$type<string[]>().notNull(),
  cinematicScore: integer("cinematic_score").notNull(),
  analysisVersion: text("analysis_version"),
  model: text("model"),
  promptVersion: text("prompt_version"),
  valence: real("valence"),
  arousal: integer("arousal"),
  tension: integer("tension"),
  scale: integer("scale"),
  epicness: integer("epicness"),
  intimacy: integer("intimacy"),
  instrumentation: text("instrumentation", { mode: "json" }).$type<string[]>(),
  textures: text("textures", { mode: "json" }).$type<string[]>(),
  trajectory: text("trajectory"),
  dialogueFriendly: integer("dialogue_friendly"),
  montageFriendly: integer("montage_friendly"),
  beatEditability: integer("beat_editability"),
  loopability: integer("loopability"),
  endingQuality: integer("ending_quality"),
  recommendedScenes: text("recommended_scenes", { mode: "json" }).$type<string[]>(),
  notRecommendedScenes: text("not_recommended_scenes", { mode: "json" }).$type<string[]>(),
  cuePoints: text("cue_points", { mode: "json" }).$type<Record<string, number>>(),
  confidence: real("confidence"),
  summary: text("summary").notNull(),
  rawAiResult: text("raw_ai_result"),
  ...timestamps
});

export const musicSegments = sqliteTable("music_segments", {
  id: text("id").primaryKey(),
  musicId: text("music_id")
    .notNull()
    .references(() => musicTracks.id, { onDelete: "cascade" }),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  type: text("type").notNull(),
  energy: integer("energy"),
  tension: integer("tension"),
  description: text("description").notNull(),
  ...timestamps
});

export const musicFeatures = sqliteTable(
  "music_features",
  {
    id: text("id").primaryKey(),
    musicId: text("music_id")
      .notNull()
      .references(() => musicTracks.id, { onDelete: "cascade" }),
    bpm: real("bpm"),
    musicalKey: text("musical_key"),
    musicalMode: text("musical_mode"),
    loudness: real("loudness"),
    dynamicRange: real("dynamic_range"),
    beatPositions: text("beat_positions", { mode: "json" }).$type<number[]>(),
    energyCurve: text("energy_curve", { mode: "json" }).$type<number[]>(),
    extractor: text("extractor").notNull(),
    ...timestamps
  },
  (table) => [uniqueIndex("music_features_music_id_unique").on(table.musicId)]
);

export const analysisJobs = sqliteTable("analysis_jobs", {
  id: text("id").primaryKey(),
  trackId: text("track_id")
    .notNull()
    .references(() => musicTracks.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  ...timestamps
});

export const importJobs = sqliteTable("import_jobs", {
  id: text("id").primaryKey(),
  sourcePath: text("source_path").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  ...timestamps
});

export const importFiles = sqliteTable("import_files", {
  id: text("id").primaryKey(),
  importJobId: text("import_job_id")
    .notNull()
    .references(() => importJobs.id, { onDelete: "cascade" }),
  sourcePath: text("source_path").notNull(),
  originalFilename: text("original_filename").notNull(),
  status: text("status").notNull(),
  trackId: text("track_id").references(() => musicTracks.id, { onDelete: "set null" }),
  duplicateOf: text("duplicate_of").references(() => musicTracks.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  ...timestamps
});

export const feishuSyncRecords = sqliteTable(
  "feishu_sync_records",
  {
    id: text("id").primaryKey(),
    musicId: text("music_id")
      .notNull()
      .references(() => musicTracks.id, { onDelete: "cascade" }),
    baseToken: text("base_token").notNull(),
    tableId: text("table_id").notNull(),
    recordId: text("record_id"),
    localUpdatedAt: integer("local_updated_at", { mode: "timestamp_ms" }).notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    syncStatus: text("sync_status").notNull(),
    errorMessage: text("error_message"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("feishu_sync_records_music_table_unique").on(table.musicId, table.tableId)
  ]
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  ...timestamps
});
