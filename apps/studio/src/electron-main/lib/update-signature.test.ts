import { describe, expect, it } from "vitest";

import {
  isExecutableFile,
  isPublisherSubject,
  judgeSignatures,
  judgeUpdatePackage,
  parseDistinguishedName,
  type SignatureReport,
} from "./update-signature";

const PUBLISHER_NAMES = ["Finalpoint, LLC", "FINALPOINT, LLC"];

// The subject as Windows formats an organization-validated code signing
// certificate's, in each casing it has been issued under.
const ISSUED = `CN="Finalpoint, LLC", O="Finalpoint, LLC", L=Austin, S=Texas, C=US`;
const REISSUED = `CN="FINALPOINT, LLC", O="FINALPOINT, LLC", L=Austin, S=Texas, C=US`;

const signed = (file: string, subject = ISSUED): SignatureReport => ({
  file,
  status: "Valid",
  subject,
});

describe("parseDistinguishedName", () => {
  it("reads quoted values with commas in them", () => {
    expect(Object.fromEntries(parseDistinguishedName(ISSUED)))
      .toMatchInlineSnapshot(`
        {
          "C": "US",
          "CN": "Finalpoint, LLC",
          "L": "Austin",
          "O": "Finalpoint, LLC",
          "S": "Texas",
        }
      `);
  });

  it("reads doubled quotes inside a quoted value", () => {
    expect(parseDistinguishedName(`CN="A ""B"" C", O=D`).get("CN")).toBe(
      `A "B" C`,
    );
  });
});

describe("isPublisherSubject", () => {
  it.each([
    ["issued casing", ISSUED, true],
    ["reissued casing", REISSUED, true],
    [
      "mixed casing and spacing",
      `CN="finalPoint,  llc", O="Finalpoint, LLC"`,
      true,
    ],
    ["no organization named", `CN="Finalpoint, LLC"`, true],
    ["another publisher", `CN="Example, Inc.", O="Example, Inc."`, false],
    [
      "our name as common name under another organization",
      `CN="Finalpoint, LLC", O="Example, Inc."`,
      false,
    ],
    ["our name only as organization", `CN=Someone, O="Finalpoint, LLC"`, false],
    ["a lookalike", `CN="Finalpoint LLC", O="Finalpoint LLC"`, false],
    ["no subject", null, false],
  ])("%s", (_name, subject, expected) => {
    expect(isPublisherSubject(subject, PUBLISHER_NAMES)).toBe(expected);
  });
});

describe("judgeSignatures", () => {
  const required = ["Instrument.exe", "Squirrel.exe"];

  it("accepts an update whose executables are all ours, in either casing", () => {
    expect(
      judgeSignatures({
        publisherNames: PUBLISHER_NAMES,
        reports: [
          signed("Instrument.exe"),
          signed("Squirrel.exe", REISSUED),
          signed("resources/app.asar.unpacked/node_modules/x/x.node"),
        ],
        required,
      }),
    ).toEqual({ checked: 3, ok: true });
  });

  it("refuses an unsigned, altered, untrusted or foreign file, naming each", () => {
    const verdict = judgeSignatures({
      publisherNames: PUBLISHER_NAMES,
      reports: [
        signed("Instrument.exe"),
        signed("Squirrel.exe"),
        { file: "a.dll", status: "NotSigned", subject: null },
        { file: "b.dll", status: "HashMismatch", subject: ISSUED },
        { file: "c.dll", status: "NotTrusted", subject: ISSUED },
        signed("d.exe", `CN="Example, Inc.", O="Example, Inc."`),
      ],
      required,
    });
    expect(verdict).toMatchInlineSnapshot(`
      {
        "ok": false,
        "problems": [
          "a.dll is not signed",
          "b.dll is changed since it was signed",
          "c.dll is signed by a certificate Windows doesn't trust",
          "d.exe is signed by someone else (CN="Example, Inc.", O="Example, Inc.")",
        ],
      }
    `);
  });

  it("refuses an update missing the app or its updater", () => {
    expect(
      judgeSignatures({
        publisherNames: PUBLISHER_NAMES,
        reports: [signed("Squirrel.exe")],
        required,
      }),
    ).toEqual({ ok: false, problems: ["Instrument.exe is missing"] });
  });

  describe("third parties", () => {
    const MICROSOFT = `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`;
    const judge = (reports: SignatureReport[]) =>
      judgeSignatures({
        publisherNames: PUBLISHER_NAMES,
        reports,
        required,
        thirdParties: ["Microsoft Corporation"],
      });

    it("accepts a library signed by a trusted third party", () => {
      expect(
        judge([
          signed("Instrument.exe"),
          signed("Squirrel.exe"),
          signed("d3dcompiler_47.dll", MICROSOFT),
        ]).ok,
      ).toBe(true);
    });

    it("still wants the app itself signed by the publisher", () => {
      expect(
        judge([signed("Instrument.exe", MICROSOFT), signed("Squirrel.exe")]),
      ).toEqual({
        ok: false,
        problems: [`Instrument.exe is signed by someone else (${MICROSOFT})`],
      });
    });

    it("refuses a lookalike of a trusted third party", () => {
      expect(
        judge([
          signed("Instrument.exe"),
          signed("Squirrel.exe"),
          signed("x.dll", "CN=Microsoft Corporation, O=Microsoft Corp"),
        ]).ok,
      ).toBe(false);
    });

    it("refuses a third party's file whose signature is not valid", () => {
      expect(
        judge([
          signed("Instrument.exe"),
          signed("Squirrel.exe"),
          { file: "y.dll", status: "HashMismatch", subject: MICROSOFT },
        ]).ok,
      ).toBe(false);
    });
  });

  it("refuses an update with nothing to check", () => {
    expect(
      judgeSignatures({
        publisherNames: PUBLISHER_NAMES,
        reports: [],
        required: [],
      }),
    ).toEqual({ ok: false, problems: ["it has no executables to check"] });
  });

  it("matches required files whatever their casing", () => {
    expect(
      judgeSignatures({
        publisherNames: PUBLISHER_NAMES,
        reports: [signed("instrument.EXE"), signed("squirrel.exe")],
        required,
      }).ok,
    ).toBe(true);
  });
});

describe("isExecutableFile", () => {
  it.each([
    ["a.exe", true],
    ["b.DLL", true],
    ["c.node", true],
    ["d.asar", false],
    ["e.js", false],
  ])("%s", (file, expected) => {
    expect(isExecutableFile(file)).toBe(expected);
  });
});

describe("judgeUpdatePackage", () => {
  const MICROSOFT = `CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`;
  const reports = [
    signed("Instrument.exe"),
    signed("Squirrel.exe", REISSUED),
    signed("dxil.dll", MICROSOFT),
  ];

  it("takes Microsoft's libraries as they ship", () => {
    expect(
      judgeUpdatePackage({
        mainExe: "Instrument.exe",
        publisherNames: PUBLISHER_NAMES,
        reports,
      }).ok,
    ).toBe(true);
  });

  it("wants Velopack's updater from the publisher", () => {
    expect(
      judgeUpdatePackage({
        mainExe: "Instrument.exe",
        publisherNames: PUBLISHER_NAMES,
        reports: reports.slice(0, 1),
      }),
    ).toEqual({ ok: false, problems: ["Squirrel.exe is missing"] });
  });
});
