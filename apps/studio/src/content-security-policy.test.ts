import { describe, expect, it } from "vitest";

import {
  rendererContentSecurityPolicy,
  serializeContentSecurityPolicy,
} from "./content-security-policy";

const policyFor = (...args: Parameters<typeof rendererContentSecurityPolicy>) =>
  serializeContentSecurityPolicy(rendererContentSecurityPolicy(...args))
    .split("; ")
    .join(";\n");

describe("rendererContentSecurityPolicy", () => {
  it("names the released app's scheme", () => {
    expect(policyFor({ kind: "release" })).toMatchInlineSnapshot(`
      "connect-src 'self' instrument: http://localhost:* https://localhost:*;
      default-src 'self' http://localhost:* https://localhost:*;
      font-src 'self' data:;
      frame-src 'self' data: instrument: mailto: tel: http://localhost:* https://localhost:*;
      img-src 'self' blob: data: instrument: https://*.googleusercontent.com https://*.gstatic.com https://*.googleapis.com https://images.google.com https://www.google.com https://github.com https://*.github.com https://*.githubusercontent.com https://*.s3.amazonaws.com;
      media-src 'self' data: instrument: http://localhost:* https://localhost:*;
      script-src 'self' 'wasm-unsafe-eval';
      style-src 'self' 'unsafe-inline';
      worker-src 'self' blob:;"
    `);
  });

  it("names a preview's own scheme", () => {
    expect(
      policyFor({ kind: "preview", name: "claude-resume-2-21" }),
    ).toMatchInlineSnapshot(`
      "connect-src 'self' instrument-preview-claude-resume-2-21: http://localhost:* https://localhost:*;
      default-src 'self' http://localhost:* https://localhost:*;
      font-src 'self' data:;
      frame-src 'self' data: instrument-preview-claude-resume-2-21: mailto: tel: http://localhost:* https://localhost:*;
      img-src 'self' blob: data: instrument-preview-claude-resume-2-21: https://*.googleusercontent.com https://*.gstatic.com https://*.googleapis.com https://images.google.com https://www.google.com https://github.com https://*.github.com https://*.githubusercontent.com https://*.s3.amazonaws.com;
      media-src 'self' data: instrument-preview-claude-resume-2-21: http://localhost:* https://localhost:*;
      script-src 'self' 'wasm-unsafe-eval';
      style-src 'self' 'unsafe-inline';
      worker-src 'self' blob:;"
    `);
  });

  it("names a development run's scheme", () => {
    expect(
      rendererContentSecurityPolicy({ kind: "development" })["connect-src"],
    ).toContain("instrument-local:");
  });
});
