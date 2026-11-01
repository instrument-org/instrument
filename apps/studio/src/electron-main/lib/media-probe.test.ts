// A file opened as video is read before a player is chosen for it: a picture
// means the video player, and album art in a song is not a picture.
import { describe, expect, it } from "vitest";

import { probeOf } from "./media-probe";

const streams = (...list: [string, number][]) =>
  JSON.stringify({
    programs: [],
    stream_groups: [],
    streams: list.map(([codec_type, attached_pic]) => ({
      codec_type,
      disposition: { attached_pic },
    })),
  });

describe("probeOf", () => {
  it.each([
    ["a video with sound", streams(["video", 0], ["audio", 0]), true],
    ["a voice recording in WebM", streams(["audio", 0]), false],
    ["a song with album art", streams(["audio", 0], ["video", 1]), false],
    ["a silent video", streams(["video", 0]), true],
  ])("reads %s", (_name, stdout, picture) => {
    expect(probeOf(stdout)).toEqual({ picture });
  });

  it.each([
    ["not JSON", "Invalid data found"],
    ["no streams", "{}"],
  ])("gives nothing for %s", (_name, stdout) => {
    expect(probeOf(stdout)).toBeNull();
  });
});
