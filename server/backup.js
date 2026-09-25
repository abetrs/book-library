#!/usr/bin/env node
"use strict";
/* Online backup of the library database (safe while the server is running).
 *   npm run backup                 -> data/backups/library-<timestamp>.sqlite
 *   npm run backup -- /some/file   -> that file
 * For a human-readable copy, use "Export backup" in the app (Markdown).
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("./config");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dest = path.resolve(process.argv[2] || path.join(config.dataDir, "backups", `library-${stamp}.sqlite`));
fs.mkdirSync(path.dirname(dest), { recursive: true });
const db = new Database(config.dbFile, { readonly: true, fileMustExist: true });
db.backup(dest)
  .then(() => {
    console.log(`backed up ${config.dbFile} -> ${dest}`);
    db.close();
  })
  .catch((e) => {
    console.error("backup failed:", e.message);
    process.exit(1);
  });
