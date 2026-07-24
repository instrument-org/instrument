import { type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";

export type SkillSource =
  RPCOutput["workspace"]["skill"]["list"][number]["source"];

// A skill we ship reads as one thing whether it came from the bundle or the
// registry, so both collapse to this label.
const PROVIDED_LABEL = `Provided by ${APP_NAME}`;

// Each source names the app or place its skills come from, for a person. The
// folder on disk is shown separately, as secondary detail.
const SOURCE_LABELS: Record<SkillSource, string> = {
  agents: "Agent skills",
  antigravity: "Antigravity",
  claude: "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  gemini: "Gemini",
  goose: "Goose",
  kiro: "Kiro",
  opencode: "OpenCode",
  registry: PROVIDED_LABEL,
  system: PROVIDED_LABEL,
  windsurf: "Windsurf",
  workspace: "Your workspace",
};

// Skills Instrument itself ships; where they sit on disk is an internal detail.
export function isProvidedSource(source: SkillSource) {
  return source === "registry" || source === "system";
}

/** The app or place a skill comes from, named for a person. */
export function skillSourceLabel(source: SkillSource) {
  return SOURCE_LABELS[source];
}
