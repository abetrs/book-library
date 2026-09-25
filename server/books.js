"use strict";
/* The library: validation, duplicate-aware writes, imports, export, deltas. */
const crypto = require("crypto");
const { nextRev, currentRev } = require("./db");
const { cleanDdc } = require("../shared/ddc");
const { normTitle, surname, isbnKey, bookKeys } = require("../shared/dedupe");
const ListFormat = require("../shared/listfmt");

const LISTS = ["reading", "goodreads"];

/* ---------------- rows <-> API objects ---------------- */
function toBook(r) {
  return {
    id: r.id,
    list: r.list,
    position: r.position,
    title: r.title,
    author: r.author,
    category: r.category,
    subcategory: r.subcategory,
    subsubcategory: r.subsubcategory,
    read: !!r.read,
    primary: !!r.is_primary,
    custom: !!r.custom,
    rating: r.rating,
    isbn: r.isbn,
    note: r.note,
    ddc: r.ddc,
    ddcSrc: r.ddc_src,
    genres: JSON.parse(r.genres || "[]"),
    classified: !!r.classified,
    cover: r.cover_key,
  };
}

// Stable key for a book's cover image: the edition (ISBN) if known, else author + title.
function coverKey(b) {
  const ik = isbnKey(b.isbn);
  const k = ik || "t:" + surname(b.author) + "|" + normTitle(b.title);
  return crypto.createHash("sha1").update(k).digest("hex").slice(0, 24);
}

/* ---------------- validation ---------------- */
class InputError extends Error {}

const str = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

// Clean user input into column values. `partial` allows omitting fields (PATCH).
function clean(input, partial = false) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has("title")) {
    out.title = str(input.title, 500);
    if (!out.title) throw new InputError("title is required");
  }
  if (!partial || has("author")) out.author = str(input.author, 300);
  if (!partial || has("category")) out.category = str(input.category, 200) || "Uncategorized";
  if (!partial || has("subcategory")) out.subcategory = str(input.subcategory, 200);
  if (!partial || has("subsubcategory")) out.subsubcategory = str(input.subsubcategory, 300);
  if (!partial || has("note")) out.note = str(input.note, 1000);
  if (!partial || has("isbn")) out.isbn = String(input.isbn || "").replace(/[^0-9Xx]/g, "").toUpperCase().slice(0, 13);
  if (!partial || has("rating")) out.rating = Math.max(0, Math.min(5, Math.round(Number(input.rating) || 0)));
  for (const [k, col] of [["read", "read"], ["primary", "is_primary"], ["custom", "custom"]])
    if (!partial || has(k)) out[col] = input[k] ? 1 : 0;
  if (has("ddc")) {
    if (input.ddc === null || input.ddc === "") {
      out.ddc = "";
      out.ddc_src = "";
    } else {
      const n = cleanDdc(input.ddc);
      if (!n) throw new InputError("not a Dewey number");
      out.ddc = n;
      const src = input.ddcSrc === "ol" || input.ddcSrc === "est" ? input.ddcSrc : "manual";
      out.ddc_src = src;
    }
  }
  if (!partial || has("list")) {
    if (!LISTS.includes(input.list)) throw new InputError("list must be 'reading' or 'goodreads'");
    out.list = input.list;
  }
  return out;
}

/* ---------------- reads ---------------- */
function getBook(db, id) {
  const r = db.prepare(`SELECT * FROM books WHERE id = ?`).get(id);
  return r ? toBook(r) : null;
}

function pendingCount(db) {
  return db.prepare(`SELECT COUNT(*) n FROM books WHERE classified = 0`).get().n;
}

// Everything, or only what changed after revision `since`.
function listBooks(db, since) {
  const rev = currentRev(db);
  const pending = pendingCount(db);
  if (since == null || !(since >= 0) || since > rev) {
    const books = db.prepare(`SELECT * FROM books ORDER BY list, position, id`).all().map(toBook);
    return { rev, full: true, pending, books, deleted: [] };
  }
  const books = db.prepare(`SELECT * FROM books WHERE rev > ? ORDER BY list, position, id`).all(since).map(toBook);
  const deleted = db.prepare(`SELECT id FROM deletions WHERE rev > ?`).all(since).map((r) => r.id);
  return { rev, full: false, pending, books, deleted };
}

/* ---------------- duplicate detection ---------------- */
function listIndex(db, list) {
  const idx = new Map();
  for (const r of db.prepare(`SELECT id, title, author, isbn FROM books WHERE list = ?`).all(list))
    for (const k of bookKeys(r)) if (!idx.has(k)) idx.set(k, r.id);
  return idx;
}
function findDup(idx, b) {
  for (const k of bookKeys(b)) if (idx.has(k)) return idx.get(k);
  return null;
}

