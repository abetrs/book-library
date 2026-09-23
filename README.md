# Library

A minimalist personal reading dashboard. A curated reading list and a Goodreads library in one
place — shelved by **Dewey Decimal Classification**, searchable by Dewey number, subject, author,
and read status, with book covers pulled automatically from [Open Library](https://openlibrary.org/).

The whole library is stored in **[`library.md`](library.md)** in this repo — a plain Markdown file
you can read on GitHub and edit by hand.

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
- **Add books quickly.** Paste an ISBN and the title and author fill themselves in. Typed a title
  and author instead? The form checks them against Open Library and Google Books: an exact match is
  added straight away; otherwise you get **"Did you mean…"** with the real books to pick from, or
  keep yours as a **custom book** (marked `!custom`, never looked up by title).
- **Section headers stay headers.** When importing Markdown, `#` headings, bold lines
  (`**Poetry**`), bold bullets (`- **Poetry**`), bullets ending in a colon (`- Poetry:`), and bullets
  with nested bullets under them are treated as categories, never as books.
- **Remove books** — click any book for a details popup with a **summary**, genres, its Dewey
  number, and a delete button.
- **Covers** fetched lazily from Open Library and cached locally.
- **Filters:** author, read/unread status, sort (shelf order, curated, title, author), and a
  grid/list view toggle.
- **Light & dark** (follows your system), responsive, and fast.

## Where the library is saved

Everything lives in `library.md`. The footer shows where changes are going; click it for options.

- **On your computer:** `node server.js` (no dependencies), then open <http://localhost:8000>.
  Every change is written straight into `library.md`; commit it whenever you like.
- **Anywhere (e.g. GitHub Pages):** open the storage dialog and connect GitHub with a
  [fine-grained token](https://github.com/settings/personal-access-tokens/new) for this repository
  with **Contents: Read and write**. Each save is committed to `library.md` (edits are batched, so
  a burst of changes is one commit). The token stays in that browser only.
- **Otherwise** the app reads `library.md` read-only, and says so in the footer.

Books that older versions kept in browser storage are moved into `library.md` automatically the
first time the app can save. Covers, genres and summaries are still cached in the browser — they're
lookups, not data.

### `library.md` format

```markdown
# Reading List

## Philosophy
### Stoics
- Marcus Aurelius — _Meditations_ (Hays translation) ✅ isbn:9780812968255 {188 catalog}

# Goodreads

## Read
- Frank Herbert — _Dune_ ✅ ★5 isbn:9780441172719 {813.54 catalog}
```

`✅` read · `!primary` primary source · `!custom` custom book · `★N` rating · `{823.8}` your Dewey
number · `{… catalog}` from library records · `{… est}` estimated.

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
duplicates. Imported lists use the same format as `library.md`.

### Goodreads
On the **Goodreads** tab, import your library export:

1. Go to **Goodreads → My Books → [Import/Export](https://www.goodreads.com/review/import)**.
2. Click **Export Library** and download `goodreads_library_export.csv`.
3. Drop the CSV onto the tab.

Shelves, ratings, and read status come across; Dewey numbers and genres are looked up
automatically. Re-import any time with **Import CSV** — only new books are added.

## Deploy to GitHub Pages

Because it's fully static, GitHub Pages hosts it for free:

1. Push this repo to GitHub.
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then **Save**.
5. Wait ~1 minute; your site is live at `https://abetrs.github.io/book-library/`.
6. Open it, click the storage button in the footer, and connect GitHub to edit from there.

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
- Data: `library.md`, parsed and written by `store.js`; saved through `server.js` locally or the
  GitHub contents API. Only caches and the GitHub connection live in `localStorage`.

## License

[MIT](LICENSE)
