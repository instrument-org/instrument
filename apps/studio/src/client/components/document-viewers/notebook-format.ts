/**
 * Reading a `.ipynb` file into the shape the viewer renders.
 *
 * A notebook is JSON, and every awkward part of it lives here rather than in
 * the component: the format is permissive in ways that only show up on real
 * files, and all of this is pure, so it is the part worth testing.
 *
 * Nothing here touches the DOM or React on purpose. The viewer composes
 * Studio's existing markdown, syntax highlighting, and viewer chrome over this
 * model; parsing is the only piece a notebook actually needs that Studio does
 * not already own.
 */

// cspell:ignore ename evalue ipynb kernelspec nbformat pyerr pyout sgr tqdm vnd

/** One rendered line of terminal-ish output, split at each style change. */
export type AnsiLine = AnsiSegment[];

export interface AnsiStyle {
  bold: boolean;
  color: AnsiColor | null;
}

export interface NotebookCell {
  /** `In [n]` gutter; null for a cell that has never been run. */
  executionCount: null | number;
  id: string;
  outputs: NotebookOutput[];
  source: string;
  type: NotebookCellType;
}

export type NotebookOutput =
  | NotebookErrorOutput
  | NotebookHtmlOutput
  | NotebookImageOutput
  | NotebookJsonOutput
  | NotebookTextOutput;

type AnsiColor =
  | "black"
  | "blue"
  | "cyan"
  | "green"
  | "magenta"
  | "red"
  | "white"
  | "yellow";

interface AnsiSegment {
  style: AnsiStyle;
  text: string;
}

interface Notebook {
  cells: NotebookCell[];
  /** Highlighting language for code cells, from the notebook's metadata. */
  language: string;
}

type NotebookCellType = "code" | "markdown" | "raw";

interface NotebookErrorOutput {
  ename: string;
  evalue: string;
  traceback: AnsiLine[];
  type: "error";
}

interface NotebookHtmlOutput {
  html: string;
  prompt: null | number;
  type: "html";
}

interface NotebookImageOutput {
  alt: string;
  prompt: null | number;
  src: string;
  type: "image";
}

interface NotebookJsonOutput {
  json: string;
  prompt: null | number;
  type: "json";
}

interface NotebookTextOutput {
  lines: AnsiLine[];
  /** `Out[n]` gutter; only an execute result carries one. */
  prompt: null | number;
  /** Set when the text came from a `stream` output, so stderr can be marked. */
  stream: "stderr" | "stdout" | null;
  type: "text";
}

/** A stream output, before adjacent chunks of the same channel are merged. */
interface PendingStream {
  name: "stderr" | "stdout";
  text: string;
  type: "stream";
}

// Standard SGR foreground codes, plus the bright variants that map onto the
// same eight names. Anything else -- 256-color, 24-bit color, backgrounds -- is
// parsed and dropped rather than rendered: a traceback needs to be legible, and
// the palette it actually uses is this one.
const ANSI_COLORS: Record<number, AnsiColor> = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "black",
  91: "red",
  92: "green",
  93: "yellow",
  94: "blue",
  95: "magenta",
  96: "cyan",
  97: "white",
};

const ESCAPE = "\u001B";

// The characters a mime subtype is allowed to be made of, per RFC 2045's
// token. Anything else in an attachment key means it is not a mime type.
const MIME_SUBTYPE_CHARACTERS = new Set(
  "abcdefghijklmnopqrstuvwxyz0123456789!#$&^_.+-",
);

/** nbformat 3 stored its mime bundle as flat keys on the output itself. */
const LEGACY_MIME_KEYS: Record<string, string> = {
  html: "text/html",
  jpeg: "image/jpeg",
  json: "application/json",
  latex: "text/latex",
  png: "image/png",
  svg: "image/svg+xml",
  text: "text/plain",
};

