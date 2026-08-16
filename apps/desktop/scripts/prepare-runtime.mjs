import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(desktopRoot, "../..");
const runtimeRoot = join(desktopRoot, "runtime");
const adminDist = join(repositoryRoot, "apps/analyze-music/dist");
const nodeServiceDist = join(repositoryRoot, "apps/node-service/dist");
const runtimeAdmin = join(runtimeRoot, "admin");
const runtimeNodeService = join(runtimeRoot, "node-service");
const runtimeDependencies = join(runtimeRoot, "dependencies");
const runtimeTools = join(runtimeRoot, "tools/music-analyzer");
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
  await execFileAsync("cp", [
    "-RL",
    join(stagingNodeModules, dependencyEntry),
    join(runtimeDependencies, dependencyEntry)
  ]);
}
await cp(join(repositoryRoot, "tools/music-analyzer"), runtimeTools, { recursive: true });
await rm(dependencyStaging, { force: true, recursive: true });

const envSource = join(repositoryRoot, ".env");
try {
  await access(envSource);
  await cp(envSource, defaultEnv);
} catch {
  await cp(join(repositoryRoot, ".env.example"), defaultEnv);
}
