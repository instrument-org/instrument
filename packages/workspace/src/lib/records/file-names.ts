import { StoreId } from "../../schemas/store-id";
import { DEVICE_ID_PATTERN, type DeviceId, DeviceIdSchema } from "./device-id";
import { GENERATION_PATTERN } from "./record";

/**
 * The names of a chat's record files, and the copies of them a sync engine
 * makes when it decides two versions of one file conflict:
 *
 *     <session>.<device>.jsonl        a session's log from one device
 *     <session>.<device>.2.jsonl      the device's next log of that session, then .3
 *     settings.<device>.jsonl         every per-chat value one device set
 *     marks.<device>.jsonl            the same, under the name builds before gave it
 *
 * A copy keeps the name and adds to it before `.jsonl`: iCloud Drive ` 2`,
 * Dropbox ` (… conflicted copy …)`, OneDrive `-<computer name>`, Syncthing
 * `.sync-conflict-<date>-<time>-<device>`. Every file has one writer, so a
 * copy holds the same records as its original, or fewer; a fold reads it as
 * another copy of that file.
 */

/** Which log of a session one device wrote: its id, then `.2`, `.3`. */
export function logStem(device: DeviceId, generation: number): string {
  return generation === 1 ? device : `${device}.${generation}`;
}

export function logFileName(
  session: StoreId.Session,
  device: DeviceId,
  generation = 1,
): string {
  return `${session}.${logStem(device, generation)}.jsonl`;
}

export function settingsFileName(device: DeviceId): string {
  return `settings.${device}.jsonl`;
}

/** What builds before named a device's settings file, read as one and renamed by its own device. */
export function formerSettingsFileName(device: DeviceId): string {
  return `marks.${device}.jsonl`;
}

export type RecordFileName =
  | {
      copy?: string;
      device: DeviceId;
      generation: number;
      kind: "log";
      session: StoreId.Session;
      stem: string;
    }
  | { copy?: string; device: DeviceId; kind: "settings" };

/** What a sync engine adds to a name it keeps two versions under. */
export const COPY_PATTERN = [
  " [0-9]+",
  " \\([^)]*\\)",
  "-[^.]+",
  "\\.sync-conflict-[0-9]{8}-[0-9]{6}-[0-9A-Z]+",
]
  .map((suffix) => `(?:${suffix})`)
  .join("|");

/**
 * The suffixes a copied name carries, matched once and then kept: the match
 * is made inside a lookahead and repeated through its own backreference, so
 * the engine settles on one way of dividing them instead of searching every
 * way. Written as a plain repeat (`(?:a|b)+`), each hyphen segment of a name
 * that fails to match doubles the work twice over: a 70-character name took
 * 125 ms, a 102-character one minutes, on the thread that draws the window
 * and for every entry of a folder a sync engine also writes to.
 */
const COPY_SUFFIXES = `(?:(?=(?<copy>(?:${COPY_PATTERN})+))\\k<copy>)?`;

const LOG_NAME = new RegExp(
  `^(ses_[0-9A-HJKMNP-TV-Z]{26})\\.(${DEVICE_ID_PATTERN})(?:\\.(${GENERATION_PATTERN}))?${COPY_SUFFIXES}\\.jsonl$`,
);

const SETTINGS_NAME = new RegExp(
  `^(?:settings|marks)\\.(${DEVICE_ID_PATTERN})${COPY_SUFFIXES}\\.jsonl$`,
);

/**
 * What a file in a chat's record folder is, or nothing for a file that is
 * not a log or a settings file (a blob, a temporary file, a
 * placeholder for a file not downloaded).
 */
export function parseRecordFileName(name: string): RecordFileName | undefined {
  const settings = SETTINGS_NAME.exec(name);
  if (settings) {
    const device = DeviceIdSchema.safeParse(settings[1]);
    return device.success
      ? {
          kind: "settings",
          device: device.data,
          ...copyOf(settings.groups?.copy),
        }
      : undefined;
  }
  const log = LOG_NAME.exec(name);
  if (!log) {
    return undefined;
  }
  const session = StoreId.SessionSchema.safeParse(log[1]);
  const device = DeviceIdSchema.safeParse(log[2]);
  if (!session.success || !device.success) {
    return undefined;
  }
  const generation = log[3] === undefined ? 1 : Number(log[3]);
  return {
    kind: "log",
    session: session.data,
    device: device.data,
    generation,
    stem: logStem(device.data, generation),
    ...copyOf(log.groups?.copy),
  };
}

function copyOf(suffix: string | undefined): { copy?: string } {
  return suffix === undefined ? {} : { copy: suffix };
}
