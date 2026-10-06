# App metadata

The strings the operating system shows about Instrument outside its own window: installer screens, Get Info, file properties, package managers, permission prompts. electron-builder bakes them in at package time from a handful of fields, most of them fanning out to several surfaces, so a change to one field moves strings on every platform. This is the map from field to surface.

## Sources

| Field | Where it is set | Value |
| --- | --- | --- |
| `productName` | `APP_PRODUCT_NAME` in `packages/shared/src/constants.ts`, through `productName` and `extraMetadata.productName` in `apps/studio/electron-builder.ts` | `Instrument`, or `Instrument <preview>` for a preview build |
| `description` | `apps/studio/package.json` | `Private AI workspace on your computer`. Follows the subhead on the website's home page |
| `author.name` | `apps/studio/package.json` | `Finalpoint, LLC`, the legal entity: the same name the Windows code-signing certificate and the website's terms carry |
| `author.email` | `apps/studio/package.json` | `oss@tryinstrument.com` |
| `copyright` | not set; electron-builder writes `Copyright © <build year> <author.name>` | `Copyright © <year> Finalpoint, LLC` |
| `mac.category` | `apps/studio/electron-builder.ts` | `public.app-category.productivity` |
| `linux.category` | `apps/studio/electron-builder.ts` | `Office`, the freedesktop main category closest to the Mac one |
| `mac.extendInfo.NS*UsageDescription` | `apps/studio/electron-builder.ts` | One sentence per permission, each naming what the agent does with it and when |
| `nsis.shortcutName`, `nsis.uninstallDisplayName` | `apps/studio/electron-builder.ts` | `${productName}` |

## Surfaces

**macOS.** The bundle name and the menu bar take `productName`. Finder's Get Info shows `NSHumanReadableCopyright` (the copyright line) and the category is what Finder groups it under when a folder is grouped by Application Category. Each permission prompt shows its `NS*UsageDescription` under the system's own question, the first time a task reaches that resource. The DMG mounts as `productName version`.

**Windows.** The `.exe`'s Properties > Details tab shows File description and Product name (both `productName`), Company (`author.name`), and Copyright. The Add/Remove Programs entry takes its name from `uninstallDisplayName` and its Publisher from `author.name`. The installer's UAC prompt and SmartScreen show the signing certificate's subject, which `win.signtoolOptions.publisherName` must list verbatim; keeping `author.name` the same entity keeps Publisher and the verified signer from disagreeing.

**Linux.** The `.desktop` entry takes `Name` from `productName`, `Comment` from `description`, and `Categories` from `linux.category`. The `.deb` and `.rpm` take their summary from `description` and their Maintainer and Vendor from `author`, rendered `Finalpoint, LLC <oss@tryinstrument.com>`; a `linux.maintainer` would replace both, which is why none is set. Software centers show the summary as the one-liner under the name.

## Changing one

`description` is the field most likely to move with positioning, and it lands on Linux only, so a change there has no Mac or Windows surface to check. A change to `author.name` moves Company, Publisher, copyright, Maintainer, and Vendor together. `productName` also names the userData folder and the keychain's Safe Storage item, so it is not a copy change: renaming it orphans every existing install's data.
