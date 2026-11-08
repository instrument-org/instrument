# Model text

The words the chat's agent reads: the system prompt, the context message, the notes stored parts render, one-request notes, command descriptions and guides. Each subfolder is named for when the model reads what is in it, and each module's doc comment says what its text is for. The code that decides when a piece is said stays with its feature and imports the words from here.

A provider caches the request prefix, so changing one byte here misses that cache for every chat on its next turn. `model-text-bytes.test.ts` pins all of it in one snapshot: update that snapshot only on purpose, in a commit that says what the model now reads differently. `model-text-home.test.ts` fails when a `*-model-text.ts` module lands outside this folder.

Tool definitions are not here: each tool's description stays beside its input schema in `src/tools/`, pinned by `tool-definitions.test.ts`. Text a command prints or refuses with stays where it fails or finishes.
