// Runs real native workloads and known escapes under one sandbox candidate and
// reports which ran and which were stopped. See README.md beside this file.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { inheritedEnv } from "../../packages/workspace/src/lib/native-env.ts";
import {
  nodeToolsEnvFor,
  uvToolsEnvFor,
} from "../../packages/workspace/src/lib/tool-isolation-env.ts";

const MARKER = "sandbox-bakeoff-planted-secret";
const mac = process.platform === "darwin";

const { values: flags } = parseArgs({
  options: {
    granted: { type: "string" },
    home: { type: "string" },
    json: { type: "string" },
    "mxc-sdk": { type: "string" },
    only: { type: "string" },
    registry: { type: "string" },
    runner: { default: "none", type: "string" },
    srt: { default: "srt", type: "string" },
    timeout: { default: "900", type: "string" },
  },
});

if (!flags.home || !flags.granted) {
  console.error(
    "usage: node probe.ts --runner <none|seatbelt|bwrap|srt|mxc|./runner.ts> --home <fixture home> --granted <granted folder> [--registry <dir>] [--only a,b] [--json out.json]",
  );
  process.exit(2);
}

const ensure = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
};
const home = ensure(flags.home);
const granted = ensure(flags.granted);
// The temp folders every candidate leaves writable. pnpm 11 keeps its store
// locks in /tmp whatever TMPDIR says.
const tmp = [...new Set([realpathSync(os.tmpdir()), realpathSync("/tmp")])];
if (tmp.some((dir) => home.startsWith(`${dir}/`))) {
  console.error(
    `The fixture home must sit outside ${tmp.join(" and ")}, which every candidate leaves writable.`,
  );
  process.exit(2);
}
const timeoutMs = Number(flags.timeout) * 1000;
const registry = path.resolve(
  flags.registry ?? path.join(import.meta.dirname, "../../registry"),
);

/**
 * Where the app's own pnpm, npm, node-gyp and uv keep their stores, caches and
 * config: outside the fixture home, the way the app keeps them beside its
 * own data rather than in the person's.
 */
const appData = ensure(path.join(path.dirname(home), "app-data"));

/** The policy every candidate approximates, all in the fixture home. */
const inHome = (...names: string[]) =>
  names.map((name) => path.join(home, name));
const policy = {
  // The passwords place, as the Permissions rules spell it.
  denied: inHome(
    ".ssh",
    ".gnupg",
    ".aws",
    ".config/gh",
    ".docker/config.json",
    ...(mac ? ["Library/Keychains"] : []),
  ),
  // The app's own tool folders, and the system's caches, writable whatever
  // else is closed. The person's own tool caches and settings are not.
  caches: [appData, ...(mac ? inHome("Library/Caches") : [])],
  settings: [] as string[],
  granted,
  home,
  tmp,
};
type Policy = typeof policy;

type ExecResult = { code: number | null; output: string; stdout: string };
type Runner = {
  exec: (
    script: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<ExecResult>;
  name: string;
};

function spawnArgv(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const [file = "", ...args] = argv;
    const child = spawn(file, args, {
      cwd,
      detached: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let output = "";
    const cap = (text: string, more: string) => (text + more).slice(-200_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = cap(stdout, chunk.toString());
      output = cap(output, chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output = cap(output, chunk.toString());
    });
    const timer = setTimeout(() => {
      output += `\nerror: timed out after ${timeoutMs / 1000}s`;
      try {
        process.kill(-(child.pid ?? 0), "SIGKILL");
      } catch {
        // already gone
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `error: ${error.message}`, stdout });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, stdout });
    });
  });
}

const sbpl = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const depth = (target: string) => target.split("/").filter(Boolean).length;

/**
 * The profile `seatbeltProfile` in packages/workspace/src/lib/native-sandbox.ts
 * generates for this policy: allow by default, no writes in the home folder,
 * then each place opened or closed from shallow to deep.
 */
