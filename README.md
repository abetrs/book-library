# Library

A self-hosted personal library: a curated reading list and your Goodreads library in one place,
shelved by **Dewey Decimal Classification**, searchable by Dewey number, subject, author and read
status, with covers pulled from [Open Library](https://openlibrary.org/). Runs as a small Node
server with a **SQLite** database, meant for your own server.

## Features

- **Two lists.** A curated **Reading List** and your **Goodreads** library.
- **Dewey Decimal organization.** Every book gets a detailed DDC number (e.g. `891.73`), shown on
  its card and in its popup with the full class › division › section path. Books are shelved in
  Dewey order under division headings, with class → division → section chips.
  - **Catalog numbers** come from Open Library's library records (the edition by ISBN, then
    matching editions), picking the most-cited section and its most detailed form.
  - **Estimated numbers** (`~`) fill the gaps from subjects, genres and your category — e.g.
    "Russian fiction" → 891.73. Literature is classed by original language + form.
  - **Your numbers** — set or change any book's number in its popup (type it, or pick by
    category); yours always win. **Reset** sends it back through classification.
- **Search by Dewey number** in the Dewey box or the main search: `8`/`800` (the class),
  `82`/`820`/`82x` (a division), `823`, `823.8` (and everything under it), `320.` (exactly that
  section), or a range like `300-399`.
- **Find by category** — build a number step by step (class → division → section → decimals).
- **DDC guide** — how to read a number, the search syntax, the literature pattern, and the full
  outline of 10 classes / 100 divisions / 1,000 sections with your book counts.
- **No duplicates.** Every upload skips books you already have: same ISBN (ISBN-10 and -13
  unified) or same author surname + title (ignoring case, accents, leading articles, subtitles and
  Goodreads series tags). Details from the duplicate are merged into the kept entry.
- **Add books quickly.** Paste an ISBN and the title and author fill themselves in. Typed a title
  instead? It's checked against Open Library and Google Books: an exact match is added straight
  away; otherwise **"Did you mean…"** shows the real books, or keep yours as a **custom book**.
- **Imports:** Goodreads CSV export, Markdown lists (headings, bold lines, `Label:` bullets and
  bullets with nested items are categories, never books), or a full backup.
- **Export backup** — the whole library as one readable Markdown file; restore it with
  **Import list**.
- **Clear library** — everything, or one list. Offers a backup first, then asks you to type
  `delete N books` and waits out a countdown; the server checks the phrase too.
- **Optional password** — single-user login with a signed, HttpOnly session cookie.
- Light & dark, responsive, installable (web app manifest).

## Run it

Requires Node 20+.

```sh
npm install
npm start            # http://127.0.0.1:8080
```

The database and image cache go in `./data` (`library.sqlite`, `images/`).

### On a server

**Docker Compose** (recommended):

```sh
cp .env.example .env        # set LIBRARY_PASSWORD
docker compose up -d --build
```

It listens on `127.0.0.1:8080`; put a TLS reverse proxy in front — see
[`deploy/Caddyfile`](deploy/Caddyfile) (automatic HTTPS) or [`deploy/nginx.conf`](deploy/nginx.conf).
Data lives in `./data` next to the compose file.

**systemd:** clone to `/opt/book-library`, `npm ci --omit=dev`, create `.env`, and install
[`deploy/library.service`](deploy/library.service).

### Settings (`.env`)

| Variable | Default | |
| --- | --- | --- |
| `LIBRARY_PASSWORD` | *(empty)* | Password for the app. **Set this on any server.** Changing it logs everyone out. |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | Where to listen. |
| `DATA_DIR` | `./data` | Database + image cache. |
| `TRUST_PROXY` | `false` | `true` behind a TLS proxy (client IPs for login rate-limiting, `Secure` cookies). |
| `SESSION_DAYS` | `60` | How long a login lasts. |
| `SESSION_SECRET` | *(generated)* | Cookie signing key; generated and stored in the database if unset. |
| `CONTACT_EMAIL` | *(empty)* | Added to the User-Agent, as Open Library asks of API clients. |
| `LIBRARY_IMPORT` | `./library.md` | A Markdown export loaded into an **empty** database on first start. |

