import {
  isTextMimeType,
} from "./is-text-mime-type";

type FileType =
  | "audio"
  | "code"
  | "html"
  | "image"
  | "markdown"
  | "pdf"
  | "text"
  | "unknown"
  | "video";

export function fileKindLabel(fileType: FileType): string {
  switch (fileType) {
    case "audio": {
      return "Audio";
    }
    case "code": {
      return "Code";
    }
    case "html": {
      return "HTML";
    }
    case "image": {
      return "Image";
    }
    case "markdown": {
      return "Markdown";
    }
    case "pdf": {
      return "PDF";
    }
    case "text": {
      return "Text file";
    }
    case "video": {
      return "Video";
    }
    default: {
      return "File";
    }
  }
}

export function getFileType({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}): FileType {
  const lowerFilename = filename.toLowerCase();

  if (mimeType) {
    if (mimeType.startsWith("image/")) {
      return "image";
    }

    if (mimeType.startsWith("video/")) {
      return "video";
    }

    if (mimeType.startsWith("audio/")) {
      return "audio";
    }

    if (mimeType === "application/pdf") {
      return "pdf";
    }

    if (mimeType === "text/html") {
      return "html";
    }
  }

  if (isMarkdown({ filename, mimeType })) {
    return "markdown";
  }

  if (/\.html?$/i.test(lowerFilename)) {
    return "html";
  }

  if (isTextMimeType(mimeType)) {
    if (isReadableText({ filename, mimeType })) {
      return "text";
    }
    return "code";
  }

  if (isReadableText({ filename, mimeType })) {
    return "text";
  }

  return "unknown";
}

function isMarkdown({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}): boolean {
  const lowerFilename = filename.toLowerCase();
  return (
    mimeType === "text/markdown" ||
    /\.(?:md|markdown|mdown|mkd|mdx)$/i.test(lowerFilename)
  );
}

function isMarkupFile(filename: string): boolean {
  // cspell:disable-next-line
  return /\.(?:rst|rest|adoc|asciidoc|textile|org|wiki|mediawiki|creole)$/i.test(
    filename.toLowerCase(),
  );
}

function isReadableText({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}): boolean {
  const lowerFilename = filename.toLowerCase();
  const hasNoExtension = !lowerFilename.includes(".");
  const isTextFile =
    lowerFilename.endsWith(".txt") || lowerFilename.endsWith(".text");

  return (
    isTextFile ||
    (hasNoExtension && mimeType === "text/plain") ||
    isMarkdown({ filename, mimeType }) ||
    isMarkupFile(filename)
  );
}
