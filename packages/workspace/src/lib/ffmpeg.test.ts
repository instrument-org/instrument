import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  FFMPEG_PATH,
  ffmpegSubprocessEnv,
  FFPROBE_PATH,
} from "./ffmpeg";

describe("ffmpegSubprocessEnv", () => {
  it("exposes the bundled binaries to subprocesses", () => {
    const env = ffmpegSubprocessEnv();

    expect(env.FFMPEG_PATH).toBe(FFMPEG_PATH);
    expect(env.FFPROBE_PATH).toBe(FFPROBE_PATH);
  });

  it("prepends the binary dirs to PATH ahead of the host PATH", () => {
    const env = ffmpegSubprocessEnv();
    const parts = env.PATH?.split(path.delimiter) ?? [];

    expect(parts.slice(0, 2)).toStrictEqual([
      path.dirname(FFMPEG_PATH),
      path.dirname(FFPROBE_PATH),
    ]);
    if (process.env.PATH) {
      expect(env.PATH?.endsWith(process.env.PATH)).toBe(true);
    }
  });
});
