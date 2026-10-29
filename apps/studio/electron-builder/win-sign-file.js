// Signs files through the cloud HSM, for tools that sign by running a
// command (vpk's --signTemplate, which passes a batch of quoted paths in place
// of its {{file}}) rather than by calling electron-builder's hook.
//   node electron-builder/win-sign-file.js <file>...
import sign from "./win-cloud-hsm-sign.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  throw new Error("Usage: win-sign-file.js <file>...");
}
for (const file of files) {
  sign({ path: file });
}