// Fold what a duplicate knows into the kept row (same rules as before: read/primary
// stick, best rating wins, missing ISBN/note filled, your Dewey number wins).
function mergeInto(db, id, dup, rev) {
  const keep = db.prepare(`SELECT * FROM books WHERE id = ?`).get(id);
  const upd = {
    read: keep.read || dup.read ? 1 : 0,
    is_primary: keep.is_primary || dup.is_primary ? 1 : 0,
    rating: Math.max(keep.rating, dup.rating || 0),
    isbn: keep.isbn || dup.isbn || "",
    note: keep.note || dup.note || "",
    ddc: keep.ddc,
    ddc_src: keep.ddc_src,
  };
  if (dup.ddc && (!keep.ddc || (dup.ddc_src === "manual" && keep.ddc_src !== "manual"))) {
    upd.ddc = dup.ddc;
    upd.ddc_src = dup.ddc_src || "manual";
  }
  const changed = Object.keys(upd).some((k) => upd[k] !== keep[k]);
  if (!changed) return false;
  db.prepare(
    `UPDATE books SET read=@read, is_primary=@is_primary, rating=@rating, isbn=@isbn, note=@note,
       ddc=@ddc, ddc_src=@ddc_src, rev=@rev, updated_at=@now WHERE id=@id`
  ).run({ ...upd, rev, now: Date.now(), id });
  return true;
}

/* ---------------- writes ---------------- */
function insertRow(db, c, position, rev) {
  const now = Date.now();
  const row = {
    author: "", category: "Uncategorized", subcategory: "", subsubcategory: "", note: "", isbn: "",
    rating: 0, read: 0, is_primary: 0, custom: 0, ddc: "", ddc_src: "",
    ...c,
  };
  row.cover_key = coverKey(row);
  const info = db
    .prepare(
      `INSERT INTO books (list, position, title, author, category, subcategory, subsubcategory, read, is_primary,
         custom, rating, isbn, note, ddc, ddc_src, cover_key, rev, created_at, updated_at)
       VALUES (@list, @position, @title, @author, @category, @subcategory, @subsubcategory, @read, @is_primary,
         @custom, @rating, @isbn, @note, @ddc, @ddc_src, @cover_key, @rev, @now, @now)`
    )
    .run({ ...row, position, rev, now });
  return Number(info.lastInsertRowid);
}

// Add one book (from the form). New books go to the top of the curated order.
// A duplicate is merged into the existing entry instead.
function createBook(db, input) {
  const c = clean(input);
  return db.transaction(() => {
    const rev = nextRev(db);
    const dupId = findDup(listIndex(db, c.list), c);
    if (dupId) {
      mergeInto(db, dupId, c, rev);
      return { book: getBook(db, dupId), duplicate: true };
    }
    const min = db.prepare(`SELECT MIN(position) p FROM books WHERE list = ?`).get(c.list).p;
    const id = insertRow(db, c, (min == null ? 0 : min) - 1, rev);
    return { book: getBook(db, id), duplicate: false };
  })();
}

function updateBook(db, id, patch) {
  const c = clean(patch, true);
  delete c.list; // moving between lists isn't a thing
  return db.transaction(() => {
    const cur = db.prepare(`SELECT * FROM books WHERE id = ?`).get(id);
    if (!cur) return null;
    const next = { ...cur, ...c };
    // Clearing the Dewey number means "classify it again".
    if ("ddc" in c && !c.ddc) next.classified = 0;
    // A changed identity invalidates lookups tied to the old title/ISBN.
    const idChanged = next.title !== cur.title || next.author !== cur.author || next.isbn !== cur.isbn || next.custom !== cur.custom;
    if (idChanged) {
      next.classified = 0;
      next.classify_after = 0;
      if (cur.ddc_src !== "manual" && !("ddc" in c)) [next.ddc, next.ddc_src] = ["", ""];
    }
    next.cover_key = coverKey(next);
    next.rev = nextRev(db);
    next.updated_at = Date.now();
    db.prepare(
      `UPDATE books SET title=@title, author=@author, category=@category, subcategory=@subcategory,
         subsubcategory=@subsubcategory, read=@read, is_primary=@is_primary, custom=@custom, rating=@rating,
         isbn=@isbn, note=@note, ddc=@ddc, ddc_src=@ddc_src, classified=@classified,
         classify_after=@classify_after, cover_key=@cover_key, rev=@rev, updated_at=@updated_at WHERE id=@id`
    ).run(next);
    return getBook(db, id);
  })();
}

function deleteBook(db, id) {
  return db.transaction(() => {
    const r = db.prepare(`SELECT id, title FROM books WHERE id = ?`).get(id);
    if (!r) return null;
    const rev = nextRev(db);
    db.prepare(`DELETE FROM books WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO deletions (id, rev) VALUES (?, ?)`).run(id, rev);
    return r;
  })();
}

