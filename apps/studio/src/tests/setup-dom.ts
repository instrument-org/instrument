import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Loaded only by the `dom` project (see `vitest.config.ts`), on top of the
// shared node setup.

// Unmounts anything still rendered, so one test's tree cannot be found by the
// next one's queries.
afterEach(cleanup);
