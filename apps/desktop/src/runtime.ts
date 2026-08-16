import { dirname, join, resolve } from "node:path";

export interface DesktopRuntimePaths {
  adminDist: string;
  envPath: string;
  nodeServiceRoot: string;
  userDataRoot: string;
}

export interface DesktopRuntimePathOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
}

export function desktopRuntimePaths({
  appPath,
  isPackaged,
  resourcesPath,
  userDataPath
}: DesktopRuntimePathOptions): DesktopRuntimePaths {
  if (isPackaged) {
    return {
      adminDist: join(resourcesPath, "admin"),
      envPath: join(userDataPath, ".env"),
      nodeServiceRoot: join(resourcesPath, "node-service"),
      userDataRoot: userDataPath
    };
  }
  const repositoryRoot = resolve(dirname(appPath), "../..");
  return {
    adminDist: join(repositoryRoot, "apps/analyze-music/dist"),
    envPath: join(repositoryRoot, ".env"),
    nodeServiceRoot: join(repositoryRoot, "apps/node-service"),
    userDataRoot: userDataPath
  };
}

export function isDevToolsShortcut(input: { key: string }) {
  return input.key === "F12";
}
