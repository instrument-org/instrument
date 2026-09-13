import { listIdeas } from "@/electron-main/lib/ideas";
import { base } from "@/electron-main/rpc/base";
import { z } from "zod";

const ExampleSchema = z.object({
  capture: z.object({ path: z.string(), version: z.number() }).optional(),
  htmlPath: z.string(),
  illustrative: z.boolean().optional(),
  name: z.string(),
  note: z.string().optional(),
  prompt: z.string().optional(),
  title: z.string(),
  variant: z.string().optional(),
});

const IdeaSchema = z.object({
  cover: z.string(),
  examples: z.array(ExampleSchema),
  name: z.string(),
  order: z.number(),
  sketch: z.array(z.string()).optional(),
  tagline: z.string(),
  tags: z.array(z.string()),
  title: z.string(),
  when: z.string(),
});

/** The kinds of page the app can make, from the registry it ships, in the order the catalog gives them. */
const list = base.output(z.array(IdeaSchema)).handler(() => listIdeas());

export const ideas = {
  list,
};
