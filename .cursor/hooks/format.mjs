import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PRETTIER_EXT =
  /\.(?:ts|tsx|mjs|cjs|js|jsx|json|css|scss|md|yaml|yml|html)$/i;
const ESLINT_EXT = /\.(?:ts|tsx|mjs|cjs|js|jsx)$/i;

const INSTRUMENT_ROOT_NAMES = new Set([
  "@instrument-org/monorepo",
  "@instrument-org/skills",
  "@instrument/internal",
]);

function fileExists(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

function findEslintConfigDirectory(repoRoot, filePath) {
  // Walk up from the file's directory to find the nearest eslint.config.*,
  // stopping at the repo root. ESLint must run from this directory so that
  // package-level settings (e.g. better-tailwindcss entryPoint) apply.
  let directory = path.dirname(path.resolve(filePath));
  const root = path.resolve(repoRoot);
  while (directory.startsWith(root) && directory !== root) {
    for (const name of [
      "eslint.config.ts",
      "eslint.config.mts",
      "eslint.config.js",
      "eslint.config.mjs",
    ]) {
      if (fileExists(path.join(directory, name))) {
        return directory;
      }
    }
    directory = path.dirname(directory);
  }
  return root;
}

function formatDirtyFiles(repoRoot) {
  if (!isInstrumentRepoRoot(repoRoot)) {
    return;
  }

  const existing = listDirtyPaths(repoRoot).filter((relativePath) => {
    if (shouldSkipRelative(relativePath)) {
      return false;
    }
    return fileExists(path.join(repoRoot, relativePath));
  });

  const prettierFiles = existing.filter((relativePath) =>
    PRETTIER_EXT.test(relativePath),
  );
  const eslintFiles = existing.filter((relativePath) =>
    ESLINT_EXT.test(relativePath),
  );

  runBatched(repoRoot, prettierFiles, runPrettier);
  runBatched(repoRoot, eslintFiles, runEslint);

  // ESLint fixes can change layout, so finish with Prettier.
  runBatched(repoRoot, prettierFiles, runPrettier);
}

function formatEditedFile({ filePath, repoRoot }) {
  const relativePath = getSafeRelativePath({ filePath, repoRoot });
  if (!relativePath || !fileExists(filePath)) {
    return;
  }

  if (!isInstrumentRepoRoot(repoRoot)) {
    return;
  }

  if (PRETTIER_EXT.test(relativePath)) {
    runPrettier(repoRoot, [relativePath]);
  }
}

function formatEditedFiles({ cwd, filePaths, repoRoot }) {
  const relativePaths = filePaths
    .map((filePath) =>
      getSafeRelativePath({
        filePath: path.resolve(cwd, filePath),
        repoRoot,
      }),
    )
    .filter(
      (relativePath) =>
        relativePath && fileExists(path.join(repoRoot, relativePath)),
    );

  if (relativePaths.length === 0 || !isInstrumentRepoRoot(repoRoot)) {
    return;
  }

  const prettierFiles = relativePaths.filter((relativePath) =>
    PRETTIER_EXT.test(relativePath),
  );
  const eslintFiles = relativePaths.filter((relativePath) =>
    ESLINT_EXT.test(relativePath),
  );

  runBatched(repoRoot, prettierFiles, runPrettier);
  runBatched(repoRoot, eslintFiles, runEslint);
  runBatched(repoRoot, prettierFiles, runPrettier);
}

function getCodexEditedPaths(data) {
  const command =
    typeof data.tool_input?.command === "string" ? data.tool_input.command : "";
  const paths = new Set();

  for (const line of command.split("\n")) {
    const match = /^\*\*\* (?:Add|Update) File: (.+)$/.exec(line);
    if (match) {
      paths.add(match[1].trim());
    }
  }

  return [...paths];
}

function getRepoRoot(cwd) {
  const root = readGitPaths(cwd, ["rev-parse", "--show-toplevel"]).trim();
  return root || cwd;
}

function getSafeRelativePath({ filePath, repoRoot }) {
  const relativePath = path.relative(repoRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return;
  }
  if (shouldSkipRelative(relativePath)) {
    return;
  }
  return relativePath;
}

function getStopRoots({ data, repoRoot }) {
  const workspaceRoots = Array.isArray(data.workspace_roots)
    ? data.workspace_roots
        .filter((root) => typeof root === "string" && root.length > 0)
        .map((root) => path.resolve(root))
    : [];
  const roots = workspaceRoots.length > 0 ? workspaceRoots : [repoRoot];
  const instrumentRoots = roots.filter((root) => isInstrumentRepoRoot(root));
  if (instrumentRoots.length === 0) {
    return [];
  }

  const primaryRoot = [...instrumentRoots].sort()[0];
  if (path.resolve(repoRoot) !== primaryRoot) {
    return [];
  }
  return instrumentRoots;
}

function isInstrumentRepoRoot(repoRoot) {
  const packagePath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return false;
  }

  let package_;
  try {
    package_ = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return false;
  }

  if (!INSTRUMENT_ROOT_NAMES.has(package_.name)) {
    return false;
  }

  try {
    fs.statSync(path.join(repoRoot, ".git"));
  } catch {
    return false;
  }

  return true;
}

