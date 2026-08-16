import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

await rm(runtimeRoot, { force: true, recursive: true });
await mkdir(runtimeRoot, { recursive: true });
await cp(adminDist, runtimeAdmin, { recursive: true });
await execFileAsync(
  "pnpm",
  ["--filter", "@analyze-music/node-service", "--prod", "deploy", runtimeNodeService, "--legacy"],
  { cwd: repositoryRoot }
);
await cp(nodeServiceDist, join(runtimeNodeService, "dist"), { recursive: true });
