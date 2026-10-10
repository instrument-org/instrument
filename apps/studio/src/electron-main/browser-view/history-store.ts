import { logger } from "@/electron-main/lib/electron-logger";
import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { workspacePrivateDir } from "@/electron-main/lib/workspaces";
import { EventPublisher } from "@orpc/server";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The person's history in the app: the in-app browser's pages, and the files
 * they opened.
 *
 * Pages are modeled on Chromium's `urls` and `visits`
 * tables: one row per address, carrying what the address is called and the
 * counts the address field ranks by, and one row per time a tab committed it.
 *
 * Every count and the `hidden` flag on a `urls` row are derived from its
 * visits (`refresh`), so a visit hidden after the fact (a page that turned
 * out to be a client redirect) or removed (clearing) leaves the row saying
 * what its remaining visits say. Only the person's own visible visits count:
 * an agent's visits keep the row's title and icon fresh, which chats and the
 * inbox draw, and never put it on a history surface.
 */

/** Who moved the tab. */
export type HistoryActor = "agent" | "user";

/**
 * How the visit came about, the core of Chromium's page transition: `typed`
 * from the address field or a bookmark, `back_forward` a step through the
 * tab's own history, `link` everything else a page or the app did.
 */
export type HistoryTransition = "back_forward" | "link" | "typed";

/**
 * Why a visit is kept out of history, or null when it is not: `redirect` a
 * page another replaced in its tab before the person moved on (a client
 * redirect), `error` a page the server answered with an error status or that
 * failed to load, `sign-in` a page the app's own sign-in flow went through.
 */
export type HiddenBy = "error" | "redirect" | "sign-in";

/**
 * How a file was opened: `tab` shown in one of the app's own tabs, by any way
 * in (a folder, a link in a reply, the Finder handing it over); `external`
 * handed to another app from here.
 */
export type FileOpenVia = "external" | "tab";

/** A file the person opened, as the recents read it. */
export interface OpenedFile {
  /** When they last opened it, in epoch ms. */
  at: number;
  openCount: number;
  /** The host path, as it was when last opened or since moved by the app. */
  path: string;
}

/** A page as the history surfaces draw it. */
export interface HistoryPage {
  /** When the person last visited it visibly, in epoch ms. */
  at: number;
  favicon?: string;
  title: string;
  typedCount: number;
  url: string;
  visitCount: number;
}

export interface NewVisit {
  actor: HistoryActor;
  at: number;
  /** The visit the tab was on when this one came, Chromium's `from_visit`. */
  fromVisit?: number;
  hiddenBy?: HiddenBy;
  /** Whether this visit replaced the one before it in its tab. */
  isClientRedirect?: boolean;
  /** The HTTP status the page was answered with, for a page loaded over HTTP. */
  status?: number;
  transition: HistoryTransition;
  url: string;
}

