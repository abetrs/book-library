"use strict";
/* SQLite storage (better-sqlite3, WAL mode).
 *
 * books        — the library. Every write stamps the row with a new library
 *                revision (`rev`), so clients can fetch only what changed.
 * deletions    — tombstones (id, rev) so deltas can report removed books.
 * lookup_cache — everything scraped from Open Library / Google Books / Wikipedia,
 *                keyed by what was asked, with an expiry.
 * images       — cached cover/thumbnail files on disk, keyed by a content key.
 * meta         — schema version, revision counter, generated secrets.
 */
const fs = require("fs");
const Database = require("better-sqlite3");

const SCHEMA_VERSION = 1;

function open(file) {
  if (file !== ":memory:") fs.mkdirSync(require("path").dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const v = Number((db.prepare(`SELECT value FROM meta WHERE key = 'schema'`).get() || {}).value || 0);
  if (v >= SCHEMA_VERSION) return;
  db.transaction(() => {
    if (v < 1) {
      db.exec(`
        CREATE TABLE books (
          id             INTEGER PRIMARY KEY,
          list           TEXT    NOT NULL CHECK (list IN ('reading', 'goodreads')),
          position       INTEGER NOT NULL DEFAULT 0,
          title          TEXT    NOT NULL,
          author         TEXT    NOT NULL DEFAULT '',
          category       TEXT    NOT NULL DEFAULT 'Uncategorized',
          subcategory    TEXT    NOT NULL DEFAULT '',
          subsubcategory TEXT    NOT NULL DEFAULT '',
          read           INTEGER NOT NULL DEFAULT 0,
          is_primary     INTEGER NOT NULL DEFAULT 0,
          custom         INTEGER NOT NULL DEFAULT 0,
          rating         INTEGER NOT NULL DEFAULT 0,
          isbn           TEXT    NOT NULL DEFAULT '',
          note           TEXT    NOT NULL DEFAULT '',
          ddc            TEXT    NOT NULL DEFAULT '',
          ddc_src        TEXT    NOT NULL DEFAULT '' CHECK (ddc_src IN ('', 'ol', 'est', 'manual')),
          genres         TEXT    NOT NULL DEFAULT '[]',
          cover_key      TEXT    NOT NULL DEFAULT '',
          classified     INTEGER NOT NULL DEFAULT 0,
          classify_after INTEGER NOT NULL DEFAULT 0,
          rev            INTEGER NOT NULL DEFAULT 0,
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL
        );
        CREATE INDEX books_list_pos ON books (list, position);
        CREATE INDEX books_rev ON books (rev);
        CREATE INDEX books_pending ON books (classified, classify_after);
        CREATE INDEX books_cover ON books (cover_key);

        CREATE TABLE deletions (id INTEGER NOT NULL, rev INTEGER NOT NULL);
        CREATE INDEX deletions_rev ON deletions (rev);

        CREATE TABLE lookup_cache (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE TABLE images (
          key        TEXT PRIMARY KEY,   -- sha1 of what the image is for
          status     TEXT NOT NULL,      -- 'ok' | 'none'
          file       TEXT NOT NULL DEFAULT '',
          mime       TEXT NOT NULL DEFAULT '',
          bytes      INTEGER NOT NULL DEFAULT 0,
          etag       TEXT NOT NULL DEFAULT '',
          fetched_at INTEGER NOT NULL
        );
      `);
      db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('rev', '0')`).run();
    }
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)`).run(String(SCHEMA_VERSION));
  })();
}

function getMeta(db, key) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key);
  return row ? row.value : null;
}
function setMeta(db, key, value) {
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(key, String(value));
}
// Next library revision; call inside the write transaction that uses it.
function nextRev(db) {
  const rev = Number(getMeta(db, "rev") || 0) + 1;
  setMeta(db, "rev", rev);
  return rev;
}
function currentRev(db) {
  return Number(getMeta(db, "rev") || 0);
}

/* ---------------- lookup cache ---------------- */
function cacheGet(db, key) {
  const row = db.prepare(`SELECT value, expires_at FROM lookup_cache WHERE key = ?`).get(key);
  if (!row) return undefined;
  if (row.expires_at < Date.now()) return undefined;
  return JSON.parse(row.value);
}
function cacheSet(db, key, value, ttlMs) {
  db.prepare(`INSERT OR REPLACE INTO lookup_cache (key, value, expires_at) VALUES (?, ?, ?)`).run(
    key,
    JSON.stringify(value),
    Date.now() + ttlMs
  );
}
function cachePrune(db) {
  return db.prepare(`DELETE FROM lookup_cache WHERE expires_at < ?`).run(Date.now()).changes;
}

module.exports = { open, getMeta, setMeta, nextRev, currentRev, cacheGet, cacheSet, cachePrune, SCHEMA_VERSION };
