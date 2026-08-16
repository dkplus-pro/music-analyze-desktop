export interface AnalysisJob {
  errorMessage: string | null;
  id: string;
  status: "QUEUED" | "EXTRACTING" | "AI_ANALYZING" | "VALIDATING" | "COMPLETED" | "FAILED";
  trackId: string;
}

export interface MusicTrack {
  analysisError: string | null;
  analysisJobId: string | null;
  analysisStatus: "NONE" | AnalysisJob["status"];
  arousal?: number | null;
  beatEditability?: number | null;
  bpm?: number | null;
  cinematicScore: number | null;
  cinematicStyles?: string[];
  confidence?: number | null;
  cuePoints?: Record<string, number> | null;
  dialogueFriendly?: number | null;
  endingQuality?: number | null;
  epicness?: number | null;
  durationMs: number | null;
  features?: DeterministicFeatures | null;
  format: string;
  id: string;
  instrumentation?: string[];
  intimacy?: number | null;
  loopability?: number | null;
  manualPrimaryEmotion: string | null;
  montageFriendly?: number | null;
  musicalKey?: string | null;
  musicalMode?: string | null;
  narrativeFunctions?: string[];
  notRecommendedScenes?: string[];
  originalFilename?: string;
  primaryEmotion: string | null;
  recommendedScenes?: string[];
  scale?: number | null;
  secondaryEmotions?: string[];
  segments?: MusicSegment[];
  summary?: string | null;
  tension?: number | null;
  textures?: string[];
  title: string;
  trajectory?: string | null;
  valence?: number | null;
}

export interface MusicSegment {
  description: string;
  endMs: number;
  energy: number | null;
  startMs: number;
  tension: number | null;
  type: string;
}

export interface DeterministicFeatures {
  beatPositions: number[] | null;
  bpm: number | null;
  dynamicRange: number | null;
  energyCurve: number[] | null;
  extractor: string;
  musicalKey: string | null;
  loudness: number | null;
  musicalMode: string | null;
}

export interface AudioWaveform {
  durationMs: number | null;
  peaks: number[];
  sampleRate: number;
}

export interface FeishuStatus {
  canCreate: boolean;
  configured: boolean;
  failed: number;
  lastSyncedAt: string | null;
  libraryUrl: string | null;
  synced: number;
}

export interface FeishuExportResult {
  appToken: string;
  created: number;
  failed: number;
  libraryUrl: string;
  skipped: number;
  tableId: string;
  updated: number;
}

export interface MusicListResponse {
  items: MusicTrack[];
  total: number;
}

export interface ImportSessionSnapshot {
  counts: {
    completed: number;
    duplicate: number;
    failed: number;
    imported: number;
    pending: number;
    total: number;
    uploading: number;
  };
  files?: Array<{ clientId: string; errorMessage: string | null; name: string; status: string }>;
  id: string;
  status: string;
}

export interface MusicFilters {
  cinematicStyle: string;
  minCinematicScore: string;
  minDialogueFriendly: string;
  narrative: string;
  primaryEmotion: string;
  search: string;
  status: string;
  trajectory: string;
}

export class MusicApi {
  constructor(private readonly baseUrl: string) {}

  async listMusic(filters: MusicFilters, page: { limit: number; offset: number }) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) {
      if (value) query.set(name, value);
    }
    query.set("limit", String(page.limit));
    query.set("offset", String(page.offset));
    return this.request<MusicListResponse>(`/music${query.size ? `?${query}` : ""}`);
  }

  async getMusic(trackId: string) {
    return this.request<MusicTrack>(`/music/${trackId}`);
  }

  async listJobs() {
    return this.request<AnalysisJob[]>("/analysis-jobs");
  }

  async importFiles(files: File[], onProgress: (snapshot: ImportSessionSnapshot) => void) {
    const session = await this.request<ImportSessionSnapshot>("/import-sessions", {
      method: "POST"
    });
    const manifest = await this.request<ImportSessionSnapshot>(
      `/import-sessions/${session.id}/manifest`,
      {
        body: JSON.stringify({
          files: files.map((file, index) => ({
            clientId: `upload-${index}`,
            name: file.name,
            size: file.size
          }))
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
    onProgress(manifest);

    const events = this.observeImportSession(session.id, onProgress);
    try {
      for (const [index, file] of files.entries()) {
        const body = new FormData();
        body.append("audio", file);
        await this.request<{
          duplicateOf?: string;
          kind: "DUPLICATE" | "IMPORTED";
          trackId?: string;
        }>(`/import-sessions/${session.id}/files/upload-${index}`, { body, method: "POST" });
        onProgress(await this.getImportSession(session.id));
      }
      return await this.getImportSession(session.id);
    } finally {
      events?.close();
    }
  }

  async getImportSession(sessionId: string) {
    return this.request<ImportSessionSnapshot>(`/import-jobs/${sessionId}`);
  }

  async retry(jobId: string) {
    return this.request<{ id: string; status: AnalysisJob["status"] }>(
      `/analysis-jobs/${jobId}/retry`,
      { method: "POST" }
    );
  }

  async deleteMusic(trackId: string) {
    return this.request<void>(`/music/${trackId}`, { method: "DELETE" });
  }

  async analyze(trackId: string) {
    return this.request<{ id: string; status: AnalysisJob["status"] }>(
      `/music/${trackId}/analyze`,
      {
        method: "POST"
      }
    );
  }

  async batchAnalyze(trackIds?: string[]) {
    return this.request<{ jobs: AnalysisJob[]; queued: number; skipped: number }>(
      "/music/batch-analyze",
      {
        body: JSON.stringify(trackIds ? { trackIds } : {}),
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
  }

  async feishuStatus() {
    return this.request<FeishuStatus>("/feishu/status");
  }

  async exportFeishu() {
    return this.request<FeishuExportResult>("/feishu/export", { method: "POST" });
  }

  async createFeishuLibrary(name?: string) {
    return this.request<{ appToken: string; tableId: string }>("/feishu/library", {
      body: JSON.stringify(name ? { name } : {}),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
  }

  async syncFeishu(trackIds?: string[]) {
    return this.request<{ created: number; failed: number; skipped: number; updated: number }>(
      "/feishu/sync",
      {
        body: JSON.stringify(trackIds ? { trackIds } : {}),
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
  }

  async updateTrack(
    trackId: string,
    patch: { manualPrimaryEmotion?: string | null; title?: string }
  ) {
    return this.request<MusicTrack>(`/music/${trackId}`, {
      body: JSON.stringify(patch),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });
  }

  audioUrl(trackId: string) {
    return `${this.baseUrl}/music/${trackId}/audio`;
  }

  async waveform(trackId: string) {
    return this.request<AudioWaveform>(`/music/${trackId}/waveform`);
  }

  private observeImportSession(
    sessionId: string,
    onProgress: (snapshot: ImportSessionSnapshot) => void
  ) {
    if (typeof EventSource === "undefined") return undefined;
    const events = new EventSource(`${this.baseUrl}/import-jobs/${sessionId}/events`);
    events.addEventListener("progress", (event) => {
      try {
        onProgress(JSON.parse((event as MessageEvent<string>).data) as ImportSessionSnapshot);
      } catch {
        // Ignore malformed transient events; the final HTTP snapshot remains authoritative.
      }
    });
    return events;
  }

  private async request<T>(path: string, init?: RequestInit) {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `请求失败（${response.status}）`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
