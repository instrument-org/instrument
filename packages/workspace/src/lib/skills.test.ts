import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SKILLS_FOLDER_NAME } from "../constants";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import {
  findSkills,
  getSkillSources,
  listSkillFiles,
  parseFrontmatter,
  resolveSkillName,
} from "./skills";

const make = (frontmatter: string, body = "Body content") =>
  `---\n${frontmatter}\n---\n${body}`;

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

// Whether macOS shows its prompt while a listing waits; none unless a test says so.
const promptShows = vi.hoisted(() => ({ value: false }));

vi.mock("./permissions/macos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions/macos")>()),
  watchMacosPrompt: async (
    _pending: Promise<unknown>,
    onAsking: () => Promise<void>,
  ) => {
    if (promptShows.value) {
      await onAsking();
    }
    return promptShows.value;
  },
}));

describe("a source whose listing waits", () => {
  async function heldSource() {
    const dir = AbsolutePathSchema.parse(await tempDir("skills-held-"));
    return { dir, id: "claude", source: "claude" } as const;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    promptShows.value = false;
  });

  it("starts one listing however many passes come while macOS asks", async () => {
    promptShows.value = true;
    const source = await heldSource();
    // As macOS holds a listing while its prompt for the folder is up.
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementation(() => new Promise(() => {}));

    const passes = await Promise.all([
      findSkills([source]),
      findSkills([source]),
      findSkills([source]),
    ]);

    expect(passes).toEqual([[], [], []]);
    expect(readdir).toHaveBeenCalledTimes(1);
  });

  it("waits out a slow listing with no prompt, up to a cap", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const source = await heldSource();
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementation(() => new Promise(() => {}));
    let settled = false;
    const pass = findSkills([source]).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(readdir).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pass).resolves.toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  it("parses typical skill file", () => {
    expect(parseFrontmatter(make("description: Does a thing")))
      .toMatchInlineSnapshot(`
        {
          "body": "Body content",
          "compatibility": undefined,
          "description": "Does a thing",
          "keys": [
            "description",
          ],
          "modelInvocable": true,
          "ok": true,
          "title": undefined,
          "userInvocable": true,
        }
      `);
  });

  it("says which rejection happened", () => {
    expect({
      noDescription: parseFrontmatter(make("name: foo")),
      noFrontmatter: parseFrontmatter("Just plain content"),
      unterminated: parseFrontmatter("---\ndescription: Oops\nBody, no close"),
    }).toMatchInlineSnapshot(`
      {
        "noDescription": {
          "keys": [
            "name",
          ],
          "ok": false,
          "reason": "no-description",
        },
        "noFrontmatter": {
          "ok": false,
          "reason": "no-frontmatter",
        },
        "unterminated": {
          "ok": false,
          "reason": "unterminated",
        },
      }
    `);
  });

  it("gives the same reason every time it reads the same broken file", () => {
    const raw = make("description: [");
    const first = parseFrontmatter(raw);
    expect(first).toMatchObject({ ok: false, reason: "unparsable" });
    expect(parseFrontmatter(raw)).toEqual(first);
  });

  // A CRLF checkout is what a Windows build packages, and the closing fence
  // eats the `\n` of the last CRLF. Cover a quoted final value too: the stray
  // `\r` left behind is harmless inside an unquoted scalar but is a second
  // scalar after a closing quote, so quoting alone decided whether a skill was
  // discovered at all.
  it.each([
    { style: "unquoted", value: "Windows skill" },
    { style: "quoted", value: '"Windows skill"' },
  ])("handles Windows-style CRLF line endings ($style)", ({ value }) => {
    const raw = `---\r\ndescription: ${value}\r\n---\r\nBody`;
    expect(parseFrontmatter(raw)).toMatchInlineSnapshot(`
        {
          "body": "Body",
          "compatibility": undefined,
          "description": "Windows skill",
          "keys": [
            "description",
          ],
          "modelInvocable": true,
          "ok": true,
          "title": undefined,
          "userInvocable": true,
        }
      `);
  });

  it("falls back to sanitizer for description with colon (invalid YAML)", () => {
    expect(parseFrontmatter(make("description: Foo: bar baz")))
      .toMatchInlineSnapshot(`
        {
          "body": "Body content",
          "compatibility": undefined,
          "description": "Foo: bar baz",
          "keys": [
            "description",
          ],
          "modelInvocable": true,
          "ok": true,
          "title": undefined,
          "userInvocable": true,
        }
      `);
  });

  it.each([
    {
      expected: false,
      field: "modelInvocable",
      line: "disable-model-invocation: true",
    },
    { expected: true, field: "modelInvocable", line: "" },
    { expected: false, field: "userInvocable", line: "user-invocable: false" },
    { expected: true, field: "userInvocable", line: "" },
  ] as const)(
    "reads $field=$expected from `$line`",
    ({ expected, field, line }) => {
      const result = parseFrontmatter(
        make(["description: Does a thing", line].filter(Boolean).join("\n")),
      );
      expect(result.ok && result[field]).toBe(expected);
    },
  );

  it("preserves extra frontmatter keys like argument-hint", () => {
    expect(
      parseFrontmatter(
        make(
          [
            "name: teach",
            "description: Teach the user a new skill or concept.",
            'argument-hint: "What would you like to learn about?"',
            "disable-model-invocation: true",
          ].join("\n"),
        ),
      ),
    ).toMatchInlineSnapshot(`
      {
        "body": "Body content",
        "compatibility": undefined,
        "description": "Teach the user a new skill or concept.",
        "keys": [
          "name",
          "description",
          "argument-hint",
          "disable-model-invocation",
        ],
        "modelInvocable": false,
        "ok": true,
        "title": "teach",
        "userInvocable": true,
      }
    `);
  });

  it("trims leading/trailing whitespace from body", () => {
    const result = parseFrontmatter(
      `---\ndescription: Trimmed\n---\n\n  Body\n`,
    );
    expect(result.ok && result.body).toBe("Body");
  });
});

