import {
  type SubdomainPart,
  SubdomainPartSchema,
} from "../schemas/subdomain-part";
import { folderSlug } from "./folder-slug";

/**
 * How long the words in a chat's folder name may run: short enough that a
 * deep path inside the chat's folder still fits around it.
 */
const CHAT_SLUG_MAX = 24;

/**
 * Crockford's base32 alphabet, lowercased: no `i`, `l`, `o` or `u`, so a
 * suffix reads back without mistaking one character for another.
 */
const SUFFIX_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Characters of the random suffix a new chat's id ends in: 20 bits, so two
 * computers that have not synced yet, each starting a chat on the same day
 * with the same first words, pick the same id once in about a million.
 */
const SUFFIX_LENGTH = 4;

/**
 * A new chat's id: the day it began, a few words of what it is about, and a
 * short random suffix, so the folder reads well on disk and a chat started
 * on another computer before the two synced does not get the same id. A
 * suffix this computer already knows is drawn again.
 */
export function newChatName({
  date,
  isTaken,
  randomBytes = cryptoRandomBytes,
  title,
}: {
  date: Date;
  isTaken: (candidate: string) => boolean;
  /** Where the suffix's randomness comes from, for a test that pins it. */
  randomBytes?: (length: number) => Uint8Array;
  title: string | undefined;
}): SubdomainPart {
  const base = chatNameBase(date, title);
  let name: string;
  do {
    name = `${base}-${randomSuffix(randomBytes)}`;
  } while (isTaken(name));
  return SubdomainPartSchema.parse(name);
}

/**
 * A chat's folder name with no randomness in it: the day it began and a few
 * words of what it is about, and a numeric suffix when the name is taken.
 * For the 1.x migration, which names chats from tasks it finds rather than
 * starting new ones. Synchronous, so the boot migration can name chats too.
 */
export function chatFolderName({
  date,
  isTaken,
  title,
}: {
  date: Date;
  isTaken: (candidate: string) => boolean;
  title: string | undefined;
}): SubdomainPart {
  const base = chatNameBase(date, title);
  let name = base;
  for (let suffix = 2; isTaken(name); suffix += 1) {
    name = `${base}-${suffix}`;
  }
  return SubdomainPartSchema.parse(name);
}

function chatNameBase(date: Date, title: string | undefined): string {
  const slug = (title && folderSlug(title, CHAT_SLUG_MAX)) || "chat";
  return `${formatDatePrefix(date)}-${slug}`;
}

/** 32 divides 256, so masking a byte to five bits picks evenly. */
function randomSuffix(randomBytes: (length: number) => Uint8Array): string {
  let suffix = "";
  for (const byte of randomBytes(SUFFIX_LENGTH)) {
    suffix += SUFFIX_ALPHABET.charAt(byte & 31);
  }
  return suffix;
}

function cryptoRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function formatDatePrefix(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
