import {
  FileSystemFolderGlyph,
  FileTypeGlyph,
  resolveFileTypeIcon,
} from "@/client/components/extend/file-system";
import {
  FILE_NAME_ALIASES,
  FILE_TYPE_ALIASES,
  FILE_TYPE_GLYPHS,
} from "@/client/components/extend/file-type-glyphs";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { Input } from "@/client/components/ui/input";
import { EXTENSION_MAP } from "@/client/lib/file-extension-to-language";
import { getBuiltInSpriteSheet } from "@pierre/trees";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { getComponentPage } from "../-debug-routes";

export const Route = createFileRoute("/debug/components/file-icons")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getComponentPage("file-icons").label }],
  }),
});

type ResolvedIcon = ReturnType<typeof resolveFileTypeIcon>;

// Formats people hand the app, beyond the ones a glyph or alias already
// names. The set keeps its own extension table private, so this list is what
// the page asks it about; anything that lands on the default page is a gap.
const COMMON_EXTENSIONS = [
  "7z",
  "aac",
  "aiff",
  "ass",
  "avif",
  "avro",
  "bib",
  "bmp",
  "bz2",
  "cfg",
  "conf",
  "db",
  "dll",
  "doc",
  "docm",
  "docx",
  "dot",
  "dotx",
  "dylib",
  "eot",
  "epub",
  "flac",
  "geojson",
  "gif",
  "gz",
  "icns",
  "ico",
  "ini",
  "jar",
  "jpeg",
  "jpg",
  "json",
  "json5",
  "jsonc",
  "jsonl",
  "key",
  "log",
  "m4a",
  "m4v",
  "mhtml",
  "mkv",
  "mobi",
  "mov",
  "mp3",
  "mp4",
  "ndjson",
  "odp",
  "ods",
  "odt",
  "ogg",
  "opus",
  "otf",
  "pages",
  "parquet",
  "png",
  "ppt",
  "pptx",
  "rar",
  "ris",
  "rtf",
  "so",
  "sqlite",
  "ssa",
  "tar",
  "tgz",
  "tif",
  "tiff",
  "tsv",
  "ttf",
  "txt",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "xz",
  "yaml",
  "zip",
  "zst",
];

// Names the set matches whole, before it looks at an extension.
const SAMPLE_FILE_NAMES = [
  ".env",
  ".gitignore",
  ".prettierrc",
  "CLAUDE.md",
  "Dockerfile",
  "biome.json",
  "bun.lockb",
  "eslint.config.js",
  "package.json",
  "tailwind.config.ts",
  "tsconfig.json",
  "vite.config.ts",
];

const SAMPLES = [
  ...[
    ...new Set([
      ...COMMON_EXTENSIONS,
      ...Object.keys(EXTENSION_MAP),
      ...Object.values(FILE_TYPE_ALIASES).flat(),
      ...Object.values(FILE_TYPE_GLYPHS).flatMap((glyph) => glyph.extensions),
    ]),
  ].map((extension) => ({ fileName: `file.${extension}`, label: extension })),
  ...[
    ...new Set([
      ...Object.values(FILE_NAME_ALIASES).flat(),
      ...SAMPLE_FILE_NAMES,
    ]),
  ].map((fileName) => ({ fileName, label: fileName })),
];

// Every glyph the sprite carries, reached by a sample or not, so a glyph no
// listed format resolves to still shows up.
const SPRITE_ICONS: ResolvedIcon[] = [
  ...[
    ...getBuiltInSpriteSheet("complete").matchAll(
      /<symbol[^>]*id="file-tree-builtin-([^"]+)"/g,
    ),
  ].flatMap(([, token]) =>
    token ? [{ name: `file-tree-builtin-${token}`, token }] : [],
  ),
  ...[...Object.keys(FILE_TYPE_GLYPHS), ...Object.keys(FILE_TYPE_ALIASES)].map(
    (token) => ({ name: `file-system-icon-${token}` }),
  ),
];

// What people keep on their own computers, as opposed to in a repository:
// the icons that turn up most in attachments, folders and the files a task
// hands back.
const EVERYDAY_FILES = [
  "Budget.xlsx",
  "Legacy.xls",
  "Macros.xlsm",
  "Open.ods",
  "Export.csv",
  "Export.tsv",
  "Report.docx",
  "Contract.pdf",
  "Deck.pptx",
  "Keynote.key",
  "Pages.pages",
  "Numbers.numbers",
  "Notes.txt",
  "Notes.md",
  "Notes.rtf",
  "Photo.jpg",
  "Screenshot.png",
  "Photo.heic",
  "Logo.svg",
  "Design.psd",
  "Recording.mov",
  "Video.mp4",
  "Song.mp3",
  "Memo.m4a",
  "Archive.zip",
  "Installer.dmg",
  "Page.html",
  "Email.eml",
  "Invite.ics",
  "Contact.vcf",
  "Book.epub",
  "Font.otf",
  "Data.json",
  "Shortcut.webloc",
];

