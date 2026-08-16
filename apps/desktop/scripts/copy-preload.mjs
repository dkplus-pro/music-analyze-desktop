import { cp } from "node:fs/promises";

await cp("src/preload.cjs", "dist/preload.cjs");
