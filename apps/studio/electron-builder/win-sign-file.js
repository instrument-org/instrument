// Signs one file through the cloud HSM, for tools that sign by running a
// command per file (vpk's --signTemplate) rather than by calling electron-builder's hook.
//   node electron-builder/win-sign-file.js <file>
import sign from "./win-cloud-hsm-sign.js";

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: win-sign-file.js <file>");
}
sign({ path: file });
