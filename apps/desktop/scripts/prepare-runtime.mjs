import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import { installerArchitecture } from "./target-architecture.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const targetPlatform = process.env["MUSIC_DESKTOP_TARGET_PLATFORM"] ?? process.platform;
const targetArch = process.env["MUSIC_DESKTOP_TARGET_ARCH"] ?? process.arch;
const installerArch = installerArchitecture(targetArch);
const executableExtension = targetPlatform === "win32" ? ".exe" : "";
const ffmpegPath = resolveToolPath("@ffmpeg-installer", "ffmpeg", `ffmpeg${executableExtension}`);
const ffprobePath = resolveToolPath(
  "@ffprobe-installer",
  "ffprobe",
  `ffprobe${executableExtension}`
);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(desktopRoot, "../..");
const runtimeRoot = join(desktopRoot, "runtime");
const adminDist = join(repositoryRoot, "apps/analyze-music/dist");
const nodeServiceDist = join(repositoryRoot, "apps/node-service/dist");
const runtimeAdmin = join(runtimeRoot, "admin");
const runtimeNodeService = join(runtimeRoot, "node-service");
const runtimeDependencies = join(runtimeRoot, "dependencies");
const runtimeTools = join(runtimeRoot, "tools/music-analyzer");
const runtimeToolBin = join(runtimeRoot, "tools/bin");
const defaultEnv = join(runtimeRoot, "default.env");

await rm(runtimeRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
await mkdir(runtimeRoot, { recursive: true });
await cp(adminDist, runtimeAdmin, { recursive: true });
const dependencyStaging = await mkdtemp(join(tmpdir(), "analyze-music-runtime-"));
const stagingPackages = join(dependencyStaging, "packages");
const stagingMusicDomain = join(stagingPackages, "music-domain");
const stagingContracts = join(stagingPackages, "contracts");
const stagingDatabase = join(stagingPackages, "database");
await mkdir(stagingPackages, { recursive: true });
await Promise.all(
  ["music-domain", "contracts", "database"].map((packageName) =>
    cp(join(repositoryRoot, "packages", packageName), join(stagingPackages, packageName), {
      recursive: true
    })
  )
);
const contractsPackagePath = join(stagingContracts, "package.json");
const contractsPackage = JSON.parse(await readFile(contractsPackagePath, "utf8"));
contractsPackage.dependencies["@analyze-music/music-domain"] = `file:${stagingMusicDomain}`;
await writeFile(contractsPackagePath, `${JSON.stringify(contractsPackage, null, 2)}\n`);
await writeFile(
  join(dependencyStaging, "package.json"),
  `${JSON.stringify(
    {
      dependencies: {
        "@analyze-music/contracts": `file:${stagingContracts}`,
        "@analyze-music/database": `file:${stagingDatabase}`,
        "@analyze-music/music-domain": `file:${stagingMusicDomain}`,
        "@fastify/multipart": "^9.4.0",
        "drizzle-orm": "^0.45.2",
        fastify: "^5.11.3"
      },
      name: "analyze-music-runtime",
      private: true,
      type: "module",
      version: "0.0.0"
    },
    null,
    2
  )}\n`
);
await execFileAsync(
  "pnpm",
  [
    "install",
    "--prod",
    "--shamefully-hoist",
    "--package-import-method=copy",
    "--ignore-workspace",
    "--config.confirmModulesPurge=false"
  ],
  { cwd: dependencyStaging }
);
await mkdir(runtimeNodeService, { recursive: true });
await cp(
  join(repositoryRoot, "apps/node-service/package.json"),
  join(runtimeNodeService, "package.json")
);
await cp(nodeServiceDist, join(runtimeNodeService, "dist"), { recursive: true });
const stagingNodeModules = join(dependencyStaging, "node_modules");
await mkdir(runtimeDependencies, { recursive: true });
for (const dependencyEntry of await readdir(stagingNodeModules)) {
  if (dependencyEntry === ".bin" || dependencyEntry === ".pnpm") continue;
  await cp(join(stagingNodeModules, dependencyEntry), join(runtimeDependencies, dependencyEntry), {
    dereference: true,
    recursive: true
  });
}
await cp(join(repositoryRoot, "tools/music-analyzer"), runtimeTools, { recursive: true });
await mkdir(runtimeToolBin, { recursive: true });
for (const [tool, source] of [
  ["ffmpeg", ffmpegPath],
  ["ffprobe", ffprobePath]
]) {
  await copyFile(source, join(runtimeToolBin, tool));
  await chmod(join(runtimeToolBin, tool), 0o755);
}
await writeFile(
  join(runtimeNodeService, ".runtime-revision"),
  `${await createRuntimeRevision()}\n`
);
await rm(dependencyStaging, { force: true, recursive: true });

const envSource = join(repositoryRoot, ".env");
try {
  await access(envSource);
  await cp(envSource, defaultEnv);
} catch {
  await cp(join(repositoryRoot, ".env.example"), defaultEnv);
}

async function createRuntimeRevision() {
  const hash = createHash("sha256");
  await hashDirectory(hash, runtimeNodeService, "node-service");
  await hashDirectory(hash, runtimeDependencies, "dependencies");
  return hash.digest("hex");
}

function resolveToolPath(scope, installer, executable) {
  const packageName = `${scope}/${targetPlatform}-${installerArch}`;
  const installerDirectory = dirname(require.resolve(`${scope}/${installer}`));
  const binaryPath = join(
    installerDirectory,
    "..",
    `${targetPlatform}-${installerArch}`,
    executable
  );
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Missing ${packageName}; install dependencies for the target platform before packaging`
    );
  }
  return binaryPath;
}

async function hashDirectory(hash, directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = `${prefix}/${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await hashDirectory(hash, path, relativePath);
      continue;
    }
    hash.update(`${relativePath}\0`);
    hash.update(await readFile(path));
  }
}
