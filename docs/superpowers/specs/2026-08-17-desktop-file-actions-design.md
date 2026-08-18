# Desktop music file actions

## Goal

Make a desktop-library row useful without copying or moving its source audio file:

- clicking a track name opens the source audio in the operating system's default player;
- the row action area offers **详情** and **打开所在文件夹**;
- the detail dialog closes through its close button, an outside-layer click, or `Escape`.

## Interaction design

### Track rows

In Electron, a track-name click asks the desktop bridge to open the library track in the system default application. The action area contains **详情** for the existing inspector and **打开所在文件夹** to reveal the source file in Finder/Explorer. Existing analysis and delete actions remain unchanged.

The browser build does not receive system file operations. There, clicking the track name retains the current detail-opening behavior and the folder action is omitted. This keeps browser use functional without creating a misleading control.

### Detail dialog

The inspector continues to lock document scrolling while open. Its outer layer is clickable: a click whose target is the layer closes the dialog, while clicks inside the inspector do not. A window-level keydown listener closes the dialog on `Escape` and is removed on close. The existing close button remains available.

## Desktop boundary

The renderer never imports Electron APIs or receives a filesystem path. The preload bridge exposes two narrow asynchronous operations:

- `openTrack(trackId)`;
- `showTrackInFolder(trackId)`.

The main process accepts these requests only from the packaged local renderer. It resolves the track ID through a local-service endpoint protected by a per-launch secret, then canonicalizes the stored path, verifies it is a readable regular supported-audio file, and delegates to Electron `shell.openPath` or `shell.showItemInFolder`. Both operations return a structured success/error result. The renderer turns a failure—such as a source file that was moved or a player that could not start—into the existing inline notice. Neither path action copies, moves, or deletes audio files.

## Data flow

The renderer passes only the library track ID to the preload bridge. The main process resolves the linked source path with the per-launch desktop token, validates the canonical local file, and invokes the operating-system shell integration. The regular music API never exposes source paths to the browser renderer.

## Error handling

- Missing, unreadable, or non-file paths produce a user-facing notice rather than throwing in the renderer.
- `shell.openPath` error text is preserved in a readable notice.
- Opening the containing folder is attempted only after the source path passes validation.
- Browser mode does not expose or invoke file-operation controls.

## Tests

1. Frontend tests verify the desktop bridge receives a track ID for playback and folder reveal, surfaces action failures, and preserves the details action.
2. Frontend tests verify outside-layer click and `Escape` close the inspector while an inside click does not.
3. Desktop tests verify ID-only track resolution, token-protected source lookup, readable-audio validation, and shell failures.
4. The packaged Electron smoke test exercises both shell actions without modifying the source, and verifies matching but incomplete runtimes are repaired at launch.
