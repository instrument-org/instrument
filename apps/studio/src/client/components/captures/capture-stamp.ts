import { type Capture, type CaptureMeta, captureUrl } from "@/shared/captures";

/**
 * Copy image puts the picture on the clipboard with a band under it naming
 * the build, screen, chat and time. Slack and most chat apps re-encode a
 * pasted image and drop what the PNG carries, so the band is what still says
 * where a capture came from once it is shared. The file itself stays clean.
 */

/** Below this width, in the picture's CSS pixels, the band gives only the build. */
const FULL_LINE_MIN_WIDTH = 600;
const BAND_HEIGHT = 24;
const FONT_SIZE = 11;
const PADDING = 8;

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});

/** The build, as short as it can be and still say which: version, kind, commit. */
function buildWords(build: CaptureMeta["build"]) {
  if (build.env === "development") {
    return [`${build.version} dev`, build.commit].filter(Boolean).join(" · ");
  }
  if (build.env === "preview") {
    return [`${build.version} preview`, build.name].filter(Boolean).join(" ");
  }
  return build.version;
}

/** The band's line: everything when there is room, the build alone when there is not. */
export function stampLine(meta: CaptureMeta, wide: boolean) {
  if (!wide) {
    return buildWords(meta.build);
  }
  const build = meta.build;
  const where =
    build.env === "development"
      ? [
          `${build.version} dev`,
          [build.name, build.commit].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(" · ")
      : buildWords(build);
  return [
    `Instrument ${where}`,
    meta.chatTitle ? `${meta.screen} “${meta.chatTitle}”` : meta.screen,
    dateFormat.format(meta.takenAt),
  ].join(" · ");
}

/** Cuts `text` to fit `width` on the canvas, ending it with an ellipsis. */
function fitted(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) {
    return text;
  }
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > width) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}

/** The picture with its band, as a PNG. `picture` is an edit not yet saved, when there is one. */
async function stamped(capture: Capture, picture?: Blob) {
  const source = picture ?? (await (await fetch(captureUrl(capture))).blob());
  const meta = capture.meta;
  if (!meta) {
    return source;
  }
  const bitmap = await createImageBitmap(source);
  // Captures are taken at the screen's density, so the band is drawn at it.
  const scale = Math.max(1, Math.round(window.devicePixelRatio));
  const band = BAND_HEIGHT * scale;
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height + band;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return source;
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.fillStyle = "#111113";
  ctx.fillRect(0, bitmap.height, bitmap.width, band);
  ctx.font = `${FONT_SIZE * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.textBaseline = "middle";
  const line = stampLine(meta, bitmap.width / scale >= FULL_LINE_MIN_WIDTH);
  ctx.fillText(
    fitted(ctx, line, bitmap.width - PADDING * 2 * scale),
    PADDING * scale,
    bitmap.height + band / 2,
  );
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The picture couldn't be made"));
      }
    }, "image/png");
  });
}

/** Puts a capture on the clipboard as a picture with its build band. */
export async function copyCaptureImage(capture: Capture, picture?: Blob) {
  const blob = await stamped(capture, picture);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
