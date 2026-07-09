import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignore: [
    "registry/**/*",
    ".agents/**/*",
    ".cursor/**/*",
    ".claude/worktrees/**/*",
  ],
  // Namespace members are exported for organization (see AGENTS.md), not always
  // consumed cross-file. knip 5 did not check them; keep that scope under knip 6.
  rules: {
    namespaceMembers: "off",
  },
  workspaces: {
    ".": {
      entry: ["scripts/*.ts"],
      ignoreBinaries: ["actionlint", "electron"],
      ignoreDependencies: [
        "@instrument-org/agent-hooks", // Used in .codex/hooks.json and .claude/settings.json hook commands
        "@posthog/cli", // Used in .github/workflows/release.yml to upload source maps to PostHog
        "tailwindcss", // Runtime dependency of oxlint-tailwindcss
        "markdownlint", // markdownlint used by VSCode Extension for the markdownlint/style/prettier
        "chrome-devtools-mcp", // Used in .agents/skills/studio-chrome-devtools/scripts/connect-cli.sh
      ],
    },
    "apps/api": {
      entry: ["scripts/*.{ts,tsx}"],
    },
    "apps/studio": {
      entry: [
        "scripts/*.{ts,tsx,js}",
        "electron-builder/win-cloud-hsm-sign.js",
        "src/client/components/ui/*.tsx",
        "src/client/routeTree.gen.ts",
        "src/client/router.tsx",
        "src/client/main.tsx",
        "src/electron-main/index.ts",
        "src/electron-preload/index.ts",
        "src/client/routes/_app/debug/-sessions/data/*.ts",
        "electron.vite.config.ts",
        "src/index.html",
        "electron-builder.ts",
        "validate-env.ts",
      ],
      ignore: ["fixtures/**/*", "templates/**/*", "__mocks__/**/*"],
      ignoreBinaries: [
        "tail",
        "op",
        "gh",
        "powershell.exe",
        "which",
        "xdg-open",
      ],
      ignoreDependencies: [
        "@derhuerst/ffprobe-static", // Imported in Vite build to fix import issues
        "ffmpeg-static", // Imported in Vite build to fix import issues
        "dugite", // Needed to ensure the git binary is available
        "babel-plugin-react-compiler", // Used in electron.vite.config.ts as Babel plugin
        "agent-browser", // Imported in Vite build to resolve the binary path
        "@parcel/watcher", // Needed for electron.vite.config.ts to build
      ],
      paths: {
        "@/*": ["src/*"],
      },
      postcss: true, // Not getting picked up by the plugin
    },
    "packages/components": {
      entry: ["index.html", "src/main.tsx"],
      ignoreDependencies: ["tailwindcss"],
    },
    "packages/eslint-config": {
      ignore: ["ignore.ts"],
    },
    "packages/shim-client": {
      entry: ["src/client/index.ts", "src/iframe/index.tsx"],
    },
    "packages/typescript-config": {},
    "packages/workspace": {
      entry: ["__mocks__/*"],
      ignore: ["fixtures/**/*"],
      ignoreBinaries: ["which", "ldd"],
    },
  },
};

export default config;
