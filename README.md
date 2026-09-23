# Library

A minimalist, static reading dashboard. Keep a curated reading list and browse your Goodreads
library in one place — shelved by **Dewey Decimal Classification**, searchable by Dewey number,
subject, author, and read status, with book covers pulled automatically from
[Open Library](https://openlibrary.org/).

No accounts, no backend, no tracking. Everything runs in your browser and your data stays on your
device (in `localStorage`).

**[▶ Live demo](https://YOUR-USERNAME.github.io/book-library/)** — replace with your Pages URL.

## Features

- **Two tabs.** A curated **Reading List** you build yourself, and your **Goodreads** library.
- **Build your reading list** by pasting a simple Markdown list (or load the built-in sample).
- **Import Goodreads** from the official CSV export — no scraping, one click.
- **No duplicates.** Every upload (Goodreads CSV, Markdown list, a single added book) skips books
  you already have. Two entries match when they share an ISBN (ISBN-10 and -13 are unified) or the
  same author surname + title, ignoring case, accents, leading articles, subtitles and Goodreads
  series tags — so `Dune (Dune, #1)`, `Dune: Deluxe Edition` and `Herbert, Frank — Dune` are one
  book. Read status, ratings and ISBNs from a duplicate are merged into the kept entry, and
  duplicates saved by older versions are cleaned up on load.
- **Dewey Decimal organization.** Every book gets a detailed DDC number (e.g. `891.73`), shown on
  its card and in its popup with the full class › division › section path. Books are shelved in
  Dewey order under division headings.
  - **Catalog numbers** come from Open Library's library records (the edition by ISBN, then
    matching editions), picking the most-cited section and its most detailed form.
  - **Estimated numbers** (`~`) fill the gaps from subjects, genres and your category — e.g.
    "Russian fiction" → 891.73. Literature is classed by original language + form.
  - **Your numbers** — set or change any book's number in its popup (type it, or pick by
    category); yours always win.
- **Search by Dewey number** — type it in the Dewey box or the main search: `8`/`800` (the
  class), `82`/`820`/`82x` (a division), `823`, `823.8` (and everything under it), or a range
  like `300-399`.
- **Find by category** — build a number step by step (class → division → section → optional
  decimals) without knowing Dewey; the number assembles as you go.
- **DDC guide** — how to read a number, the search syntax, the literature pattern, and the full
  outline of 10 classes / 100 divisions / 1,000 sections with your book counts (click any code).
- **Drill-down chips:** class → division → section, with counts.
- **Add or remove books** — click any book for a details popup with a **summary**, genres, its
  Dewey number, and a delete button.
- **Covers** fetched lazily from Open Library and cached locally.
- **Filters:** author, read/unread status, sort (shelf order, curated, title, author), and a
  grid/list view toggle.
- **Light & dark** (follows your system), responsive, and fast.

## Run locally

It's plain HTML/CSS/JS — no build step, no dependencies.

- Double-click `index.html`, **or**
- serve it: `python -m http.server 8000` then open <http://localhost:8000>.

## Use it

### Reading List
Open the **Reading List** tab and paste a Markdown list. Format:

```markdown
## Philosophy
- Plato — _The Republic_ ✅
- Aristotle — _Nicomachean Ethics_

## Fiction
- Fyodor Dostoevsky — _Crime and Punishment_ !primary
```

- `##` / `###` / `####` are categories and subcategories.
- One book per line: `- Author — Title` (em-dash, en-dash, or hyphen; italics optional).
- `✅` or `[x]` marks a book as **read**; `!primary` marks a **primary source**.
- `{823.8}` (optional) sets the book's Dewey number yourself.

Or drop a `.md` / `.txt` file. Once you have a list, **Import list** merges more in, skipping
duplicates. Your list is saved in `localStorage`.

### Goodreads
On the **Goodreads** tab, import your library export:

1. Go to **Goodreads → My Books → [Import/Export](https://www.goodreads.com/review/import)**.
2. Click **Export Library** and download `goodreads_library_export.csv`.
3. Drop the CSV onto the tab.

Shelves, ratings, and read status come across; Dewey numbers and genres are looked up
automatically. Re-import any time with **Import CSV** — only new books are added.

## Deploy to GitHub Pages

Because it's fully static, GitHub Pages hosts it for free:

1. Push this repo to GitHub (see below).
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then **Save**.
5. Wait ~1 minute; your site is live at `https://YOUR-USERNAME.github.io/book-library/`.

The included `.nojekyll` file tells Pages to serve the files as-is (no Jekyll processing).

## Tech notes

- Covers: Open Library Covers API (by ISBN, then title/author search).
- Dewey numbers + genres: one Open Library lookup per book (ISBN → edition
  `dewey_decimal_class` + work subjects, with a title/author search fallback for `ddc` and
  subjects). Subjects are canonicalized into a curated genre list; when no catalog number exists
  the number is estimated from subjects/genres/category. The DDC outline (three summaries) lives
  in `data/dewey.js`.
- Summaries: Open Library work descriptions, falling back to a Wikipedia search + summary
  (matched on title + author) when Open Library has none.
- Covers and classification load on separate request queues so lookups never block covers.
- All state (imported lists, added/removed books, caches) lives in `localStorage`.

## License

[MIT](LICENSE)
