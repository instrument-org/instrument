type Member = { filename: string; uncompressedSize: number };

export type ArchiveFolder<T extends Member> = {
  children: ArchiveNode<T>[];
  /** Files anywhere under it. */
  fileCount: number;
  kind: "folder";
  name: string;
  path: string;
  /** Unpacked bytes anywhere under it, as the archive claims them. */
  size: number;
};

export type ArchiveFile<T extends Member> = {
  entry: T;
  kind: "file";
  name: string;
  path: string;
};

export type ArchiveNode<T extends Member> = ArchiveFile<T> | ArchiveFolder<T>;

export type ArchiveRow<T extends Member> = {
  depth: number;
  node: ArchiveNode<T>;
};

/**
 * The archive's members as folders, the way it will look once unpacked.
 *
 * A zip is a flat list of paths, so its folders are inferred from them. Most
 * archives wrap everything in one folder named for the archive itself, and
 * that folder is the root here rather than the first row: a row every other
 * row sits under says nothing, and costs a level of indent on all of them.
 * `root.path` is the prefix that was skipped, "" when there was none.
 */
export function archiveTree<T extends Member>(entries: T[]): ArchiveFolder<T> {
  const root = folder<T>("", "");
  const folders = new Map<string, ArchiveFolder<T>>([["", root]]);

  for (const entry of entries) {
    const parts = entry.filename.split("/").filter((part) => part !== "");
    const name = parts.pop();
    if (name === undefined) {
      continue;
    }
    let parent = root;
    let path = "";
    for (const part of parts) {
      path += `${part}/`;
      let next = folders.get(path);
      if (!next) {
        next = folder<T>(part, path);
        folders.set(path, next);
        parent.children.push(next);
      }
      parent = next;
    }
    parent.children.push({
      entry,
      kind: "file",
      name,
      path: path + name,
    });
  }

  tally(root);

  let shown = root;
  while (shown.children.length === 1 && shown.children[0]?.kind === "folder") {
    shown = shown.children[0];
  }
  return shown;
}

/** The rows on screen: each folder's contents follow it while it is open. */
export function visibleRows<T extends Member>(
  root: ArchiveFolder<T>,
  expanded: ReadonlySet<string>,
): ArchiveRow<T>[] {
  const rows: ArchiveRow<T>[] = [];
  const walk = (parent: ArchiveFolder<T>, depth: number) => {
    for (const node of parent.children) {
      rows.push({ depth, node });
      if (node.kind === "folder" && expanded.has(node.path)) {
        walk(node, depth + 1);
      }
    }
  };
  walk(root, 0);
  return rows;
}

/**
 * Every file whose path under the root holds the query, in the order the tree
 * draws them, each at depth zero: a match is reached wherever it sits, and its
 * folders are shown beside its name rather than opened around it.
 */
export function matchingFiles<T extends Member>(
  root: ArchiveFolder<T>,
  query: string,
): ArchiveFile<T>[] {
  const needle = query.toLowerCase();
  const found: ArchiveFile<T>[] = [];
  const walk = (parent: ArchiveFolder<T>) => {
    for (const node of parent.children) {
      if (node.kind === "folder") {
        walk(node);
      } else if (relativePath(root, node).toLowerCase().includes(needle)) {
        found.push(node);
      }
    }
  };
  walk(root);
  return found;
}

/** Where a node sits under the root on screen. */
export function relativePath<T extends Member>(
  root: ArchiveFolder<T>,
  node: ArchiveNode<T>,
) {
  return node.path.slice(root.path.length);
}

function folder<T extends Member>(
  name: string,
  path: string,
): ArchiveFolder<T> {
  return { children: [], fileCount: 0, kind: "folder", name, path, size: 0 };
}

// Counts and sizes from the leaves up, then folders ahead of files and each
// group by name, the order a file manager lists a folder in.
function tally<T extends Member>(parent: ArchiveFolder<T>) {
  for (const node of parent.children) {
    if (node.kind === "folder") {
      tally(node);
      parent.fileCount += node.fileCount;
      parent.size += node.size;
    } else {
      parent.fileCount += 1;
      parent.size += node.entry.uncompressedSize;
    }
  }
  parent.children.sort((left, right) =>
    left.kind === right.kind
      ? left.name.localeCompare(right.name, undefined, { numeric: true })
      : left.kind === "folder"
        ? -1
        : 1,
  );
}
