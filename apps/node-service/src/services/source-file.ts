import { access } from "node:fs/promises";

import { musicTracks } from "@analyze-music/database";

type TrackSource = Pick<typeof musicTracks.$inferSelect, "managedPath" | "sourcePath">;

export function isLinkedSource(track: TrackSource) {
  return track.sourcePath === track.managedPath;
}

export function analysisFilePath(track: TrackSource) {
  return isLinkedSource(track) ? track.sourcePath : track.managedPath;
}

export function canReleaseManagedPath(track: TrackSource) {
  return !isLinkedSource(track);
}

export async function isSourceAvailable(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
