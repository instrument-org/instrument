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
  it("reads a video's shape and length, turned the way it is shown", () => {
    const stdout = JSON.stringify({
      format: { duration: "161.2" },
      streams: [
        {
          codec_type: "video",
          disposition: { attached_pic: 0 },
          height: 1080,
          side_data_list: [{ rotation: -90 }],
          width: 1920,
        },
      ],
    });
    expect(probeOf(stdout)).toEqual({
      durationSeconds: 161.2,
      height: 1920,
      picture: true,
      width: 1080,
    });
  });

  it("takes no shape from a song's album art", () => {
    const stdout = JSON.stringify({
      format: { duration: "200" },
      streams: [
        { codec_type: "audio", disposition: { attached_pic: 0 } },
        {
          codec_type: "video",
          disposition: { attached_pic: 1 },
          height: 600,
          width: 600,
        },
      ],
    });
    expect(probeOf(stdout)).toEqual({ durationSeconds: 200, picture: false });
  });

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
