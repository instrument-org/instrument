// How many of Node's file threads the main process and the bash worker share.
// libuv reads this once, when the pool first starts, so it is set before any
// other module runs. A listing in a folder macOS guards holds its thread for
// as long as the system's prompt about that folder is up, and macOS asks
// about one folder at a time while the rest wait in line: with Node's four,
// a few such waits stall every file read in the app until the person
// answers.
process.env.UV_THREADPOOL_SIZE ??= "64";
