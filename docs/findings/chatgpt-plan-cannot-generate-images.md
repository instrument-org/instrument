# A ChatGPT plan cannot generate images, so a plan-only user has no image tool

**Status:** known, by design upstream. Checked 2026-10-04 against OpenAI's [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) for Sign in with ChatGPT.

## What OpenAI allows

The plan token works only on `POST /v1/responses`, with `store: false` and `stream: true`. The preview limitations list what it refuses: "Image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, and Responses `tool_search`". There is no `/v1/images` either. Hosted `web_search` is accepted, which is why the plan is a search provider and not an image one.

## What we do

The `chatgpt` entry in [`metadata.ts`](../../packages/ai-gateway/src/lib/providers/metadata.ts) carries only the `webSearch` tag, so `filterImageGenerationConfigs` never offers it. Image generation from a chat on the plan goes to another configured provider by `PROVIDER_TYPE_PRIORITY` in [`get-ai-sdk-image-model.ts`](../../packages/ai-gateway/src/lib/get-ai-sdk-image-model.ts). With only a ChatGPT plan signed in, there is none, and the tool fails with "No provider with image generation support found".

## What might change it

- OpenAI adding the `image_generation` tool to the plan route. Recheck the preview limitations page when it changes.
- Our own image provider for plan users (the platform gateway) would cover it, but under the Sign in with ChatGPT Terms §2 using the plan must never require paying us, so that can only be an addition the plan works without.