/**
 * Which representation of an output we render, richest first.
 *
 * This is not JupyterLab's order, and the difference is deliberate. JupyterLab
 * ranks `text/html` above the images because it can run the scripts an HTML
 * bundle carries; we cannot, since that markup arrives from an untrusted file
 * and is rendered through a sanitizer that drops every script. So when a
 * library offers both -- which is exactly what a plotting library does -- the
 * picture is the representation that survives intact and the markup is the one
 * that would arrive inert.
 *
 * Absent from the list, and so falling through to `text/plain`:
 * `application/vnd.jupyter.widget-view+json` and every other widget or vendor
 * bundle. Notebooks carry a plain-text fallback for precisely this case.
 */
const OUTPUT_MIME_PRECEDENCE = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "text/html",
  "application/json",
  "text/plain",
];

const PLAIN_STYLE: AnsiStyle = { bold: false, color: null };

/**
 * Splits text into styled segments at each SGR escape sequence.
 *
 * Written as a scanner rather than a regular expression because the escape
 * character is a control character, and because the sequences that are not SGR
 * still have to be consumed and dropped rather than left in the output as
 * visible garbage.
 */
export function parseAnsi(text: string): AnsiLine[] {
  const lines: AnsiLine[] = [];
  let segments: AnsiLine = [];
  let style = PLAIN_STYLE;
  let pending = "";

  const flush = () => {
    if (pending !== "") {
      segments.push({ style, text: pending });
      pending = "";
    }
  };

  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);

    if (character === "\n") {
      flush();
      lines.push(segments);
      segments = [];
      index += 1;
      continue;
    }

    if (character === ESCAPE && text.charAt(index + 1) === "[") {
      const end = findSequenceEnd(text, index + 2);
      if (end === -1) {
        // An escape that never terminates: drop the remainder rather than
        // print the raw bytes.
        break;
      }
      if (text.charAt(end) === "m") {
        flush();
        style = applySgr(style, text.slice(index + 2, end));
      }
      index = end + 1;
      continue;
    }

    pending += character;
    index += 1;
  }

  flush();
  lines.push(segments);

  // Text ending in a newline leaves a final empty line, which would render as
  // a blank row under every stream output.
  if (lines.length > 1 && lines.at(-1)?.length === 0) {
    lines.pop();
  }

  return lines;
}

/**
 * Reads a notebook file.
 *
 * Throws on anything it cannot read, which is what puts the file on the shared
 * "preview unavailable" card: the viewer renders inside the viewer surface's
 * `CatchBoundary`, so a truncated or non-notebook `.ipynb` degrades to that
 * card rather than to half a rendered document.
 */
export function parseNotebook(text: string): Notebook {
  const parsed: unknown = JSON.parse(text);
  const root = asRecord(parsed);
  if (!root) {
    throw new Error("Notebook is not a JSON object");
  }

  const rawCells = collectCells(root);
  if (!rawCells) {
    throw new Error("Notebook has no cells");
  }

  const cells: NotebookCell[] = [];
  for (const [index, rawCell] of rawCells.entries()) {
    const cell = normalizeCell(rawCell, index);
    if (cell) {
      cells.push(cell);
    }
  }

  return { cells, language: readLanguage(root) };
}

/**
 * Replaces `attachment:` image references with the data the cell carries.
 *
 * An image pasted into a markdown cell is stored on the cell rather than in the
 * task folder, so the reference resolves against nothing once that markdown
 * leaves the notebook. Rewriting it here means the shared markdown renderer
 * needs to know nothing about notebooks.
 */
