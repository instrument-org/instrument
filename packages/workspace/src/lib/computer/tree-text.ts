import { z } from "zod";

type TreeNode = {
  children?: TreeNode[];
  children_count?: number;
  name?: string;
  ref_id?: string;
  role?: string;
  states?: string[];
  value?: string;
};

const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    children: z.array(TreeNodeSchema).optional(),
    children_count: z.number().optional(),
    name: z.string().optional(),
    ref_id: z.string().optional(),
    role: z.string().optional(),
    states: z.array(z.string()).optional(),
    value: z
      .unknown()
      .optional()
      .transform((value) => {
        if (value === undefined || value === null) {
          return undefined;
        }
        return typeof value === "string" ? value : JSON.stringify(value);
      }),
  }),
);

export const SnapshotDataSchema = z.object({
  app: z.string().optional(),
  complete: z.boolean().optional(),
  ref_count: z.number().optional(),
  snapshot_id: z.string(),
  tree: TreeNodeSchema.optional(),
  window: z.object({ id: z.string(), title: z.string() }).optional(),
});

/** Longest a field's value is shown in a tree: a document is read with `get`. */
const MAX_VALUE_LENGTH = 200;

function nodeLine(node: TreeNode): string {
  const value =
    node.value === undefined
      ? undefined
      : node.value.length > MAX_VALUE_LENGTH
        ? `${node.value.slice(0, MAX_VALUE_LENGTH)}…`
        : node.value;
  return [
    node.role ?? "element",
    node.name === undefined ? undefined : JSON.stringify(node.name),
    value === undefined ? undefined : `= ${JSON.stringify(value)}`,
    node.states?.length ? `[${node.states.join(", ")}]` : undefined,
    node.children_count === undefined
      ? undefined
      : `(${String(node.children_count)} inside)`,
    node.ref_id,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}

/**
 * An accessibility tree as the agent reads it, a line per element indented by
 * depth, in place of the driver's JSON, which is several times the size and
 * lists actions a role already implies.
 */
export function treeText(tree: TreeNode, depth = 0): string {
  return [
    `${"  ".repeat(depth)}${nodeLine(tree)}`,
    ...(tree.children ?? []).map((child) => treeText(child, depth + 1)),
  ].join("\n");
}
