export function installerArchitecture(targetArch) {
  return targetArch === "armv7l" ? "arm" : targetArch;
}