function applyAttachments(source: string, attachments: unknown): string {
  const bundles = asRecord(attachments);
  if (!bundles) {
    return source;
  }

  // Longest name first. These are plain substring replacements, so a name that
  // is a prefix of another would otherwise consume the head of the longer
  // reference before that one is reached: with `a.png` and `a.png.bak.png` in
  // the same cell, the short one leaves its URI followed by a stray
  // `.bak.png`, and then neither image resolves.
  const named = Object.entries(bundles).sort(
    ([first], [second]) => second.length - first.length,
  );

  let result = source;
  for (const [name, bundle] of named) {
    const data = asRecord(bundle);
    if (!data) {
      continue;
    }
    // The key has to look like a mime type before it is interpolated into
    // one. It is written by the file, and the URI built from it is spliced
    // back into markdown, so a key carrying markdown's own punctuation would
    // close the image link and open whatever followed. Nothing is crossed here
    // that the cell's own source could not cross on its own -- both come from
    // the same file -- but a key that is not a mime type has no business
    // becoming one either way.
    const mimeType = Object.keys(data).find(isImageMimeType);
    if (mimeType === undefined) {
      continue;
    }
    const encoded = stripWhitespace(joinLines(data[mimeType]));
    if (encoded === "") {
      continue;
    }
    // Lower-cased because the key is accepted case-insensitively but the URI
    // built from it is read by an allow-list that is not, and a mime type is
    // the one part of a `data:` URI where case carries no meaning.
    const uri = `data:${mimeType.toLowerCase()};base64,${encoded}`;
    // Both spellings appear: the name is written verbatim by hand and
    // percent-encoded by the notebook UI when it contains spaces.
    result = result
      .split(`attachment:${name}`)
      .join(uri)
      .split(`attachment:${encodeURIComponent(name)}`)
      .join(uri);
  }
  return result;
}

/**
 * Collapses the carriage returns a progress bar leaves behind.
 *
 * `tqdm` and friends redraw a line by returning to its start and writing over
 * it, so the stored stream holds every intermediate state of the bar. Rendered
 * literally that is dozens of near-identical lines where the notebook showed
 * one; only what follows the last carriage return was ever on screen.
 */
function applyCarriageReturns(text: string): string {
  if (!text.includes("\r")) {
    return text;
  }

  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) {
        return line;
      }
      const parts = line.split("\r");
      // A line ending in a carriage return leaves the cursor over an empty
      // string; what the reader saw is the last part that had content.
      return parts.findLast((part) => part !== "") ?? "";
    })
    .join("\n");
}

