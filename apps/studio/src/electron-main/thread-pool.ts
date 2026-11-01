// How many of Node's file threads the main process and the bash worker share.
// libuv reads this once, when the pool first starts, so it is set before any
// other module runs. A listing in a folder macOS guards holds its thread for
// as long as the system's prompt about that folder is up, and macOS asks
// about one folder at a time while the rest wait in line: with Node's four,
// a few such waits stall every file read in the app until the person
// answers.
//
// It stays well under 64. A read in a cloud-synced folder can need macOS's
// approval to reach the folder's provider (iCloud Drive's among them), and
// sandboxd takes each approval on a thread of its own that waits for the
// answer on another; at 64 requests in flight its threads run out, the
// answers never come, and every approval on the computer waits until
// sandboxd is restarted (docs/findings/sandboxd-deadlocks-at-64-approvals.md).
process.env.UV_THREADPOOL_SIZE ??= "16";
