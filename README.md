# Library

A minimalist, static reading dashboard. Keep a curated reading list and browse your Goodreads
library in one place — search and filter by author, category/genre, and read status, with book
covers pulled automatically from [Open Library](https://openlibrary.org/).

No accounts, no backend, no tracking. Everything runs in your browser and your data stays on your
device (in `localStorage`).

**[▶ Live demo](https://YOUR-USERNAME.github.io/book-library/)** — replace with your Pages URL.

## Features

- **Two tabs.** A curated **Reading List** you build yourself, and your **Goodreads** library.
- **Build your reading list** by pasting a simple Markdown list (or load the built-in sample).
- **Import Goodreads** from the official CSV export — no scraping, one click.
- **Automatic genre tags** for Goodreads books, looked up online and canonicalized into a clean,
  filterable vocabulary (History, Philosophy, Fiction, Economics, Science Fiction, …).
- **Covers** fetched lazily from Open Library and cached locally.
- **Search + filters:** author, category/genre chips with counts, read/unread status, sort, and a
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

Or drop a `.md` / `.txt` file. Your list is saved in `localStorage`.

### Goodreads
On the **Goodreads** tab, import your library export:

1. Go to **Goodreads → My Books → [Import/Export](https://www.goodreads.com/review/import)**.
2. Click **Export Library** and download `goodreads_library_export.csv`.
3. Drop the CSV onto the tab.

Shelves, ratings, and read status come across; genres are looked up and tagged automatically.

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
- Genres: Open Library subjects (ISBN → work subjects, with a title/author fallback),
  canonicalized into a curated genre list with word-boundary matching and noise filtering.
- All state (imported lists, cover/genre caches) lives in `localStorage`.

## License

[MIT](LICENSE)
