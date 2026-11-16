// Written by `pnpm --filter @instrument-org/workspace script:refresh-office-manifest <version>`.
// Sizes and hashes are TDF's own, read from its archive.

export const OFFICE_MANIFEST = {
  "artifacts": {
    "darwin-arm64": {
      "bytes": 297813809,
      "file": "LibreOffice_26.2.7.3_MacOS_aarch64.dmg",
      "folder": "mac/aarch64",
      "sha256": "58601808ae2b919c82dc7c4d6a26389de0e167f344ca48e5b6c9189218eb95ae"
    },
    "darwin-x64": {
      "bytes": 308070986,
      "file": "LibreOffice_26.2.7.3_MacOS_x86-64.dmg",
      "folder": "mac/x86_64",
      "sha256": "26a830205c617cc624b2a83783ef46434a4d6c337c3a873f79c43012171f83de"
    },
    "linux-arm64": {
      "bytes": 207217464,
      "file": "LibreOffice_26.2.7.3_Linux_aarch64_deb.tar.gz",
      "folder": "deb/aarch64",
      "sha256": "d871da75fe387f9dab5acb7569d46d1098835c25b53695c89152f5194ad34411"
    },
    "linux-x64": {
      "bytes": 218569368,
      "file": "LibreOffice_26.2.7.3_Linux_x86-64_deb.tar.gz",
      "folder": "deb/x86_64",
      "sha256": "8cd04a88396a9230264ff784ec89cc090cbfd0960c192483ba2b80fa53939416"
    },
    "win32-arm64": {
      "bytes": 359571456,
      "file": "LibreOffice_26.2.7.3_Win_aarch64.msi",
      "folder": "win/aarch64",
      "sha256": "2dde2f3564a0df375070395b7bf3a93c65b144100f2892eb112082ac1476cab2"
    },
    "win32-x64": {
      "bytes": 373121024,
      "file": "LibreOffice_26.2.7.3_Win_x86-64.msi",
      "folder": "win/x86_64",
      "sha256": "480fecf759fc6393bd614fbf43753eb95a8198fc1a065d41b727e3b664cd1e59"
    }
  },
  "version": "26.2.7.3"
} as const;
