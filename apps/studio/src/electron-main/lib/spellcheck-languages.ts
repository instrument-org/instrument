import { app, type Session } from "electron";

import { logger } from "./electron-logger";

/**
 * The spellchecker's languages for a session: every language the system
 * prefers that the spellchecker has, in the system's order. Off macOS,
 * Chromium checks only the app's own locale unless told otherwise, so someone
 * writing in a second language sees every word of it underlined. On macOS the
 * system spellchecker picks the language itself and the call does nothing.
 */
export function applySpellCheckerLanguages(ses: Session): void {
  if (process.platform === "darwin") {
    return;
  }
  const preferred = app.getPreferredSystemLanguages();
  const languages = spellCheckerLanguagesFor(
    preferred.length > 0 ? preferred : [app.getLocale()],
    ses.availableSpellCheckerLanguages,
  );
  if (languages.length === 0) {
    return;
  }
  try {
    ses.setSpellCheckerLanguages(languages);
  } catch (error) {
    logger.warn("Could not set the spellchecker's languages", {
      error,
      languages,
    });
  }
}

/**
 * Matches each preferred language to one the spellchecker has: the same tag
 * first ("de-AT"), then the bare language ("de"), then the first regional
 * dictionary for it ("de-DE"). Case-insensitive, since systems spell the tags
 * differently, and each dictionary appears once.
 */
export function spellCheckerLanguagesFor(
  preferred: readonly string[],
  available: readonly string[],
): string[] {
  const byLower = new Map(available.map((tag) => [tag.toLowerCase(), tag]));
  const chosen: string[] = [];
  for (const tag of preferred) {
    const lower = tag.replaceAll("_", "-").toLowerCase();
    const base = lower.split("-")[0] ?? lower;
    const match =
      byLower.get(lower) ??
      byLower.get(base) ??
      available.find((candidate) =>
        candidate.toLowerCase().startsWith(`${base}-`),
      );
    if (match !== undefined && !chosen.includes(match)) {
      chosen.push(match);
    }
  }
  return chosen;
}
