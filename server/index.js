#!/usr/bin/env node
"use strict";
/* Library server entry point.  `npm start`  (settings: see README / .env.example) */
const fs = require("fs");
const http = require("http");
const config = require("./config");
const DB = require("./db");
const Books = require("./books");
const Auth = require("./auth");
const Images = require("./images");
const { startWorker } = require("./classify");
const { createApp } = require("./app");

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  error: (...a) => console.error(new Date().toISOString(), ...a),
};

const db = DB.open(config.dbFile);
Auth.init(db);

// First start: load an existing Markdown export (e.g. the old library.md) into the empty database.
if (config.importOnStart && Books.countBooks(db, "all") === 0 && !DB.getMeta(db, "imported_from")) {
  if (fs.existsSync(config.importOnStart)) {
    const r = Books.importExport(db, fs.readFileSync(config.importOnStart, "utf8"));
    DB.setMeta(db, "imported_from", config.importOnStart);
    if (r.added) log.info(`imported ${r.added} books from ${config.importOnStart}`);
  }
}

const worker = startWorker(db, { log: log.error });
const app = createApp({ db, worker, log });
const server = http.createServer(app);
server.keepAliveTimeout = 65e3;

// Background upkeep: fetch covers nobody has viewed yet (so first views are
// instant), and drop expired lookup-cache rows.
const upkeep = setInterval(() => {
  const missing = db
    .prepare(`SELECT DISTINCT b.cover_key k FROM books b LEFT JOIN images i ON i.key = 'c:' || b.cover_key WHERE i.key IS NULL AND b.custom = 0 LIMIT 25`)
    .all()
    .map((r) => r.k);
  if (missing.length) Images.prefetchCovers(db, missing).catch(() => {});
  DB.cachePrune(db);
}, 5 * 60e3);
upkeep.unref();

server.listen(config.port, config.host, () => {
  log.info(`Library on http://${config.host}:${config.port}  (data: ${config.dataDir})`);
  const local = ["127.0.0.1", "localhost", "::1"].includes(config.host);
  if (!local && !config.password)
    log.info("WARNING: listening on a public interface with no LIBRARY_PASSWORD — anyone who can reach it can edit your library.");
});

function shutdown(sig) {
  log.info(`${sig}: shutting down`);
  worker.stop();
  clearInterval(upkeep);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