interface Group {
  icon: ResolvedIcon;
  samples: string[];
}

function groupSamples(): Group[] {
  const groups = new Map<string, Group>(
    SPRITE_ICONS.map((icon) => [icon.name, { icon, samples: [] }]),
  );
  for (const { fileName, label } of SAMPLES) {
    const icon = resolveFileTypeIcon(fileName);
    const group = groups.get(icon.name) ?? { icon, samples: [] };
    group.samples.push(label);
    groups.set(icon.name, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, samples: group.samples.toSorted() }))
    .toSorted((a, b) => glyphLabel(a.icon).localeCompare(glyphLabel(b.icon)));
}

const GROUPS = groupSamples();
const DEFAULT_GROUP = GROUPS.find(
  (group) => group.icon.name === "file-tree-builtin-default",
);
const GLYPH_GROUPS = GROUPS.filter((group) => group !== DEFAULT_GROUP);

// The extension leads, since telling formats apart is the point; the name
// and the glyph it resolved to sit under it, wrapping rather than cut off.
function EverydayFile({ fileName }: { fileName: string }) {
  const icon = resolveFileTypeIcon(fileName);
  const dot = fileName.lastIndexOf(".");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <GlyphTiles icon={icon} />
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-sm font-medium break-all">
          {dot > 0 ? fileName.slice(dot) : fileName}
        </span>
        <span className="font-mono text-[11px] break-all text-muted-foreground">
          {fileName} → {glyphLabel(icon)}
        </span>
      </div>
    </div>
  );
}

function GlyphCard({ group }: { group: Group }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <GlyphTiles icon={group.icon} />
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-xs break-all">
            {glyphLabel(group.icon)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {glyphSource(group.icon)}
          </span>
        </div>
      </div>
      <p className="font-mono text-[11px] leading-relaxed break-words text-muted-foreground">
        {group.samples.length > 0 ? group.samples.join(" ") : "no sample"}
      </p>
    </div>
  );
}

function glyphLabel(icon: ResolvedIcon) {
  return icon.name.replace(/^file-tree-builtin-|^file-system-icon-/, "");
}

function glyphSource(icon: ResolvedIcon) {
  if (icon.name.startsWith("file-system-icon-")) {
    return icon.name.slice("file-system-icon-".length) in FILE_TYPE_ALIASES
      ? "alias"
      : "ours";
  }
  return "set";
}

// The icon at row size and tile size on the app's surface, then on the paper
// surface thumbnails keep in dark mode.
function GlyphTiles({ icon }: { icon: ResolvedIcon }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <FileTypeGlyph className="size-4" icon={icon} />
      <FileTypeGlyph className="size-8" icon={icon} />
      <div
        className="flex items-center gap-2 rounded-md bg-white p-1.5"
        data-file-system-on-light=""
      >
        <FileTypeGlyph className="size-4" icon={icon} />
        <FileTypeGlyph className="size-8" icon={icon} />
      </div>
    </div>
  );
}

function RouteComponent() {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const tried = trimmed ? resolveFileTypeIcon(trimmed) : undefined;

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
        <div className="flex flex-col gap-3">
          <Input
            className="max-w-sm"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Try a file name, like report.docx"
            value={query}
          />
          {tried ? (
            <div className="flex items-center gap-3 text-sm">
              <GlyphTiles icon={tried} />
              <span className="font-mono text-xs text-muted-foreground">
                {glyphLabel(tried)} · {glyphSource(tried)}
              </span>
            </div>
          ) : null}
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Everyday files</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {EVERYDAY_FILES.map((fileName) => (
              <EverydayFile fileName={fileName} key={fileName} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Folders</h2>
          <p className="text-xs text-muted-foreground">
            The app draws folders two ways. The file browser uses the first one,
            and folder cards and chips in a chat use the second.
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <FileSystemFolderGlyph className="h-3.5 w-auto" />
                <FileSystemFolderGlyph className="h-9 w-auto" />
                <FileSystemFolderGlyph className="h-13 w-auto drop-shadow-sm" />
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                FileSystemFolderGlyph · extend/file-system.tsx
              </span>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <MacFolderIcon className="size-4" />
                <MacFolderIcon className="size-5" />
                <MacFolderIcon className="size-9" />
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                MacFolderIcon · icons/mac-folder.tsx
              </span>
            </div>
          </div>
        </section>

        {DEFAULT_GROUP ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">
              No icon of its own ({DEFAULT_GROUP.samples.length})
            </h2>
            <GlyphCard group={DEFAULT_GROUP} />
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">
            Glyphs ({GLYPH_GROUPS.length})
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {GLYPH_GROUPS.map((group) => (
              <GlyphCard group={group} key={group.icon.name} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
