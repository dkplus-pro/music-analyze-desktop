import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

export async function hashFile(sourcePath: string) {
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(sourcePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  return hash.digest("hex");
}