### Backups

- `npm run backup` — consistent online copy of the SQLite database to `data/backups/`
  (safe while running). `npm run backup -- /path/file.sqlite` for a specific file.
- **Export backup** in the app — a human-readable Markdown file you can re-import anywhere.

### Moving from the old static version

- A `library.md` from the GitHub-hosted version: put it at the repo root (or point
  `LIBRARY_IMPORT` at it) before the first start and it's imported automatically — or use
  **Import list** in the app with the file.
- Books an older version kept in your browser's storage are moved into the database the first
  time you open the new app in that browser.

## Performance & caching

Built for fast repeat loads:

- **Covers are scraped once.** The server finds each cover (edition ISBN → Open Library work →
  Google Books), stores it on disk and serves it from `/covers/<key>.jpg`. The key is derived from
  the book's ISBN or author + title, so the URL never changes and is served
  `Cache-Control: immutable` — the browser downloads each cover once, ever. Misses are remembered
  for a week, so books without covers don't trigger lookups on every visit. Covers for newly
  imported books are fetched in the background so they're ready when you look.
- **Search thumbnails** go through the same disk cache (`/img`, allowlisted hosts only).
- **Every lookup is cached in SQLite** — Dewey numbers/genres (90 days), summaries (90 days),
  ISBN lookups (30 days), title searches (7 days) — shared by duplicates and re-imports.
  Classification runs in a background queue with per-host concurrency limits and pacing.
- **Instant paint:** the page keeps a snapshot of your library and renders it immediately, then
  asks the server only for what changed since that revision (`/api/books?since=N`). Unchanged
  full listings return `304 Not Modified`.
- **Static assets** use content-hashed URLs (`/app.js?v=<hash>`) served `immutable`, are
  pre-compressed with brotli and gzip at startup, and everything else revalidates with ETags.
- **Service worker** caches the app shell and covers, so repeat visits start without the network
  and the app still opens (read-only) offline.

## API

All JSON. Writes need `Content-Type: application/json` and `X-Library: 1` (blocks cross-site
forgeries); with a password set, everything except `/api/session` and `/api/login` needs the
session cookie.

| | |
| --- | --- |
| `GET /api/books[?since=rev]` | all books, or changes since a revision (`{rev, full, pending, books, deleted}`) |
| `POST /api/books` | add `{list, title, author, …}`; duplicates are merged (`{book, duplicate}`) |
| `PATCH /api/books/:id` | update fields; `{ddc: "823.8"}` sets your number, `{ddc: null}` re-classifies |
| `DELETE /api/books/:id` | remove |
| `GET /api/books/:id/summary` | summary (Open Library, then Wikipedia) |
| `POST /api/import` | `{list, format: "csv" \| "markdown", text}`, `{format: "export", text}`, or `{list, format: "json", books}` |
| `GET /api/export` | Markdown backup |
| `POST /api/clear` | `{scope: "all" \| "reading" \| "goodreads", confirm: "delete N books"}` |
| `GET /api/lookup/isbn/:isbn` · `GET /api/lookup/search?title=&author=` | catalog lookups |
| `GET /api/status` · `GET /healthz` | status / health check |

## Development

```sh
npm test                     # node:test — shared logic + API against a mock upstream (offline)
node test/mock-upstream.js   # the mock Open Library / Google Books, for manual testing
```

Point the server at the mock with `OPENLIBRARY_URL`, `COVERS_URL`, `GOOGLE_BOOKS_URL` and
`WIKIPEDIA_URL`.

```
server/   index.js (entry) · app.js (routes) · db.js (schema) · books.js (library) ·
          classify.js (Dewey + genres) · lookup.js (ISBN/search/summaries) · images.js (cover cache) ·
          static.js (assets) · auth.js · net.js (outbound HTTP) · backup.js
shared/   dewey.js (DDC outline) · ddc.js · dedupe.js · listfmt.js — used by server and browser
public/   index.html · app.js · styles.css · sw.js
```

## License

[MIT](LICENSE)
