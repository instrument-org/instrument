# Vendored oxlint plugins

## anti-slop

An unmodified copy of the plugin source from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), which is distributed to be vendored rather than installed. Re-sync it by replacing the whole `anti-slop/` directory:

```sh
npx skills add dmmulroy/anti-slop --skill install-anti-slop
```

Keep it unmodified so that stays a copy rather than a merge. Local edits belong in a plugin of our own.

It ships fifteen rules; `.oxlintrc.json` enables five, and `docs/decisions/2026-08-15-anti-slop-rule-selection.md` records which and why. The rest are registered and off, so enabling one is a config edit.

`@oxlint/plugins` must match the `oxlint` version in the root `package.json`, which is not necessarily the version upstream anti-slop pins. Bump the two together.
