<h1 align="center">Instrument</h1>

## Dependencies

### `pnpm-workspace.yaml`

- `@types/node` locked in `package.json` to avoid constant `pnpm dedupe --check` failures.
- `better-sqlite3` is ignored in `pnpm-workspace.yaml` to avoid the native dependency installation because we are using Node's native SQLite support.
- `@mongodb-js/zstd` and `node-liblzma` are ignored because they are included by `just-bash` but not working.
