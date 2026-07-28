import { rgPath } from "@vscode/ripgrep";

import { unpackAsarPath } from "./asar";

export const RG_DISK_PATH = unpackAsarPath(rgPath);
