import {
  configure,
  type FileEntry,
  HttpRangeReader,
  ZipReader,
} from "@zip.js/zip.js";

// Inflate on the thread that asked rather than in zip.js's own worker pool.
// The workers are started from a blob URL, which the renderer's CSP does not
// admit, and the failure is silent: `getData` waits forever on a worker that
// never reports for duty rather than rejecting. Listing an archive never
// reaches this code -- the central directory is read directly -- so what this
// costs is inflating one member on the main thread, which for the preview
// images this reads is not a wait anybody will see.
configure({ useWebWorkers: false });

/**
 * Every member of an archive, read from its central directory.
 *
 * Nothing is decompressed, and nothing outside the directory is even fetched.
 * The directory is a table of contents at the end of the file recording each
 * member's name, sizes and timestamp, so a listing costs a few kilobytes
 * whether the archive holds one small file or a compression bomb; only
 * {@link readArchiveMember} inflates anything.
 *
 * Directory entries are dropped. A zip records them inconsistently -- some
 * writers emit one per folder, some none at all -- so a listing that kept them
 * would look different for two archives holding identical trees.
 */
export async function readArchiveEntries(url: string): Promise<FileEntry[]> {
  const reader = openArchive(url);
  try {
    const entries = await reader.getEntries();
    return entries.filter(
      (entry): entry is FileEntry => !entry.directory,
    );
  } finally {
    await closeQuietly(reader);
  }
}

/**
 * One named member's bytes, or null when the archive has no such member.
 *
 * Two bounds, because they catch different files. The declared
 * `uncompressedSize` rejects an honest large member without inflating a byte,
 * and is only ever a hint: it is the archive describing itself, and a hostile
 * one understates it, which is exactly how a few hundred kilobytes of zeroes
 * become gigabytes in memory. So the real cap is the one enforced on the bytes
 * as they arrive, in {@link inflateBounded}.
 *
 * The name is matched exactly rather than by suffix, so a member deeper in the
 * tree cannot stand in for one the caller expected at the root.
 */
export async function readArchiveMember({
  maxBytes,
  name,
  url,
}: {
  maxBytes: number;
  name: string;
  url: string;
}): Promise<Blob | null> {
  const reader = openArchive(url);
  try {
    const entries = await reader.getEntries();
    const entry = entries.find(
      (candidate): candidate is FileEntry =>
        candidate.filename === name && !candidate.directory,
    );
    if (!entry) {
      return null;
    }
    if (entry.uncompressedSize > maxBytes) {
      throw new Error(`"${name}" is larger than this preview allows.`);
    }
    return await inflateBounded({ entry, maxBytes });
  } finally {
    await closeQuietly(reader);
  }
}

/**
 * Releases the reader without letting the release become the failure.
 *
 * Left open, every archive opened in a session keeps a reader alive. But a
 * close that throws inside a `finally` replaces whatever error sent it there,
 * and the viewer would then report the plumbing rather than the file.
 */
async function closeQuietly(reader: ReturnType<typeof openArchive>) {
  try {
    await reader.close();
  } catch {
    // The reader is being discarded either way.
  }
}

/**
 * Inflates one member, stopping the moment it produces more than `maxBytes`.
 *
 * The cap is enforced while the bytes arrive rather than once they have, which
 * is the whole point: a member that expands to gigabytes has already spent the
 * memory by the time a finished blob could be measured. Chunks are counted as
 * the stream writes them and the sink throws past the bound, which errors the
 * stream and unwinds the inflate rather than letting it run to completion.
 */
async function inflateBounded({
  entry,
  maxBytes,
}: {
  entry: FileEntry;
  maxBytes: number;
}) {
  // Spelled with its buffer type so the chunks satisfy `BlobPart` below: a
  // plain `Uint8Array` is backed by `ArrayBufferLike`, which admits
  // `SharedArrayBuffer` and so is not something a `Blob` will take.
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let written = 0;

  try {
    await entry.getData(
      new WritableStream<Uint8Array<ArrayBuffer>>({
        write(chunk) {
          written += chunk.length;
          if (written > maxBytes) {
            throw new Error("Member exceeds the preview size limit.");
          }
          chunks.push(chunk);
        },
      }),
    );
  } catch (error) {
    // What escapes is not the error thrown above: zip.js goes on to close a
    // stream that is already errored, and the `TypeError` from doing that is
    // what surfaces. The byte count is the reliable witness to which failure
    // this was, so the reason that reaches the log is the size rather than the
    // plumbing.
    if (written > maxBytes) {
      throw new Error(
        `"${entry.filename}" is larger than this preview allows.`,
      );
    }
    throw error;
  }

  return new Blob(chunks);
}

/**
 * A reader over the archive at `url` that fetches only the bytes it is asked
 * for, as HTTP range requests.
 *
 * The shape of the format is what makes this worth doing. A listing needs the
 * central directory, a few kilobytes at the end of the file; one member needs
 * its own extent and nothing else. Reading through a downloaded blob instead
 * would put a copy of the whole archive in renderer memory in order to look at
 * a fraction of it, and for a large one that is a gigabyte spent on bytes
 * nothing is going to render.
 *
 * This depends on the asset server naming `Accept-Ranges` and `Content-Range`
 * in `Access-Control-Expose-Headers`, since the renderer reads them from
 * another origin. Without that the reader cannot see that partial reads are
 * available and gives up on them.
 */
function openArchive(url: string) {
  return new ZipReader(new HttpRangeReader(url));
}
