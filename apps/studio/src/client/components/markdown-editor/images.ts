import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type Uploader } from "@milkdown/kit/plugin/upload";
import {
  Fragment,
  type Node as PMNode,
  type Schema,
  Slice,
} from "@milkdown/kit/prose/model";
import { type EditorView } from "@milkdown/kit/prose/view";

// Files given to the Markdown editor: pasted, dropped, or picked from the
// slash menu. Each is put in the file's folder (copied in unless it is already
// there or below) and linked by its path relative to the file, which is how
// the file reads in any other Markdown app and how the editor resolves it. A
// picture goes in as an image, anything else as a link named for the file.

/** A file put beside the Markdown file: its link, and whether it shows as a picture. */
interface Placed {
  image: boolean;
  name: string;
  src: string;
}

/**
 * Crepe's uploader, which its upload plugin calls with what was pasted or
 * dropped and places at the drop: the files, put beside the file.
 */
export function fileUploader(folder: string): Uploader {
  return async (files, schema) =>
    Fragment.from(nodesFor(schema, await placeFiles(folder, [...files])));
}

/** Puts `files` beside the file in `folder`, then links them at the selection. */
export async function insertFiles(
  view: EditorView,
  folder: string,
  files: File[],
): Promise<void> {
  const placed = await placeFiles(folder, files);
  if (view.isDestroyed || placed.length === 0) {
    return;
  }
  const slice = new Slice(
    Fragment.from(nodesFor(view.state.schema, placed)),
    0,
    0,
  );
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  view.focus();
}

/** Each file as the editor shows it: a picture as an image, anything else a link named for it, with a space beside a link. */
function nodesFor(schema: Schema, placed: Placed[]): PMNode[] {
  const { image } = schema.nodes;
  const { link } = schema.marks;
  const shown = placed.map((file) => ({
    asImage: file.image && image !== undefined,
    file,
  }));
  return shown.flatMap(({ asImage, file }, index) => {
    const node =
      asImage && image
        ? image.create({ alt: "", src: file.src, title: "" })
        : schema.text(file.name, link ? [link.create({ href: file.src })] : []);
    const besideLink = !asImage || shown[index - 1]?.asImage === false;
    return index > 0 && besideLink ? [schema.text(" "), node] : [node];
  });
}

/** Each file's link, or none and a toast when one of them could not be put there. */
async function placeFiles(folder: string, files: File[]): Promise<Placed[]> {
  try {
    return await Promise.all(files.map((file) => placeFile(folder, file)));
  } catch (error) {
    toast.error(
      files.length === 1 ? "Couldn't add the file" : "Couldn't add the files",
      { cause: error },
    );
    return [];
  }
}

/** Where `file` went in `folder`, written as a Markdown link writes it. */
async function placeFile(folder: string, file: File): Promise<Placed> {
  const image = file.type.startsWith("image/");
  const from = window.api.getFilePath(file);
  const { path } = await (from
    ? rpcClient.files.addFile.call({ folder, from })
    : rpcClient.files.addFile.call({
        content: await base64Of(file),
        folder,
        // A copied picture comes as `image.png` whatever it is; it is named for when it came in.
        name: image || !file.name ? pastedName(file.type) : file.name,
      }));
  // Always below the folder, since it is put there; a path is escaped a
  // segment at a time so a space or `#` in a name still reads as the name.
  const relative = path.startsWith(folder) ? path.slice(folder.length) : path;
  return {
    image,
    name: relative.split(/[/\\]/).at(-1) ?? relative,
    src: relative.split(/[/\\]/).map(encodeURIComponent).join("/"),
  };
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
      reject(reader.error ?? new Error("Couldn't read the file"));
    });
    reader.readAsDataURL(file);
  });
}
