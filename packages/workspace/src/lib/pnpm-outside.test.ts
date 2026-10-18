import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { AbsolutePathSchema } from "../schemas/paths";
import { chatLayout } from "../test/helpers/chat-layout";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import {
  installOutside,
  isRegistryRange,
  isRegistrySpec,
  lockfileReason,
  manifestReason,
  outsideArgs,
  outsidePlan,
  projectReason,
  workspaceManifestReason,
} from "./pnpm-outside";
import { outsidePnpmEnv } from "./run-pnpm";
import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workDir } from "./work-dir";

vi.mock(import("./run-pnpm"), async (importOriginal) => ({
  ...(await importOriginal()),
  runPnpmCommand: vi.fn(),
  runPnpmOutsideSandbox: vi.fn(),
}));

describe("isRegistrySpec", () => {
  it.each([
    "lodash",
    "lodash@4",
    "lodash@^4.17.0",
    "is-odd@3.0.1",
    "react@latest",
    "react@next",
    "foo@>=1 <2",
    "foo@1.x || 2.x",
    "@types/node",
    "@types/node@22",
    "JSONStream",
  ])("takes %s", (spec) => {
    expect(isRegistrySpec(spec)).toBe(true);
  });

  it.each([
    "file:../x",
    "foo@file:../x",
    "link:../x",
    "foo@link:/etc",
    "portal:../x",
    "workspace:*",
    "foo@workspace:^",
    "catalog:",
    "foo@npm:bar@1",
    "jsr:@std/path",
    "github:user/repo",
    "user/repo",
    "foo@user/repo",
    "git+https://github.com/x/y.git",
    "git+ssh://git@github.com/x/y.git",
    "https://example.com/x.tgz",
    "x.tgz",
    "x.tar.gz",
    "../x",
    "./x",
    "/abs/x",
    "C:\\x",
    "~/x",
    ".hidden",
    "_private",
    "foo@",
    "@scope",
    "@scope/",
    "",
  ])("refuses %s", (spec) => {
    expect(isRegistrySpec(spec)).toBe(false);
  });
});

describe("isRegistryRange", () => {
  it.each(["^1.2.3", "~1.2", "*", "", "latest", ">=1 <2", "npm:lodash@4"])(
    "takes %j",
    (specifier) => {
      expect(isRegistryRange(specifier)).toBe(true);
    },
  );

  it.each([
    "file:../x",
    "link:../x",
    "workspace:^",
    "catalog:",
    "catalog:react18",
    "user/repo",
    "github:user/repo",
    "https://x.test/y.tgz",
    "npm:file:../x",
    "npm:@scope",
    "runtime:22",
    "jsr:@std/path",
  ])("refuses %j", (specifier) => {
    expect(isRegistryRange(specifier)).toBe(false);
  });
});

describe("outsideArgs", () => {
  it.each<[string[], string[] | undefined]>([
    [
      ["add", "is-odd", "-D"],
      ["add", "is-odd", "-D", "--ignore-scripts", "--ignore-pnpmfile"],
    ],
    [
      ["i", "--frozen-lockfile"],
      [
        "i",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--config.confirm-modules-purge=false",
      ],
    ],
    [
      ["remove", "is-odd"],
      ["remove", "is-odd"],
    ],
    [
      ["update", "-L"],
      ["update", "-L", "--ignore-scripts", "--ignore-pnpmfile"],
    ],
    [
      ["up", "react@19"],
      ["up", "react@19", "--ignore-scripts", "--ignore-pnpmfile"],
    ],
    // Not a registry package, or an option that names a folder, a registry
    // or a setting: the sandbox, as before.
    [["add", "file:../x"], undefined],
    [["add", "is-odd", "../x"], undefined],
    [["add"], undefined],
    [["add", "--dir", "/tmp", "is-odd"], undefined],
    [["add", "-C", "/tmp", "is-odd"], undefined],
    [["add", "--registry=https://x.test", "is-odd"], undefined],
    [["add", "--config.ignore-scripts=false", "is-odd"], undefined],
    [["add", "-DE", "is-odd"], undefined],
    [["add", "--", "is-odd"], undefined],
    [["install", "is-odd"], undefined],
    [["install", "-r"], undefined],
    [["install", "--filter", "x"], undefined],
    [["remove", "is-odd@1"], undefined],
    [["remove"], undefined],
    [["update", "-i"], undefined],
    [["update", "@babel/*"], undefined],
    [["run", "build"], undefined],
    [["approve-builds"], undefined],
    [["dlx", "cowsay"], undefined],
    [[], undefined],
  ])("%j", (args, expected) => {
    expect(outsideArgs(args, "/p")).toEqual(
      expected && [...expected, "--dir", "/p"],
    );
  });
});