function listDirtyPaths(repoRoot) {
  const lines = [
    readGitPaths(repoRoot, [
      "diff",
      "--name-only",
      "--ignore-submodules=all",
      "HEAD",
      "--",
      ":!registry",
    ]),
    readGitPaths(repoRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ":!registry",
    ]),
  ];

  const dirty = new Set();
  for (const line of lines.join("\n").split("\n")) {
    const relativePath = line.trim();
    if (relativePath) {
      dirty.add(relativePath);
    }
  }
  return [...dirty];
}

function readGitPaths(repoRoot, arguments_) {
  try {
    return execFileSync("git", arguments_, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return typeof error.stdout === "string" ? error.stdout : "";
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

function runBatched(repoRoot, files, run) {
  const batchSize = 40;
  for (let index = 0; index < files.length; index += batchSize) {
    run(repoRoot, files.slice(index, index + batchSize));
  }
}

function runEslint(repoRoot, files) {
  if (files.length === 0) {
    return;
  }
  const eslintPath = path.join(repoRoot, "node_modules/.bin/eslint");
  if (!fileExists(eslintPath)) {
    return;
  }
  const formatConfigPath = path.join(
    repoRoot,
    "packages/eslint-config/format.ts",
  );
  const configArguments = fileExists(formatConfigPath)
    ? ["--config", formatConfigPath]
    : [];

  // Group files by their nearest eslint.config directory so each group runs
  // with the correct cwd (and thus the correct package-level config).
  const groups = new Map();
  for (const relativePath of files) {
    const configDirectory = findEslintConfigDirectory(
      repoRoot,
      path.join(repoRoot, relativePath),
    );
    if (!groups.has(configDirectory)) {
      groups.set(configDirectory, []);
    }
    groups.get(configDirectory).push(path.resolve(repoRoot, relativePath));
  }

  for (const [configDirectory, absolutePaths] of groups) {
    try {
      execFileSync(
        eslintPath,
        [...configArguments, "--no-ignore", "--fix", ...absolutePaths],
        {
          cwd: configDirectory,
          maxBuffer: 50 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      // ESLint exits 1 for unfixable lint errors -- that's expected, ignore.
    }
  }
}

function runPrettier(repoRoot, files) {
  if (files.length === 0) {
    return;
  }
  const prettierPath = path.join(repoRoot, "node_modules/.bin/prettier");
  if (!fileExists(prettierPath)) {
    return;
  }
  execFileSync(prettierPath, ["--write", ...files], {
    cwd: repoRoot,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function shouldSkipRelative(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    normalized.startsWith("registry/") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/")
  );
}

const raw = await readStdin();
let data = {};
try {
  data = JSON.parse(raw || "{}");
} catch (error) {
  console.error("[format-hook] invalid JSON stdin", error.message);
  process.stdout.write("{}");
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(0);
}

try {
  const cwd = process.cwd();
  const repoRoot = getRepoRoot(cwd);

  // Cursor runtime delivers camelCase names; Claude Code delivers PascalCase.
  // Normalize to PascalCase so the branches below work for both runtimes.
  const eventName = (() => {
    const n = data.hook_event_name;
    if (n === "postToolUse") {
      return "PostToolUse";
    }
    if (n === "stop") {
      return "Stop";
    }
    return n;
  })();

  if (
    eventName === "afterFileEdit" &&
    typeof data.file_path === "string" &&
    data.file_path.length > 0
  ) {
    formatEditedFile({
      filePath: path.resolve(data.file_path),
      repoRoot,
    });
  }

  if (eventName === "Stop") {
    for (const root of getStopRoots({ data, repoRoot })) {
      formatDirtyFiles(root);
    }
  }

  if (eventName === "PostToolUse" && data.tool_name === "apply_patch") {
    formatEditedFiles({
      cwd,
      filePaths: getCodexEditedPaths(data),
      repoRoot,
    });
  }

  if (
    eventName === "PostToolUse" &&
    (data.tool_name === "Edit" || data.tool_name === "Write") &&
    typeof data.tool_input?.file_path === "string" &&
    data.tool_input.file_path.length > 0
  ) {
    formatEditedFile({
      filePath: path.resolve(data.tool_input.file_path),
      repoRoot,
    });
  }
} catch (error) {
  console.error("[format-hook]", error?.message ?? error);
}

process.stdout.write("{}");
// eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
process.exit(0);