// Append many books to a list, skipping duplicates of existing entries and of
// each other (their details are merged into the kept entry).
function importBooks(db, list, books) {
  if (!LISTS.includes(list)) throw new InputError("list must be 'reading' or 'goodreads'");
  return db.transaction(() => {
    const rev = nextRev(db);
    const idx = listIndex(db, list);
    let pos = (db.prepare(`SELECT MAX(position) p FROM books WHERE list = ?`).get(list).p ?? -1) + 1;
    let added = 0,
      dup = 0,
      skipped = 0;
    for (const raw of books) {
      let c;
      try {
        c = clean({ ...raw, list });
      } catch (e) {
        skipped++;
        continue;
      }
      const hit = findDup(idx, c);
      if (hit) {
        mergeInto(db, hit, c, rev);
        dup++;
        continue;
      }
      const id = insertRow(db, c, pos++, rev);
      for (const k of bookKeys(c)) if (!idx.has(k)) idx.set(k, id);
      added++;
    }
    return { added, dup, skipped };
  })();
}

// Parse an upload (Markdown list, Goodreads CSV, or JSON array) and import it.
function importText(db, list, format, text) {
  let books;
  if (format === "csv") books = ListFormat.parseGoodreadsCsv(String(text || ""));
  else if (format === "markdown") books = ListFormat.parseList(String(text || ""));
  else throw new InputError("format must be 'csv' or 'markdown'");
  if (!books.length) throw new InputError(format === "csv" ? "No books found in that CSV." : "No books found in that list.");
  return importBooks(db, list, books);
}

// Restore a full export (both lists).
function importExport(db, text) {
  const parsed = ListFormat.parseDatabase(text);
  const r = importBooks(db, "reading", parsed.reading);
  const g = importBooks(db, "goodreads", parsed.goodreads);
  return { added: r.added + g.added, dup: r.dup + g.dup, skipped: r.skipped + g.skipped };
}

function countBooks(db, scope) {
  if (scope === "all") return db.prepare(`SELECT COUNT(*) n FROM books`).get().n;
  return db.prepare(`SELECT COUNT(*) n FROM books WHERE list = ?`).get(scope).n;
}
const clearPhrase = (n) => `delete ${n} book${n === 1 ? "" : "s"}`;

// Clear a list or everything. The caller must echo the confirmation phrase for
// the current count, so a stale or scripted request can't wipe the library.
function clearBooks(db, scope, confirm) {
  if (!["all", ...LISTS].includes(scope)) throw new InputError("scope must be all, reading or goodreads");
  return db.transaction(() => {
    const n = countBooks(db, scope);
    if (String(confirm || "").trim().toLowerCase() !== clearPhrase(n))
      throw new InputError(`confirmation must be "${clearPhrase(n)}"`);
    const rev = nextRev(db);
    const where = scope === "all" ? "" : "WHERE list = ?";
    const args = scope === "all" ? [] : [scope];
    db.prepare(`INSERT INTO deletions (id, rev) SELECT id, ${rev} FROM books ${where}`).run(...args);
    db.prepare(`DELETE FROM books ${where}`).run(...args);
    return n;
  })();
}

function exportMarkdown(db) {
  const all = db.prepare(`SELECT * FROM books ORDER BY list, position, id`).all().map(toBook);
  return ListFormat.serialize({
    reading: all.filter((b) => b.list === "reading"),
    goodreads: all.filter((b) => b.list === "goodreads"),
  });
}

/* ---------------- classification results ---------------- */
function pendingBooks(db, limit) {
  return db
    .prepare(`SELECT * FROM books WHERE classified = 0 AND classify_after <= ? ORDER BY list, position LIMIT ?`)
    .all(Date.now(), limit)
    .map(toBook);
}

// Store lookup results. Never replaces your own number, and never trades a
// catalog number for an estimate.
function applyClassification(db, id, m) {
  return db.transaction(() => {
    const cur = db.prepare(`SELECT * FROM books WHERE id = ?`).get(id);
    if (!cur) return;
    let ddc = cur.ddc,
      src = cur.ddc_src;
    const keep = src === "manual" || !m.d || (src === "ol" && m.e);
    if (!keep) [ddc, src] = [m.d, m.e ? "est" : "ol"];
    const genres = JSON.stringify(m.g || []);
    db.prepare(
      `UPDATE books SET ddc=?, ddc_src=?, genres=?, classified=1, rev=?, updated_at=? WHERE id=?`
    ).run(ddc, src, genres, nextRev(db), Date.now(), id);
  })();
}
// Lookup failed (offline, rate-limited): try again later without bumping the revision.
function deferClassification(db, id, ms) {
  db.prepare(`UPDATE books SET classify_after = ? WHERE id = ?`).run(Date.now() + ms, id);
}

module.exports = {
  InputError, LISTS, toBook, coverKey, clean,
  getBook, listBooks, pendingCount, createBook, updateBook, deleteBook,
  importBooks, importText, importExport, countBooks, clearPhrase, clearBooks, exportMarkdown,
  pendingBooks, applyClassification, deferClassification,
};
