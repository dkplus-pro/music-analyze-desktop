import { useEffect, useMemo, useRef, useState } from "react";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";

import { MusicApi, type ImportSessionSnapshot, type MusicFilters, type MusicTrack } from "./api";
import { useInterfaceStore } from "./store";

const emotionOptions = [
  "Calm",
  "Warm",
  "Hopeful",
  "Nostalgic",
  "Melancholic",
  "Sad",
  "Tense",
  "Dark",
  "Epic",
  "Dreamy"
];
const pageSize = 25;

export function App({ apiBaseUrl = "/api" }: { apiBaseUrl?: string }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <MusicLibrary apiBaseUrl={apiBaseUrl} />
    </QueryClientProvider>
  );
}

function MusicLibrary({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new MusicApi(apiBaseUrl), [apiBaseUrl]);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [emotion, setEmotion] = useState("");
  const [narrative, setNarrative] = useState("");
  const [cinematicStyle, setCinematicStyle] = useState("");
  const [minCinematicScore, setMinCinematicScore] = useState("");
  const [minDialogueFriendly, setMinDialogueFriendly] = useState("");
  const [status, setStatus] = useState("");
  const [trajectory, setTrajectory] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportedLibraryUrl, setExportedLibraryUrl] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportSessionSnapshot | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTrackId = useInterfaceStore((state) => state.selectedTrackId);
  const setSelectedTrackId = useInterfaceStore((state) => state.setSelectedTrackId);
  const importPanelOpen = useInterfaceStore((state) => state.importPanelOpen);
  const setImportPanelOpen = useInterfaceStore((state) => state.setImportPanelOpen);

  const filters: MusicFilters = {
    cinematicStyle,
    minCinematicScore,
    minDialogueFriendly,
    narrative,
    primaryEmotion: emotion,
    search,
    status,
    trajectory
  };
  useEffect(() => {
    setPage(1);
  }, [
    cinematicStyle,
    emotion,
    minCinematicScore,
    minDialogueFriendly,
    narrative,
    search,
    status,
    trajectory
  ]);
  const musicQuery = useQuery({
    queryFn: () => api.listMusic(filters, { limit: pageSize, offset: (page - 1) * pageSize }),
    queryKey: ["music", filters, page],
    refetchInterval: (query) =>
      query.state.data?.items.some((track) => hasActiveAnalysis(track.analysisStatus))
        ? 2_000
        : false
  });
  useQuery({
    queryFn: () => api.listJobs(),
    queryKey: ["analysis-jobs"],
    refetchInterval: (query) =>
      query.state.data?.some((job) => hasActiveAnalysis(job.status)) ? 2_000 : false
  });
  const feishuQuery = useQuery({
    queryFn: () => api.feishuStatus(),
    queryKey: ["feishu-status"]
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["music"] }),
      queryClient.invalidateQueries({ queryKey: ["analysis-jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["feishu-status"] })
    ]);
  };

  const analyzeMutation = useMutation({
    mutationFn: api.analyze.bind(api),
    onError: (error) => setNotice(error instanceof Error ? error.message : "分析任务创建失败"),
    onSuccess: async () => {
      setNotice("分析任务已加入队列。");
      await refresh();
    }
  });
  const batchAnalyzeMutation = useMutation({
    mutationFn: () => api.batchAnalyze(tracks.map((track) => track.id)),
    onError: (error) => setNotice(error instanceof Error ? error.message : "批量分析任务创建失败"),
    onSuccess: async (result) => {
      setNotice(
        result.skipped > 0
          ? `已将 ${result.queued} 首未完成音乐加入队列；已跳过 ${result.skipped} 首。`
          : `已将 ${result.queued} 首音乐加入分析队列。`
      );
      await refresh();
    }
  });
  const feishuExportMutation = useMutation({
    mutationFn: () => api.exportFeishu(),
    onError: (error) => setNotice(error instanceof Error ? error.message : "飞书导出失败"),
    onSuccess: async (result) => {
      setExportedLibraryUrl(result.libraryUrl);
      setNotice(
        `飞书导出完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}。`
      );
      await refresh();
    }
  });
  const retryMutation = useMutation({
    mutationFn: api.retry.bind(api),
    onError: (error) => setNotice(error instanceof Error ? error.message : "分析重试失败"),
    onSuccess: async () => {
      setNotice("分析任务已重新加入队列。");
      await refresh();
    }
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteMusic.bind(api),
    onError: (error) => setNotice(error instanceof Error ? error.message : "删除音乐失败"),
    onSuccess: async () => {
      setNotice("音乐已删除。");
      await refresh();
    }
  });
  const importMutation = useMutation({
    mutationFn: (files: File[]) => api.importFiles(files, setImportProgress),
    onError: (error) => setNotice(error instanceof Error ? error.message : "导入失败"),
    onSuccess: async (result) => {
      setNotice(
        result.counts.duplicate > 0 && result.counts.imported === 0
          ? "已存在：该音乐的内容哈希已在资料库中。"
          : "已导入并提交分析，完成后会自动清理音频文件。"
      );
      await refresh();
    }
  });

  const tracks = musicQuery.data?.items ?? [];
  const libraryUrl = exportedLibraryUrl ?? feishuQuery.data?.libraryUrl;
  const totalPages = Math.max(1, Math.ceil((musicQuery.data?.total ?? 0) / pageSize));
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? null;
  const importFiles = (files: FileList | null) => {
    const audioFiles = Array.from(files ?? []).filter(isSupportedAudioFile);
    if (audioFiles.length === 0) {
      setNotice("未找到可导入的音频文件。支持 MP3、WAV、FLAC、M4A、AAC、OGG。");
      return;
    }
    importMutation.mutate(audioFiles);
  };

  return (
    <main className="workstation">
      <aside className="rail" aria-label="主导航">
        <div className="mark" aria-hidden="true">
          AM
        </div>
        <div className="rail-line" />
        <p className="rail-label">
          CUE
          <br />
          LIBRARY
        </p>
        <p className="rail-foot">
          LOCAL
          <br />
          01—V1
        </p>
      </aside>

      <section className="content">
        <header className="masthead">
          <div>
            <p className="overline">Cinematic audio catalog / local workstation</p>
            <h1>音乐管理</h1>
          </div>
          <div className="system-light">
            <span />
            服务在线
          </div>
        </header>

        <section className="control-deck" aria-label="音乐筛选和导入">
          <label className="search-field">
            <span>检索</span>
            <input
              aria-label="搜索音乐"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="名称、文件名、情绪…"
            />
          </label>
          <label className="select-field">
            <span>情绪</span>
            <select
              aria-label="按情绪筛选"
              value={emotion}
              onChange={(event) => setEmotion(event.target.value)}
            >
              <option value="">全部</option>
              {emotionOptions.map((option) => (
                <option key={option} value={option}>
                  {toChinese(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>叙事功能</span>
            <select
              aria-label="按叙事筛选"
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
            >
              <option value="">全部</option>
              {narrativeOptions.map((option) => (
                <option key={option} value={option}>
                  {toChinese(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>电影风格</span>
            <select
              aria-label="按电影风格筛选"
              value={cinematicStyle}
              onChange={(event) => setCinematicStyle(event.target.value)}
            >
              <option value="">全部</option>
              {cinematicStyleOptions.map((option) => (
                <option key={option} value={option}>
                  {toChinese(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>分析状态</span>
            <select
              aria-label="按分析状态筛选"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部</option>
              <option value="NONE">未分析</option>
              <option value="QUEUED">排队中</option>
              <option value="COMPLETED">已完成</option>
              <option value="FAILED">失败</option>
            </select>
          </label>
          <div className="control-actions">
            <button
              className="outline-button"
              disabled={tracks.length === 0 || batchAnalyzeMutation.isPending}
              type="button"
              onClick={() => batchAnalyzeMutation.mutate()}
            >
              批量分析
            </button>
            <button
              className="outline-button"
              disabled={
                feishuExportMutation.isPending ||
                (!feishuQuery.data?.configured && !feishuQuery.data?.canCreate)
              }
              title={
                feishuQuery.data?.configured
                  ? "将变更的音乐增量导出到飞书"
                  : feishuQuery.data?.canCreate
                    ? "首次导出会创建飞书多维表格"
                    : "请先在本地 .env 配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET"
              }
              type="button"
              onClick={() => feishuExportMutation.mutate()}
            >
              导出飞书
            </button>
            <button
              className="solid-button"
              type="button"
              onClick={() => setImportPanelOpen(!importPanelOpen)}
            >
              导入音乐
            </button>
          </div>
        </section>

        <p className="feishu-state">
          飞书：
          {feishuQuery.data?.configured
            ? `已连接 · 已同步 ${feishuQuery.data.synced} 首${feishuQuery.data.lastSyncedAt ? ` · 最近 ${formatDate(feishuQuery.data.lastSyncedAt)}` : ""}`
            : feishuQuery.data?.canCreate
              ? "已配置凭证，首次导出将创建多维表格"
              : "未配置（本地资料库仍可正常使用）"}
          {libraryUrl ? (
            <a href={libraryUrl} rel="noreferrer" target="_blank">
              打开飞书多维表格
            </a>
          ) : null}
        </p>

        <section className="advanced-filters" aria-label="剪辑筛选">
          <span>剪辑筛选</span>
          <label className="select-field">
            <span>最低电影感</span>
            <select
              aria-label="最低电影感"
              value={minCinematicScore}
              onChange={(event) => setMinCinematicScore(event.target.value)}
            >
              <option value="">不限</option>
              {scoreThresholds.map((score) => (
                <option key={score} value={score}>
                  {score}+
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>最低对白友好</span>
            <select
              aria-label="最低对白友好"
              value={minDialogueFriendly}
              onChange={(event) => setMinDialogueFriendly(event.target.value)}
            >
              <option value="">不限</option>
              {scoreThresholds.map((score) => (
                <option key={score} value={score}>
                  {score}+
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>发展轨迹</span>
            <select
              aria-label="按发展轨迹筛选"
              value={trajectory}
              onChange={(event) => setTrajectory(event.target.value)}
            >
              <option value="">全部</option>
              {trajectoryOptions.map((option) => (
                <option key={option} value={option}>
                  {toChinese(option)}
                </option>
              ))}
            </select>
          </label>
        </section>

        {importPanelOpen ? (
          <section className="import-panel" aria-label="导入音乐面板">
            <div>
              <p className="overline">Managed import</p>
              <h2>将声音带入资料库</h2>
              <p>
                支持 MP3、WAV、FLAC、M4A、AAC、OGG。系统仅在分析期间临时保存文件，完成后自动清理。
              </p>
            </div>
            <div className="import-actions">
              <label className="file-drop">
                <input
                  aria-label="导入音频"
                  accept={audioAccept}
                  multiple
                  type="file"
                  onChange={(event) => {
                    importFiles(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
                <span>选择音频文件</span>
                <small>拖入或选择一个或多个文件</small>
              </label>
              <input
                accept={audioAccept}
                aria-label="导入音频文件夹"
                className="visually-hidden"
                multiple
                ref={(node) => {
                  folderInputRef.current = node;
                  if (node) {
                    node.setAttribute("directory", "");
                    node.setAttribute("webkitdirectory", "");
                  }
                }}
                type="file"
                onChange={(event) => {
                  importFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <button
                className="folder-button"
                type="button"
                onClick={() => folderInputRef.current?.click()}
              >
                选择文件夹
              </button>
            </div>
          </section>
        ) : null}

        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        {importProgress ? <ImportProgress snapshot={importProgress} /> : null}

        <section className="library" aria-label="音乐资料库">
          <div className="library-head">
            <span>资料库</span>
            <strong>
              {musicQuery.data?.total ?? 0} 个音轨 · 每页 {pageSize} 首
            </strong>
          </div>
          {musicQuery.isError ? (
            <p className="error-message">{errorMessage(musicQuery.error)}</p>
          ) : null}
          <div className="track-scroll">
            <div className="track-table" role="table" aria-label="音乐列表">
              <div className="track-row table-labels" role="row">
                <span>音轨</span>
                <span>时长</span>
                <span>速度 / 调性</span>
                <span>情绪 / 叙事</span>
                <span>电影感</span>
                <span>发展轨迹</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {tracks.map((track, index) => (
                <TrackRow
                  key={track.id}
                  deleting={deleteMutation.isPending}
                  index={(page - 1) * pageSize + index + 1}
                  onAnalyze={() => analyzeMutation.mutate(track.id)}
                  onDelete={() => {
                    if (window.confirm(`确定删除“${track.title}”吗？此操作会同时删除关联数据。`)) {
                      deleteMutation.mutate(track.id);
                    }
                  }}
                  onRetry={
                    track.analysisJobId
                      ? () => retryMutation.mutate(track.analysisJobId!)
                      : undefined
                  }
                  onSelect={() => setSelectedTrackId(track.id)}
                  retrying={retryMutation.isPending}
                  track={track}
                />
              ))}
              {!musicQuery.isLoading && tracks.length === 0 ? (
                <p className="empty-state">尚未导入音乐。选择文件后，资料库会在这里生长。</p>
              ) : null}
            </div>
          </div>
          <nav className="pagination" aria-label="音乐分页">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div>
              <button
                disabled={page === 1}
                type="button"
                onClick={() => setPage((value) => value - 1)}
              >
                上一页
              </button>
              <button
                disabled={page >= totalPages}
                type="button"
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </div>
          </nav>
        </section>
      </section>

      <TrackInspector api={api} onClose={() => setSelectedTrackId(null)} track={selectedTrack} />
    </main>
  );
}

function TrackRow({
  deleting,
  index,
  onAnalyze,
  onDelete,
  onRetry,
  onSelect,
  retrying,
  track
}: {
  deleting: boolean;
  index: number;
  onAnalyze: () => void;
  onDelete: () => void;
  onRetry?: () => void;
  onSelect: () => void;
  retrying: boolean;
  track: MusicTrack;
}) {
  const emotion = toChinese(track.manualPrimaryEmotion ?? track.primaryEmotion ?? "—");
  return (
    <div className="track-row" role="row">
      <button className="track-name" type="button" onClick={onSelect}>
        <em>{String(index).padStart(2, "0")}</em>
        <span>
          {track.title}
          <small>{formatAudioFormat(track.format)}</small>
        </span>
      </button>
      <span>{formatDuration(track.durationMs)}</span>
      <span>
        <b>{formatBpm(track.bpm)}</b>
        <small>{formatKey(track.musicalKey, track.musicalMode)}</small>
      </span>
      <span>
        <b>{emotion}</b>
        <small>{translateValues(track.narrativeFunctions) || "等待分析"}</small>
      </span>
      <span className="score">{formatScore(track.cinematicScore)}</span>
      <span>
        <small>{toChinese(track.trajectory ?? "等待分析")}</small>
      </span>
      <span>
        <StatusBadge status={track.analysisStatus} />
      </span>
      <span className="row-actions">
        {track.analysisStatus === "COMPLETED" ? (
          <span className="row-complete">已分析</span>
        ) : track.analysisStatus === "FAILED" ? (
          <>
            {track.analysisError ? (
              <small className="failure-reason">失败原因：{track.analysisError}</small>
            ) : null}
            <button disabled={!onRetry || retrying} type="button" onClick={onRetry}>
              重试分析
            </button>
          </>
        ) : hasActiveAnalysis(track.analysisStatus) ? (
          <span className="row-complete">分析中</span>
        ) : (
          <button type="button" onClick={onAnalyze}>
            开始分析
          </button>
        )}
        <button
          className="delete-music-button"
          disabled={deleting || hasActiveAnalysis(track.analysisStatus)}
          type="button"
          onClick={onDelete}
        >
          删除音乐
        </button>
      </span>
    </div>
  );
}

function ImportProgress({ snapshot }: { snapshot: ImportSessionSnapshot }) {
  const percentage =
    snapshot.counts.total === 0
      ? 0
      : Math.round((snapshot.counts.completed / snapshot.counts.total) * 100);
  return (
    <section className="import-progress" aria-label="导入进度">
      <div>
        <span>导入音乐</span>
        <strong>{percentage}%</strong>
      </div>
      <div
        aria-valuemax={snapshot.counts.total}
        aria-valuemin={0}
        aria-valuenow={snapshot.counts.completed}
        className="progress-bar"
        role="progressbar"
      >
        <i style={{ width: `${percentage}%` }} />
      </div>
      <p>
        {snapshot.counts.completed} / {snapshot.counts.total} · 已导入 {snapshot.counts.imported} ·
        已跳过 {snapshot.counts.duplicate} · 失败 {snapshot.counts.failed}
      </p>
      {snapshot.files?.length ? (
        <ul className="import-file-list">
          {snapshot.files.slice(-4).map((file) => (
            <li key={file.clientId}>
              <span>
                {file.status === "IMPORTED" || file.status === "DUPLICATE"
                  ? "✓"
                  : file.status === "FAILED"
                    ? "×"
                    : "⟳"}
              </span>
              {file.name}
              <small>{file.errorMessage ?? file.status}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TrackInspector({
  api,
  onClose,
  track
}: {
  api: MusicApi;
  onClose: () => void;
  track: MusicTrack | null;
}) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: ({ id, primaryEmotion }: { id: string; primaryEmotion: string }) =>
      api.updateTrack(id, { manualPrimaryEmotion: primaryEmotion }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["music"] })
  });
  const detailsQuery = useQuery({
    enabled: track !== null,
    queryFn: async () => {
      if (!track) throw new Error("No music track selected");
      return api.getMusic(track.id);
    },
    queryKey: ["music-detail", track?.id]
  });
  useEffect(() => {
    if (!track) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [track]);
  if (!track) return null;
  const details = detailsQuery.data ?? track;
  return (
    <div className="inspector-layer">
      <aside aria-label="音轨详情" aria-modal="true" className="inspector" role="dialog">
        <header className="inspector-head">
          <div>
            <p className="overline">音乐详情 / {formatAudioFormat(details.format)}</p>
            <h2>{details.title}</h2>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="关闭详情">
            ×
          </button>
        </header>
        <dl>
          <DetailField label="分析状态" value={statusLabel(details.analysisStatus)} />
          {details.analysisError ? (
            <DetailField label="失败原因" value={details.analysisError} />
          ) : null}
          <DetailField label="音频格式" value={formatAudioFormat(details.format)} />
          <DetailField label="时长" value={formatDuration(details.durationMs)} />
          <DetailField
            label="速度 / 调性"
            value={`${formatBpm(details.bpm)} · ${formatKey(details.musicalKey, details.musicalMode)}`}
          />
          <DetailField
            label="主情绪"
            value={toChinese(details.manualPrimaryEmotion ?? details.primaryEmotion ?? "尚未分析")}
          />
          <DetailField label="次要情绪" value={translateValues(details.secondaryEmotions)} />
          <DetailField label="叙事功能" value={translateValues(details.narrativeFunctions)} />
          <DetailField label="电影风格" value={translateValues(details.cinematicStyles)} />
          <DetailField label="电影感评分" value={formatScore(details.cinematicScore)} />
          <DetailField label="发展轨迹" value={toChinese(details.trajectory ?? "—")} />
          <DetailField label="乐器编制" value={translateValues(details.instrumentation)} />
          <DetailField label="音色质感" value={translateValues(details.textures)} />
          <DetailField label="推荐场景" value={translateValues(details.recommendedScenes)} />
          <DetailField label="不推荐场景" value={translateValues(details.notRecommendedScenes)} />
          <DetailField label="对白适配度" value={formatScore(details.dialogueFriendly)} />
          <DetailField label="蒙太奇适配度" value={formatScore(details.montageFriendly)} />
          <DetailField label="节拍剪辑适配度" value={formatScore(details.beatEditability)} />
          <DetailField label="循环适配度" value={formatScore(details.loopability)} />
          <DetailField label="结尾质量" value={formatScore(details.endingQuality)} />
          <DetailField label="紧张度" value={formatScore(details.tension)} />
          <DetailField label="唤醒度" value={formatScore(details.arousal)} />
          <DetailField label="史诗感" value={formatScore(details.epicness)} />
          <DetailField label="亲密感" value={formatScore(details.intimacy)} />
          <DetailField label="情绪正负向" value={formatSignedScore(details.valence, 5)} />
          <DetailField label="分析置信度" value={formatConfidence(details.confidence)} />
          <DetailField label="提示点" value={formatCuePoints(details.cuePoints)} />
          <DetailField
            label="响度"
            value={
              details.features?.loudness === null || details.features?.loudness === undefined
                ? "—"
                : `${details.features.loudness} 分贝`
            }
          />
          <DetailField
            label="动态范围"
            value={
              details.features?.dynamicRange === null ||
              details.features?.dynamicRange === undefined
                ? "—"
                : `${details.features.dynamicRange} 分贝`
            }
          />
          <DetailField
            label="节拍点数量"
            value={
              details.features?.beatPositions ? `${details.features.beatPositions.length} 个` : "—"
            }
          />
          <DetailField
            label="能量窗口数"
            value={
              details.features?.energyCurve ? `${details.features.energyCurve.length} 个` : "—"
            }
          />
        </dl>
        <section className="analysis-copy" aria-label="分析内容">
          <p className="analysis-summary">分析摘要：{formatAnalysisSummary(details)}</p>
          {details.segments?.length ? (
            <section className="analysis-segments" aria-label="音乐结构分段">
              <h3>音乐结构分析</h3>
              {details.segments.map((segment) => (
                <p key={`${segment.type}-${segment.startMs}`}>{formatSegmentAnalysis(segment)}</p>
              ))}
            </section>
          ) : null}
        </section>
        <label className="select-field edit-field">
          <span>人工主情绪覆盖</span>
          <select
            aria-label="人工主情绪覆盖"
            defaultValue={details.manualPrimaryEmotion ?? ""}
            onChange={(event) => {
              if (event.target.value)
                updateMutation.mutate({ id: details.id, primaryEmotion: event.target.value });
            }}
          >
            <option value="">使用 AI 判断</option>
            {emotionOptions.map((option) => (
              <option key={option} value={option}>
                {toChinese(option)}
              </option>
            ))}
          </select>
        </label>
      </aside>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: MusicTrack["analysisStatus"] }) {
  return <span className={`status status-${status.toLowerCase()}`}>{statusLabel(status)}</span>;
}

function statusLabel(status: MusicTrack["analysisStatus"]) {
  const labels: Record<MusicTrack["analysisStatus"], string> = {
    AI_ANALYZING: "分析中",
    COMPLETED: "已完成",
    EXTRACTING: "提取中",
    FAILED: "失败",
    NONE: "未分析",
    QUEUED: "队列中",
    VALIDATING: "校验中"
  };
  return labels[status];
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null || milliseconds === undefined) return "—";
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatBpm(bpm: number | null | undefined) {
  return bpm ? `${Math.round(bpm)} BPM` : "—";
}

function formatScore(score: number | null | undefined) {
  return score ? `${score} / 10 分` : "—";
}

function formatSignedScore(score: number | null | undefined, maximum: number) {
  return score === null || score === undefined
    ? "—"
    : `${score > 0 ? "+" : ""}${score} / ${maximum}`;
}

function formatConfidence(confidence: number | null | undefined) {
  return confidence === null || confidence === undefined ? "—" : `${Math.round(confidence * 100)}%`;
}

function formatKey(key: string | null | undefined, mode: string | null | undefined) {
  if (!key && !mode) return "等待提取";
  return `${toChinese(key ?? "—")} ${toChinese(mode ?? "")}`.trim();
}

function formatAudioFormat(format: string) {
  return toChinese(format.toLowerCase());
}

function translateValues(values: string[] | undefined) {
  return values?.map(toChinese).join(" / ") ?? "—";
}

function formatCuePoints(cuePoints: MusicTrack["cuePoints"]) {
  if (!cuePoints || Object.keys(cuePoints).length === 0) return "—";
  return Object.entries(cuePoints)
    .map(([name, milliseconds]) => `${toChinese(name)} ${formatDuration(milliseconds)}`)
    .join(" / ");
}

function formatAnalysisSummary(track: MusicTrack) {
  const emotion = toChinese(track.manualPrimaryEmotion ?? track.primaryEmotion ?? "平静");
  const trajectory = toChinese(track.trajectory ?? "平稳");
  const narrative = translateValues(track.narrativeFunctions);
  const instruments = translateValues(track.instrumentation);
  const scenes = translateValues(track.recommendedScenes);
  const style = translateValues(track.cinematicStyles);
  return `这是一首以${emotion}为主情绪、${trajectory}发展的音乐。叙事功能侧重${narrative}，以${instruments}为主；适合${scenes}等场景，呈现${style}风格。`;
}

function formatSegmentAnalysis(segment: NonNullable<MusicTrack["segments"]>[number]) {
  const measurements = [
    segment.energy === null || segment.energy === undefined ? "" : `能量 ${segment.energy} 分`,
    segment.tension === null || segment.tension === undefined ? "" : `紧张度 ${segment.tension} 分`
  ].filter(Boolean);
  return `${toChinese(segment.type)}阶段，从 ${formatDuration(segment.startMs)} 至 ${formatDuration(segment.endMs)}。${measurements.length ? `${measurements.join("，")}。` : ""}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "无法读取音乐资料库";
}

function hasActiveAnalysis(status: MusicTrack["analysisStatus"] | "NONE") {
  return (
    status === "QUEUED" ||
    status === "EXTRACTING" ||
    status === "AI_ANALYZING" ||
    status === "VALIDATING"
  );
}

function toChinese(value: string) {
  return chineseLabels[value] ?? value;
}

const chineseLabels: Record<string, string> = {
  "Acoustic Guitar": "原声吉他",
  "Ambient Cinematic": "氛围电影感",
  "Ambient Pad": "氛围铺底",
  "Build → Climax": "渐强至高潮",
  "Build → Climax → Resolve": "渐强至高潮再舒缓",
  "C#": "升 C",
  "D#": "升 D",
  "F#": "升 F",
  "G#": "升 G",
  "A#": "升 A",
  AAC: "AAC 音频",
  aac: "AAC 音频",
  Atmosphere: "氛围铺陈",
  Bass: "贝斯",
  Brass: "铜管",
  Bright: "明亮",
  Build: "推进",
  Calm: "平静",
  Cello: "大提琴",
  Choir: "人声合唱",
  Climax: "高潮",
  Clean: "清晰",
  Cold: "冷峻",
  Connection: "连接",
  Conflict: "冲突",
  "Continuous Fall": "持续回落",
  "Continuous Rise": "持续上扬",
  Dark: "黑暗",
  "Dark Cinematic": "黑暗电影感",
  Dense: "浓密",
  Discovery: "发现",
  Documentary: "纪录片",
  Drama: "剧情电影",
  Drums: "鼓组",
  Dreamy: "梦幻",
  "Drop → Rebuild": "骤降再重建",
  Electric: "电声",
  "Electric Guitar": "电吉他",
  Emotional: "情感",
  "Emotional Cinematic": "情感电影感",
  Ending: "收尾",
  Epic: "史诗",
  "Epic Cinematic": "史诗电影感",
  Ethereal: "空灵",
  Flat: "平稳",
  FLAC: "FLAC 音频",
  flac: "FLAC 音频",
  "Fast Build": "快速渐强",
  Harsh: "尖锐",
  Hopeful: "希望",
  Hybrid: "混合",
  "Hybrid Cinematic": "混合电影感",
  Intimate: "亲密",
  Intro: "引子",
  Inspiring: "振奋",
  Joyful: "欢快",
  Loss: "失落",
  Lonely: "孤独",
  M4A: "M4A 音频",
  Melancholic: "忧郁",
  Memory: "记忆",
  Minimal: "极简",
  "Minimal Cinematic": "极简电影感",
  minor: "小调",
  major: "大调",
  Montage: "蒙太奇",
  MP3: "MP3 音频",
  mp3: "MP3 音频",
  m4a: "M4A 音频",
  Mysterious: "神秘",
  "Multiple Peaks": "多重高潮",
  "Neo-Classical": "新古典",
  Nostalgic: "怀旧",
  OGG: "OGG 音频",
  ogg: "OGG 音频",
  Opening: "开场",
  Oppressive: "压迫",
  Organic: "自然",
  "Orchestral Cinematic": "管弦电影感",
  Outro: "尾奏",
  Percussion: "打击乐",
  Piano: "钢琴",
  Powerful: "力量感",
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
  Soft: "柔和",
  "Sound Design": "音效设计",
  Soundscape: "声音景观",
  Spacious: "开阔",
  Strings: "弦乐",
  Suspense: "悬念",
  "Suspense Cinematic": "悬念电影感",
  Suspenseful: "悬疑",
  Synth: "合成器",
  Synthetic: "合成",
  Tense: "紧张",
  Tension: "张力",
  Theme: "主题",
  Trailer: "预告片",
  Triumphant: "凯旋",
  Triumph: "胜利",
  Violin: "小提琴",
  Warm: "温暖",
  WAV: "WAV 音频",
  wav: "WAV 音频",
  Wave: "波浪式起伏",
  Wonder: "惊奇",
  Woodwinds: "木管",
  beatEditability: "节拍剪辑点",
  buildStartMs: "推进开始",
  climaxStartMs: "高潮开始",
  dropMs: "骤降点",
  introEndMs: "引子结束",
  outroStartMs: "尾奏开始",
  peakMs: "峰值点",
  themeStartMs: "主题开始",
  人物回忆: "人物回忆",
  人物独处: "人物独处",
  公路: "公路",
  冲突: "冲突",
  分别: "分别",
  危机: "危机",
  发现: "发现",
  品牌片: "品牌片",
  城市空镜: "城市空镜",
  成长: "成长",
  悬疑: "悬疑",
  战争: "战争",
  探索: "探索",
  旅途: "旅途",
  爱情: "爱情",
  纪录片: "纪录片",
  自然风景: "自然风景",
  调查: "调查",
  采访: "采访",
  追逐: "追逐",
  结尾: "结尾",
  胜利: "胜利"
};

const audioAccept =
  "audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/aac,audio/ogg,.mp3,.wav,.flac,.m4a,.aac,.ogg";
const supportedAudioExtensions = new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg"]);
const narrativeOptions = [
  "Opening",
  "Atmosphere",
  "Discovery",
  "Wonder",
  "Reflection",
  "Memory",
  "Connection",
  "Romance",
  "Build",
  "Suspense",
  "Tension",
  "Conflict",
  "Reveal",
  "Loss",
  "Climax",
  "Triumph",
  "Resolution",
  "Ending"
];
const cinematicStyleOptions = [
  "Minimal Cinematic",
  "Emotional Cinematic",
  "Ambient Cinematic",
  "Orchestral Cinematic",
  "Hybrid Cinematic",
  "Epic Cinematic",
  "Dark Cinematic",
  "Suspense Cinematic",
  "Documentary",
  "Drama",
  "Neo-Classical",
  "Trailer",
  "Soundscape"
];
const trajectoryOptions = [
  "Flat",
  "Slow Build",
  "Fast Build",
  "Build → Climax",
  "Build → Climax → Resolve",
  "Wave",
  "Multiple Peaks",
  "Drop → Rebuild",
  "Continuous Rise",
  "Continuous Fall"
];
const scoreThresholds = [5, 7, 8, 9];

function isSupportedAudioFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension !== undefined && supportedAudioExtensions.has(extension);
}
