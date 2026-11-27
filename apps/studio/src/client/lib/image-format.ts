/** The picture formats a file's first bytes name, by the word a file manager uses. */
type ImageFormat =
  | "AVIF"
  | "BMP"
  | "GIF"
  | "HEIC"
  | "ICO"
  | "JPEG"
  | "PNG"
  | "TIFF"
  | "WebP";

/** How many leading bytes `formatOfBytes` reads. */
export const IMAGE_SIGNATURE_LENGTH = 32;

const EXTENSIONS: Record<string, ImageFormat> = {
  avif: "AVIF",
  bmp: "BMP",
  gif: "GIF",
  heic: "HEIC",
  heif: "HEIC",
  ico: "ICO",
  jpeg: "JPEG",
  jpg: "JPEG",
  png: "PNG",
  tif: "TIFF",
  tiff: "TIFF",
  webp: "WebP",
};

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "mif1", "msf1"]);

/** The format a file's name says it is, where its extension names one. */
export function formatOfName(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension === undefined || extension === filename.toLowerCase()
    ? undefined
    : EXTENSIONS[extension];
}

/** The format a file's first bytes say it is, where they match a known signature. */
export function formatOfBytes(bytes: Uint8Array): ImageFormat | undefined {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) {
    return "PNG";
  }
  if (startsWith(0xff, 0xd8, 0xff)) {
    return "JPEG";
  }
  if (ascii(0, 4) === "GIF8") {
    return "GIF";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "WebP";
  }
  if (
    startsWith(0x49, 0x49, 0x2a, 0x00) ||
    startsWith(0x4d, 0x4d, 0x00, 0x2a)
  ) {
    return "TIFF";
  }
  if (ascii(0, 2) === "BM") {
    return "BMP";
  }
  if (startsWith(0x00, 0x00, 0x01, 0x00)) {
    return "ICO";
  }
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") {
      return "AVIF";
    }
    if (HEIC_BRANDS.has(brand)) {
      return "HEIC";
    }
  }
  return undefined;
}
