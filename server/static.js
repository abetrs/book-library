"use strict";
/* Static assets, built once at startup:
 *  - every file gets a content hash; index.html and sw.js reference assets as
 *    /app.js?v=<hash>, and those URLs are served `immutable` for a year;
 *  - text assets are pre-compressed (brotli + gzip) and served per Accept-Encoding;
 *  - everything else revalidates cheaply with ETags (304s).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const config = require("./config");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest)|image\/svg)/;

const hash = (buf) => crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12);

function compress(buf) {
  return {
    br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
    gzip: zlib.gzipSync(buf, { level: 9 }),
  };
}

function entry(urlPath, buf) {
  const mime = MIME[path.extname(urlPath)] || "application/octet-stream";
  const e = { urlPath, buf, mime, hash: hash(buf), etag: "" };
  e.etag = `"${e.hash}"`;
  if (COMPRESSIBLE.test(mime) && buf.length > 512) Object.assign(e, compress(buf));
  return e;
}

// Map of URL path -> asset. `/shared/*` comes from ../shared (also used by the server).
function build() {
  const assets = new Map();
  const add = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isFile() && !name.startsWith(".")) assets.set(prefix + name, { full, buf: fs.readFileSync(full) });
    }
  };
  add(path.join(config.root, "public"), "/");
  add(path.join(config.root, "shared"), "/shared/");

  const out = new Map();
  // Plain assets first so their hashes can be injected into the templates.
  for (const [p, a] of assets) if (p !== "/index.html" && p !== "/sw.js") out.set(p, entry(p, a.buf));
  const versioned = (p) => {
    const e = out.get(p);
    if (!e) throw new Error(`index.html references missing asset ${p}`);
    return `${p}?v=${e.hash}`;
  };
  const precache = [...out.keys()].filter((p) => /\.(js|css|svg)$/.test(p)).map(versioned);
  const version = hash(Buffer.from(precache.join("|")));

  // {{asset:/app.js}} -> /app.js?v=<hash>
  const html = assets.get("/index.html").buf.toString("utf8").replace(/\{\{asset:([^}]+)\}\}/g, (_, p) => versioned(p));
  out.set("/index.html", entry("/index.html", Buffer.from(html)));
  const sw = assets
    .get("/sw.js")
    .buf.toString("utf8")
    .replace('"__VERSION__"', JSON.stringify(version))
    .replace('"__PRECACHE__"', JSON.stringify(["/", ...precache]));
  out.set("/sw.js", entry("/sw.js", Buffer.from(sw)));
  return { assets: out, version };
}

function pickEncoding(req, e) {
  const ae = String(req.headers["accept-encoding"] || "");
  if (e.br && /\bbr\b/.test(ae)) return "br";
  if (e.gzip && /\bgzip\b/.test(ae)) return "gzip";
  return null;
}

// Returns true if handled.
function serve(req, res, built, pathname, query) {
  if (pathname === "/") pathname = "/index.html";
  const e = built.assets.get(pathname);
  if (!e) return false;
  const immutable = query.get("v") === e.hash;
  const headers = {
    "Content-Type": e.mime,
    ETag: e.etag,
    Vary: "Accept-Encoding",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  };
  if (pathname === "/sw.js") headers["Service-Worker-Allowed"] = "/";
  if (req.headers["if-none-match"] === e.etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const enc = pickEncoding(req, e);
  const body = enc ? e[enc] : e.buf;
  if (enc) headers["Content-Encoding"] = enc;
  headers["Content-Length"] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

// Compress a dynamic response body (API JSON) when worthwhile.
function sendBody(req, res, status, headers, body) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const ae = String(req.headers["accept-encoding"] || "");
  if (buf.length > 1024) {
    if (/\bbr\b/.test(ae)) {
      buf = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
      headers["Content-Encoding"] = "br";
    } else if (/\bgzip\b/.test(ae)) {
      buf = zlib.gzipSync(buf, { level: 6 });
      headers["Content-Encoding"] = "gzip";
    }
    headers.Vary = "Accept-Encoding";
  }
  headers["Content-Length"] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : buf);
}

module.exports = { build, serve, sendBody };
