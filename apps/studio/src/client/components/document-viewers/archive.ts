import {
  BlobReader,
  BlobWriter,
  configure,
  type FileEntry,
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
 * Nothing is decompressed. The directory is a table of contents at the end of
 * the file recording each member's name, sizes and timestamp, so listing an
 * archive costs the same whether it holds one small file or a compression
 * bomb; only {@link readArchiveMember} inflates anything.
 *
 * Directory entries are dropped. A zip records them inconsistently -- some
 * writers emit one per folder, some none at all -- so a listing that kept them
 * would look different for two archives holding identical trees.
 */
export async function readArchiveEntries(url: string): Promise<FileEntry[]> {
  const reader = await openArchive(url);
  try {
    const entries = await reader.getEntries();
    return entries.filter((entry) => !entry.directory);
  } finally {
    // Releases the worker the reader may have started. Left open, every
    // archive opened in a session keeps one alive.
    await reader.close();
  }
}

/**
 * One named member's bytes, or null when the archive has no such member.
 *
 * `maxBytes` is checked against what actually came out rather than the header's
 * `uncompressedSize`, which the archive declares about itself and a hostile one
 * can understate: a few hundred kilobytes of zeroes expand to gigabytes, and
 * trusting the declared figure is what turns reading a member into a way to
 * exhaust memory.
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
  const reader = await openArchive(url);
  try {
    const entries = await reader.getEntries();
    const entry = entries.find(
      (candidate): candidate is FileEntry =>
        candidate.filename === name && !candidate.directory,
    );
    if (!entry) {
      return null;
    }
    const blob = await entry.getData(new BlobWriter());
    if (blob.size > maxBytes) {
      throw new Error(`"${name}" is larger than this preview allows.`);
    }
    return blob;
  } finally {
    await reader.close();
  }
}

async function openArchive(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load file: ${response.statusText}`);
  }
  return new ZipReader(new BlobReader(await response.blob()));
}
