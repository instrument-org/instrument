import path from "node:path";

/**
 * The formats "Save page as…" offers, in its order, by the extension each
 * saves under. The save dialog says only the name chosen, never the format,
 * so each format has an extension of its own and the name's decides.
 */
export const SAVE_FORMATS = [
  { extension: "html", name: "Webpage, Complete", type: "HTMLComplete" },
  { extension: "htm", name: "Webpage, HTML Only", type: "HTMLOnly" },
] as const;

/**
 * The name a page is offered under: its title, with what no file name may
 * hold taken out, else its host, else "page"; a complete page's extension.
 */
export function saveName({ title, url }: { title: string; url: string }) {
  const host = URL.canParse(url) ? new URL(url).hostname : "";
  const stem = cleanName(title) || cleanName(host) || "page";
  return `${stem}.${SAVE_FORMATS[0].extension}`;
}

function cleanName(name: string) {
  return (
    name
      // oxlint-disable-next-line no-control-regex -- control characters are what is being removed
      .replaceAll(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .slice(0, 100)
      .trim()
  );
}

/** How a page saved under `filePath` is saved: only the HTML for the HTML-only extension, otherwise complete. */
export function saveTypeOf(
  filePath: string,
): (typeof SAVE_FORMATS)[number]["type"] {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return (
    SAVE_FORMATS.find((format) => format.extension === extension)?.type ??
    "HTMLComplete"
  );
}
