import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type Uploader } from "@milkdown/kit/plugin/upload";
import { Fragment } from "@milkdown/kit/prose/model";
import { type EditorView } from "@milkdown/kit/prose/view";

// Pictures given to the Markdown editor: pasted, dropped, or picked from the
// slash menu. Each is put in the file's folder (copied in unless it is already
// there or below) and linked by its path relative to the file, which is how
// the file reads in any other Markdown app and how the editor resolves it.

/** The pictures among files handed over, in order. */
export function imageFilesOf(files: FileList | null | undefined): File[] {
  return [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
}

/**
 * Crepe's uploader, which its upload plugin calls with what was pasted or
 * dropped and places at the drop: the pictures among them, put beside the file.
 */
export function imageUploader(folder: string): Uploader {
  return async (files, schema) => {
    const image = schema.nodes.image;
    const srcs = await placeImages(folder, imageFilesOf(files));
    return Fragment.from(
      image ? srcs.map((src) => image.create({ alt: "", src, title: "" })) : [],
    );
  };
}

/** Puts `files` beside the file in `folder`, then links them at the selection. */
export async function insertImages(
  view: EditorView,
  folder: string,
  files: File[],
): Promise<void> {
  const srcs = await placeImages(folder, files);
  const image = view.state.schema.nodes.image;
  if (!image || view.isDestroyed || srcs.length === 0) {
    return;
  }
  let tr = view.state.tr;
  for (const src of srcs) {
    tr = tr.replaceSelectionWith(image.create({ alt: "", src, title: "" }));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Each picture's link, or none and a toast when one of them could not be put there. */
async function placeImages(folder: string, files: File[]): Promise<string[]> {
  try {
    return await Promise.all(files.map((file) => placeImage(folder, file)));
  } catch (error) {
    toast.error(
      files.length === 1
        ? "Couldn't add the picture"
        : "Couldn't add the pictures",
      { cause: error },
    );
    return [];
  }
}

/** The file's path for `file` in `folder`, written as a Markdown link writes it. */
async function placeImage(folder: string, file: File): Promise<string> {
  const from = window.api.getFilePath(file);
  const { path } = await (from
    ? rpcClient.files.addImage.call({ folder, from })
    : rpcClient.files.addImage.call({
        content: await base64Of(file),
        folder,
        // A copied picture comes as `image.png` whatever it is; it is named for when it came in.
        name: pastedName(file.type),
      }));
  // Always below the folder, since it is put there; a path is escaped a
  // segment at a time so a space or `#` in a name still reads as the name.
  const relative = path.startsWith(folder) ? path.slice(folder.length) : path;
  return relative.split(/[/\\]/).map(encodeURIComponent).join("/");
}

/** A name for a picture pasted with no file behind it: when it came in, local time. */
function pastedName(type: string): string {
  const extension =
    { "image/jpeg": "jpg", "image/svg+xml": "svg" }[type] ??
    type.replace(/^image\//, "");
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ]
    .map((part) => part.toString().padStart(2, "0"))
    .join("");
  return `Pasted image ${stamp}.${extension || "png"}`;
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.replace(/^data:[^,]*,/, ""));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Couldn't read the picture"));
    });
    reader.readAsDataURL(file);
  });
}
