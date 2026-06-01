import { execFileSync } from "node:child_process";

const SIGNTOOL = process.env.SIGNTOOL_PATH || "signtool.exe";
const SKIPPED_SIGNING_PATH_SUFFIXES = [
  ["node_modules", "@vscode", "ripgrep", "bin", "rg.exe"],
];

const TIMESTAMP =
  process.env.WIN_TIMESTAMP_URL ||
  "http://timestamp.globalsign.com/tsa/r6advanced1";
// Full key **version** resource ID:
// projects/…/locations/…/keyRings/…/cryptoKeys/…/cryptoKeyVersions/1
const KCV = process.env.WIN_GCP_KMS_KEY_VERSION;
// Path to your EV cert chain (PEM or DER)
const CERTFILE = process.env.WIN_CERT_PATH;

/**
 * @param {string} file
 */
export function shouldSkipSigning(file) {
  return SKIPPED_SIGNING_PATH_SUFFIXES.some((suffix) =>
    hasPathSuffix(file, suffix),
  );
}

/**
 * @param {string} file
 * @param {string[]} suffix
 */
function hasPathSuffix(file, suffix) {
  const parts = pathParts(file);
  if (parts.length < suffix.length) {
    return false;
  }

  for (let index = 0; index < suffix.length; index++) {
    const partIndex = parts.length - suffix.length + index;
    if (parts[partIndex] !== suffix[index]) {
      return false;
    }
  }

  return true;
}

/**
 * @param {string} file
 */
function pathParts(file) {
  return file
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

// eslint-disable-next-line unicorn/no-anonymous-default-export, @typescript-eslint/require-await
export default async function (cfg) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!cfg?.path) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const file = String(cfg.path);

  if (shouldSkipSigning(file)) {
    console.log(`Skipping vendor-signed binary: ${file}`);
    return;
  }

  const args = [
    "sign",
    "/fd",
    "sha256",
    "/tr",
    TIMESTAMP,
    "/td",
    "sha256",
    "/f",
    CERTFILE,
    "/csp",
    "Google Cloud KMS Provider",
    "/kc",
    KCV,
    file,
  ];

  execFileSync(SIGNTOOL, args, { stdio: "inherit" });
}
