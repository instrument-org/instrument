# Plan: rename topics to projects

Status: done. Landed in one change. The code and the app say project wherever they said topic; what real workspaces, older logs and earlier builds hold under the old word is migrated at launch or read under both names, as listed below.

## Why

What a chat is filed under had become a long-running place of its own: the agent keeps reference files in its folder and works from its instructions, which is what the industry calls a project. "Topic" read as a light tag, and only fit while a chat could carry several. 1.x already called them projects.

## What changed

- One pass over code, schemas, routes, components, atoms, tests, docs and the wireframe kit: `topic` became `project` throughout. "Topic" stays only where it means something else: web search's "any topic", a pubsub topic, an eval corpus's own words.
- A project is a folder in `Projects/<Name>/`, and every folder there is one, the system's clutter aside. Its file is `AGENTS.md`, the name coding agents give a folder's instructions, so another agent opened in the folder reads the same instructions. Front matter is optional: a copied-in `AGENTS.md` with none is a project whose whole text is its instructions, and a folder with no file is a project with none.
- A project whose file names no `id` goes by one drawn from its folder's name (`folderProjectId`), the same on every computer, and nothing is written while it is only listed. Filing a chat under it writes the id into the file first (`saveProjectId`), so renaming the folder afterwards keeps the chat in it. Any other write to the project (a mark, a color, its instructions, a grant) writes the id with it.
- New project ids take the `prj_` prefix, a 1.x project's id shape: the 1.x migration keeps a 1.x project's own id as the project's. Existing `top_` ids stay valid.
- A project changes, for the notes under a reply, only when its `AGENTS.md` does or its folder comes or goes: a file saved into its folder is no change to the project.
- The agent is told a project's folder is where its lasting files are kept, and a finished file the user gave no place for goes there rather than in the chat's own folder (`project-model-text.ts`, and the finished-file rule in the system prompt). Checked by reading it, with no eval run.

## 1.x and the case-insensitive collision

1.x kept its projects, and before that its tasks, in a lowercase `projects/` at the workspace's top level. On macOS and Windows `Projects/` is the same folder, so the 1.x migration would have written the projects it makes into the folder it was emptying, and the set-aside step would then have moved them out. A layout sweep that is going to run now first moves a folder named exactly `projects` into `.instrument/1x-projects/` (`legacyProjectsDir`), and every 1.x step reads from there. 1.x workspaces go straight to `Projects/<Name>/AGENTS.md`; nothing passes through topics.

## What is migrated, and what is read under both names

- **`Topics/` and `TOPIC.md`** (`moveTopicsToProjects`, every launch, every workspace, before the layout sweep so the 1.x migration finds a 1.x project's earlier project): `Topics/` is renamed `Projects/`, or moved in a folder at a time beside a `Projects/` already there, and each `TOPIC.md` becomes `AGENTS.md`. A name already taken in `Projects/`, or a folder holding both files, is left and logged.
- **`.instrument/topics/`**, where builds before that hid them: still moved out by `moveProjectsToFolder`, now to `Projects/`.
- **Settings lines**: a `set` line whose field is `topic` reads as `project` (`parseSettingLine`). New lines say `project`.
- **`permissions.json`**: `topics` reads as `projects`, and the next write leaves the old key behind.
- **`DRAFT.md`**: `topic:` reads as `project:`, and a rewrite writes `project:`.
- **Stored message parts** (`message-part.ts`): `data-topic` reads as `data-project`, `data-topics` as the `data-project` for its first, and a `data-setupChanges` change of kind `topic` as `project`. The retired `data-chatContext` part keeps its stored `topics` key.
- **A 1.x `chat.db` row**: `topic` and `topics` read as the row's project.
- **The activity log**: purposes `topic-suggestion` and `topic-backfill` and surface `topics` read under their new names.
- **A project's front matter** written by a topics build for a 1.x project keeps `projectId` as a key this build does not own, which the 1.x migration still finds a project by.
- **Derived files**: `workspace.db` is rebuilt (index version bumped); `chat-list.json` and `CHAT.md` are rewritten with `project` on their next write.
- **Not kept**: the `chats.setTopic` route, `instrument://new?topic=` (now `?project=`), and the RPC and event names. Nothing outside the app calls them.

## Left for later

- The phone app reads `topic` from `chat-list.json`, and needs the new key.
- Whether a chat filed under a project should work in the project's folder rather than its own work folder: the working-folder question, left out of the rename.
