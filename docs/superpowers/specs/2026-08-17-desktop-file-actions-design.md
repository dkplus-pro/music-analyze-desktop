# Desktop music file actions

## Goal

Make a desktop-library row useful without copying or moving its source audio file:

- clicking a track name opens the source audio in the operating system's default player;
- the row action area offers **详情** and **打开所在文件夹**;
- the detail dialog closes through its close button, an outside-layer click, or `Escape`.

## Interaction design

### Track rows

In Electron, a track-name click asks the desktop bridge to open the linked source path with the system default application. The action area contains **详情** for the existing inspector and **打开所在文件夹** to reveal the source file in Finder/Explorer. Existing analysis and delete actions remain unchanged.

The browser build does not receive system file operations. There, clicking the track name retains the current detail-opening behavior and the folder action is omitted. This keeps browser use functional without creating a misleading control.

### Detail dialog

The inspector continues to lock document scrolling while open. Its outer layer is clickable: a click whose target is the layer closes the dialog, while clicks inside the inspector do not. A window-level keydown listener closes the dialog on `Escape` and is removed on close. The existing close button remains available.

## Desktop boundary

The renderer never imports Electron APIs. The preload bridge exposes two narrow asynchronous operations:

- `openFile(sourcePath)`;
- `showItemInFolder(sourcePath)`.

The main process validates the supplied path, verifies the file is accessible, and delegates to Electron `shell.openPath` or `shell.showItemInFolder`. Both operations return a structured success/error result. The renderer turns a failure—such as a source file that was moved or a player that could not start—into the existing inline notice. Neither path action copies, moves, or deletes audio files.

## Data flow

The local music API already returns each track's linked source path. The renderer passes that path only to the preload bridge in desktop mode. The bridge relays it over IPC to the main process, which invokes the operating system shell integration.

## Error handling

- Missing, unreadable, or non-file paths produce a user-facing notice rather than throwing in the renderer.
- `shell.openPath` error text is preserved in a readable notice.
- Opening the containing folder is attempted only after the source path passes validation.
- Browser mode does not expose or invoke file-operation controls.

## Tests

1. Frontend tests verify the desktop bridge receives the linked path for playback and folder reveal, and that the details action still opens the inspector.
2. Frontend tests verify outside-layer click and `Escape` close the inspector while an inside click does not.
3. Desktop tests verify IPC handlers use the appropriate shell action and return failures for missing files.
4. The packaged Electron smoke test continues to exercise the desktop bridge and app startup.
