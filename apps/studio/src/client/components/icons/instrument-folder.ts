import artwork from "../../../../resources/instrument-folder.svg?raw";

// The desktop folder icon, framed like the file browser's folder glyph (64 by
// 50, the folder filling about 84% of the width) so the two sit at one size.
const framed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22.5 31 557 435" width="557" height="435">${artwork}</svg>`;

/** Instrument's output folder as the file browser draws it. */
export const INSTRUMENT_FOLDER_GLYPH_URL = `data:image/svg+xml,${encodeURIComponent(framed)}`;
