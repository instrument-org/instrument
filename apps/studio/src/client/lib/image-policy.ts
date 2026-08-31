/**
 * Where an `<img>` in content this app did not write is allowed to point.
 *
 * One module because the answer is a question about the network rather than
 * about layout, and it is asked from more than one surface: markdown from the
 * agent, a `.md` file that arrived in a download, and the HTML a notebook cell
 * printed. Those surfaces do not want the same answer -- a notebook is a file
 * someone else wrote and gets the narrowest one -- but they must not disagree
 * by accident, which is what three separate allow-lists were doing. Each one
 * names the kinds it takes; the reading of a source belongs here.
 *
 * The renderer's own `img-src` in `index.html` is the outer bound on all of
 * this. It is deliberately wider, because it also covers chrome this app drew
 * itself, so it can only ever be a backstop. Nothing here may be relaxed on the
 * grounds that the CSP would still catch it.
 */

/** What a source turns out to be, which is what a caller decides against. */
export type ImageSourceKind =
  /** Bytes in the document. Reaching one sends nothing anywhere. */
  | "embedded"
  /** Anything else, including every source that names a host we do not know. */
  | "rejected"
  /** A host on the network. Drawing one is a request that leaves the machine. */
  | "remote"
  /** This machine's own per-task asset origin, which is local and unencrypted. */
  | "task-asset"
  /** A path inside the task, which the caller resolves against that origin. */
  | "task-relative";

// Hosts an image may be fetched from over the network.
//
// Exported for one reader only: the test pinning this list inside the
// renderer's `img-src`. The reveal a chip offers for a `remote` source
// promises a load, so a host here that the CSP refuses turns that click into
// a no-op; the test fails the drift instead of a reader finding it. Every
// other caller asks `classifyImageSource`.
export const REMOTE_HOSTS = new Set(["github.com", "images.google.com"]);

// Subdomains, held apart from the exact hosts above because an image comes from
// `raw.githubusercontent.com` and never from the bare domain. Exported on the
// same terms as `REMOTE_HOSTS`.
export const REMOTE_HOST_SUFFIXES = [".github.com", ".githubusercontent.com"];

// This machine's own asset server, which is per-task and local and so the one
// host an image may be fetched from without TLS. A port is not part of
// `hostname`, which is why none is named here.
const LOCAL_HOST_SUFFIX = ".localhost";

// An image type rather than the `data:` scheme whole, so the widest thing an
// untrusted document can put in an `<img>` is bytes a decoder will either read
// as a picture or refuse. An SVG among them runs nothing: a document loaded
// through `<img>` has no script execution.
const EMBEDDED_PREFIX = "data:image/";

/**
 * What kind of source this is, without deciding whether to draw it.
 *
 * Which host a source names is read from a parsed `hostname` rather than tested
 * against the source string, because a pattern matching the whole URL cannot
 * tell a host from a path: `https://evil.test/x.githubusercontent.com/p.png`
 * reads as the host it names instead of the path it is. Confining such a
 * pattern to the authority is not enough on its own either, since a query or a
 * fragment opens before the first slash does, and
 * `https://evil.test?a=.githubusercontent.com/p.png` walks past that too.
 * `hostname` is the one spelling of a host with nothing else in it to confuse.
 */
export function classifyImageSource(src: string | undefined): ImageSourceKind {
  const value = src?.trim();
  if (!value) {
    return "rejected";
  }

  // Before the path test below, which would otherwise read the leading slash of
  // `//host/pixel.png` as a path on this machine and let it past every kind --
  // the one source that could name any host at all.
  if (value.startsWith("//")) {
    return "rejected";
  }
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return "task-relative";
  }
  // Case-insensitively, since a scheme and a mime type both are, and the
  // browser that ends up decoding this makes no distinction either.
  if (value.toLowerCase().startsWith(EMBEDDED_PREFIX)) {
    return "embedded";
  }

  const url = parseUrl(value);
  if (!url) {
    return "rejected";
  }
  if (url.protocol === "http:" && url.hostname.endsWith(LOCAL_HOST_SUFFIX)) {
    return "task-asset";
  }
  if (url.protocol === "https:" && isRemoteHost(url.hostname)) {
    return "remote";
  }
  return "rejected";
}

/**
 * Whether a source is one of the kinds this surface takes.
 *
 * `rejected` is never among them, so a caller cannot admit it by listing every
 * kind.
 */
export function isImageSourceAllowed(
  src: string | undefined,
  kinds: readonly ImageSourceKind[],
): boolean {
  const kind = classifyImageSource(src);
  return kind !== "rejected" && kinds.includes(kind);
}

/**
 * Markdown the agent wrote, or the user did.
 *
 * Every kind, because such a document is written for this reader: a host it
 * names is one the allow-list already knows, and the asset origin it addresses
 * holds the files of the task the markdown belongs to.
 */
export const MARKDOWN_IMAGE_KINDS = [
  "embedded",
  "remote",
  "task-asset",
  "task-relative",
] as const satisfies readonly ImageSourceKind[];

/**
 * What a file someone else wrote carries, whether as output or as prose.
 *
 * Embedded bytes and nothing else. A remote `<img src>` needs no script to
 * phone home -- opening the file is the request, which discloses an IP and
 * confirms the read, and inside a desktop app it can also probe hosts only this
 * machine can reach. Nothing is lost by it: a notebook's own pictures arrive
 * base64-encoded in the mime bundle, and its attachments are rewritten into the
 * same shape before they are rendered.
 */
export const UNTRUSTED_FILE_IMAGE_KINDS = [
  "embedded",
] as const satisfies readonly ImageSourceKind[];

function isRemoteHost(hostname: string): boolean {
  return (
    REMOTE_HOSTS.has(hostname) ||
    REMOTE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function parseUrl(src: string): undefined | URL {
  try {
    return new URL(src);
  } catch {
    return undefined;
  }
}
