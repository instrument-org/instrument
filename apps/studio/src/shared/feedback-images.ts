/**
 * The images feedback may carry beside its report, as the reports service
 * takes them: at most four, each a PNG, JPEG, WebP or GIF of at most 5 MB,
 * its type read from its own first bytes. SVG is left out, since it is a
 * document that can run script rather than a picture.
 */
export const MAX_FEEDBACK_IMAGES = 4;
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;

export const FEEDBACK_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type FeedbackImageType = (typeof FEEDBACK_IMAGE_TYPES)[number];

/** How many of a file's first bytes `imageTypeOf` reads. */
export const IMAGE_HEAD_BYTES = 12;

/** The image type a file's first bytes name, or null for anything else. */
export function imageTypeOf(bytes: Uint8Array): FeedbackImageType | null {
  const starts = (offset: number, values: readonly number[]) =>
    values.every((value, index) => bytes[offset + index] === value);
  const ascii = (offset: number, text: string) =>
    starts(
      offset,
      Array.from(text, (char) => char.charCodeAt(0)),
    );
  if (starts(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (starts(0, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) {
    return "image/gif";
  }
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
    return "image/webp";
  }
  return null;
}

/** A file offered as an image: its name, its size, and its first bytes. */
export type ImageCandidate = { head: Uint8Array; name: string; size: number };

/**
 * Which of the files offered can join the `already` images attached, in
 * order, and a line for each one left out, in the words the dialog shows.
 */
export function checkFeedbackImages<T extends ImageCandidate>(
  already: number,
  offered: readonly T[],
): { accepted: (T & { type: FeedbackImageType })[]; problems: string[] } {
  const accepted: (T & { type: FeedbackImageType })[] = [];
  const problems: string[] = [];
  for (const file of offered) {
    const type = imageTypeOf(file.head);
    if (!type) {
      problems.push(
        `“${file.name}” isn't an image, so we left it out. You can attach PNG, JPEG, WebP or GIF.`,
      );
    } else if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
      problems.push(`“${file.name}” is over 5 MB, so we left it out.`);
    } else if (already + accepted.length >= MAX_FEEDBACK_IMAGES) {
      problems.push(
        `You can attach up to ${MAX_FEEDBACK_IMAGES} images, so we left out “${file.name}”.`,
      );
    } else {
      accepted.push({ ...file, type });
    }
  }
  return { accepted, problems };
}
