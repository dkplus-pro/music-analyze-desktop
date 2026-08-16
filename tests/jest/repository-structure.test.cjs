const fs = require("node:fs");
const path = require("node:path");

describe("monorepo repository structure", () => {
  const root = process.cwd();

  test("contains expected top-level monorepo areas", () => {
    for (const relativePath of [
      "apps/demo",
      "packages/tsconfig",
      "packages/eslint-config",
      "scripts"
    ]) {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
    }
  });

  test("pnpm workspace includes apps and packages", () => {
    const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("apps/*");
    expect(workspace).toContain("packages/*");
  });

  test("root package exposes core developer lifecycle scripts", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    for (const script of [
      "dev",
      "dev:music",
      "build",
      "lint",
      "typecheck",
      "test",
      "format",
      "commitlint",
      "prepare"
    ]) {
      expect(pkg.scripts).toHaveProperty(script);
    }
  });

  test("music API development rebuilds its workspace dependencies before it starts", () => {
    const service = JSON.parse(
      fs.readFileSync(path.join(root, "apps/node-service/package.json"), "utf8")
    );
    expect(service.scripts.dev).toContain(
      "turbo run build --filter=@analyze-music/node-service..."
    );
  });
});
