import { nameOf } from "@/client/components/window/host-path";
import { useQuery } from "@tanstack/react-query";

import { getComputerFileUrl } from "./computer-file-url";
import {
  captionCandidates,
  type SiblingCaptions,
  srtToVtt,
} from "./media-captions";

/**
 * The first caption file beside a video, read as WebVTT: a HEAD per name
 * until one is there, so a video with none costs two bodiless requests and
 * no listing of its folder.
 */
async function readSiblingCaptions(
  hostPath: string,
  signal: AbortSignal,
): Promise<null | SiblingCaptions> {
  for (const candidate of captionCandidates(hostPath)) {
    const url = getComputerFileUrl({ hostPath: candidate });
    if (!url) {
      return null;
    }
    const head = await fetch(url, { method: "HEAD", signal });
    if (!head.ok) {
      continue;
    }
    const text = await (await fetch(url, { signal })).text();
    const vtt = candidate.toLowerCase().endsWith(".srt")
      ? srtToVtt(text)
      : text;
    return { name: nameOf(candidate), vtt };
  }
  return null;
}

/**
 * A caption track for a video from the file beside it with its name, as a
 * `data:` URL: the window's policy lets media load from `data:` and not from
 * `blob:`, and the video needs no `crossorigin` for it. Nothing while it is
 * looked for or where there is none. Looked for again each time the video
 * opens, so a caption file written since is found.
 */
export function useSiblingCaptions(hostPath: string) {
  const { data } = useQuery({
    queryFn: ({ signal }) => readSiblingCaptions(hostPath, signal),
    queryKey: ["sibling-captions", hostPath],
    retry: false,
  });
  if (!data) {
    return undefined;
  }
  return {
    label: data.name,
    url: `data:text/vtt;charset=utf-8,${encodeURIComponent(data.vtt)}`,
  };
}
