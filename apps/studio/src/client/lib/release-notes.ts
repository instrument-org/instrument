import { type RPCOutput } from "@/client/rpc/client";

export type Release = RPCOutput["releases"]["list"]["releases"][number];

/**
 * Which releases the page shows in full and which folded, from the newest
 * first list. Opened after an update (`since`), every version between the one
 * left and the one running is in full, set apart from the rest; otherwise only the
 * running one is. Newer releases than that sit above it folded, except one
 * already downloaded, which the page leads with on its own.
 */
export function planPage(
  releases: Release[],
  {
    current,
    since,
    staged,
  }: {
    current: string | undefined;
    since: string | undefined;
    staged: string | undefined;
  },
) {
  const indexOf = (version: string | undefined) =>
    version === undefined
      ? -1
      : releases.findIndex((release) => release.version === version);
  // A build with no release of its own, a dev run's, reads as the newest.
  const at = Math.max(indexOf(current), 0);
  const left = indexOf(since);
  const fresh = left > at + 1;
  const end = fresh ? left : at + 1;
  return {
    current: releases[at]?.version === current ? current : undefined,
    folded: releases.slice(end),
    fresh,
    full: releases.slice(at, end),
    newer: releases
      .slice(0, at)
      .filter((release) => release.version !== staged),
    staged: releases.find((release) => release.version === staged),
  };
}

/**
 * A beta by its full version and number, so a beta of 2.0.1 never reads as
 * one of 2.0.0; any other build by its version.
 */
export function versionLabel(version: string) {
  const beta = /^(?<line>\d+\.\d+\.\d+)-beta\.(?<n>\d+)$/.exec(version)?.groups;
  return beta?.line && beta.n
    ? `${beta.line} beta ${beta.n}`
    : `Version ${version}`;
}

/**
 * The notes below their opening paragraph, which the page shows on its own as
 * the lede, less the What's new section the page shows above every version.
 * Notes with no summary are a commit list, shown whole.
 */
export function detailOf({ body, summary }: Release) {
  if (summary === null) {
    return body;
  }
  const section = whatsNewSection(body);
  const rest = section
    ? `${body.slice(0, section.start)}${body.slice(section.end)}`
    : body;
  const heading = rest.search(/^#{2,3}\s/m);
  return heading === -1 ? "" : rest.slice(heading).trim();
}

/** One feature a release's What's new section leads with. */
export type Feature = {
  line: string;
  /** The release asset that shows it, once the pictures are approved. */
  picture: string | undefined;
  title: string;
  version: string;
};

/**
 * How long a release whose pictures are on their way is waited on before the
 * page and the card take its features as words alone, so a follow-up nobody
 * finished never leaves them waiting.
 */
export const PICTURES_WAIT_MS = 24 * 60 * 60 * 1000;

const WHATS_NEW_HEADING = /^##\s+What's new\s*$/im;
const NEXT_SECTION = /^##\s/m;
const FEATURE = /^[-*]\s+\*\*(?<title>.+?)\.?\*\*\s*(?<line>.*)$/;
const NOTE = /<!--\s*whats-new\b(?<note>[\s\S]*?)-->/;

/** The `## What's new` section of a body, from its heading to the next `##`. */
function whatsNewSection(body: string) {
  const heading = WHATS_NEW_HEADING.exec(body);
  if (!heading) return null;
  const from = heading.index + heading[0].length;
  const next = body.slice(from).search(NEXT_SECTION);
  const end = next === -1 ? body.length : from + next;
  return { end, start: heading.index, text: body.slice(from, end) };
}

/**
 * A release's What's new: each feature as its notes write it, a bullet led
 * by its name in bold, and whether its pictures are still on their way. The
 * section's note, an HTML comment nobody reading the notes sees, says
 * `status: pending` while the pictures wait for approval and `status: ready`
 * once they are attached, with one `<feature name>: <asset name>` line per
 * picture. A section with no note is words alone. Null when the release has
 * no What's new.
 */
export function whatsNewOf(
  release: Pick<Release, "body" | "publishedAt" | "version">,
  now: number,
): null | { features: Feature[]; waiting: boolean } {
  const section = whatsNewSection(release.body);
  if (!section) return null;
  const note = NOTE.exec(section.text)?.groups?.note ?? "";
  const fields = new Map<string, string>();
  for (const raw of note.split("\n")) {
    const pair = /^\s*(?<key>[^:]+?)\s*:\s*(?<value>\S.*?)\s*$/.exec(
      raw,
    )?.groups;
    if (pair?.key && pair.value) fields.set(pair.key, pair.value);
  }
  const status = fields.get("status");
  const features: Feature[] = [];
  for (const raw of section.text.replace(NOTE, "").split("\n")) {
    const match = FEATURE.exec(raw.trim())?.groups;
    if (!match?.title) continue;
    features.push({
      line: match.line?.trim() ?? "",
      picture: status === "ready" ? fields.get(match.title) : undefined,
      title: match.title,
      version: release.version,
    });
  }
  if (features.length === 0) return null;
  const waiting =
    status === "pending" &&
    now - Date.parse(release.publishedAt) < PICTURES_WAIT_MS;
  return { features, waiting };
}
