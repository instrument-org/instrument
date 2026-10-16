import { describe, expect, it } from "vitest";

import { isZoneName, unsandboxedEnv } from "./unsandboxed-uutils-env";

const options = {
  platform: "darwin" as const,
  systemRoot: () => "C:\\Windows",
  tempDir: () => "/app/tmp",
};

describe("unsandboxedEnv", () => {
  it("keeps only the fixed set, whatever the agent exported", () => {
    expect(
      unsandboxedEnv(
        {
          DYLD_INSERT_LIBRARIES: "/Users/sam/evil.dylib",
          GREP_COLORS: "mt=01;31",
          HOME: "/Users/sam",
          LANG: "en_US.UTF-8",
          LC_ALL: "C",
          LC_COLLATE: "../../etc",
          LD_PRELOAD: "/tmp/x.so",
          PATH: "/usr/bin",
          POSIXLY_CORRECT: "1",
          QUOTING_STYLE: "literal",
          RUST_BACKTRACE: "1",
          TMPDIR: "/Users/sam/closed",
          TZ: "America/Chicago",
          TZDIR: "/Users/sam/zones",
          UUTILS_PATH_SEPARATOR: "slash",
          _POSIX2_VERSION: "199209",
        },
        options,
      ),
    ).toMatchInlineSnapshot(`
      {
        "LANG": "en_US.UTF-8",
        "LC_ALL": "C",
        "NO_COLOR": "1",
        "TEMP": "/app/tmp",
        "TERM": "dumb",
        "TMP": "/app/tmp",
        "TMPDIR": "/app/tmp",
        "TZ": "America/Chicago",
      }
    `);
  });

  it.each([
    "/etc/passwd",
    ":/etc/passwd",
    "../../etc/passwd",
    "America/../../etc/passwd",
    "Not/AZone",
    "",
  ])("leaves out TZ=%s", (zone) => {
    expect(unsandboxedEnv({ TZ: zone }, options).TZ).toBeUndefined();
  });

  it.each([
    "UTC",
    "Europe/Paris",
    "America/Argentina/Buenos_Aires",
    "Etc/GMT+5",
  ])("passes the zone %s", (zone) => {
    expect(isZoneName(zone)).toBe(true);
  });

  it.each(["en_US.UTF-8", "C", "C.UTF-8", "POSIX", "de_DE", "sr_RS@latin"])(
    "passes the locale %s",
    (locale) => {
      expect(unsandboxedEnv({ LANG: locale }, options).LANG).toBe(locale);
    },
  );

  it.each(["/usr/share/locale", "en_US.UTF-8/../x", "C;rm", "en US"])(
    "leaves out the locale %s",
    (locale) => {
      expect(unsandboxedEnv({ LANG: locale }, options).LANG).toBeUndefined();
    },
  );

  it("reads names without case, as Windows does, and adds the app's SystemRoot", () => {
    expect(
      unsandboxedEnv(
        { Lang: "en_US.UTF-8", SystemRoot: "C:\\evil", tz: "UTC" },
        { ...options, platform: "win32" },
      ),
    ).toMatchObject({
      LANG: "en_US.UTF-8",
      SystemRoot: "C:\\Windows",
      TZ: "UTC",
    });
  });
});
