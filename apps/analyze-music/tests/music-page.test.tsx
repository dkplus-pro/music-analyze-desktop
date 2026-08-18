import { createServer, type Server } from "node:http";
import { act } from "react";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../src/App";

let server: Server;
let apiBaseUrl: string;
const receivedRequests: Array<{ method?: string; pathname: string }> = [];
const musicQueries: string[] = [];
const track = {
  analysisError: "临时分析服务不可用",
  analysisJobId: "job-1",
  analysisStatus: "FAILED",
  cinematicScore: 8,
  cinematicStyles: ["Drama"],
  durationMs: 156000,
  features: {
    beatPositions: [0, 1],
    bpm: 88,
    dynamicRange: 12,
    energyCurve: [0.1, 0.8],
    extractor: "librosa",
    loudness: -16,
    musicalKey: "C",
    musicalMode: "major"
  },
  format: "mp3",
  id: "track-1",
  instrumentation: ["Piano", "Strings"],
  narrativeFunctions: ["Memory"],
  primaryEmotion: "Nostalgic",
  recommendedScenes: ["人物回忆"],
  secondaryEmotions: ["Warm"],
  segments: [
    {
      description: "Piano opening",
      endMs: 20_000,
      energy: 3,
      startMs: 0,
      tension: 2,
      type: "Intro"
    }
  ],
  summary: "Warm piano memory cue",
  sourcePath: "/music/remember-me.mp3",
  textures: ["Warm", "Intimate"],
  title: "Remember Me",
  trajectory: "Slow Build"
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    receivedRequests.push({ method: request.method, pathname: url.pathname });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/music") {
      musicQueries.push(url.search);
      response.end(
        JSON.stringify({
          items: [track],
          total: 26
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/music/track-1") {
      response.end(JSON.stringify(track));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/analysis-jobs") {
      response.end(JSON.stringify([{ id: "job-1", status: "FAILED", trackId: "track-1" }]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/feishu/status") {
      response.end(
        JSON.stringify({
          canCreate: false,
          configured: true,
          failed: 0,
          lastSyncedAt: null,
          libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music",
          synced: 0
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/settings") {
      response.end(
        JSON.stringify({
          ai: {
            apiKeyConfigured: true,
            apiKeySuffix: "...secret",
            baseUrl: "https://dashscope.example/v1",
            model: "qwen-test"
          },
          feishu: {
            appId: "cli_test",
            appIdConfigured: true,
            appSecretConfigured: true,
            appSecretSuffix: "...secret",
            appToken: "",
            appTokenConfigured: false,
            tableId: "",
            tableIdConfigured: false
          }
        })
      );
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/settings") {
      response.end(
        JSON.stringify({
          ai: {
            apiKeyConfigured: true,
            apiKeySuffix: "...secret",
            baseUrl: "https://dashscope.example/v1",
            model: "qwen-updated"
          },
          feishu: {
            appId: "cli_test",
            appIdConfigured: true,
            appSecretConfigured: true,
            appSecretSuffix: "...secret",
            appToken: "",
            appTokenConfigured: false,
            tableId: "",
            tableIdConfigured: false
          }
        })
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/import") {
      response.statusCode = 201;
      response.end(JSON.stringify({ kind: "IMPORTED", trackId: "track-source" }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/feishu/export") {
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          appToken: "app_music",
          created: 1,
          failed: 0,
          libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music",
          skipped: 0,
          tableId: "tbl_music",
          updated: 0
        })
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/analysis-jobs/job-1/retry") {
      response.statusCode = 202;
      response.end(JSON.stringify({ id: "job-1", status: "COMPLETED" }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/music/track-1") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/import-sessions") {
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          counts: {
            completed: 0,
            duplicate: 0,
            failed: 0,
            imported: 0,
            pending: 0,
            total: 0,
            uploading: 0
          },
          id: "session-1",
          status: "SCANNING"
        })
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/import-sessions/session-1/manifest") {
      response.end(
        JSON.stringify({
          accepted: 1,
          counts: {
            completed: 0,
            duplicate: 0,
            failed: 0,
            imported: 0,
            pending: 1,
            total: 1,
            uploading: 0
          },
          id: "session-1",
          rejected: 0,
          status: "IMPORTING"
        })
      );
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/import-sessions/session-1/files/upload-0"
    ) {
      response.statusCode = 200;
      response.end(JSON.stringify({ duplicateOf: "track-1", kind: "DUPLICATE" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/import-jobs/session-1") {
      response.end(
        JSON.stringify({
          counts: {
            completed: 1,
            duplicate: 1,
            failed: 0,
            imported: 0,
            pending: 0,
            total: 1,
            uploading: 0
          },
          id: "session-1",
          status: "COMPLETED"
        })
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port");
  }
  apiBaseUrl = `http://127.0.0.1:${address.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

afterEach(() => {
  cleanup();
  delete window.musicDesktop;
  vi.unstubAllGlobals();
  receivedRequests.length = 0;
  musicQueries.length = 0;
});

describe("music management page", () => {
  it("shows the reason for a failed analysis", async () => {
    await renderApp();

    expect(screen.getByLabelText("按叙事筛选")).toBeTruthy();
    expect(screen.getByLabelText("按电影风格筛选")).toBeTruthy();
    expect(await screen.findByText("失败原因：临时分析服务不可用")).toBeTruthy();
  });

  it("retries and deletes a failed music track", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await renderApp();

      await user.click(await screen.findByRole("button", { name: "重试分析" }));
      await waitFor(() => expect(requestCount("/api/analysis-jobs/job-1/retry")).toBe(1));

      await user.click(screen.getByRole("button", { name: "删除音乐" }));
      await waitFor(() => expect(requestCount("/api/music/track-1")).toBe(1));
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      confirm.mockRestore();
    }
  });

  it("links to the connected Feishu library", async () => {
    await renderApp();

    const link = await screen.findByRole("link", { name: "打开飞书多维表格" });
    expect(link.getAttribute("href")).toBe("https://feishu.cn/base/app_music?table=tbl_music");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("shows duplicate import feedback", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "导入音乐" }));
    expect(screen.getByRole("button", { name: "选择文件夹" })).toBeTruthy();
    await user.upload(
      screen.getByLabelText("导入音频"),
      new File(["audio"], "remember-me.mp3", { type: "audio/mpeg" })
    );

    expect(await screen.findByText("已存在：该音乐的内容哈希已在资料库中。")).toBeTruthy();
    expect(screen.getByLabelText("导入进度")).toBeTruthy();
  });

  it("switches to system settings and saves the model configuration", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "系统设置" }));
    expect(await screen.findByRole("heading", { name: "系统设置" })).toBeTruthy();
    expect(await screen.findByDisplayValue("qwen-test")).toBeTruthy();

    const model = screen.getByLabelText("AI 模型名称");
    await user.clear(model);
    await user.type(model, "qwen-updated");
    await user.click(screen.getByRole("button", { name: "保存系统设置" }));

    expect(
      await screen.findByText("系统设置已保存，AI 服务将在下次启动时使用新配置。")
    ).toBeTruthy();
    expect(requestCount("/api/settings")).toBe(2);
  });

  it("uses the Electron file bridge for direct source imports", async () => {
    const user = userEvent.setup();
    const selectFiles = vi
      .fn()
      .mockResolvedValue([{ name: "remember-me.mp3", path: "/music/remember-me.mp3", size: 1024 }]);
    const desktopBridge = {
      isAvailable: true,
      openTrack: vi.fn().mockResolvedValue({ error: null }),
      selectFiles,
      selectFolder: vi.fn().mockResolvedValue([]),
      showTrackInFolder: vi.fn().mockResolvedValue({ error: null }),
      toggleDevTools: vi.fn()
    };
    Object.defineProperty(window, "musicDesktop", {
      configurable: true,
      value: desktopBridge
    });
    expect(window.musicDesktop?.isAvailable).toBe(true);

    await renderApp();
    if (!screen.queryByRole("region", { name: "导入音乐面板" })) {
      await user.click(screen.getByRole("button", { name: "导入音乐" }));
    }
    await user.click(screen.getByRole("button", { name: /选择本地音频文件/ }));

    await waitFor(() => expect(requestCount("/api/import")).toBe(1));
    expect(selectFiles).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("已记录源文件并提交分析，源文件不会被复制或删除。")
    ).toBeTruthy();
  });

  it("uses the desktop bridge to play a track and reveal its source folder", async () => {
    const user = userEvent.setup();
    const openTrack = vi.fn().mockResolvedValue({ error: null });
    const showTrackInFolder = vi.fn().mockResolvedValue({ error: null });
    Object.defineProperty(window, "musicDesktop", {
      configurable: true,
      value: {
        isAvailable: true,
        openTrack,
        selectFiles: vi.fn(),
        selectFolder: vi.fn(),
        showTrackInFolder,
        toggleDevTools: vi.fn()
      }
    });

    await renderApp();

    await user.click(await screen.findByRole("button", { name: "播放 Remember Me" }));
    await user.click(screen.getByRole("button", { name: "打开所在文件夹" }));

    expect(openTrack).toHaveBeenCalledWith("track-1");
    expect(showTrackInFolder).toHaveBeenCalledWith("track-1");
    await user.click(screen.getByRole("button", { name: "详情" }));
    expect(await screen.findByRole("dialog", { name: "音轨详情" })).toBeTruthy();
  });

  it("shows a clear notice when the desktop player cannot open a track", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "musicDesktop", {
      configurable: true,
      value: {
        isAvailable: true,
        openTrack: vi.fn().mockResolvedValue({ error: "默认播放器不可用。" }),
        selectFiles: vi.fn(),
        selectFolder: vi.fn(),
        showTrackInFolder: vi.fn().mockResolvedValue({ error: null }),
        toggleDevTools: vi.fn()
      }
    });

    await renderApp();
    await user.click(await screen.findByRole("button", { name: "播放 Remember Me" }));

    expect(await screen.findByText("无法播放“Remember Me”：默认播放器不可用。")).toBeTruthy();
  });

  it("closes details from its outside layer and Escape without closing for content clicks", async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(screen.queryByRole("button", { name: "打开所在文件夹" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: /Remember Me/ }));
    const inspector = await screen.findByRole("dialog", { name: "音轨详情" });
    await user.click(within(inspector).getByText("速度 / 调性"));
    expect(screen.getByRole("dialog", { name: "音轨详情" })).toBeTruthy();

    await user.click(inspector.parentElement!);
    expect(screen.queryByRole("dialog", { name: "音轨详情" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Remember Me/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "音轨详情" })).toBeNull();
  });

  it("requests music one page at a time", async () => {
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => expect(musicQueries).toContain("?limit=25&offset=0"));
    await user.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => expect(musicQueries).toContain("?limit=25&offset=25"));
  });

  it("opens details in a scroll-locked dialog with Chinese analysis text", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /Remember Me/ }));

    const inspector = await screen.findByRole("dialog", { name: "音轨详情" });
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(inspector).getByText("速度 / 调性")).toBeTruthy();
    expect(
      within(inspector).getByText(
        (content, element) => element?.tagName === "DD" && content === "怀旧"
      )
    ).toBeTruthy();
    expect(within(inspector).getByText("记忆")).toBeTruthy();
    expect(within(inspector).getByText("剧情电影")).toBeTruthy();
    expect(within(inspector).getByText("缓慢渐强")).toBeTruthy();
    expect(within(inspector).getByText(/分析摘要：这是一首以怀旧为主情绪/)).toBeTruthy();
    expect(
      within(inspector).getByText("引子阶段，从 0:00 至 0:20。能量 3 分，紧张度 2 分。")
    ).toBeTruthy();
  });

  it("does not keep polling when every analysis job has reached a terminal state", async () => {
    await renderApp();
    await waitFor(() => {
      expect(requestCount("/api/analysis-jobs")).toBe(1);
      expect(requestCount("/api/feishu/status")).toBe(1);
    });

    await wait(10_250);

    expect(requestCount("/api/analysis-jobs")).toBe(1);
    expect(requestCount("/api/feishu/status")).toBe(1);
  }, 12_000);

  it("exports the library with a single Feishu action", async () => {
    const user = userEvent.setup();
    await renderApp();

    const exportButton = (await screen.findByRole("button", {
      name: "导出飞书"
    })) as HTMLButtonElement;
    expect(screen.queryByRole("button", { name: "创建飞书库" })).toBeNull();
    expect(screen.queryByRole("button", { name: "同步飞书" })).toBeNull();
    await waitFor(() => expect(exportButton.disabled).toBe(false));

    await user.click(exportButton);

    expect((await screen.findByRole("status")).textContent).toBe(
      "飞书导出完成：新增 1，更新 0，跳过 0，失败 0。"
    );
    expect(requestCount("/api/feishu/export")).toBe(1);
  });
});

async function renderApp() {
  await act(async () => {
    render(<App apiBaseUrl={apiBaseUrl} />);
  });
}

function requestCount(pathname: string) {
  return receivedRequests.filter((request) => request.pathname === pathname).length;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
