import fs from "node:fs";

/**
 * Where crash and hang diagnostics are kept: the session and freeze markers,
 * the crash record, the crash dumps, the stored exceptions and the bell's
 * pending problems. The userData root, unless `INSTRUMENT_DIAGNOSTICS_DIR`
 * (development builds only) names a folder of the instance's own, which
 * studio-drive sets for an instance on the developer's application data, so
 * two instances never read each other's markers and dumps as a crash of
 * their own.
 */
export function diagnosticsDirOf(
  app: Pick<Electron.App, "getPath" | "isPackaged">,
): string {
  const own = process.env.INSTRUMENT_DIAGNOSTICS_DIR;
  if (!own || app.isPackaged) {
    return app.getPath("userData");
  }
  fs.mkdirSync(own, { recursive: true });
  return own;
}