describe("listSkillFiles", () => {
  it("skips dependency trees and tool caches", async () => {
    const root = await tempDir("skill-files-");
    await fs.mkdir(path.join(root, "node_modules", "cac"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, ".turbo"), { recursive: true });
    await fs.mkdir(path.join(root, "scripts"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "cac", "index.js"), "");
    await fs.writeFile(path.join(root, ".turbo", "turbo-test.log"), "");
    await fs.writeFile(path.join(root, "scripts", "run.ts"), "");
    await fs.writeFile(path.join(root, "package.json"), "{}");
    await fs.writeFile(path.join(root, "SKILL.md"), make("description: X"));

    const { files } = await listSkillFiles(
      AbsolutePathSchema.parse(root),
      AbortSignal.timeout(5000),
    );

    expect(files.sort()).toEqual([
      "SKILL.md",
      "package.json",
      "scripts/run.ts",
    ]);
  });
});

describe("skill discovery", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "skips a source it can't read and keeps the others",
    async () => {
      const root = await tempDir("skills-refused-");
      const refused = path.join(root, "home", ".claude", "skills");
      await writeSkill(path.join(refused, "review"), "Claude");
      await writeSkill(
        path.join(root, "home", ".codex", "skills", "notes"),
        "Codex",
      );
      await fs.chmod(refused, 0o000);
      try {
        const skills = await findSkills(sourcesIn(root));
        expect(skills.map((skill) => skill.id)).toEqual(["codex:notes"]);
      } finally {
        await fs.chmod(refused, 0o755);
      }
    },
  );

  it("keeps a skill ID stable when a higher-ranked namesake appears", async () => {
    const root = await tempDir("skills-identity-");
    await writeSkill(
      path.join(root, "home", ".claude", "skills", "review"),
      "Claude",
    );
    const sources = sourcesIn(root);

    const [before] = await findSkills(sources);
    expect(before).toMatchObject({
      id: "claude:review",
      qualifiedName: "review",
    });

    await writeSkill(
      path.join(root, "workspace", SKILLS_FOLDER_NAME, "review"),
      "Workspace",
    );
    const after = await findSkills(sources);
    expect(
      after.map(({ id, qualifiedName }) => ({ id, qualifiedName })),
    ).toEqual([
      { id: "claude:review", qualifiedName: "claude:review" },
      { id: "workspace:review", qualifiedName: "review" },
    ]);
  });

  it("keeps every copy of a shared name and qualifies the ones that lose it", async () => {
    const root = await tempDir("skills-test-");
    const sharedSkill = path.join(root, "shared", "review");

    await writeSkill(path.join(root, "system", "creator"), "System");
    await writeSkill(
      path.join(root, "registry", "skills", "bundled"),
      "Bundled",
    );
    await writeSkill(sharedSkill, "Shared");
    for (const vendor of [".claude", ".codex"]) {
      await fs.mkdir(path.join(root, "home", vendor, "skills"), {
        recursive: true,
      });
      await fs.symlink(
        sharedSkill,
        path.join(root, "home", vendor, "skills", "review"),
      );
    }
    await writeSkill(
      path.join(root, "workspace", SKILLS_FOLDER_NAME, "review"),
      "Workspace",
    );

    const sources = sourcesIn(root);
    const skills = await findSkills(sources);

    expect(
      skills.map(({ aliases, description, qualifiedName, source }) => ({
        aliases,
        description,
        qualifiedName,
        source,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "aliases": [
            "system:creator",
          ],
          "description": "System",
          "qualifiedName": "creator",
          "source": "system",
        },
        {
          "aliases": [
            "instrument:bundled",
          ],
          "description": "Bundled",
          "qualifiedName": "bundled",
          "source": "instrument",
        },
        {
          "aliases": [
            "claude:review",
            "codex:review",
          ],
          "description": "Shared",
          "qualifiedName": "claude:review",
          "source": "claude",
        },
        {
          "aliases": [
            "workspace:review",
          ],
          "description": "Workspace",
          "qualifiedName": "review",
          "source": "workspace",
        },
      ]
    `);
  });

  it("collapses copies of one skill that agree on SKILL.md", async () => {
    const root = await tempDir("skills-copies-");

    // What a tool that copies rather than symlinks leaves behind.
    for (const vendor of [".claude", ".cursor", ".gemini"]) {
      await writeSkill(
        path.join(root, "home", vendor, "skills", "review"),
        "Shared",
      );
    }
    await writeSkill(
      path.join(root, "workspace", SKILLS_FOLDER_NAME, "review"),
      "Shared",
    );
    await writeSkill(
      path.join(root, "home", ".codex", "skills", "review"),
      "Different",
    );

    const skills = await findSkills(sourcesIn(root));

    // One entry for the four identical copies, attributed to the source that
    // outranks the rest, and the genuinely different one beside it.
    expect(
      skills.map(({ aliases, description, qualifiedName, source }) => ({
        aliases,
        description,
        qualifiedName,
        source,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "aliases": [
            "workspace:review",
            "claude:review",
            "cursor:review",
            "gemini:review",
          ],
          "description": "Shared",
          "qualifiedName": "review",
          "source": "workspace",
        },
        {
          "aliases": [
            "codex:review",
          ],
          "description": "Different",
          "qualifiedName": "codex:review",
          "source": "codex",
        },
      ]
    `);
    expect(resolveSkillName(skills, "claude:review")).toEqual({
      skill: skills[0],
    });
  });

  it("keeps same-instruction packages with different authored files", async () => {
    const root = await tempDir("skills-packages-");
    const claude = path.join(root, "home", ".claude", "skills", "review");
    const cursor = path.join(root, "home", ".cursor", "skills", "review");
    await writeSkill(claude, "Shared");
    await writeSkill(cursor, "Shared");
    await writePackageFile(claude, "scripts/run.ts", "claude");
    await writePackageFile(cursor, "scripts/run.ts", "cursor");

    const skills = await findSkills(sourcesIn(root));

    expect(skills.map(({ id }) => id)).toEqual([
      "claude:review",
      "cursor:review",
    ]);
  });

  it("keeps copies with different invocation metadata", async () => {
    const root = await tempDir("skills-metadata-");
    const claude = path.join(root, "home", ".claude", "skills", "review");
    const cursor = path.join(root, "home", ".cursor", "skills", "review");
    await writeSkill(claude, "Shared");
    await fs.mkdir(cursor, { recursive: true });
    await fs.writeFile(
      path.join(cursor, "SKILL.md"),
      make("description: Shared\nuser-invocable: false"),
    );

    const skills = await findSkills(sourcesIn(root));

    expect(
      skills.map(({ id, userInvocable }) => ({ id, userInvocable })),
    ).toEqual([
      { id: "claude:review", userInvocable: true },
      { id: "cursor:review", userInvocable: false },
    ]);
  });

  it("keeps the skills we ship out of user invocation", async () => {
    const root = await tempDir("skills-bundled-");

    await writeSkill(path.join(root, "system", "creator"), "System");
    await writeSkill(path.join(root, "registry", "skills", "pdf"), "Ours");
    await writeSkill(
      path.join(root, "home", ".claude", "skills", "review"),
      "Theirs",
    );

    const skills = await findSkills(sourcesIn(root));

    // Neither shipped skill says so in its frontmatter, since the same packages
    // install into agents that do offer them by name.
    expect(
      skills.map(({ id, userInvocable }) => ({ id, userInvocable })),
    ).toEqual([
      { id: "system:creator", userInvocable: false },
      { id: "instrument:pdf", userInvocable: false },
      { id: "claude:review", userInvocable: true },
    ]);
  });

  it("collapses a copy of a shipped skill installed in another agent into the one we ship", async () => {
    const root = await tempDir("skills-installed-");

    await writeSkill(path.join(root, "registry", "skills", "pdf"), "Ours");
    await writeSkill(
      path.join(root, "home", ".claude", "skills", "pdf"),
      "Ours",
    );

    const skills = await findSkills(sourcesIn(root));

    // Installing our package into another agent's folder is the same skill, so
    // it collapses into the one we ship rather than reappearing as a slash
    // command beside it.
    expect(
      skills.map(({ aliases, id, userInvocable }) => ({
        aliases,
        id,
        userInvocable,
      })),
    ).toEqual([
      {
        aliases: ["instrument:pdf", "claude:pdf"],
        id: "instrument:pdf",
        userInvocable: false,
      },
    ]);
  });

  it("invalidates a cached package fingerprint when an authored file changes", async () => {
    const root = await tempDir("skills-cache-");
    const claude = path.join(root, "home", ".claude", "skills", "review");
    const cursor = path.join(root, "home", ".cursor", "skills", "review");
    for (const skillDir of [claude, cursor]) {
      await writeSkill(skillDir, "Shared");
      await writePackageFile(skillDir, "scripts/run.ts", "same");
    }
    const sources = sourcesIn(root);

    await expect(findSkills(sources)).resolves.toHaveLength(1);
    await fs.writeFile(
      path.join(cursor, "scripts", "run.ts"),
      "different contents",
    );
    await expect(findSkills(sources)).resolves.toHaveLength(2);
  });

  it("treats names that differ only in case as the same name", async () => {
    const root = await tempDir("skills-case-");

    await writeSkill(path.join(root, "registry", "skills", "pdf"), "Ours");
    await writeSkill(
      path.join(root, "home", ".claude", "skills", "PDF"),
      "Theirs",
    );

    const skills = await findSkills(sourcesIn(root));

    // macOS and Windows would give both of these the same folder inside a task,
    // so the lower-ranked one has to be qualified even though the names differ.
    expect(skills.map(({ qualifiedName }) => qualifiedName))
      .toMatchInlineSnapshot(`
      [
        "pdf",
        "claude:PDF",
      ]
    `);
  });

  it("qualifies every claimant when the top-ranked source is a tie", async () => {
    const root = await tempDir("skills-tie-");

    await writeSkill(
      path.join(root, "home", ".claude", "skills", "review"),
      "Claude",
    );
    await writeSkill(
      path.join(root, "home", ".cursor", "skills", "review"),
      "Cursor",
    );

    const skills = await findSkills(sourcesIn(root));

    // Neither vendor directory outranks the other, so "review" alone addresses
    // nothing and both have to be asked for by source.
    expect(skills.map(({ qualifiedName }) => qualifiedName))
      .toMatchInlineSnapshot(`
      [
        "claude:review",
        "cursor:review",
      ]
    `);
  });

  it("collapses one real skill reached through several symlinked sources", async () => {
    const root = await tempDir("skills-dedupe-");
    const shared = path.join(root, "dotfiles", "skills");

    await writeSkill(path.join(shared, "review"), "Shared");
    // ~/.agents/skills is the symlink farm itself; the other vendors symlink
    // the individual skill, which is how these directories look in practice.
    await fs.mkdir(path.join(root, "home", ".agents"), { recursive: true });
    await fs.symlink(shared, path.join(root, "home", ".agents", "skills"));
    for (const vendor of [".claude", ".cursor", ".gemini"]) {
      await fs.mkdir(path.join(root, "home", vendor, "skills"), {
        recursive: true,
      });
      await fs.symlink(
        path.join(shared, "review"),
        path.join(root, "home", vendor, "skills", "review"),
      );
    }

    const skills = await findSkills(sourcesIn(root));

    expect(skills.map(({ name, source }) => ({ name, source }))).toEqual([
      { name: "review", source: "agents" },
    ]);
  });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** Every skill source, laid out under one folder: `home`, `workspace`, `registry` and `system`. */
function sourcesIn(root: string) {
  return getSkillSources(
    {
      registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
      systemSkillsDir: AbsolutePathSchema.parse(path.join(root, "system")),
    },
    AbsolutePathSchema.parse(path.join(root, "home")),
  );
}

async function writePackageFile(
  dir: string,
  relativePath: string,
  body: string,
) {
  const filePath = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
}

async function writeSkill(dir: string, description: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    make(`description: ${description}`),
  );
}
