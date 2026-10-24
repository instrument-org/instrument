import { type DefaultTreeAdapterTypes, html as markup, parse } from "parse5";

/** How long a page has to answer with its title. */
const TIMEOUT_MS = 8000;

/**
 * How much of a page is read looking for its title. A title is in the head,
 * which is near the top of any page that has one; past this the page is not
 * going to name itself.
 */
const MAX_BYTES = 256 * 1024;

/** How long a title is kept, which covers any a reader would take in. */
const MAX_TITLE_LENGTH = 300;

/**
 * Whether an address is a page out on the internet rather than one on this
 * computer or its network. Only those are asked for a title: a page on a
 * local server answers a GET by doing whatever that server does with one.
 */
export function isPublicPage(url: string): boolean {
  const parsed = URL.parse(url);
  if (
    !parsed ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    host.startsWith("[") ||
    /\.(?:localhost|local|internal|lan|home\.arpa)$/u.test(host)
  ) {
    return false;
  }
  const octets = /^(\d+)\.(\d+)\.\d+\.\d+$/u.exec(host);
  if (!octets) {
    return true;
  }
  const [a = 0, b = 0] = octets.slice(1).map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * The title a page gives itself in its `<title>`, read from the top of the
 * page with no cookies, so a page behind a sign-in answers with its sign-in
 * page's. Undefined when the page is not HTML, does not answer in time, or
 * names itself nothing.
 */
export async function fetchPageTitle(
  url: string,
  userAgent: string,
): Promise<string | undefined> {
  const response = await fetch(url, {
    headers: { accept: "text/html", "user-agent": userAgent },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !response.body || !/html/iu.test(type)) {
    await response.body?.cancel();
    return undefined;
  }
  const head = await readHead(response.body, charsetOf(type));
  return titleIn(head);
}

async function readHead(
  body: ReadableStream<Uint8Array>,
  charset: string,
): Promise<string> {
  const decoder = decoderFor(charset);
  const reader = body.getReader();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < MAX_BYTES && !/<\/title\s*>/iu.test(text)) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return text;
}

function charsetOf(contentType: string): string {
  return /charset=["']?([\w-]+)/iu.exec(contentType)?.[1] ?? "utf-8";
}

function decoderFor(charset: string): TextDecoder {
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder();
  }
}

/** The text of the document's own `<title>`, not one inside an SVG. */
export function titleIn(html: string): string | undefined {
  const title = findTitle(parse(html));
  if (!title) {
    return undefined;
  }
  const text = title.childNodes
    .map((node) => ("value" in node ? node.value : ""))
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return text === "" ? undefined : text;
}

function findTitle(
  node: DefaultTreeAdapterTypes.ParentNode,
): DefaultTreeAdapterTypes.Element | undefined {
  for (const child of node.childNodes) {
    if (!("tagName" in child)) {
      continue;
    }
    if (child.tagName === "title" && child.namespaceURI === markup.NS.HTML) {
      return child;
    }
    const found = findTitle(child);
    if (found) {
      return found;
    }
  }
  return undefined;
}
