// PostToolUse hook: formats the file Claude just edited with the project's Prettier.
// Cross-platform (Windows/macOS/Linux): runs Prettier through Node directly, no jq or .cmd shims.
// Never blocks Claude: if Prettier isn't installed yet or formatting fails, it exits 0 silently.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const FORMATTABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".md", ".html"]);

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

try {
  const input = JSON.parse((await readStdin()) || "{}");
  const filePath = input?.tool_input?.file_path;
  if (!filePath || !FORMATTABLE.has(path.extname(filePath).toLowerCase())) process.exit(0);
  if (filePath.includes(`${path.sep}node_modules${path.sep}`) || filePath.includes("/node_modules/")) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  let prettierBin;
  try {
    const require = createRequire(path.join(projectDir, "package.json"));
    prettierBin = require.resolve("prettier/bin/prettier.cjs");
  } catch {
    process.exit(0); // Prettier not installed yet (before session S1)
  }

  spawnSync(process.execPath, [prettierBin, "--write", "--ignore-unknown", filePath], {
    cwd: projectDir,
    stdio: "ignore",
    timeout: 50_000,
  });
} catch {
  // Formatting is a convenience; never fail the tool call because of it.
}
process.exit(0);
