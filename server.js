#!/usr/bin/env node
/* Local server for the Library app — no dependencies.
 *   node server.js            -> http://localhost:8000
 * Serves the site and lets the app read/write library.md in this folder
 * (GET/PUT /api/library). Commit library.md whenever you like.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DB = path.join(ROOT, "library.md");
const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    // Only answer to localhost names (blocks DNS-rebinding pages from reaching the API).
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/library") {
      res.setHeader("X-Library-Store", "local");
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "GET") {
        return fs.readFile(DB, "utf8", (err, text) => {
          res.writeHead(200, { "Content-Type": TYPES[".md"] });
          res.end(err ? "" : text);
        });
      }
      // PUT only: cross-site pages can't send one without a CORS preflight, which we never grant.
      if (req.method === "PUT") {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
          size += c.length;
          if (size > 20e6) req.destroy();
          else chunks.push(c);
        });
        req.on("end", () => {
          const tmp = DB + ".tmp";
          fs.writeFile(tmp, Buffer.concat(chunks), (err) => {
            if (err) {
              res.writeHead(500);
              return res.end(String(err));
            }
            fs.rename(tmp, DB, (err2) => {
              res.writeHead(err2 ? 500 : 204);
              res.end(err2 ? String(err2) : undefined);
            });
          });
        });
        return;
      }
      res.writeHead(405, { Allow: "GET, PUT" });
      return res.end();
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(ROOT, path.normalize(rel));
    if (!file.startsWith(ROOT + path.sep) || path.relative(ROOT, file).split(path.sep).some((p) => p.startsWith("."))) {
      res.writeHead(404);
      return res.end("Not found");
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`Library → http://localhost:${PORT}\nSaving to ${DB}`);
  });