/** How long ago a page still counts as lately visited for the address field, Chromium's rule. */
const SIGNIFICANT_RECENCY_MS = 3 * 24 * 60 * 60 * 1000;
/** How many visible visits make a page significant without being typed, Chromium's rule. */
const SIGNIFICANT_VISITS = 4;

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS urls (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  favicon TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  typed_count INTEGER NOT NULL DEFAULT 0,
  last_visit INTEGER,
  hidden INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  url_id INTEGER NOT NULL REFERENCES urls(id),
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  transition TEXT NOT NULL,
  client_redirect INTEGER NOT NULL DEFAULT 0,
  from_visit INTEGER,
  status INTEGER,
  hidden_by TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS visits_url ON visits(url_id);
CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
CREATE INDEX IF NOT EXISTS urls_last_visit ON urls(last_visit);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  open_count INTEGER NOT NULL DEFAULT 0,
  last_open INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS file_opens (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id),
  at INTEGER NOT NULL,
  via TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS file_opens_file ON file_opens(file_id);
CREATE INDEX IF NOT EXISTS files_last_open ON files(last_open);
`;

/** A visit that counts toward history: the person's own, and not hidden. */
const VISIBLE = "actor = 'user' AND hidden_by IS NULL";

/** Sets a row's counts and `hidden` from its visits; `?` is the row's id, or every row when it matches all. */
const REFRESH = `
UPDATE urls SET
  visit_count = (SELECT count(*) FROM visits WHERE url_id = urls.id AND ${VISIBLE}),
  typed_count = (SELECT count(*) FROM visits WHERE url_id = urls.id AND ${VISIBLE} AND transition = 'typed'),
  last_visit = (SELECT max(at) FROM visits WHERE url_id = urls.id AND ${VISIBLE}),
  hidden = NOT EXISTS (SELECT 1 FROM visits WHERE url_id = urls.id AND ${VISIBLE})
`;

export type HistoryStore = ReturnType<typeof createHistoryStore>;

/**
 * The store over one database file, or `:memory:` for tests. Every write
 * tells `changes` so live readers read again.
 */
export function createHistoryStore(file: string) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  const version = database.prepare("PRAGMA user_version").get()?.user_version;
  if (version !== SCHEMA_VERSION) {
    // Nothing older than this version was ever written; a file of another
    // version is from a build this one cannot read, so it starts over.
    database.exec(
      "DROP TABLE IF EXISTS visits; DROP TABLE IF EXISTS urls; DROP TABLE IF EXISTS file_opens; DROP TABLE IF EXISTS files;",
    );
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION.toString()}`);
  }
  database.exec(SCHEMA);

  const changes = new EventPublisher<{ changed: null }>();
  const changed = () => {
    changes.publish("changed", null);
  };

  const statements = {
    addUrl: database.prepare(
      "INSERT INTO urls (url) VALUES (?) ON CONFLICT(url) DO NOTHING",
    ),
    addVisit: database.prepare(
      "INSERT INTO visits (url_id, at, actor, transition, client_redirect, from_visit, status, hidden_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    refreshOne: database.prepare(`${REFRESH} WHERE id = ?`),
    urlId: database.prepare("SELECT id FROM urls WHERE url = ?"),
    urlOfVisit: database.prepare("SELECT url_id FROM visits WHERE id = ?"),
  };

  const urlIdOf = (url: string): number => {
    statements.addUrl.run(url);
    const row = statements.urlId.get(url);
    return Number(row?.id);
  };
  const refresh = (urlId: number) => {
    statements.refreshOne.run(urlId);
  };
  const urlIdOfVisit = (visitId: number): number | undefined => {
    const row = statements.urlOfVisit.get(visitId);
    return row === undefined ? undefined : Number(row.url_id);
  };

  const pagesWhere = (where: string, parameters: number[], limit: number) =>
    database
      .prepare(
        `SELECT url, title, favicon, last_visit, visit_count, typed_count FROM urls WHERE hidden = 0 AND ${where} ORDER BY last_visit DESC LIMIT ?`,
      )
      .all(...parameters, limit)
      .map(
        (row): HistoryPage => ({
          at: Number(row.last_visit),
          ...(typeof row.favicon === "string" ? { favicon: row.favicon } : {}),
          title: String(row.title),
          typedCount: Number(row.typed_count),
          url: String(row.url),
          visitCount: Number(row.visit_count),
        }),
      );

  return {
    /**
     * The person opened a file. Kept by its host path; the row lasts while
     * the file is gone, so a file put back is the same recent again.
     */
    addFileOpen({
      at,
      path: filePath,
      via,
    }: {
      at: number;
      path: string;
      via: FileOpenVia;
    }) {
      database
        .prepare(
          "INSERT INTO files (path, open_count, last_open) VALUES (?, 1, ?) ON CONFLICT(path) DO UPDATE SET open_count = open_count + 1, last_open = max(last_open, excluded.last_open)",
        )
        .run(filePath, at);
      database
        .prepare(
          "INSERT INTO file_opens (file_id, at, via) SELECT id, ?, ? FROM files WHERE path = ?",
        )
        .run(at, via, filePath);
      changed();
    },

    /** A visit committed in a tab; answers its id. */
    addVisit(visit: NewVisit): number {
      const urlId = urlIdOf(visit.url);
      const result = statements.addVisit.run(
        urlId,
        visit.at,
        visit.actor,
        visit.transition,
        visit.isClientRedirect ? 1 : 0,
        visit.fromVisit ?? null,
        visit.status ?? null,
        visit.hiddenBy ?? null,
      );
      refresh(urlId);
      changed();
      return Number(result.lastInsertRowid);
    },

    changes,

    /**
     * Removes every visit, the person's and an agent's, at or after `since`
     * (all of them without it), and every address left with none. Answers how
     * many visits went.
     */
    clear(since?: number): { removed: number } {
      const removed = Number(
        (since === undefined
          ? database.prepare("DELETE FROM visits").run()
          : database.prepare("DELETE FROM visits WHERE at >= ?").run(since)
        ).changes,
      );
      database.exec(
        "UPDATE visits SET from_visit = NULL WHERE from_visit IS NOT NULL AND from_visit NOT IN (SELECT id FROM visits)",
      );
      database.exec(
        "DELETE FROM urls WHERE id NOT IN (SELECT DISTINCT url_id FROM visits)",
      );
      database.exec(REFRESH);
      changed();
      return { removed };
    },

    close() {
      database.close();
    },

    /**
     * Hides a visit after the fact: a page its tab replaced before the person
     * moved on, or one whose load failed. A visit hidden already keeps its
     * first reason.
     */
    hideVisit(visitId: number, hiddenBy: HiddenBy) {
      const urlId = urlIdOfVisit(visitId);
      if (urlId === undefined) {
        return;
      }
      database
        .prepare(
          "UPDATE visits SET hidden_by = ? WHERE id = ? AND hidden_by IS NULL",
        )
        .run(hiddenBy, visitId);
      refresh(urlId);
      changed();
    },

    /**
     * Something the app moved or renamed from `from` to `to`: the file there,
     * or every file under the folder there, keeps its history at its new path.
     * A row already at the new path gives way to the one that moved there.
     */
    moveFiles(from: string, to: string) {
      const moved = database
        .prepare(
          "SELECT id, path FROM files WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || ?",
        )
        .all(from, from, from, path.sep)
        .map((row) => ({
          id: Number(row.id),
          path: `${to}${String(row.path).slice(from.length)}`,
        }));
      if (moved.length === 0) {
        return;
      }
      const evict = database.prepare(
        "DELETE FROM file_opens WHERE file_id IN (SELECT id FROM files WHERE path = ?)",
      );
      const evictFile = database.prepare("DELETE FROM files WHERE path = ?");
      const update = database.prepare("UPDATE files SET path = ? WHERE id = ?");
      database.exec("BEGIN");
      try {
        for (const entry of moved) {
          evict.run(entry.path);
          evictFile.run(entry.path);
          update.run(entry.path, entry.id);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      changed();
    },

    /** The files the person opened, most recently opened first. */
    openedFiles(limit: number): OpenedFile[] {
      return database
        .prepare(
          "SELECT path, last_open, open_count FROM files ORDER BY last_open DESC LIMIT ?",
        )
        .all(limit)
        .map((row) => ({
          at: Number(row.last_open),
          openCount: Number(row.open_count),
          path: String(row.path),
        }));
    },

    /** The person's visible pages, newest first. */
    recent(limit: number): HistoryPage[] {
      return pagesWhere("1", [], limit);
    },

    /** Takes a page off the person's history: their visits to it, and the row once nothing else visited it. */
    remove(url: string) {
      const row = statements.urlId.get(url);
      if (row === undefined) {
        return;
      }
      const urlId = Number(row.id);
      database
        .prepare("DELETE FROM visits WHERE url_id = ? AND actor = 'user'")
        .run(urlId);
      database
        .prepare(
          "DELETE FROM urls WHERE id = ? AND NOT EXISTS (SELECT 1 FROM visits WHERE url_id = ?)",
        )
        .run(urlId, urlId);
      refresh(urlId);
      changed();
    },

    /** The page's icon, as it announced it, whoever had the tab. */
    setFavicon(url: string, favicon: string) {
      const result = database
        .prepare(
          "UPDATE urls SET favicon = ? WHERE url = ? AND favicon IS NOT ?",
        )
        .run(favicon, url, favicon);
      if (Number(result.changes) > 0) {
        changed();
      }
    },

    /** A title for the addresses of the given visits, which a redirect chain shares. */
    setTitle(visitIds: readonly number[], title: string) {
      const urlIds = new Set(
        visitIds.flatMap((visitId) => urlIdOfVisit(visitId) ?? []),
      );
      let didChange = false;
      const update = database.prepare(
        "UPDATE urls SET title = ? WHERE id = ? AND title IS NOT ?",
      );
      for (const urlId of urlIds) {
        didChange =
          Number(update.run(title, urlId, title).changes) > 0 || didChange;
      }
      if (didChange) {
        changed();
      }
    },

    /**
     * The pages the address field completes to, Chromium's "significant"
     * rule: visible, and typed at least once, visited often, or visited lately.
     */
    significant(limit: number, now: number): HistoryPage[] {
      return pagesWhere(
        "(typed_count >= 1 OR visit_count >= ? OR last_visit >= ?)",
        [SIGNIFICANT_VISITS, now - SIGNIFICANT_RECENCY_MS],
        limit,
      );
    },

    /**
     * What clearing from `since` would take, as the person sees it: how many
     * pages they visited visibly in that time, and the hosts of those pages,
     * most-visited first.
     */
    summary(since?: number): { count: number; hosts: string[] } {
      const rows = database
        .prepare(
          "SELECT urls.url AS url, count(*) AS visits FROM visits JOIN urls ON urls.id = visits.url_id WHERE visits.actor = 'user' AND visits.hidden_by IS NULL AND visits.at >= ? GROUP BY urls.id",
        )
        .all(since ?? 0);
      const byHost = new Map<string, number>();
      for (const row of rows) {
        const host = URL.parse(String(row.url))?.hostname;
        if (host) {
          byHost.set(host, (byHost.get(host) ?? 0) + Number(row.visits));
        }
      }
      return {
        count: rows.length,
        hosts: [...byHost]
          .toSorted(
            ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
          )
          .map(([host]) => host),
      };
    },
  };
}

let opened: HistoryStore | undefined;

/** The history of the workspace this process runs, opened on first use. */
export function getHistoryStore(): HistoryStore {
  opened ??= createHistoryStore(
    path.join(workspacePrivateDir(getWorkspaceFolder()), "history.db"),
  );
  return opened;
}

/**
 * Writes a file the person opened into history, now. A failure is reported
 * and swallowed: the open itself has happened, and history is what follows
 * it rather than a gate in front of it.
 */
export function recordFileOpen(filePath: string, via: FileOpenVia) {
  try {
    getHistoryStore().addFileOpen({ at: Date.now(), path: filePath, via });
  } catch (error) {
    logger.error("Could not record a file open", error);
  }
}