describe("manifestReason", () => {
  it.each<[unknown, string | undefined]>([
    [{}, undefined],
    [
      {
        dependencies: { "is-odd": "^3", alias: "npm:lodash@4" },
        devDependencies: { "@types/node": "*" },
        packageManager: "pnpm@9.0.0",
        scripts: { postinstall: "node build.js" },
      },
      undefined,
    ],
    [{ dependencies: { x: "file:../x" } }, "package.json dependencies names x"],
    [
      { optionalDependencies: { x: "github:a/b" } },
      "package.json optionalDependencies names x",
    ],
    [
      { peerDependencies: { x: "workspace:*" } },
      "package.json peerDependencies names x",
    ],
    [{ dependencies: { "../x": "1" } }, "package.json dependencies names ../x"],
    [{ dependencies: { x: 1 } }, "package.json dependencies names x"],
    [{ dependencies: [] }, "package.json dependencies is not an object"],
    [
      { devEngines: { runtime: { name: "node" } } },
      "package.json names a runtime",
    ],
    [
      { engines: { runtime: { name: "node" } } },
      "package.json names a runtime",
    ],
    [[], "package.json is not an object"],
  ])("%j", (manifest, reason) => {
    expect(manifestReason(manifest)).toBe(reason);
  });
});

/** A lockfile as pnpm 11 writes one for `pnpm add is-odd`. */
const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      is-odd:
        specifier: ^3.0.1
        version: 3.0.1

packages:

  is-number@6.0.0:
    resolution: {integrity: sha512-Wu1VHeILBK8KAWJUAiSZQX94GmOE45Rg6/538fKwiloUu21KncEkYGPqob2oSZ5mUT73vLGrHQjKw3KMPwfDzg==}
    engines: {node: '>=0.10.0'}

  is-odd@3.0.1:
    resolution: {integrity: sha512-CQpnWPrDwmP1+SMHXZhtLtJv90yiyVfluGsX5iNCVkrhQtU3TQHsUWPG9wkdk9Lgd5yNpAg9jQEo90CBaXgWMA==}
    engines: {node: '>=4'}

snapshots:

  is-number@6.0.0: {}

  is-odd@3.0.1:
    dependencies:
      is-number: 6.0.0
