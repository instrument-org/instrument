// Runs every shell a test starts in the bash worker. vitest.config.ts loads
// this only when INSTRUMENT_BASH_WORKER=1. Loading the worker client in every
// run would load modules a test file mocks (`ulid` among them) before its mock
// is in place.
import { setBashWorkerFactory } from "../lib/bash-worker/client";
import { createTsxBashWorker } from "./helpers/tsx-bash-worker";

setBashWorkerFactory(createTsxBashWorker);
