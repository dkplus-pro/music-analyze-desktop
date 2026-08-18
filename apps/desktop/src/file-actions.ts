import { extname } from "node:path";

export interface DesktopFileActionResult {
  error: string | null;
}

type SourcePathValidation = { error: null; filePath: string } | { error: string; filePath: null };

interface DesktopFileActionsDependencies {
  access: (sourcePath: string) => Promise<void>;
  realpath: (sourcePath: string) => Promise<string>;
  shell: {
    openPath: (sourcePath: string) => Promise<string>;
    showItemInFolder: (sourcePath: string) => void;
  };
  stat: (sourcePath: string) => Promise<{ isFile: () => boolean }>;
}

const audioExtensions = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);

export function createDesktopFileActions({
  access,
  realpath,
  shell,
  stat
}: DesktopFileActionsDependencies) {
  const validateSourcePath = async (sourcePath: unknown): Promise<SourcePathValidation> => {
    if (typeof sourcePath !== "string" || !sourcePath.trim()) {
      return { error: "源文件路径无效。", filePath: null };
    }
    try {
      const filePath = await realpath(sourcePath);
      if (!audioExtensions.has(extname(filePath).toLowerCase())) {
        return { error: "仅支持打开已导入的音频源文件。", filePath: null };
      }
      if (!(await stat(filePath)).isFile()) {
        return { error: "源文件不存在或无法读取。", filePath: null };
      }
      await access(filePath);
      return { error: null, filePath };
    } catch {
      return { error: "源文件不存在或无法读取。", filePath: null };
    }
  };

  return {
    openFile: async (sourcePath: unknown): Promise<DesktopFileActionResult> => {
      const validation = await validateSourcePath(sourcePath);
      if (validation.error !== null) return { error: validation.error };
      try {
        return { error: (await shell.openPath(validation.filePath)) || null };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "无法调用默认播放器。" };
      }
    },
    showItemInFolder: async (sourcePath: unknown): Promise<DesktopFileActionResult> => {
      const validation = await validateSourcePath(sourcePath);
      if (validation.error !== null) return { error: validation.error };
      try {
        shell.showItemInFolder(validation.filePath);
        return { error: null };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "无法打开所在文件夹。" };
      }
    }
  };
}
