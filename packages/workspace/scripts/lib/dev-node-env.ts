// Marks a script run as development, the way a `NODE_ENV=development` prefix on
// the package.json script used to.
//
// It moved here because `cross-env` re-quotes the arguments it forwards, and
// strips single quotes doing it: `run-bash -- "echo 'a(b)'"` reached the sandbox
// as `echo a(b)` and came back as a parse error for a command the sandbox
// accepts. A harness that misreports the thing it exists to test is worse than
// no harness, and every other way of setting this from the shell has the same
// argument-forwarding problem.
//
// Import it before anything else. Modules read this at evaluation time rather
// than at call time -- `APP_PROTOCOL` in `@instrument-org/shared` is the one to
// know about -- so a later assignment is read too late. Ahead of
// `dotenv/config` too, which does not overwrite what is already set.
//
// Assigned rather than defaulted, matching what the prefix did: these scripts
// are development entry points and nothing invokes them with NODE_ENV set.
process.env.NODE_ENV = "development";