`;

describe("lockfileReason", () => {
  it("takes a lockfile of registry packages", () => {
    expect(lockfileReason(LOCKFILE)).toBeUndefined();
  });

  it("takes the environment lockfile pnpm writes before the main one", () => {
    expect(
      lockfileReason(
        `---\nlockfileVersion: '9.0'\nimporters:\n  .: {}\n---\n${LOCKFILE}`,
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      LOCKFILE.replace(
        "resolution: {integrity: sha512-Wu1",
        "resolution: {directory: ../../secret, type: directory, integrity: sha512-Wu1",
      ),
      "pnpm-lock.yaml resolves is-number@6.0.0 off the registry",
    ],
    [
      LOCKFILE.replace(
        /resolution: \{integrity: sha512-CQ[^}]*\}/,
        "resolution: {tarball: file:x.tgz}",
      ),
      "pnpm-lock.yaml resolves is-odd@3.0.1 off the registry",
    ],
    [
      LOCKFILE.replace("is-number: 6.0.0\n", "is-number: link:../../x\n"),
      "pnpm-lock.yaml snapshot is-odd@3.0.1 links off the registry",
    ],
    [
      LOCKFILE.replace("specifier: ^3.0.1", "specifier: file:../x"),
      "pnpm-lock.yaml names is-odd",
    ],
    [
      LOCKFILE.replace("version: 3.0.1", "version: link:../x"),
      "pnpm-lock.yaml names is-odd",
    ],
    [
      LOCKFILE.replace("  .:\n", "  packages/a:\n"),
      "pnpm-lock.yaml has the importer packages/a",
    ],
    [
      `${LOCKFILE}\noverrides:\n  is-number: file:../x\n`,
      "pnpm-lock.yaml has overrides",
    ],
    ["a: [", "pnpm-lock.yaml does not parse"],
    ["- 1\n", "pnpm-lock.yaml is not an object"],
  ])("refuses a changed lockfile (%#)", (text, reason) => {
    expect(lockfileReason(text)).toBe(reason);
  });
});

describe("workspaceManifestReason", () => {
  it.each<[string, string | undefined]>([
    ["", undefined],
    ["allowBuilds:\n  esbuild: true\n", undefined],
    [
      "onlyBuiltDependencies:\n  - esbuild\nminimumReleaseAge: 1440\n",
      undefined,
    ],
    ["packages:\n  - '*'\n", "pnpm-workspace.yaml sets packages"],
    ["overrides:\n  x: file:../x\n", "pnpm-workspace.yaml sets overrides"],
    [
      "configDependencies:\n  x: 1.0.0\n",
      "pnpm-workspace.yaml sets configDependencies",
    ],
    ["storeDir: /tmp/x\n", "pnpm-workspace.yaml sets storeDir"],
    ["virtualStoreDir: ../../x\n", "pnpm-workspace.yaml sets virtualStoreDir"],
    ["ignoreScripts: false\n", "pnpm-workspace.yaml sets ignoreScripts"],
    ["- 1\n", "pnpm-workspace.yaml is not an object"],
    ["a: 1\n---\nb: 2\n", "pnpm-workspace.yaml does not parse"],
  ])("%j", (text, reason) => {
    expect(workspaceManifestReason(text)).toBe(reason);
  });
});

describe("projectReason", () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    root = realpathSync.native(
      mkdtempSync(path.join(os.tmpdir(), "pnpm-outside-")),
    );
    project = path.join(root, "project");
    mkdirSync(
      path.join(project, "node_modules", ".pnpm", "a@1", "node_modules", "a"),
      {
        recursive: true,
      },
    );
    writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ dependencies: { a: "1" } }),
    );
    writeFileSync(path.join(project, "pnpm-lock.yaml"), LOCKFILE);
  });

  it("takes a project of registry packages, with pnpm's own links", () => {
    // A junction on Windows, as pnpm makes there; the type is ignored
    // elsewhere.
    symlinkSync(
      path.join(project, "node_modules", ".pnpm", "a@1", "node_modules", "a"),
      path.join(project, "node_modules", "a"),
      "junction",
    );
    writeFileSync(
      path.join(project, "pnpm-workspace.yaml"),
      "allowBuilds:\n  esbuild: true\n",
    );
    expect(projectReason(project)).toBeUndefined();
  });

  it.each([
    {
      above: "packages:\n  - '*'\n",
      name: "its own pnpm-workspace.yaml stops pnpm's look",
      own: "allowBuilds:\n  esbuild: true\n",
    },
    {
      above: "allowBuilds:\n  esbuild: true\n",
      name: "a workspace above lists no packages and it has a package.json",
      own: undefined,
    },
  ])("takes a project when $name", ({ above, own }) => {
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), above);
    if (own !== undefined) {
      writeFileSync(path.join(project, "pnpm-workspace.yaml"), own);
    }
    expect(projectReason(project)).toBeUndefined();
  });

  it("keeps a folder with no package.json under a workspace in the sandbox", () => {
    writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      "allowBuilds:\n  esbuild: true\n",
    );
    const empty = path.join(root, "empty");
    mkdirSync(empty);
    expect(projectReason(empty)).toMatch(
      /pnpm-workspace\.yaml is above the project$/,
    );
  });

  it("takes a folder with nothing in it yet", () => {
    const empty = path.join(root, "empty");
    mkdirSync(empty);
    expect(projectReason(empty)).toBeUndefined();
  });

  it.each(
    [
      {
        name: "a link in node_modules leading out of the project",
        plant: () => {
          mkdirSync(path.join(root, "elsewhere"));
          symlinkSync(
            path.join(root, "elsewhere"),
            path.join(
              project,
              "node_modules",
              ".pnpm",
              "a@1",
              "node_modules",
              "b",
            ),
            "junction",
          );
        },
        reason:
          /node_modules[\\/]\.pnpm[\\/]a@1[\\/]node_modules[\\/]b leads out of the project$/,
      },
      {
        name: "a link that leads nowhere",
        plant: () => {
          symlinkSync(
            path.join(root, "no-such-folder"),
            path.join(project, "node_modules", ".pnpm", "gone"),
            "junction",
          );
        },
        reason: /node_modules[\\/]\.pnpm[\\/]gone leads out of the project$/,
      },
      {
        name: "node_modules itself a link",
        plant: () => {
          const modules = path.join(project, "node_modules");
          renameSync(modules, path.join(root, "modules"));
          symlinkSync(path.join(root, "modules"), modules, "junction");
        },
        reason: /^node_modules is not a folder$/,
      },
      {
        fileLink: true,
        name: "package.json a link",
        plant: () => {
          writeFileSync(path.join(root, "secret.json"), "{}");
          renameSync(
            path.join(project, "package.json"),
            path.join(root, "old.json"),
          );
          symlinkSync(
            path.join(root, "secret.json"),
            path.join(project, "package.json"),
          );
        },
        reason: /^package.json is not a plain file$/,
      },
      {
        name: "package.json with a second name",
        plant: () => {
          linkSync(
            path.join(project, "package.json"),
            path.join(root, "second.json"),
          );
        },
        reason: /^package.json is not a plain file$/,
      },
      {
        fileLink: true,
        name: "pnpm-lock.yaml a link",
        plant: () => {
          writeFileSync(path.join(root, "lock.yaml"), LOCKFILE);
          renameSync(
            path.join(project, "pnpm-lock.yaml"),
            path.join(root, "old.yaml"),
          );
          symlinkSync(
            path.join(root, "lock.yaml"),
            path.join(project, "pnpm-lock.yaml"),
          );
        },
        reason: /^pnpm-lock.yaml is not a plain file$/,
      },
      ...[
        ".npmrc",
        ".pnpmfile.cjs",
        ".pnpmfile.mjs",
        "package.yaml",
        "pnpm-workspace.yml",
      ].map((name) => ({
        name: `a ${name}`,
        plant: () => {
          writeFileSync(path.join(project, name), "");
        },
        reason: new RegExp(`^the project has ${name.replaceAll(".", "\\.")}$`),
      })),
      {
        name: "a file: dependency",
        plant: () => {
          writeFileSync(
            path.join(project, "package.json"),
            JSON.stringify({ dependencies: { x: "file:../x" } }),
          );
        },
        reason: /^package.json dependencies names x$/,
      },
      {
        name: "a workspace above it listing packages",
        plant: () => {
          writeFileSync(
            path.join(root, "pnpm-workspace.yaml"),
            "packages: []\n",
          );
        },
        reason: /pnpm-workspace\.yaml is above the project$/,
      },
      {
        name: "settings beyond the build approvals",
        plant: () => {
          writeFileSync(
            path.join(project, "pnpm-workspace.yaml"),
            "virtualStoreDir: ../../x\n",
          );
        },
        reason: /^pnpm-workspace.yaml sets virtualStoreDir$/,
      },
    ].filter(
      // A link to a file takes a privilege Windows does not give by default.
      (each) => process.platform !== "win32" || !("fileLink" in each),
    ),
  )("keeps $name in the sandbox", ({ plant, reason }) => {
    plant();
    expect(projectReason(project)).toMatch(reason);
  });
});

describe("outsidePnpmEnv", () => {
  // Nothing the shell or the app's own environment says about pnpm, Node or
  // a program to run reaches the install step.
  it("is built from the app's environment and the install settings alone", () => {
    const env = outsidePnpmEnv({
      appEnv: {
        API_KEY: "secret",
        HOME: "/Users/sam",
        HTTPS_PROXY: "http://proxy.test:8080",
        NODE_OPTIONS: "--require /tmp/evil.js",
        PATH: "/Users/sam/bin:/usr/bin",
        TMPDIR: "/var/folders/x",
        npm_config_ignore_scripts: "false",
        pnpm_config_ignore_scripts: "false",
        pnpm_config_store_dir: "/tmp/elsewhere",
      },
      install: {
        TMPDIR: "/runtime/install/caches/tmp",
        pnpm_config_ignore_scripts: "true",
        pnpm_config_store_dir: "/runtime/install/caches/pnpm-store",
      },
      nodeExecEnv: { ELECTRON_RUN_AS_NODE: "1" },
      platform: "darwin",
    });
    expect(env).toMatchInlineSnapshot(`
      {
        "ELECTRON_RUN_AS_NODE": "1",
        "HOME": "/Users/sam",
        "HTTPS_PROXY": "http://proxy.test:8080",
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "TMPDIR": "/runtime/install/caches/tmp",
        "pnpm_config_ignore_scripts": "true",
        "pnpm_config_reporter": "append-only",
        "pnpm_config_store_dir": "/runtime/install/caches/pnpm-store",
      }
    `);
  });

  it("puts the system's own folders on the PATH on Windows", () => {
    expect(
      outsidePnpmEnv({
        appEnv: { PATH: "C:\\Users\\sam\\bin", SystemRoot: "C:\\Windows" },
        install: {},
        nodeExecEnv: {},
        platform: "win32",
      }).PATH,
    ).toBe("C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem");
  });
});

describe("outsidePlan", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("pnpm-outside"));
  let work: string;

  beforeEach(() => {
    work = workDir(chatId);
    mkdirSync(work, { recursive: true });
    // An executable no rule lets the chat change stands in for the app's
    // pnpm.
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      pnpmBinPath: AbsolutePathSchema.parse(process.execPath),
    });
  });

  it("plans an add in the work folder outside, naming the project", () => {
    const plan = outsidePlan({
      args: ["add", "is-odd"],
      cwd: work,
      layout: chatLayout(chatId),
    });
    expect(plan?.project).toBe(realpathSync.native(work));
    expect(plan?.args).toEqual([
      "add",
      "is-odd",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--dir",
      realpathSync.native(work),
    ]);
  });

  it("finds the project above the folder the command runs in", () => {
    writeFileSync(path.join(work, "package.json"), "{}");
    const sub = path.join(work, "src");
    mkdirSync(sub, { recursive: true });
    expect(
      outsidePlan({ args: ["install"], cwd: sub, layout: chatLayout(chatId) })
        ?.project,
    ).toBe(realpathSync.native(work));
  });

  it("leaves a folder the chat may not change to the sandbox", () => {
    const outside = realpathSync.native(
      mkdtempSync(path.join(os.tmpdir(), "pnpm-outside-unreached-")),
    );
    expect(
      outsidePlan({
        args: ["add", "is-odd"],
        cwd: outside,
        layout: chatLayout(chatId),
      }),
    ).toBeUndefined();
  });

  it("leaves everything to the sandbox when the chat may change pnpm", () => {
    const pnpm = path.join(work, "pnpm", "bin", "pnpm.mjs");
    mkdirSync(path.dirname(pnpm), { recursive: true });
    writeFileSync(pnpm, "");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      pnpmBinPath: AbsolutePathSchema.parse(pnpm),
    });
    expect(
      outsidePlan({
        args: ["add", "is-odd"],
        cwd: work,
        layout: chatLayout(chatId),
      }),
    ).toBeUndefined();
  });
});

describe("installOutside", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("pnpm-outside-run"));
  let project: string;
  let store: string;

  beforeEach(async () => {
    project = realpathSync.native(
      mkdtempSync(path.join(os.tmpdir(), "pnpm-outside-run-")),
    );
    mkdirSync(path.join(project, "node_modules"));
    store = path.join(
      runtimeLayout(getWorkspaceConfig().runtimeDir).installCaches,
      "pnpm-store",
    );
    const { runPnpmCommand, runPnpmOutsideSandbox } =
      await import("./run-pnpm");
    vi.mocked(runPnpmCommand).mockReset();
    vi.mocked(runPnpmOutsideSandbox).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function modules(fields: Record<string, unknown>) {
    writeFileSync(
      path.join(project, "node_modules", ".modules.yaml"),
      JSON.stringify(fields, null, 2),
    );
  }

  const ok = (stdout: string) => ({
    command: "pnpm",
    exitCode: 0,
    stderr: "",
    stdout,
  });

  it("runs the skipped install scripts in the sandbox, from the install store", async () => {
    const { runPnpmCommand, runPnpmOutsideSandbox } =
      await import("./run-pnpm");
    vi.mocked(runPnpmOutsideSandbox).mockImplementation(() => {
      modules({
        pendingBuilds: ["esbuild@0.28.2"],
        storeDir: path.join(store, "v11"),
      });
      return Promise.resolve(ok("+ esbuild 0.28.2\n"));
    });
    vi.mocked(runPnpmCommand).mockImplementation(() => {
      modules({
        ignoredBuilds: ["esbuild@0.28.2"],
        pendingBuilds: [],
        storeDir: path.join(store, "v11"),
      });
      return Promise.resolve(ok(""));
    });

    const result = await installOutside({
      chatId,
      env: { SHELL_VAR: "1" },
      plan: { args: ["add", "esbuild"], project },
    });

    expect(vi.mocked(runPnpmCommand).mock.calls[0]?.[0]).toMatchObject({
      args: ["rebuild", "--pending"],
      cwd: project,
      env: { SHELL_VAR: "1" },
      pnpmConfig: {
        pnpm_config_frozen_store: "true",
        pnpm_config_side_effects_cache: "false",
        pnpm_config_store_dir: store,
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "+ esbuild 0.28.2
      Ignored build scripts: esbuild@0.28.2.
      Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
      "
    `);
  });

  it("runs no build when nothing is pending", async () => {
    const { runPnpmCommand, runPnpmOutsideSandbox } =
      await import("./run-pnpm");
    vi.mocked(runPnpmOutsideSandbox).mockImplementation(() => {
      modules({ pendingBuilds: [], storeDir: path.join(store, "v11") });
      return Promise.resolve(ok("+ is-odd 3.0.1\n"));
    });

    const result = await installOutside({
      chatId,
      env: {},
      plan: { args: ["add", "is-odd"], project },
    });

    expect(runPnpmCommand).not.toHaveBeenCalled();
    expect(result).toMatchObject({ exitCode: 0, stdout: "+ is-odd 3.0.1\n" });
  });

  it("installs a project linked from another store again before adding to it", async () => {
    const { runPnpmOutsideSandbox } = await import("./run-pnpm");
    modules({ pendingBuilds: [], storeDir: "/runtime/caches/pnpm-store/v11" });
    vi.mocked(runPnpmOutsideSandbox).mockImplementation(({ args }) => {
      modules({ pendingBuilds: [], storeDir: path.join(store, "v11") });
      return Promise.resolve(ok(`${args[0] ?? ""}\n`));
    });

    const result = await installOutside({
      chatId,
      env: {},
      plan: { args: ["add", "is-odd", "--dir", project], project },
    });

    expect(
      vi.mocked(runPnpmOutsideSandbox).mock.calls.map(([call]) => call.args),
    ).toEqual([
      [
        "install",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--config.confirm-modules-purge=false",
        "--dir",
        project,
      ],
      ["add", "is-odd", "--dir", project],
    ]);
    expect(result.stdout).toBe("install\nadd\n");
  });

  it("stops at an install that failed", async () => {
    const { runPnpmCommand, runPnpmOutsideSandbox } =
      await import("./run-pnpm");
    vi.mocked(runPnpmOutsideSandbox).mockResolvedValue({
      command: "pnpm",
      exitCode: 1,
      stderr: "ERR_PNPM_FETCH_404\n",
      stdout: "",
    });

    const result = await installOutside({
      chatId,
      env: {},
      plan: { args: ["add", "no-such-package"], project },
    });

    expect(runPnpmCommand).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      exitCode: 1,
      stderr: "ERR_PNPM_FETCH_404\n",
    });
  });
});
