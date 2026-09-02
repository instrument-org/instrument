/**
 * Where a model id places itself in its author's release order.
 *
 * Read off the id alone, because that is the only thing every provider gives
 * us. A release date is not: Google's model list carries none at all, and
 * OpenAI's and Anthropic's carry one only when the entry happens to have it.
 */
export interface ModelRelease {
  /**
   * A dated or numbered build of the same release, when the id carries one:
   * `0731` on `deepseek-v4-flash-0731`, `2026-01-15` on a dated OpenAI build.
   * Absent on an undated id, which sorts below every dated build of its series.
   */
  build: number | undefined;
  /**
   * The author's line as a whole, which is the id up to its first digit:
   * `claude`, `gemini`, `qwen`. Coarse on purpose, so that tiers spelled before
   * the version (`claude-haiku-4.5`) and after it (`gemini-3.7-flash`) both
   * land in one family.
   */
  family: string;
  /**
   * How many segments hedge the id rather than name the model: `preview`,
   * `latest`, and a serving variant such as `:free`. Only a tiebreak, so that
   * `gemini-3.1-flash-lite` is preferred to the preview beside it.
   */
  qualifierCount: number;
  /**
   * The one line this model is a release of, version stripped: every
   * `gemini-N-flash` shares a series, and `gemini-N-pro` is a different one.
   * A tier is part of the series because a smaller tier is a different choice
   * rather than the same one at a discount.
   */
  series: string;
  /** The release number: `3.7` from `gemini-3.7-flash`, `4` from `kimi-k4`. */
  version: number;
}

/**
 * The first segment carrying a version, and what it reads as. The digits are
 * the version and any letters before them belong to the line (`v` in
 * `deepseek-v4`, `k` in `kimi-k2.7`, `qwen` in `qwen3.8`). A letter *after* the
 * digits means the segment names something else, so `glm-5v` and `gpt-4o` are
 * left unversioned rather than read as GLM 5 and GPT 4.
 */
const VERSION_SEGMENT = /^(\D*)(\d+(?:\.\d+)?)$/;

const BUILD_SEGMENT = /^\d+$/;

const QUALIFIER_SEGMENTS = new Set([
  "alpha",
  "beta",
  "exp",
  "experimental",
  "latest",
  "preview",
  "stable",
]);

/**
 * Whether `release` is a later release of the same line than `against`. Only
 * meaningful for two models of one series, since a version number means
 * nothing across lines.
 */
export function outranksRelease(
  release: ModelRelease,
  against: ModelRelease,
): boolean {
  if (release.version !== against.version) {
    return release.version > against.version;
  }

  const build = release.build ?? 0;
  const againstBuild = against.build ?? 0;
  if (build !== againstBuild) {
    return build > againstBuild;
  }

  return release.qualifierCount < against.qualifierCount;
}

/**
 * Reads a canonical id as a point in a release order, or returns undefined when
 * the id carries no version at all (`auto`, `gpt-oss-120b`, `deepseek-chat`).
 * An unversioned id has nothing to be newer or older than, so callers that rank
 * releases against each other leave it out rather than guessing.
 */
export function readModelRelease(
  canonicalId: string,
): ModelRelease | undefined {
  // OpenRouter spells a serving variant after a colon (`:free`, `:exacto`).
  // That names how the same weights are served, not which release they are.
  const [bare = canonicalId, ...servingVariants] = canonicalId.split(":");
  const segments = bare.split("-");

  let versionIndex = -1;
  let version = 0;
  let lineLetters = "";
  for (const [index, segment] of segments.entries()) {
    const match = VERSION_SEGMENT.exec(segment);
    if (match?.[2]) {
      versionIndex = index;
      version = Number.parseFloat(match[2]);
      lineLetters = match[1] ?? "";
      break;
    }
  }

  if (versionIndex === -1) {
    return undefined;
  }

  const afterVersion = segments.slice(versionIndex + 1);

  // A build number sits at the end of the id and is digits and dashes only, so
  // walk back from the end for as long as the segments are numeric.
  let buildStart = afterVersion.length;
  while (BUILD_SEGMENT.test(afterVersion[buildStart - 1] ?? "")) {
    buildStart -= 1;
  }
  const build = afterVersion.slice(buildStart).join("");

  const named = afterVersion.slice(0, buildStart);
  const tier = named.filter((segment) => !QUALIFIER_SEGMENTS.has(segment));
  const stem = [...segments.slice(0, versionIndex), lineLetters]
    .filter(Boolean)
    .join("-");
  const head = segments[0] ?? bare;

  return {
    build: build === "" ? undefined : Number.parseInt(build, 10),
    family: head.replace(/\d.*$/, "") || head,
    qualifierCount: named.length - tier.length + servingVariants.length,
    // Separated so that a tier spelled into the stem cannot collide with the
    // same word read as a tier: `gpt-luna-5.6` is not `gpt-5.6-luna`.
    series: `${stem}|${tier.join("-")}`,
    version,
  };
}
