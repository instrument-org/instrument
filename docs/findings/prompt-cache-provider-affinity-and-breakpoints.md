# Prompt cache provider affinity and breakpoint gaps

## Finding

Byte-stable prompts are necessary but not sufficient for reliable prompt-cache reuse. The current harness has provider-specific gaps that can lower hit rates even after the nonce and immutable-session-context work removes avoidable byte changes.

## Current behavior

- Anthropic-family requests add ephemeral cache control to the first two system messages and the final two non-system messages. No independent cache point is placed at the end of the stable tool-definition block.
- Direct OpenAI Responses requests disable storage and request encrypted reasoning content for supported reasoning models. They do not receive a stable session-level prompt cache key.
- The provider-options helper accepts only a model, so it cannot derive any session-affinity value without a signature change.
- Routing through a gateway or aggregator can send identical requests to different upstream workers or providers unless that route exposes and receives a stable affinity key.
- Usage telemetry records provider-reported cached input when available, but the harness does not explain whether a miss came from changed bytes, routing, expiry, or a provider policy.

## Consequences

- Identical request bytes may still miss a cache because successive turns do not share provider-side routing affinity.
- A dynamic contextual message can invalidate tool definitions when the provider treats system messages and tools as one ordered prefix and there is no later breakpoint protecting the tool block.
- Aggregate cache-read counts cannot distinguish an application prompt-stability regression from provider routing behavior.

## Candidate follow-up

1. Thread the stable Instrument session ID into provider-option construction without exposing task paths, user content, or other identifying metadata.
2. For direct OpenAI Responses requests, set the supported prompt-cache affinity field to a deterministic opaque value derived from the session ID. Keep default retention and do not request 24-hour caching.
3. For routed providers, pass their supported session-affinity field only when the adapter and upstream contract preserve it. Test the serialized request rather than assuming a generic provider option is forwarded.
4. For Anthropic-family requests, evaluate a cache point after the final stable tool definition in addition to the existing message cache points. Confirm the provider's cache-point count and minimum-prefix requirements for every supported route.
5. Add request-shape tests that prove affinity values stay constant within a session, differ across sessions, contain no raw local identifiers, and do not alter prompt bytes.
6. Split telemetry into byte-stability evidence available locally and provider-reported cache outcomes. Do not log prompt contents or tool results.

## Constraints

- Affinity keys cannot rescue a prefix whose bytes change. Land and measure nonce replay stability and immutable session context first.
- Provider options are not portable. Each field needs a supported adapter type, serialized-request proof, and an explicit fallback when routed through another provider.
- A new cache breakpoint can increase cache-write cost or exceed a provider's allowed breakpoint count. It needs cost and request-shape validation, not only a type check.
- Cache retention stays provider-default. This finding does not recommend 24-hour retention.

## Why this remains deferred

The known local invalidations have deterministic fixes and affect every provider. Affinity and explicit breakpoint work depends on route-specific contracts and may change cost behavior. Revisit it after byte-stability regressions are covered and cache-read telemetry can show whether misses remain material.
