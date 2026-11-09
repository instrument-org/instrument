import { z } from "zod";

import { listProjects, type Project } from "../chat/projects";
import { defineCapability } from "./define";

const ListedProject = z.object({ id: z.string(), name: z.string() });

/** The projects in use, which a chat can be filed under. */
export async function projectsInUse(): Promise<Project[]> {
  return (await listProjects()).filter((project) => project.retired !== true);
}

export const projectsList = defineCapability({
  input: z.object({}),
  name: "projects.list",
  output: z.array(ListedProject),
  async run() {
    return (await projectsInUse()).map(({ id, name }) => ({ id, name }));
  },
  summary: "The projects in use, each by its name and id.",
  surfaces: {
    cli: { help: "", words: ["projects", "list"] },
    script: {},
  },
  text: (projects) =>
    projects.length === 0
      ? "There are no projects yet."
      : projects
          .map((project) => `  ${project.name}  ${project.id}`)
          .join("\n"),
});
