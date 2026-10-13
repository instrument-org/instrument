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
 * A chat's folder name: the day it began and a few words of what it is
 * about, so a chat's folder is readable on disk. A numeric suffix when the
 * name is taken. Synchronous, so the boot migration can name chats too.
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
  const slug = (title && folderSlug(title, CHAT_SLUG_MAX)) || "chat";
  const base = `${formatDatePrefix(date)}-${slug}`;
  let name = base;
  for (let suffix = 2; isTaken(name); suffix += 1) {
    name = `${base}-${suffix}`;
  }
  return SubdomainPartSchema.parse(name);
}

function formatDatePrefix(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