function seatbeltProfile(p: Policy): string {
  const entries = [
    {
      at: p.home,
      rank: -1,
      text: `(deny file-write* (subpath ${sbpl(p.home)}))`,
    },
    ...p.denied.map((at) => ({
      at,
      rank: 0,
      text: `(deny file-read* file-write* (subpath ${sbpl(at)}))`,
    })),
    ...p.caches.map((at) => ({
      at,
      rank: 3,
      text: `(allow file-read* file-write* (subpath ${sbpl(at)}))`,
    })),
    ...p.settings.map((at) => ({
      at,
      rank: 3,
      text: `(allow file-read* (subpath ${sbpl(at)}))`,
    })),
    {
      at: p.granted,
      rank: 3,
      text: `(allow file-read* file-write* (subpath ${sbpl(p.granted)}))`,
    },
  ].toSorted((a, b) => depth(a.at) - depth(b.at) || a.rank - b.rank);
  const above = new Set<string>();
  for (const { at } of entries) {
    for (let dir = path.dirname(at); dir !== "/"; dir = path.dirname(dir)) {
      above.add(dir);
    }
  }
  return [
    "(version 1)",
    "(allow default)",
    ...entries.map((entry) => entry.text),
    ...[...above]
      .toSorted()
      .map((dir) => `(allow file-read-metadata (literal ${sbpl(dir)}))`),
  ].join("\n");
}

/** The arguments `bwrapArgs` in native-sandbox.ts builds for this policy. */
function bwrapArgs(p: Policy): string[] {
  const entries = [
    { access: "read", at: p.home, rank: -1 },
    ...p.denied.map((at) => ({ access: "none", at, rank: 0 })),
    ...[...p.caches, p.granted].map((at) => ({ access: "write", at, rank: 3 })),
    ...p.settings.map((at) => ({ access: "read", at, rank: 3 })),
  ].toSorted((a, b) => depth(a.at) - depth(b.at) || a.rank - b.rank);
  const args = [
    "--ro-bind",
    "/",
    "/",
    "--dev-bind",
    "/dev",
    "/dev",
    "--proc",
    "/proc",
    "--bind",
    "/tmp",
    "/tmp",
    "--die-with-parent",
  ];
  for (const { access, at } of entries) {
    // The generator skips a place that is not there yet, so a cache folder a
    // tool has never made stays read-only under the home folder.
    if (!existsSync(at)) {
      continue;
    }
    if (access === "write") {
      args.push("--bind", at, at);
    } else if (access === "read") {
      args.push("--ro-bind", at, at);
    } else if (spawnSync("test", ["-d", at]).status === 0) {
      args.push("--tmpfs", at);
    } else {
      args.push("--ro-bind", "/dev/null", at);
    }
  }
  return args;
}

const NETWORK_ALLOW = [
  "registry.npmjs.org",
  "*.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "nodejs.org",
  "cdn.sheetjs.com",
];

