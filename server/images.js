"use strict";
/* Cover + thumbnail cache.
 *
 * /covers/<key>.jpg — a book's cover. <key> is the book's cover_key (derived from
 *   its ISBN or author + title), so the URL never changes for a given cover and is
 *   served `immutable`: browsers fetch each cover once, ever.
 * /img?u=<url>      — search-result thumbnails from allowlisted hosts only.
 *
 * Images are downloaded once, written to DATA_DIR/images, and indexed in the
 * `images` table. Misses are remembered too (retried after a week) so missing
 * covers don't trigger lookups on every page load. Concurrent requests for the
 * same image share one download.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const { request, getJson, UpstreamError } = require("./net");

const MISS_RETRY_MS = 7 * 864e5;
const MAX_BYTES = 5 * 1024 * 1024;
const inflight = new Map();

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

function filePath(key, ext) {
  return path.join(config.imageDir, key.slice(0, 2), `${key}.${ext}`);
}

// Download an image URL. Returns {buf, mime} or null (not an image / not found).
async function download(url) {
  const r = await request(url, { headers: { Accept: "image/*" }, timeout: 15000 });
  if (!r.ok) {
    if (r.status >= 500 || r.status === 429) throw new UpstreamError(`HTTP ${r.status}`, r.status);
    return null;
  }
  const mime = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  // Open Library answers some misses with a 1×1 placeholder; real covers are bigger.
  if (buf.length < 1000 || buf.length > MAX_BYTES) return null;
  return { buf, mime };
}

// Where to find a book's cover: exact edition first, then the work, then Google Books.
async function findCover(b) {
  if (b.custom) return null;
  const C = config.upstream.covers;
  const isbn = (b.isbn || "").replace(/[^0-9Xx]/g, "");
  let reached = false;
  const tryUrl = async (url) => {
    try {
      const img = await download(url);
      reached = true;
      return img;
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      return null;
    }
  };
  if (isbn) {
    const img = await tryUrl(`${C}/b/isbn/${isbn}-M.jpg?default=false`);
    if (img) return img;
  }
  try {
    const p = new URLSearchParams({ title: b.title, limit: "1", fields: "cover_i,isbn" });
    if (b.author) p.set("author", b.author);
    const j = await getJson(`${config.upstream.openLibrary}/search.json?${p}`);
    reached = true;
    const doc = j && j.docs && j.docs[0];
    if (doc && doc.cover_i) {
      const img = await tryUrl(`${C}/b/id/${doc.cover_i}-M.jpg`);
      if (img) return img;
    }
    if (doc && doc.isbn && doc.isbn[0]) {
      const img = await tryUrl(`${C}/b/isbn/${doc.isbn[0]}-M.jpg?default=false`);
      if (img) return img;
    }
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
  }
  try {
    const q = [`intitle:${b.title}`, b.author && `inauthor:${b.author}`].filter(Boolean).join(" ");
    const j = await getJson(`${config.upstream.googleBooks}/volumes?q=${encodeURIComponent(q)}&maxResults=1&printType=books`);
    reached = true;
    const links = j && j.items && j.items[0] && j.items[0].volumeInfo && j.items[0].volumeInfo.imageLinks;
    const url = links && (links.thumbnail || links.smallThumbnail);
    if (url) {
      const img = await tryUrl(url.replace(/^http:/, "https:").replace(/&edge=curl/, ""));
      if (img) return img;
    }
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
  }
  if (!reached) throw new UpstreamError("cover sources unreachable");
  return null;
}

function store(db, key, img) {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }[img.mime];
  const file = filePath(key, ext);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, img.buf);
  fs.renameSync(tmp, file);
  const row = {
    key,
    status: "ok",
    file: path.relative(config.imageDir, file),
    mime: img.mime,
    bytes: img.buf.length,
    etag: '"' + sha1(img.buf).slice(0, 16) + '"',
    fetched_at: Date.now(),
  };
  db.prepare(
    `INSERT OR REPLACE INTO images (key, status, file, mime, bytes, etag, fetched_at)
     VALUES (@key, @status, @file, @mime, @bytes, @etag, @fetched_at)`
  ).run(row);
  return row;
}
function storeMiss(db, key) {
  db.prepare(`INSERT OR REPLACE INTO images (key, status, fetched_at) VALUES (?, 'none', ?)`).run(key, Date.now());
  return { key, status: "none" };
}

// Cached row, or fetch once (shared between concurrent callers).
async function resolve(db, key, fetcher) {
  const row = db.prepare(`SELECT * FROM images WHERE key = ?`).get(key);
  if (row && row.status === "ok" && fs.existsSync(path.join(config.imageDir, row.file))) return row;
  if (row && row.status === "none" && Date.now() - row.fetched_at < MISS_RETRY_MS) return row;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const img = await fetcher();
      return img ? store(db, key, img) : storeMiss(db, key);
    } catch (e) {
      if (e instanceof UpstreamError) return null; // unreachable: don't remember as a miss
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

function send(req, res, row) {
  if (!row || row.status !== "ok") {
    // Short cache for misses so a cover found later shows up within a day.
    res.writeHead(404, { "Cache-Control": row ? "private, max-age=86400" : "no-store", "Content-Type": "text/plain" });
    return res.end("no image");
  }
  const headers = {
    "Content-Type": row.mime,
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: row.etag,
  };
  if (req.headers["if-none-match"] === row.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, "Content-Length": row.bytes });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(path.join(config.imageDir, row.file)).pipe(res);
}

async function serveCover(db, req, res, coverKey) {
  if (!/^[0-9a-f]{24}$/.test(coverKey)) return send(req, res, { status: "none" });
  const b = db.prepare(`SELECT title, author, isbn, custom FROM books WHERE cover_key = ? LIMIT 1`).get(coverKey);
  const key = "c:" + coverKey;
  if (!b) {
    // book deleted: still serve a cached image, never fetch
    const row = db.prepare(`SELECT * FROM images WHERE key = ?`).get(key);
    return send(req, res, row && row.status === "ok" ? row : { status: "none" });
  }
  send(req, res, await resolve(db, key, () => findCover(b)));
}

// https on an allowlisted host, or the configured cover service itself.
function allowedImageUrl(u) {
  try {
    const url = new URL(u);
    if (url.origin === new URL(config.upstream.covers).origin) return url.toString();
    return url.protocol === "https:" && config.imageHosts.includes(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch (e) {
    return null;
  }
}

async function serveProxy(db, req, res, u) {
  const url = allowedImageUrl(u);
  if (!url) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("image host not allowed");
  }
  send(req, res, await resolve(db, "u:" + sha1(url), () => download(url)));
}

// Warm the cache ahead of time (used after imports) so first views are instant.
async function prefetchCovers(db, keys) {
  for (const k of keys) {
    const b = db.prepare(`SELECT title, author, isbn, custom FROM books WHERE cover_key = ? LIMIT 1`).get(k);
    if (b) await resolve(db, "c:" + k, () => findCover(b)).catch(() => {});
  }
}

function stats(db) {
  return db.prepare(`SELECT status, COUNT(*) n, COALESCE(SUM(bytes), 0) bytes FROM images GROUP BY status`).all();
}

module.exports = { serveCover, serveProxy, prefetchCovers, allowedImageUrl, stats };
