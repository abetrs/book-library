"use strict";
/* All settings come from environment variables (see README / .env.example). */
const path = require("path");

const root = path.join(__dirname, "..");
const env = process.env;

const config = {
  root,
  host: env.HOST || "127.0.0.1",
  port: Number(env.PORT) || 8080,
  dataDir: path.resolve(root, env.DATA_DIR || "data"),
  // Optional single-user password. Without it the app is open to anyone who can reach it.
  password: env.LIBRARY_PASSWORD || "",
  // Signing key for session cookies; generated and stored in the database when unset.
  sessionSecret: env.SESSION_SECRET || "",
  sessionDays: Number(env.SESSION_DAYS) || 60,
  // Behind a TLS-terminating proxy, trust X-Forwarded-* for the client IP / https.
  trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY || ""),
  // Markdown export to load into an empty database on first start (defaults to the
  // repo's old library.md, if present).
  importOnStart: env.LIBRARY_IMPORT != null ? env.LIBRARY_IMPORT : path.join(root, "library.md"),
  // Contact for the User-Agent Open Library asks API clients to send.
  contact: env.CONTACT_EMAIL || "",
  // Upstream services (overridable for tests or mirrors).
  upstream: {
    openLibrary: (env.OPENLIBRARY_URL || "https://openlibrary.org").replace(/\/$/, ""),
    covers: (env.COVERS_URL || "https://covers.openlibrary.org").replace(/\/$/, ""),
    googleBooks: (env.GOOGLE_BOOKS_URL || "https://www.googleapis.com/books/v1").replace(/\/$/, ""),
    wikipedia: (env.WIKIPEDIA_URL || "https://en.wikipedia.org").replace(/\/$/, ""),
  },
  // Hosts the image proxy may fetch from (search-result thumbnails).
  imageHosts: (env.IMAGE_HOSTS || "covers.openlibrary.org,books.google.com,books.googleusercontent.com")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  log: env.LOG_LEVEL || "info",
};

config.dbFile = path.join(config.dataDir, "library.sqlite");
config.imageDir = path.join(config.dataDir, "images");

module.exports = config;
