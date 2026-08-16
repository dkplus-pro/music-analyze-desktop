import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

export * from "./schema.js";

export interface Database {
  db: LibSQLDatabase;
  close: () => void;
}

export async function createDatabase({
  url = "file:data/analyze-music.db"
}: { url?: string } = {}): Promise<Database> {
  const client = createClient({ url });
  await initializeSchema(client);

  return {
    db: drizzle({ client }),
    close: () => client.close()
  };
}

async function initializeSchema(client: Client) {
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      source_path TEXT NOT NULL,
      managed_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      format TEXT NOT NULL,
      duration_ms INTEGER,
      sample_rate INTEGER,
      bit_rate INTEGER,
      channels INTEGER,
      bpm REAL,
      musical_key TEXT,
      musical_mode TEXT,
      manual_primary_emotion TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS music_tracks_file_hash_unique ON music_tracks(file_hash);

    CREATE TABLE IF NOT EXISTS music_analysis (
      id TEXT PRIMARY KEY NOT NULL,
      music_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      primary_emotion TEXT NOT NULL,
      secondary_emotions TEXT NOT NULL,
      narrative_functions TEXT NOT NULL,
      cinematic_styles TEXT NOT NULL,
      cinematic_score INTEGER NOT NULL,
      analysis_version TEXT,
      model TEXT,
      prompt_version TEXT,
      valence REAL,
      arousal INTEGER,
      tension INTEGER,
      scale INTEGER,
      epicness INTEGER,
      intimacy INTEGER,
      instrumentation TEXT,
      textures TEXT,
      trajectory TEXT,
      dialogue_friendly INTEGER,
      montage_friendly INTEGER,
      beat_editability INTEGER,
      loopability INTEGER,
      ending_quality INTEGER,
      recommended_scenes TEXT,
      not_recommended_scenes TEXT,
      cue_points TEXT,
      confidence REAL,
      summary TEXT NOT NULL,
      raw_ai_result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_segments (
      id TEXT PRIMARY KEY NOT NULL,
      music_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      energy INTEGER,
      tension INTEGER,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_features (
      id TEXT PRIMARY KEY NOT NULL,
      music_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      bpm REAL,
      musical_key TEXT,
      musical_mode TEXT,
      loudness REAL,
      dynamic_range REAL,
      beat_positions TEXT,
      energy_curve TEXT,
      extractor TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS music_features_music_id_unique ON music_features(music_id);

    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      track_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      source_path TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_files (
      id TEXT PRIMARY KEY NOT NULL,
      import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      status TEXT NOT NULL,
      track_id TEXT REFERENCES music_tracks(id) ON DELETE SET NULL,
      duplicate_of TEXT REFERENCES music_tracks(id) ON DELETE SET NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feishu_sync_records (
      id TEXT PRIMARY KEY NOT NULL,
      music_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      base_token TEXT NOT NULL,
      table_id TEXT NOT NULL,
      record_id TEXT,
      local_updated_at INTEGER NOT NULL,
      last_synced_at INTEGER,
      sync_status TEXT NOT NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS feishu_sync_records_music_table_unique ON feishu_sync_records(music_id, table_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await ensureColumns(client, "music_tracks", [
    ["bpm", "REAL"],
    ["musical_key", "TEXT"],
    ["musical_mode", "TEXT"]
  ]);
  await ensureColumns(client, "music_analysis", [
    ["analysis_version", "TEXT"],
    ["model", "TEXT"],
    ["prompt_version", "TEXT"],
    ["valence", "REAL"],
    ["arousal", "INTEGER"],
    ["tension", "INTEGER"],
    ["scale", "INTEGER"],
    ["epicness", "INTEGER"],
    ["intimacy", "INTEGER"],
    ["instrumentation", "TEXT"],
    ["textures", "TEXT"],
    ["trajectory", "TEXT"],
    ["dialogue_friendly", "INTEGER"],
    ["montage_friendly", "INTEGER"],
    ["beat_editability", "INTEGER"],
    ["loopability", "INTEGER"],
    ["ending_quality", "INTEGER"],
    ["recommended_scenes", "TEXT"],
    ["not_recommended_scenes", "TEXT"],
    ["cue_points", "TEXT"],
    ["confidence", "REAL"]
  ]);
}

async function ensureColumns(
  client: Client,
  table: "music_analysis" | "music_tracks",
  columns: Array<[string, string]>
) {
  const current = await client.execute(`PRAGMA table_info(${table})`);
  const columnNames = new Set(current.rows.map((row) => String(row["name"])));
  for (const [name, type] of columns) {
    if (!columnNames.has(name)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}
