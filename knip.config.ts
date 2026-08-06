import type { KnipConfig } from "knip";

// A `!` suffix marks a pattern as production, i.e. kept under `knip --production`
// (`pnpm check:unused:production`), which drops test files and everything they
// reach. Every non-test entry carries it so that run reports the code whose only
// consumers are tests. `"!<pattern>!"` is the inverse: negated in production only,
// which is how test support files stay out of that run without being ignored in
// the default one.
//
// knip's default project glob (its extension list plus the css the postcss plugin
// adds), restated so a workspace can pair it with a production-only negation.
const projectFiles = "**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,css}!";

const config: KnipConfig = {
  ignore: ["registry/**/*", ".agents/skills/**/*", ".claude/skills/**/*"],
  // Namespace members are exported for organization (see AGENTS.md), not always
  // consumed cross-file. knip 5 did not check them; keep that scope under knip 6.
  rules: {
    namespaceMembers: "off",
  },
  workspaces: {
    ".": {
      entry: ["scripts/*.ts!"],
      ignoreBinaries: ["actionlint", "electron"],
      ignoreDependencies: [
        "@instrument-org/agent-hooks", // Used in .codex/hooks.json and .claude/settings.json hook commands
        "tailwindcss", // Runtime dependency of oxlint-tailwindcss
        "markdownlint", // markdownlint used by VSCode Extension for the markdownlint/style/prettier
        "chrome-devtools-mcp", // Used in .agents/skills/studio-chrome-devtools/scripts/connect-cli.sh
      ],
    },
    "apps/studio": {
      entry: [
        "scripts/*.{ts,tsx,js}!",
        "electron-builder/win-cloud-hsm-sign.js!",
        "src/client/components/ui/*.tsx!",
        "src/client/router.tsx!",
        "src/client/main.tsx!",
        "src/electron-main/index.ts!",
        "src/electron-preload/index.ts!",
        "src/client/routes/_app/debug/-sessions/data/*.ts!",
        "electron.vite.config.ts!",
        "src/index.html!",
        // Browser build: reached through Vite aliases, which knip cannot follow.
        "web/index.html!",
        "web/src/mock-rpc.ts!",
        "web/src/shims/*.ts!",
        "electron-builder.ts!",
        "validate-env.ts!",
      ],
      ignoreBinaries: [
        "tail",
        "op",
        "gh",
        "powershell.exe",
        "which",
        "xdg-open",
      ],
      ignoreDependencies: [
        "ffmpeg-ffprobe-static", // Imported in Vite build to fix import issues
        "dugite", // Needed to ensure the git binary is available
        "agent-browser", // Imported in Vite build to resolve the binary path
        "@parcel/watcher", // Needed for electron.vite.config.ts to build
      ],
      paths: {
        "@/*": ["src/*"],
      },
      postcss: true, // Not getting picked up by the plugin
      project: [projectFiles, "!src/tests/**!"],
    },
    "packages/ai-gateway": {
      project: [projectFiles, "!src/test/**!"],
    },
    "packages/eslint-config": {
      ignore: ["ignore.ts"],
    },
    "packages/shim-client": {
      entry: ["src/client/index.ts!"],
    },
    "packages/typescript-config": {},
    "packages/workspace": {
      // The eval and script trees are reached through package.json scripts, which
      // knip drops in production mode; name them so only tests get dropped there.
      // The default run calls `evals/cli.ts!` redundant for that reason: keep it.
      entry: ["__mocks__/*", "evals/cli.ts!", "scripts/*.ts!"],
      ignore: ["fixtures/**/*"],
      ignoreBinaries: ["which", "ldd", "xcode-select"],
      project: [projectFiles, "!src/test/**!"],
    },
  },
};

export default config;
