import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// What Windows says about one file's Authenticode signature: PowerShell's
// `Get-AuthenticodeSignature`, which checks the chain to a trusted root and the
// timestamp as Windows itself would before running the file.
export type SignatureReport = {
  // Relative to the folder or package the file came from.
  file: string;
  // `Valid`, `NotSigned`, `HashMismatch`, `NotTrusted`, `UnknownError`, ...
  status: string;
  // The signer certificate's subject, as a distinguished name.
  subject: null | string;
};

export type SignatureVerdict =
  | { ok: true; checked: number }
  | { ok: false; problems: string[] };

const PE_EXTENSIONS = [".dll", ".exe", ".node"];

export function isExecutableFile(file: string) {
  return PE_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

/**
 * The attributes of a distinguished name, keys upper-cased. Values may be
 * quoted (`CN="Finalpoint, LLC"`), which is how a comma inside one is written.
 */
export function parseDistinguishedName(dn: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let index = 0;
  while (index < dn.length) {
    const equals = dn.indexOf("=", index);
    if (equals === -1) {
      break;
    }
    const key = dn.slice(index, equals).trim().toUpperCase();
    let value = "";
    let cursor = equals + 1;
    while (cursor < dn.length && dn[cursor] === " ") {
      cursor += 1;
    }
    if (dn[cursor] === '"') {
      cursor += 1;
      while (cursor < dn.length) {
        if (dn[cursor] === '"' && dn[cursor + 1] === '"') {
          value += '"';
          cursor += 2;
        } else if (dn[cursor] === '"') {
          cursor += 1;
          break;
        } else {
          value += dn.charAt(cursor);
          cursor += 1;
        }
      }
      const comma = dn.indexOf(",", cursor);
      index = comma === -1 ? dn.length : comma + 1;
    } else {
      const comma = dn.indexOf(",", cursor);
      value = dn.slice(cursor, comma === -1 ? dn.length : comma).trim();
      index = comma === -1 ? dn.length : comma + 1;
    }
    if (!attributes.has(key)) {
      attributes.set(key, value);
    }
  }
  return attributes;
}

function sameName(a: string, b: string) {
  const fold = (value: string) =>
    value.normalize("NFKC").replaceAll(/\s+/g, " ").trim().toLowerCase();
  return fold(a) === fold(b);
}

/**
 * Whether a signer's subject is Instrument's publisher. The certificate has
 * been issued as both "Finalpoint, LLC" and "FINALPOINT, LLC", so names are
 * compared with case folded. The common name has to be one of them, and so
 * does the organization wherever the certificate names one, which an
 * organization-validated certificate always does: a common name alone is
 * what any certificate can claim.
 */
export function isPublisherSubject(
  subject: null | string,
  publisherNames: readonly string[],
): boolean {
  if (!subject) {
    return false;
  }
  const attributes = parseDistinguishedName(subject);
  const commonName = attributes.get("CN");
  const organization = attributes.get("O");
  const isPublisher = (value: string) =>
    publisherNames.some((name) => sameName(name, value));
  return (
    commonName !== undefined &&
    isPublisher(commonName) &&
    (organization === undefined || isPublisher(organization))
  );
}

/**
 * Whether a signer is one of the third parties whose files Instrument ships
 * under their own signature, by the organization the certificate names.
 */
function isTrustedThirdParty(
  subject: null | string,
  organizations: readonly string[],
): boolean {
  const organization = subject
    ? parseDistinguishedName(subject).get("O")
    : undefined;
  return (
    organization !== undefined &&
    organizations.some((name) => sameName(name, organization))
  );
}

/**
 * Whether an update's executables are all ones Instrument ships: every one
 * validly signed, by the publisher or by one of `thirdParties` (Microsoft's
 * own libraries arrive signed by Microsoft, and keep that signature), with
 * the files the app cannot run without (`required`) signed by the publisher
 * itself. An update with no executables at all, or missing a required one,
 * is refused rather than waved through.
 */
export function judgeSignatures({
  publisherNames,
  reports,
  required,
  thirdParties = [],
}: {
  publisherNames: readonly string[];
  reports: readonly SignatureReport[];
  required: readonly string[];
  thirdParties?: readonly string[];
}): SignatureVerdict {
  const problems: string[] = [];
  const byFile = new Map(
    reports.map((report) => [report.file.toLowerCase(), report]),
  );
  for (const file of required) {
    const report = byFile.get(file.toLowerCase());
    if (!report) {
      problems.push(`${file} is missing`);
    } else if (
      report.status === "Valid" &&
      !isPublisherSubject(report.subject, publisherNames)
    ) {
      problems.push(
        `${report.file} is signed by someone else (${report.subject ?? "no subject"})`,
      );
    }
  }
  if (reports.length === 0) {
    problems.push("it has no executables to check");
  }
  for (const report of reports) {
    if (report.status !== "Valid") {
      problems.push(`${report.file} is ${describeStatus(report.status)}`);
    } else if (
      !isPublisherSubject(report.subject, publisherNames) &&
      !isTrustedThirdParty(report.subject, thirdParties) &&
      !required.some((file) => file.toLowerCase() === report.file.toLowerCase())
    ) {
      problems.push(
        `${report.file} is signed by someone else (${report.subject ?? "no subject"})`,
      );
    }
  }
  return problems.length === 0
    ? { checked: reports.length, ok: true }
    : { ok: false, problems };
}

/**
 * The rule for a Velopack package of the app, which the app applies before
 * installing one and the release applies before publishing one: the app and
 * Velopack's updater (`Squirrel.exe` in the package) signed by the
 * publisher, and everything else by the publisher or by Microsoft, whose own
 * libraries (Chromium's DirectX compilers, the .NET assemblies of Git's
 * credential manager, MXC's launcher) keep their signature.
 */
export function judgeUpdatePackage({
  mainExe,
  publisherNames,
  reports,
}: {
  mainExe: string;
  publisherNames: readonly string[];
  reports: readonly SignatureReport[];
}): SignatureVerdict {
  return judgeSignatures({
    publisherNames,
    reports,
    required: [mainExe, "Squirrel.exe"],
    thirdParties: ["Microsoft Corporation"],
  });
}

function describeStatus(status: string) {
  switch (status) {
    case "NotSigned":
      return "not signed";
    case "HashMismatch":
      return "changed since it was signed";
    case "NotTrusted":
      return "signed by a certificate Windows doesn't trust";
    default:
      return `not validly signed (${status})`;
  }
}

/**
 * Reads the signature of every executable under `folder`, in one PowerShell
 * process. Windows only.
 */
export async function readSignatures(
  folder: string,
): Promise<SignatureReport[]> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$root = (Resolve-Path -LiteralPath $env:INSTRUMENT_SIGNATURE_ROOT).Path",
    "$files = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.exe','.dll','.node' }",
    "$out = foreach ($f in $files) {",
    "  $s = Get-AuthenticodeSignature -LiteralPath $f.FullName",
    "  [pscustomobject]@{ file = $f.FullName.Substring($root.Length + 1); status = [string]$s.Status; subject = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }) }",
    "}",
    "ConvertTo-Json -InputObject @($out) -Compress -Depth 3",
  ].join("\n");
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    {
      env: { ...process.env, INSTRUMENT_SIGNATURE_ROOT: folder },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 5 * 60_000,
      windowsHide: true,
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the script's own JSON, shaped above
  const parsed = JSON.parse(stdout.trim() || "[]") as SignatureReport[];
  return parsed.map((report) => ({
    file: report.file.replaceAll("\\", "/"),
    status: report.status,
    subject: report.subject ?? null,
  }));
}

/**
 * Unpacks the executables of a Velopack package (a zip, its app under
 * `lib/app/`) into a folder of their own, for `readSignatures`. Windows'
 * own `tar` reads zips.
 */
export async function unpackPackageExecutables(
  packageFile: string,
): Promise<{ dispose: () => void; folder: string }> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "instrument-update-"));
  const dispose = () => {
    fs.rmSync(work, { force: true, recursive: true });
  };
  try {
    await promisify(execFile)(
      "tar",
      [
        "-xf",
        packageFile,
        "-C",
        work,
        ...PE_EXTENSIONS.flatMap((extension) => ["--include", `*${extension}`]),
      ],
      { timeout: 5 * 60_000, windowsHide: true },
    );
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose, folder: path.join(work, "lib", "app") };
}
