/**
 * A PNG that is nothing but a header, declaring whatever dimensions you ask for.
 *
 * The point of a decode bomb is that its declared size and its file size have
 * nothing to do with each other, so producing one does not require producing the
 * pixels. Asking ffmpeg to actually paint 16000x16000 to test the guard would
 * spend exactly the resources the guard exists to refuse.
 *
 * Enough for anything that reads dimensions from the header. Not a decodable
 * image: there is no IDAT and no IEND.
 */
export function pngHeaderBytes({
  height,
  width,
}: {
  height: number;
  width: number;
}) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // chunk data length
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16); // bit depth
  ihdr.writeUInt8(6, 17); // color type: RGBA
  // Compression, filter, and interlace all take their only sane value, which is
  // zero, and the CRC is left zero because nothing that reads a header checks it.

  return Buffer.concat([signature, ihdr]);
}