async function makeRunner(name: string, p: Policy): Promise<Runner> {
  const shell = (script: string) => ["/bin/sh", "-c", script];
  const wrapped = (wrap: (argv: string[]) => string[]): Runner => ({
    exec: (script, cwd, env) => spawnArgv(wrap(shell(script)), cwd, env),
    name,
  });
  const writable = [p.granted, ...p.caches, ...p.tmp];
  switch (name) {
    case "none":
      return wrapped((argv) => argv);
    case "seatbelt": {
      const profile = seatbeltProfile(p);
      return wrapped((argv) => [
        "/usr/bin/sandbox-exec",
        "-p",
        profile,
        ...argv,
      ]);
    }
    case "bwrap":
      return wrapped((argv) => [
        "/usr/bin/bwrap",
        ...bwrapArgs(p),
        "--",
        ...argv,
      ]);
    case "srt": {
      const settings = path.join(
        os.tmpdir(),
        `sandbox-bakeoff-srt-${process.pid}.json`,
      );
      writeFileSync(
        settings,
        JSON.stringify({
          filesystem: {
            allowWrite: writable,
            denyRead: p.denied,
            denyWrite: [],
          },
          network: { allowedDomains: NETWORK_ALLOW, deniedDomains: [] },
        }),
      );
      return {
        exec: (script, cwd, env) =>
          spawnArgv(
            [flags.srt, "--settings", settings, "-c", script],
            cwd,
            env,
          ),
        name,
      };
    }
    case "mxc": {
      if (!flags["mxc-sdk"]) {
        throw new Error("--mxc-sdk <path to @microsoft/mxc-sdk> is required");
      }
      const entry = path.resolve(flags["mxc-sdk"], "dist/v1/index.js");
      // A package outside this repo, loaded by path; its module shape is the
      // SDK's documented `run`.
      const sdk = (await import(pathToFileURL(entry).href)) as {
        run: (request: object) => Promise<{
          exitCode: number | null;
          stderr: string;
          stdout: string;
        }>;
      };
      return {
        exec: async (script, cwd, env) => {
          try {
            const result = await sdk.run({
              command: `/bin/sh -c ${shellQuote(script)}`,
              containment: { type: mac ? "seatbelt" : "bubblewrap" },
              environment: env,
              filesystem: {
                deniedPaths: p.denied,
                readonlyPaths: ["/", p.home],
                readwritePaths: [...writable, "/dev/null"],
              },
              network: { egress: { default: "allow" } },
              timeoutMs,
              workingDirectory: cwd,
            });
            return {
              code: result.exitCode,
              output: `${result.stdout}\n${result.stderr}`,
              stdout: result.stdout,
            };
          } catch (error) {
            return {
              code: null,
              output: `error: ${String(error)}`,
              stdout: "",
            };
          }
        },
        name,
      };
    }
    default: {
      // A module exporting `exec(script, cwd, env, policy)`.
      const custom = (await import(pathToFileURL(path.resolve(name)).href)) as {
        exec: (
          script: string,
          cwd: string,
          env: NodeJS.ProcessEnv,
          p: Policy,
        ) => Promise<ExecResult>;
      };
      return {
        exec: (script, cwd, env) => custom.exec(script, cwd, env, p),
        name,
      };
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The distinct packages registry skills declare, npm first, capped. */
function registryDeps(cap = 15): { npm: string[]; python: string[] } {
  const skills = path.join(registry, "skills");
  const npm = new Map<string, string>();
  const python = new Map<string, string>();
  for (const skill of existsSync(skills)
    ? readdirSync(skills).toSorted()
    : []) {
    const pkg = path.join(skills, skill, "package.json");
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      for (const [name, spec] of Object.entries(json.dependencies ?? {})) {
        npm.set(name, /^[a-z]+:\/\//.test(spec) ? spec : `${name}@${spec}`);
      }
    }
    const pyproject = path.join(skills, skill, "pyproject.toml");
    if (existsSync(pyproject)) {
      for (const dep of pyprojectDeps(readFileSync(pyproject, "utf8"))) {
        python.set(
          /^[A-Za-z0-9_.-]+/.exec(dep)?.[0]?.toLowerCase() ?? dep,
          dep,
        );
      }
    }
    const requirements = path.join(skills, skill, "requirements.txt");
    if (existsSync(requirements)) {
      for (const line of readFileSync(requirements, "utf8").split("\n")) {
        const dep = line.replace(/#.*/, "").trim();
        if (dep) {
          python.set(
            /^[A-Za-z0-9_.-]+/.exec(dep)?.[0]?.toLowerCase() ?? dep,
            dep,
          );
        }
      }
    }
  }
  const npmList = [...npm.keys()]
    .toSorted()
    .map((name) => npm.get(name) ?? name);
  const pyList = [...python.keys()]
    .toSorted()
    .map((name) => python.get(name) ?? name);
  const npmTaken = npmList.slice(0, cap);
  return { npm: npmTaken, python: pyList.slice(0, cap - npmTaken.length) };
}

/** The strings in `[project] dependencies = [...]`, comments dropped. */
function pyprojectDeps(text: string): string[] {
  const start = /^dependencies\s*=\s*\[/m.exec(text);
  if (!start) {
    return [];
  }
  const deps: string[] = [];
  let quote = "";
  let current = "";
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const char = text[i] ?? "";
    if (quote) {
      if (char === quote) {
        deps.push(current);
        current = "";
        quote = "";
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      i = text.indexOf("\n", i);
    } else if (char === "]") {
      break;
    }
  }
  return deps;
}

type Job = {
  /** Whether the escape got through, read from outside the sandbox. */
  escaped?: (run: ExecResult, cwd: string) => boolean;
  files?: Record<string, string>;
  id: string;
  kind: "escape" | "isolation" | "workload";
  /** Whether the job passed, where an exit code alone cannot say. */
  passed?: (run: ExecResult, cwd: string) => string | undefined;
  /** Runs outside the sandbox before the job, in its folder. */
  before?: (cwd: string) => void;
  script: (cwd: string) => string;
};

const PNPM = "pnpm add --loglevel=error";
const UV_VENV = "uv venv -q --python 3.12 .venv";
const zshrc = path.join(home, ".zshrc");
const autostart = mac
  ? path.join(home, "Library/LaunchAgents/x.plist")
  : path.join(home, ".config/autostart/x.desktop");
const secret = path.join(home, ".ssh/id_test");

const deps = registryDeps();
const jobs: Job[] = [
  {
    id: "sharp",
    kind: "workload",
    script: () =>
      `${PNPM} sharp && node -e "const s=require('sharp');s({create:{width:64,height:64,channels:3,background:'#f00'}}).png().toFile('in.png').then(()=>s('in.png').resize(16).toFile('out.png')).then(i=>{if(i.width!==16)process.exit(1)})"`,
  },
  {
    files: {
      "index.html":
        '<!doctype html><script type="module" src="/src/main.js"></script>',
      "src/main.js":
        "import { greet } from './greet.js';\ndocument.body.textContent = greet();\n",
      "src/greet.js": "export const greet = () => 'hi';\n",
    },
    id: "vite-esbuild",
    kind: "workload",
    script: () =>
      `${PNPM} --allow-build=esbuild esbuild vite && pnpm exec vite build --logLevel error && test -f dist/index.html && node -e "require('esbuild').buildSync({entryPoints:['src/main.js'],bundle:true,outfile:'out.js',logLevel:'error'})" && test -s out.js`,
  },
  {
    id: "better-sqlite3",
    kind: "workload",
    script: () =>
      `${PNPM} --allow-build=better-sqlite3 better-sqlite3 && node -e "const D=require('better-sqlite3');const d=new D('t.db');d.exec('create table t(x)');d.prepare('insert into t values (?)').run(42);if(d.prepare('select x from t').get().x!==42)process.exit(1)"`,
  },
  {
    files: {
      "run.py": [
        "import numpy as np, pandas as pd",
        "from PIL import Image",
        "import matplotlib; matplotlib.use('Agg')",
        "import matplotlib.pyplot as plt",
        "df = pd.DataFrame({'x': np.array(range(10)), 'y': np.array(range(10)) ** 2})",
        "plt.plot(df.x, df.y); plt.savefig('plot.png')",
        "Image.open('plot.png').resize((32, 32)).save('thumb.png')",
        "assert df.y.sum() == 285",
      ].join("\n"),
    },
    id: "uv-scipy",
    kind: "workload",
    script: () =>
      `${UV_VENV} && uv pip install -q --python .venv numpy pandas pillow matplotlib && .venv/bin/python run.py && test -s thumb.png`,
  },
  {
    id: "ffmpeg",
    kind: "workload",
    script: () =>
      "ffmpeg -v error -y -f lavfi -i testsrc=duration=2:size=320x240:rate=15 -pix_fmt yuv420p -c:v mpeg4 in.mp4 && ffmpeg -v error -y -i in.mp4 -vf scale=160:-2 -c:v mpeg4 out.mkv && test -s out.mkv",
  },
  {
    id: "git",
    kind: "workload",
    script: () =>
      "git clone -q --depth 1 https://github.com/octocat/Hello-World.git hw && cd hw && echo probe > note.txt && git add note.txt && git -c user.name=probe -c user.email=probe@example.invalid commit -qm probe && git log --oneline -1",
  },
  {
    id: "registry-deps",
    kind: "workload",
    script: () =>
      [
        deps.npm.length > 0
          ? `${PNPM} ${deps.npm.map(shellQuote).join(" ")}`
          : "true",
        deps.python.length > 0
          ? `${UV_VENV} && uv pip install -q --python .venv ${deps.python.map(shellQuote).join(" ")}`
          : "true",
      ].join(" && "),
  },
  {
    escaped: (run) => run.stdout.includes(MARKER),
    id: "read-ssh",
    kind: "escape",
    script: () => `cat "$HOME/.ssh/id_test"`,
  },
  {
    escaped: () => readFileSync(zshrc, "utf8").includes("probe-was-here"),
    id: "write-zshrc",
    kind: "escape",
    script: () => `echo probe-was-here >> "$HOME/.zshrc"`,
  },
  {
    escaped: () => existsSync(autostart),
    id: mac ? "write-launchagent" : "write-autostart",
    kind: "escape",
    script: () => `echo probe > ${shellQuote(autostart)}`,
  },
  {
    escaped: (run) => run.stdout.includes(MARKER),
    id: "symlink-ssh",
    kind: "escape",
    script: () => `ln -s "$HOME/.ssh" ssh-link; cat ssh-link/id_test`,
  },
  {
    escaped: (run, cwd) =>
      existsSync(path.join(cwd, "made-inside")) || run.stdout.includes(MARKER),
    id: "hardlink-create",
    kind: "escape",
    script: () => `ln "$HOME/.ssh/id_test" made-inside && cat made-inside`,
  },
  {
    // A hard link made before the sandbox, as if one were already there.
    before: (cwd) => linkSync(secret, path.join(cwd, "made-outside")),
    escaped: (run) => run.stdout.includes(MARKER),
    id: "hardlink-premade",
    kind: "escape",
    script: () => "cat made-outside",
  },
  {
    before: plantTheirSetup,
    id: "tool-isolation",
    kind: "isolation",
    passed: theirSetupUntouched,
    script: () =>
      [
        `printf '{"name":"t","private":true}' > package.json`,
        `${PNPM} is-number`,
        `node -e "require('is-number')"`,
        UV_VENV,
        "uv pip install -q --python .venv six",
        `.venv/bin/python -c "import six"`,
      ].join(" && "),
  },
  ...(mac
    ? [
        {
          escaped: (_run: ExecResult, cwd: string) =>
            existsSync(path.join(cwd, "into/id_test")),
          before: (cwd: string) => mkdirSync(path.join(cwd, "into")),
          id: "osascript-finder",
          kind: "escape" as const,
          script: (cwd: string) =>
            `osascript -e ${shellQuote(`tell application "Finder" to duplicate POSIX file "${secret}" to POSIX file "${path.join(cwd, "into")}"`)}`,
        },
      ]
    : []),
];

/**
 * A person's own setup, hostile to ours: config that would send an install
 * to a registry that does not answer, startup hooks that leave a mark when
 * they run, and look-alike binaries ahead on the PATH. The job passes only
 * if our tools ignore all of it and leave the person's caches as they were.
 */
const BOGUS = "http://127.0.0.1:9";
const RAN = path.join(home, "their-setup-ran");
const theirs = {
  bin: path.join(home, ".npm-global/bin"),
  hooks: path.join(home, "hooks"),
  /** The folders our tools must leave as they found them. */
  watched: inHome(
    ".npm",
    ".cache",
    ".local/share/pnpm",
    ".local/bin",
    ".pnpm-home",
    ...(mac
      ? ["Library/Caches/uv", "Library/Caches/pnpm", "Library/pnpm"]
      : []),
  ),
};
let theirListing = "";

function listing(): string {
  const lines: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      lines.push(full);
      if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  for (const dir of theirs.watched) {
    walk(dir);
  }
  return lines.sort().join("\n");
}

function plantTheirSetup(cwd: string) {
  const write = (file: string, text: string, mode?: number) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text, mode === undefined ? {} : { mode });
  };
  rmSync(RAN, { force: true });
  write(
    path.join(home, ".npmrc"),
    `registry=${BOGUS}/\nignore-scripts=false\n`,
  );
  write(path.join(home, ".config/pnpm/rc"), `registry=${BOGUS}/\n`);
  write(
    path.join(home, ".config/uv/uv.toml"),
    `index-url = "${BOGUS}/simple"\n`,
  );
  write(
    path.join(path.dirname(cwd), "uv.toml"),
    `index-url = "${BOGUS}/simple"\n`,
  );
  for (const pipConf of [
    path.join(home, ".config/pip/pip.conf"),
    path.join(home, ".pip/pip.conf"),
    ...(mac
      ? [path.join(home, "Library/Application Support/pip/pip.conf")]
      : []),
  ]) {
    write(pipConf, `[global]\nindex-url = ${BOGUS}/simple\n`);
  }
  const mark = `require("fs").appendFileSync(${JSON.stringify(RAN)}, "node\\n");`;
  write(path.join(theirs.hooks, "preload.cjs"), mark);
  write(
    path.join(theirs.hooks, "sitecustomize.py"),
    `open(${JSON.stringify(RAN)}, "a").write("python\\n")\n`,
  );
  for (const name of ["pnpm", "node", "uv", "python3", "python"]) {
    write(
      path.join(theirs.bin, name),
      `#!/bin/sh\necho "${name}" >> ${shellQuote(RAN)}\nexit 1\n`,
      0o755,
    );
  }
  theirListing = listing();
}

function theirSetupUntouched(run: ExecResult): string | undefined {
  if (run.code !== 0) {
    return firstError(run.output) || `exit ${run.code}`;
  }
  if (existsSync(RAN)) {
    return `their setup ran: ${readFileSync(RAN, "utf8").trim().replaceAll("\n", ", ")}`;
  }
  const now = listing();
  if (now !== theirListing) {
    const before = new Set(theirListing.split("\n"));
    const added = now.split("\n").filter((line) => line && !before.has(line));
    return `wrote into their folders: ${added
      .slice(0, 3)
      .map((line) => line.replace(home, "~"))
      .join(", ")}`;
  }
  return undefined;
}

/** Plants the fixture home: a secret, a dotfile, and the folders a home has. */
function plantHome() {
  for (const dir of [
    ".ssh",
    ".cache",
    ".local/share",
    ".local/state",
    ...(mac
      ? ["Library/Caches", "Library/LaunchAgents"]
      : [".config/autostart"]),
  ]) {
    mkdirSync(path.join(home, dir), { recursive: true });
  }
  writeFileSync(secret, `${MARKER}\n`, { mode: 0o600 });
  writeFileSync(zshrc, "# fixture\n");
  rmSync(autostart, { force: true });
}

function firstError(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line =
    lines.find((l) =>
      /error|denied|not permitted|EACCES|EPERM|EROFS|read-only|no such file|fatal|failed|cannot/i.test(
        l,
      ),
    ) ??
    lines.at(-1) ??
    "";
  return line
    .replaceAll(home, "~")
    .replaceAll(granted, "<granted>")
    .slice(0, 160);
}

async function median(
  runner: Runner,
  env: NodeJS.ProcessEnv,
  n = 15,
): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const started = performance.now();
    await runner.exec("true", granted, env);
    times.push(performance.now() - started);
  }
  return Math.round(times.toSorted((a, b) => a - b)[Math.floor(n / 2)] ?? 0);
}

/**
 * Spawned the way the app spawns a native command: the host's environment
 * through the app's allowlist, here with the person's hostile setup in it,
 * then the app's own tool folders and binaries first on the PATH.
 */
const which = (name: string) =>
  path.dirname(
    spawnSync("sh", ["-c", `command -v ${name}`], {
      encoding: "utf8",
    }).stdout.trim() || `/usr/bin/${name}`,
  );
const theirEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_OPTIONS: `--require ${path.join(theirs.hooks, "preload.cjs")}`,
  NODE_PATH: theirs.hooks,
  PATH: `${theirs.bin}:${process.env.PATH ?? ""}`,
  PNPM_HOME: path.join(home, ".pnpm-home"),
  PYTHONPATH: theirs.hooks,
  PYTHONSTARTUP: path.join(theirs.hooks, "sitecustomize.py"),
};
const env: NodeJS.ProcessEnv = {
  ...inheritedEnv(theirEnv),
  CI: "1",
  HOME: home,
  PATH: [
    which("pnpm"),
    which("uv"),
    path.dirname(process.execPath),
    theirEnv.PATH,
  ].join(":"),
  ...nodeToolsEnvFor(appData),
  ...uvToolsEnvFor(appData),
  pnpm_config_update_notifier: "false",
};

