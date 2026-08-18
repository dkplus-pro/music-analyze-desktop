const { execFile } = require("node:child_process");
const { join } = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const archNames = ["ia32", "x64", "armv7l", "arm64", "universal"];

exports.default = async function beforePack(context) {
  const targetArch = archNames[context.arch];
  if (!targetArch || targetArch === "universal") {
    throw new Error(`Unsupported desktop tool architecture: ${context.arch}`);
  }
  await execFileAsync(process.execPath, [join(__dirname, "prepare-runtime.mjs")], {
    cwd: context.packager.info.projectDir,
    env: {
      ...process.env,
      MUSIC_DESKTOP_TARGET_ARCH: targetArch,
      MUSIC_DESKTOP_TARGET_PLATFORM: context.electronPlatformName
    }
  });
};
