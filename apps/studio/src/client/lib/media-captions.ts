import {
  folderOf,
  joinHostPath,
  nameOf,
} from "@/client/components/window/host-path";

/** A caption file found beside a video, as WebVTT text, and its own name. */
export interface SiblingCaptions {
  name: string;
  vtt: string;
}

/**
 * The caption files a video might have beside it: its own name with `.vtt`,
 * then `.srt`, in the order they are tried.
 */
export function captionCandidates(hostPath: string) {
  const name = nameOf(hostPath);
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const folder = folderOf(hostPath);
  return [".vtt", ".srt"].map((extension) =>
    joinHostPath(folder, `${base}${extension}`),
  );
}

/**
 * SubRip text as WebVTT, the only caption format a `<track>` reads. The two
 * differ in the header and in the decimal comma of each timing, and SubRip's
 * cue numbers are valid WebVTT cue names, so they stay.
 */
export function srtToVtt(srt: string) {
  const body = srt
    .replace(/^﻿/, "")
    .replaceAll(/\r\n?/g, "\n")
    .replaceAll(
      /(\d{1,2}:\d{2}:\d{2}),(\d{3})(\s+-->\s+)(\d{1,2}:\d{2}:\d{2}),(\d{3})/g,
      "$1.$2$3$4.$5",
    )
    .trim();
  return `WEBVTT\n\n${body}\n`;
}
