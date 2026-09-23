// File-type glyphs for the types the @pierre/trees "complete" set leaves on its
// generic page: media, office documents, mail, calendars, and 3D models. Drawn
// in that set's vocabulary (16×16, the dog-eared page at 40% behind a solid
// mark in the same color) so they sit beside the built-ins as one family.
// Markup is the inside of a <symbol viewBox="0 0 16 16">.

const PAGE = `<path fill="currentColor" d="M8 1v3a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1z" opacity=".4"/><path fill="currentColor" d="M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z"/>`;

export const FILE_TYPE_GLYPHS = {
  audio: {
    // Built-in palette: indigo.
    colors: ["#693acf", "#9d6afb"],
    extensions: [
      "aac",
      "aif",
      "aifc",
      "aiff",
      "caf",
      "flac",
      "m4a",
      "mid",
      "midi",
      "mp3",
      "oga",
      "ogg",
      "opus",
      "wav",
      "weba",
      "wma",
    ],
    markup: `${PAGE}<path fill="currentColor" d="M8.25 12.5V8.1a.5.5 0 0 1 .68-.47l2.5.94a.5.5 0 0 1 .32.47v.9a.5.5 0 0 1-.68.47l-1.82-.68v2.77z"/><circle cx="7.5" cy="12.25" r="1.75" fill="currentColor"/>`,
  },
  calendar: {
    // Built-in palette: red.
    colors: ["#d52c36", "#ff6762"],
    extensions: ["ics", "ical", "icalendar", "ifb", "vcs"],
    markup: `<path fill="currentColor" d="M2 6h12v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5z" opacity=".4"/><path fill="currentColor" d="M4.5 3h7A2.5 2.5 0 0 1 14 5.5V6H2v-.5A2.5 2.5 0 0 1 4.5 3M5 1.5a.5.5 0 0 1 1 0V4a.5.5 0 0 1-1 0zm5 0a.5.5 0 0 1 1 0V4a.5.5 0 0 1-1 0zM4 8h2v1.5H4zm3 0h2v1.5H7zm3 0h2v1.5h-2zm-6 2.5h2V12H4zm3 0h2V12H7z"/>`,
  },
  document: {
    // Built-in palette: blue.
    colors: ["#1a85d4", "#69b1ff"],
    extensions: [
      "doc",
      "docm",
      "docx",
      "dot",
      "dotx",
      "epub",
      "mobi",
      "odt",
      "ott",
      "pages",
      "wpd",
    ],
    markup: `${PAGE}<path fill="currentColor" d="M4.5 8h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1m0 2h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1m0 2h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1"/>`,
  },
  mail: {
    // Built-in palette: cyan.
    colors: ["#1ca1c7", "#68cdf2"],
    extensions: ["eml", "emlx", "mbox", "msg", "oft"],
    markup: `<path fill="currentColor" d="M3.5 3h9A2.5 2.5 0 0 1 15 5.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 10.5v-5A2.5 2.5 0 0 1 3.5 3" opacity=".4"/><path fill="currentColor" d="M3.21 5.09a.5.5 0 0 1 .7-.12L8 7.89l4.09-2.92a.5.5 0 1 1 .58.81l-4.38 3.13a.5.5 0 0 1-.58 0L3.33 5.78a.5.5 0 0 1-.12-.7"/>`,
  },
  model: {
    // Built-in palette: yellow.
    colors: ["#d5a910", "#ffd452"],
    extensions: [
      "3ds",
      "3mf",
      "blend",
      "dae",
      "fbx",
      "glb",
      "gltf",
      "obj",
      "ply",
      "reality",
      "stl",
      "usd",
      "usda",
      "usdc",
      "usdz",
    ],
    markup: `<path fill="currentColor" d="M7.55 1.62a1 1 0 0 1 .9 0l5 2.5a.5.5 0 0 1 0 .9L8 7.75 2.55 5.02a.5.5 0 0 1 0-.9z" opacity=".4"/><path fill="currentColor" d="M2 6.06 7.5 8.6v6.1a.5.5 0 0 1-.72.45l-4.23-2.12A1 1 0 0 1 2 12.14z" opacity=".7"/><path fill="currentColor" d="M14 6.06 8.5 8.6v6.1a.5.5 0 0 0 .72.45l4.23-2.12a1 1 0 0 0 .55-.89z"/>`,
  },
  pdf: {
    // Built-in palette: red.
    colors: ["#d52c36", "#ff6762"],
    extensions: ["pdf"],
    markup: `${PAGE}<path fill="currentColor" d="M4.5 8h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1m0 2h7a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 1 .5-.5"/>`,
  },
  presentation: {
    // Built-in palette: orange.
    colors: ["#d47628", "#ffa359"],
    extensions: [
      "key",
      "odp",
      "otp",
      "pot",
      "potx",
      "pps",
      "ppsx",
      "ppt",
      "pptm",
      "pptx",
    ],
    markup: `${PAGE}<path fill="currentColor" fill-rule="evenodd" d="M4.5 8h7a.5.5 0 0 1 .5.5V12a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 12V8.5a.5.5 0 0 1 .5-.5M5.5 11.25h1v-1h-1zm2 0h1v-2h-1zm2 0h1V9.75h-1z"/>`,
  },
  video: {
    // Built-in palette: purple.
    colors: ["#a631be", "#d568ea"],
    extensions: [
      "3g2",
      "3gp",
      "avi",
      "flv",
      "m2ts",
      "m4v",
      "mkv",
      "mov",
      "mp4",
      "mpeg",
      "mpg",
      "mts",
      "ogv",
      "qt",
      "webm",
      "wmv",
    ],
    markup: `${PAGE}<path fill="currentColor" d="M6 8.38v3.74a.5.5 0 0 0 .76.43l3.1-1.87a.5.5 0 0 0 0-.86l-3.1-1.87A.5.5 0 0 0 6 8.38"/>`,
  },
} satisfies Record<
  string,
  {
    colors: [light: string, dark: string];
    extensions: string[];
    markup: string;
  }
>;

// Types the complete set already has a glyph for but does not map, keyed by
// the built-in token whose glyph they borrow.
export const FILE_TYPE_ALIASES = {
  bash: ["bat", "cmd", "ps1", "psm1"],
  image: [
    "arw",
    "cr2",
    "cr3",
    "dng",
    "heic",
    "heif",
    "jfif",
    "jxl",
    "nef",
    "orf",
    "psd",
    "raf",
    "raw",
    "rw2",
  ],
  python: ["ipynb"],
  svg: ["ai", "eps", "fig", "sketch"],
  table: ["numbers", "xlsm"],
  text: ["lock", "srt", "toml", "vtt"],
  zip: ["apk", "appimage", "deb", "dmg", "iso", "msi", "pkg", "rpm", "xip"],
} satisfies Record<string, string[]>;