function applySgr(style: AnsiStyle, parameters: string): AnsiStyle {
  // A bare `ESC[m` is a reset, the same as `ESC[0m`.
  if (parameters === "") {
    return PLAIN_STYLE;
  }

  const codes = parameters.split(";");
  let next = style;

  // Scanned by index rather than iterated, because an extended color is one
  // instruction spread over several parameters and has to be consumed whole.
  for (let index = 0; index < codes.length; index += 1) {
    // A parameter that is not a number parses to `NaN`, which matches no case
    // and looks up nothing, so it is ignored the same way any code outside the
    // palette is.
    const code = Number.parseInt(codes[index] ?? "", 10);

    // `38`/`48` introduce a 256-color or 24-bit color, and their arguments are
    // numbers that collide with the palette keys: read one at a time, the two
    // 30s ending `38;2;255;30;30` are black and the 31 in `38;5;31` is red.
    // These are the colors this palette does not carry, so the whole
    // instruction goes rather than only its introducer.
    if (code === 38 || code === 48) {
      index += extendedColorSpan(codes[index + 1]);
      continue;
    }

    switch (code) {
      case 0: {
        next = PLAIN_STYLE;
        break;
      }
      case 1: {
        next = { ...next, bold: true };
        break;
      }
      case 22: {
        next = { ...next, bold: false };
        break;
      }
      case 39: {
        next = { ...next, color: null };
        break;
      }
      default: {
        const color = ANSI_COLORS[code];
        if (color) {
          next = { ...next, color };
        }
      }
    }
  }
  return next;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * The output for one representation, or null when that representation is
 * present but carries nothing.
 */
function buildOutput({
  data,
  mimeType,
  prompt,
}: {
  data: Record<string, unknown>;
  mimeType: string;
  prompt: null | number;
}): NotebookOutput | null {
  const value = data[mimeType];
  const alt = joinLines(data["text/plain"]).trim();

  if (mimeType === "image/png" || mimeType === "image/jpeg") {
    const encoded = stripWhitespace(joinLines(value));
    return encoded === ""
      ? null
      : {
          alt: alt === "" ? "Notebook output image" : alt,
          prompt,
          src: `data:${mimeType};base64,${encoded}`,
          type: "image",
        };
  }

  if (mimeType === "image/svg+xml") {
    const markup = joinLines(value);
    // Handed to an `<img>` rather than inlined into the page. An SVG loaded as
    // an image cannot run its own scripts or reach the document around it,
    // which is why vector output does not go through the sanitizer.
    return markup.trim() === ""
      ? null
      : {
          alt: alt === "" ? "Notebook output image" : alt,
          prompt,
          src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
          type: "image",
        };
  }

  if (mimeType === "text/html") {
    const html = joinLines(value);
    return html.trim() === "" ? null : { html, prompt, type: "html" };
  }

  if (mimeType === "application/json") {
    // Reports itself empty like every other branch does. This one outranks
    // `text/plain`, so without it a bundle holding a null payload beside a
    // description would render a bare `null` and the description would never
    // be reached.
    return value === null || value === undefined
      ? null
      : { json: formatJson(value), prompt, type: "json" };
  }

  const lines = parseAnsi(applyCarriageReturns(joinLines(value)));
  return isBlank(lines) ? null : { lines, prompt, stream: null, type: "text" };
}

/**
 * The cell list, from either notebook generation.
 *
 * nbformat 4 has one flat `cells` array. nbformat 3 -- still what an archived
 * notebook or an old export holds -- splits them across `worksheets`, of which
 * every writer in practice emitted exactly one. Reading both costs a few lines
 * here and saves those files falling to the fallback card, and it means the
 * rest of this module only ever sees one shape.
 */
function collectCells(root: Record<string, unknown>): undefined | unknown[] {
  if (isArray(root.cells)) {
    return root.cells;
  }

  if (isArray(root.worksheets)) {
    const cells: unknown[] = [];
    for (const worksheet of root.worksheets) {
      const sheet = asRecord(worksheet);
      if (sheet && isArray(sheet.cells)) {
        // Appended one at a time rather than spread into `push`, which passes
        // an argument per cell and has an engine limit the file gets to decide
        // whether to cross.
        for (const cell of sheet.cells) {
          cells.push(cell);
        }
      }
    }
    return cells;
  }

  return undefined;
}

/**
 * How many further parameters belong to a `38`/`48` extended color.
 *
 * `5` takes one palette index, `2` takes three channel values. Anything else
 * is malformed, and consuming nothing extra leaves the scan where it was
 * rather than swallowing a parameter that may be a real code.
 */
function extendedColorSpan(mode: string | undefined): number {
  switch (Number.parseInt(mode ?? "", 10)) {
    case 2: {
      return 4;
    }
    case 5: {
      return 2;
    }
    default: {
      return 0;
    }
  }
}

/** The index of the final byte of a CSI sequence, or -1 if it never ends. */
function findSequenceEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0;
    // Parameter and intermediate bytes run 0x20-0x3F; the first byte outside
    // that range terminates the sequence.
    if (code < 0x20 || code > 0x3f) {
      return index;
    }
  }
  return -1;
}