plantHome();
const runner = await makeRunner(flags.runner, policy);
const only = flags.only?.split(",");
const results = [];
for (const job of jobs.filter((j) => !only || only.includes(j.id))) {
  const cwd = path.join(granted, job.id);
  rmSync(cwd, { force: true, recursive: true });
  mkdirSync(cwd, { recursive: true });
  for (const [name, content] of Object.entries(job.files ?? {})) {
    mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    writeFileSync(path.join(cwd, name), content);
  }
  job.before?.(cwd);
  const started = performance.now();
  const run = await runner.exec(job.script(cwd), cwd, env);
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  const failure = job.passed?.(run, cwd);
  const ok = job.passed
    ? failure === undefined
    : job.escaped
      ? !job.escaped(run, cwd)
      : run.code === 0;
  const result = {
    error: job.passed
      ? (failure ?? "")
      : ok && job.kind === "workload"
        ? ""
        : firstError(run.output),
    exit: run.code,
    id: job.id,
    kind: job.kind,
    ok,
    seconds,
  };
  results.push(result);
  console.error(`${job.id}: ${ok ? "pass" : "FAIL"} (${seconds}s)`);
}

const spawnMs = {
  none: await median(await makeRunner("none", policy), env),
  runner: await median(runner, env),
};
const workloads = results.filter(
  (r) => r.kind === "workload" || r.kind === "isolation",
);
const escapes = results.filter((r) => r.kind === "escape");
const summary = {
  escapesBlocked: `${escapes.filter((r) => r.ok).length}/${escapes.length}`,
  workloadsPassed: `${workloads.filter((r) => r.ok).length}/${workloads.length}`,
};

const rows = [
  ["job", "kind", "result", "seconds", "first error line"],
  ...results.map((r) => [
    r.id,
    r.kind,
    r.ok
      ? r.kind === "escape"
        ? "blocked"
        : "pass"
      : r.kind === "escape"
        ? "ESCAPED"
        : "FAIL",
    String(r.seconds),
    r.error,
  ]),
];
const widths =
  rows[0]?.map((_, i) =>
    Math.max(...rows.map((row) => (row[i] ?? "").length)),
  ) ?? [];
console.log(`runner ${runner.name} on ${process.platform} (${os.release()})`);
for (const row of rows) {
  console.log(
    row
      .map((cell, i) =>
        i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0),
      )
      .join("  "),
  );
}
console.log(
  `workloads ${summary.workloadsPassed}, escapes blocked ${summary.escapesBlocked}, spawn ${spawnMs.runner} ms (unwrapped ${spawnMs.none} ms)`,
);
if (flags.json) {
  writeFileSync(
    flags.json,
    `${JSON.stringify({ platform: process.platform, release: os.release(), results, runner: runner.name, spawnMs, summary, registryDeps: deps }, null, 2)}\n`,
  );
}
