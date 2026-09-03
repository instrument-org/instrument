// Marks an eval run as a test run, the way a `NODE_ENV=test` prefix on the
// package.json script used to. See `dev-node-env.ts` for why this is a module
// imported first rather than a shell prefix: `cross-env` strips quotes from the
// arguments it forwards, and a prompt is the argument most likely to carry them.
process.env.NODE_ENV = "test";
