import { type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";

export type SkillSource =
  RPCOutput["workspace"]["skill"]["list"][number]["source"];

// A skill we ship reads as one thing whether it came from the bundle or the
// registry, so both collapse to the app's own name.
const PROVIDED_LABEL = APP_NAME;

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

/**
 * Why a skill offers no edit or delete action, in terms of where it came from.
 * Only the workspace's writable skills folder is editable, and everything else
 * is read-only for a different reason worth naming.
 */
export function readOnlySkillReason(source: SkillSource) {
  if (isProvidedSource(source)) {
    return `This skill is built into ${APP_NAME}, so it can’t be edited or deleted.`;
  }
  if (source === "agents" || source === "workspace") {
    return `This skill lives outside the skills folder ${APP_NAME} manages, so it can’t be edited or deleted here.`;
  }
  return `This skill comes from ${skillSourceLabel(source)}, so it can’t be edited or deleted here.`;
}

/**
 * Where a skill sits, for a surface with room for one line of it: the folder
 * on disk, or the app itself for the ones we ship, whose location is an
 * internal detail nobody can act on.
 */
export function skillLocationHint({
  path,
  source,
}: {
  path: string;
  source: SkillSource;
}) {
  return isProvidedSource(source) ? `Built into ${APP_NAME}` : path;
}

/** The app or place a skill comes from, named for a person. */
export function skillSourceLabel(source: SkillSource) {
  return SOURCE_LABELS[source];
}