function formatJson(value: unknown): string {
  // Everything reaching this came out of `JSON.parse`, so it round-trips.
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

/**
 * `Array.isArray` on an `unknown` narrows it to `any[]`, not `unknown[]`, which
 * silently reopens every unsafe-any path this module exists to avoid. A
 * predicate of our own narrows to the type the values actually have.
 */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Whether parsed output holds nothing but empty lines. */
function isBlank(lines: AnsiLine[]): boolean {
  return lines.every((line) => line.every((segment) => segment.text === ""));
}

/**
 * Whether an attachment key is an image mime type rather than arbitrary text.
 *
 * Checked character by character rather than with a pattern, since the point
 * is to admit only the characters a mime type is made of.
 */
function isImageMimeType(key: string): boolean {
  if (!key.toLowerCase().startsWith("image/")) {
    return false;
  }
  const subtype = key.toLowerCase().slice("image/".length);
  if (subtype === "") {
    return false;
  }
  for (const character of subtype) {
    if (!MIME_SUBTYPE_CHARACTERS.has(character)) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isArray(value);
}

/** `source` and `text` are a string or an array of lines, newlines included. */
function joinLines(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isArray(value)) {
    let joined = "";
    for (const part of value) {
      if (typeof part === "string") {
        joined += part;
      }
    }
    return joined;
  }
  return "";
}

/**
 * Merges the stream chunks Jupyter emits one `print` at a time.
 *
 * Without this a loop printing a hundred lines is a hundred separate output
 * blocks, each with its own spacing, and a progress bar's carriage returns
 * never meet the line they were meant to overwrite.
 */
function mergeStreams(outputs: (NotebookOutput | PendingStream)[]) {
  const merged: (NotebookOutput | PendingStream)[] = [];
  for (const output of outputs) {
    const previous = merged.at(-1);
    if (
      output.type === "stream" &&
      previous?.type === "stream" &&
      previous.name === output.name
    ) {
      previous.text += output.text;
      continue;
    }
    merged.push(output);
  }
  return merged;
}

function normalizeCell(value: unknown, index: number): NotebookCell | null {
  const cell = asRecord(value);
  if (!cell) {
    return null;
  }

  const type = readCellType(cell);
  // nbformat 3 named a code cell's text `input` and its counter
  // `prompt_number`.
  let source = joinLines(cell.source ?? cell.input);
  if (type === "markdown") {
    source = withHeadingLevel(applyAttachments(source, cell.attachments), cell);
  }

  return {
    executionCount: readCount(cell.execution_count ?? cell.prompt_number),
    // Prefixed with the position rather than taken as written. nbformat 4.5
    // requires these to be unique and real files are not always -- a
    // hand-edited or copy-pasted cell repeats one -- and this becomes a React
    // key, where a duplicate lets the reconciler carry one cell's subtree, and
    // its "has this scrolled into view yet" state, onto another.
    id:
      typeof cell.id === "string" && cell.id !== ""
        ? `${index}-${cell.id}`
        : `cell-${index}`,
    outputs: type === "code" ? normalizeOutputs(cell.outputs) : [],
    source,
    type,
  };
}

function normalizeError(output: Record<string, unknown>): NotebookErrorOutput {
  const ename = typeof output.ename === "string" ? output.ename : "";
  const evalue = typeof output.evalue === "string" ? output.evalue : "";

  const frames = isArray(output.traceback)
    ? output.traceback.filter(
        (frame): frame is string => typeof frame === "string",
      )
    : [];

  // Every frame is styled with ANSI escapes, and a frame can itself span
  // several lines, so the traceback is joined and re-split rather than taken
  // one array element per rendered line.
  const traceback =
    frames.length > 0
      ? parseAnsi(frames.join("\n"))
      : parseAnsi(evalue === "" ? ename : `${ename}: ${evalue}`);

  return { ename, evalue, traceback, type: "error" };
}

/**
 * The richest representation of an output that actually has content.
 *
 * Walked rather than picked once, because a bundle can carry a key whose value
 * is empty -- a blank `text/html` beside a perfectly good `text/plain` is the
 * one that shows up -- and choosing by which key exists would throw the whole
 * output away on the strength of the empty one.
 */
function normalizeMimeBundle(
  data: Record<string, unknown>,
  prompt: null | number,
): NotebookOutput | null {
  for (const mimeType of OUTPUT_MIME_PRECEDENCE) {
    if (!Object.hasOwn(data, mimeType)) {
      continue;
    }
    const output = buildOutput({ data, mimeType, prompt });
    if (output) {
      return output;
    }
  }
  return null;
}

function normalizeOutput(
  value: unknown,
): NotebookOutput | null | PendingStream {
  const output = asRecord(value);
  if (!output) {
    return null;
  }

  const outputType =
    typeof output.output_type === "string" ? output.output_type : "";

  if (outputType === "stream") {
    // nbformat 3 called the channel `stream`; nbformat 4 calls it `name`.
    const channel = output.name ?? output.stream;
    return {
      name: channel === "stderr" ? "stderr" : "stdout",
      text: joinLines(output.text),
      type: "stream",
    };
  }

  // `pyerr` is nbformat 3's spelling of `error`.
  if (outputType === "error" || outputType === "pyerr") {
    return normalizeError(output);
  }

  // `pyout` is nbformat 3's spelling of `execute_result`. Everything else
  // carrying a mime bundle -- `display_data`, and whatever output type a future
  // writer adds -- is rendered from that bundle rather than dropped.
  const prompt = readCount(output.execution_count ?? output.prompt_number);
  return normalizeMimeBundle(readMimeBundle(output), prompt);
}

function normalizeOutputs(value: unknown): NotebookOutput[] {
  if (!isArray(value)) {
    return [];
  }

  const normalized: (NotebookOutput | PendingStream)[] = [];
  for (const raw of value) {
    const output = normalizeOutput(raw);
    if (output) {
      normalized.push(output);
    }
  }

  const outputs: NotebookOutput[] = [];
  for (const output of mergeStreams(normalized)) {
    if (output.type !== "stream") {
      outputs.push(output);
      continue;
    }
    const lines = parseAnsi(applyCarriageReturns(output.text));
    if (!isBlank(lines)) {
      outputs.push({ lines, prompt: null, stream: output.name, type: "text" });
    }
  }
  return outputs;
}

/**
 * The value JSON text describes, or nothing when it is not JSON.
 *
 * Wrapped because `null` is a value JSON can hold and has to stay
 * distinguishable from text that would not parse at all.
 */
function parseJsonText(value: unknown): undefined | { value: unknown } {
  try {
    const parsed: unknown = JSON.parse(joinLines(value));
    return { value: parsed };
  } catch {
    return undefined;
  }
}

function readCellType(cell: Record<string, unknown>): NotebookCellType {
  switch (cell.cell_type) {
    case "code": {
      return "code";
    }
    // nbformat 3's `heading` cell is a markdown heading with its level stored
    // beside the text; `withHeadingLevel` puts the hashes back.
    case "heading":
    case "markdown": {
      return "markdown";
    }
    default: {
      return "raw";
    }
  }
}

function readCount(value: unknown): null | number {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readLanguage(root: Record<string, unknown>): string {
  const metadata = asRecord(root.metadata);
  const languageInfo = asRecord(metadata?.language_info);
  if (typeof languageInfo?.name === "string" && languageInfo.name !== "") {
    return languageInfo.name;
  }

  const kernelspec = asRecord(metadata?.kernelspec);
  if (typeof kernelspec?.language === "string" && kernelspec.language !== "") {
    return kernelspec.language;
  }

  return "python";
}

/** The mime bundle, from nbformat 4's `data` bag or nbformat 3's flat keys. */
function readMimeBundle(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const data = asRecord(output.data);
  if (data) {
    return data;
  }

  const bundle: Record<string, unknown> = {};
  for (const [key, mimeType] of Object.entries(LEGACY_MIME_KEYS)) {
    if (Object.hasOwn(output, key)) {
      // nbformat 3 held every one of these as text, including the JSON, which
      // nbformat 4 holds parsed. Parsing it back here is what keeps the two
      // spellings from being anything the rest of this module knows about --
      // and stringifying text that is already JSON would render one quoted,
      // backslashed line where the data should be.
      //
      // Text that will not parse is not JSON output, so the key is left off
      // the bundle entirely and the precedence walk falls through to whatever
      // representation came with it.
      if (key === "json") {
        const parsed = parseJsonText(output[key]);
        if (parsed) {
          bundle[mimeType] = parsed.value;
        }
        continue;
      }

      bundle[mimeType] = output[key];
    }
  }
  return bundle;
}

function stripWhitespace(value: string): string {
  return value.replaceAll(/\s/g, "");
}

/** nbformat 3 heading cells carry their level as a number beside the text. */
function withHeadingLevel(
  source: string,
  cell: Record<string, unknown>,
): string {
  if (cell.cell_type !== "heading") {
    return source;
  }
  const level =
    typeof cell.level === "number" ? Math.min(Math.max(cell.level, 1), 6) : 1;
  return `${"#".repeat(level)} ${source}`;
}
