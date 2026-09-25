"use strict";
/* HTTP routing: JSON API, covers, static assets. `createApp` is separate from
 * listening so tests can drive it directly.
 */
const Books = require("./books");
const Lookup = require("./lookup");
const Images = require("./images");
const Static = require("./static");
const Auth = require("./auth");
const { currentRev } = require("./db");
const { UpstreamError } = require("./net");
const { isValidIsbn } = require("../shared/dedupe");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function jsonBody(req, limit = 64 * 1024) {
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || "")))
    throw new HttpError(415, "expected application/json");
  const text = await readBody(req, limit);
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    throw new HttpError(400, "invalid JSON");
  }
}

function createApp({ db, worker = { kick() {} }, log = console }) {
  let built = Static.build();

  const json = (req, res, status, obj, extra = {}) =>
    Static.sendBody(req, res, status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }, JSON.stringify(obj));

  // Covers for freshly added books are fetched in the background so they're
  // already on disk by the time the page asks.
  let warmQueue = Promise.resolve();
  const warm = (keys) => {
    if (!keys.length) return;
    warmQueue = warmQueue.then(() => Images.prefetchCovers(db, keys)).catch(() => {});
  };
  const newCoverKeys = (sinceRev) =>
    db.prepare(`SELECT DISTINCT cover_key FROM books WHERE rev > ?`).all(sinceRev).map((r) => r.cover_key);

  const routes = [
    // ---- session ----
    ["GET", /^\/api\/session$/, (req, res) => json(req, res, 200, { required: Auth.enabled(), ok: Auth.isAuthed(req) }), { open: true }],
    [
      "POST", /^\/api\/login$/,
      async (req, res) => {
        const body = await jsonBody(req);
        if (!Auth.enabled()) return json(req, res, 200, { ok: true });
        const r = Auth.login(req, body.password);
        json(req, res, r.status, r.ok ? { ok: true } : { error: r.error }, r.cookie ? { "Set-Cookie": r.cookie } : {});
      },
      { open: true },
    ],
    ["POST", /^\/api\/logout$/, (req, res) => json(req, res, 200, { ok: true }, { "Set-Cookie": Auth.logoutCookie(req) }), { open: true }],

    // ---- books ----
    [
      "GET", /^\/api\/books$/,
      (req, res, m, q) => {
        const since = q.has("since") ? Number(q.get("since")) : null;
        const rev = currentRev(db);
        // Full listings are cacheable by revision: unchanged library -> 304, no body.
        const etag = `W/"lib-${rev}"`;
        if (since == null && req.headers["if-none-match"] === etag) {
          res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
          return res.end();
        }
        json(req, res, 200, Books.listBooks(db, since), since == null ? { ETag: etag, "Cache-Control": "no-cache" } : {});
      },
    ],
    [
      "POST", /^\/api\/books$/,
      async (req, res) => {
        const before = currentRev(db);
        const r = Books.createBook(db, await jsonBody(req));
        worker.kick();
        warm(newCoverKeys(before));
        json(req, res, r.duplicate ? 200 : 201, { ...r, rev: currentRev(db) });
      },
    ],
    [
      "PATCH", /^\/api\/books\/(\d+)$/,
      async (req, res, m) => {
        const b = Books.updateBook(db, Number(m[1]), await jsonBody(req));
        if (!b) throw new HttpError(404, "no such book");
        worker.kick();
        json(req, res, 200, { book: b, rev: currentRev(db) });
      },
    ],
    [
      "DELETE", /^\/api\/books\/(\d+)$/,
      (req, res, m) => {
        const r = Books.deleteBook(db, Number(m[1]));
        if (!r) throw new HttpError(404, "no such book");
        json(req, res, 200, { deleted: r.id, title: r.title, rev: currentRev(db) });
      },
    ],
    [
      "GET", /^\/api\/books\/(\d+)\/summary$/,
      async (req, res, m) => {
        const b = Books.getBook(db, Number(m[1]));
        if (!b) throw new HttpError(404, "no such book");
        const summary = await Lookup.summary(db, b);
        json(req, res, 200, { summary }, { "Cache-Control": "private, max-age=86400" });
      },
    ],

    // ---- bulk ----
    [
      "POST", /^\/api\/import$/,
      async (req, res) => {
        const body = await jsonBody(req, 20 * 1024 * 1024);
        const before = currentRev(db);
        let r;
        if (body.format === "export") r = Books.importExport(db, String(body.text || ""));
        else if (body.format === "json") {
          if (!Array.isArray(body.books)) throw new HttpError(400, "books must be an array");
          r = Books.importBooks(db, body.list, body.books);
        } else r = Books.importText(db, body.list, body.format, body.text);
        worker.kick();
        warm(newCoverKeys(before));
        json(req, res, 200, { ...r, rev: currentRev(db) });
      },
    ],
    [
      "POST", /^\/api\/clear$/,
      async (req, res) => {
        const body = await jsonBody(req);
        const n = Books.clearBooks(db, body.scope, body.confirm);
        json(req, res, 200, { deleted: n, rev: currentRev(db) });
      },
    ],
    [
      "GET", /^\/api\/export$/,
      (req, res) => {
        const day = new Date().toISOString().slice(0, 10);
        Static.sendBody(req, res, 200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="library-${day}.md"`,
          "Cache-Control": "no-store",
        }, Books.exportMarkdown(db));
      },
    ],

    // ---- catalog lookups (add-book form) ----
    [
      "GET", /^\/api\/lookup\/isbn\/([0-9Xx-]{10,17})$/,
      async (req, res, m) => {
        const code = m[1].replace(/-/g, "").toUpperCase();
        if (!isValidIsbn(code)) throw new HttpError(400, "not a valid ISBN");
        json(req, res, 200, { result: await Lookup.isbn(db, code) }, { "Cache-Control": "private, max-age=3600" });
      },
    ],
    [
      "GET", /^\/api\/lookup\/search$/,
      async (req, res, m, q) => {
        const title = String(q.get("title") || "").trim().slice(0, 300);
        const author = String(q.get("author") || "").trim().slice(0, 300);
        if (!title) throw new HttpError(400, "title is required");
        json(req, res, 200, { results: await Lookup.search(db, title, author) }, { "Cache-Control": "private, max-age=3600" });
      },
    ],

    // ---- status ----
    [
      "GET", /^\/api\/status$/,
      (req, res) =>
        json(req, res, 200, {
          rev: currentRev(db),
          books: Books.countBooks(db, "all"),
          pending: Books.pendingCount(db),
          images: Images.stats(db),
          version: built.version,
        }),
    ],

    // ---- images ----
    ["GET", /^\/covers\/([0-9a-f]{24})\.jpg$/, (req, res, m) => Images.serveCover(db, req, res, m[1])],
    ["GET", /^\/img$/, (req, res, m, q) => Images.serveProxy(db, req, res, String(q.get("u") || ""))],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const { pathname } = url;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    if (pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      return res.end("ok");
    }

    const method = req.method === "HEAD" ? "GET" : req.method;
    for (const [meth, re, fn, opts = {}] of routes) {
      const m = pathname.match(re);
      if (!m) continue;
      if (meth !== method) continue;
      if (!opts.open && !Auth.isAuthed(req)) throw new HttpError(401, "login required");
      // Writes must come from our own page: a custom header forces a CORS
      // preflight that we never approve, which blocks cross-site forgeries.
      if (method !== "GET" && req.headers["x-library"] !== "1") throw new HttpError(403, "missing X-Library header");
      return await fn(req, res, m, url.searchParams);
    }
    if (pathname.startsWith("/api/")) throw new HttpError(404, "not found");
    if (method === "GET" && Static.serve(req, res, built, pathname, url.searchParams)) return;
    throw new HttpError(404, "not found");
  }

  const app = (req, res) => {
    handle(req, res).catch((e) => {
      let status = e.status || 500;
      let message = e.message;
      if (e instanceof Books.InputError) status = 400;
      else if (e instanceof UpstreamError) [status, message] = [502, "Couldn't reach the book catalogs"];
      else if (!(e instanceof HttpError)) {
        log.error("request failed:", req.method, req.url, e);
        message = "internal error";
      }
      if (res.headersSent) return res.destroy();
      json(req, res, status, { error: message, offline: e instanceof UpstreamError });
    });
  };
  app.rebuildAssets = () => (built = Static.build());
  return app;
}

module.exports = { createApp };
