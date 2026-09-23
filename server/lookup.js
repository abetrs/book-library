"use strict";
/* Catalog lookups used by the add-book form and the detail popup, done
 * server-side and cached in SQLite so repeat questions cost nothing.
 *   isbn(isbn)            -> {title, author, year, thumb} | null
 *   search(title, author) -> [{title, author, year, thumb, isbn}]
 *   summary(book)         -> string ("" when none found)
 */
const config = require("./config");
const { getJson, UpstreamError } = require("./net");
const { cacheGet, cacheSet } = require("./db");
const { normTitle, surname } = require("../shared/dedupe");

const DAY = 864e5;
const OL = () => config.upstream.openLibrary;
const GB = () => config.upstream.googleBooks;
const WP = () => config.upstream.wikipedia;
const olThumb = (coverId) => (coverId ? `${config.upstream.covers}/b/id/${coverId}-M.jpg` : "");

// Cache wrapper: `fn` throws UpstreamError when nothing could be reached — that
// is never cached, so the next request tries again.
async function cached(db, key, ttl, missTtl, fn) {
  const hit = cacheGet(db, key);
  if (hit !== undefined) return hit;
  const value = await fn();
  const empty = value == null || value === "" || (Array.isArray(value) && !value.length);
  cacheSet(db, key, value, empty ? missTtl : ttl);
  return value;
}

// Runs each source; succeeds if at least one answered (even with nothing).
async function firstOf(sources) {
  let reached = false,
    lastErr = null;
  for (const src of sources) {
    try {
      const v = await src();
      reached = true;
      if (v) return v;
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      lastErr = e;
    }
  }
  if (!reached) throw lastErr || new UpstreamError("no source reachable");
  return null;
}

function googleBook(v) {
  const ids = v.industryIdentifiers || [];
  const isbn = (ids.find((i) => i.type === "ISBN_13") || ids.find((i) => i.type === "ISBN_10") || {}).identifier || "";
  return {
    title: v.title,
    author: (v.authors || [])[0] || "",
    year: (v.publishedDate || "").slice(0, 4),
    thumb: ((v.imageLinks || {}).thumbnail || (v.imageLinks || {}).smallThumbnail || "").replace(/^http:/, "https:"),
    isbn,
  };
}

/* ---------------- ISBN ---------------- */
function isbn(db, code) {
  return cached(db, "isbn:" + code, 30 * DAY, DAY, () =>
    firstOf([
      async () => {
        const p = new URLSearchParams({ q: `isbn:${code}`, limit: "1", fields: "title,author_name,first_publish_year,cover_i" });
        const j = await getJson(`${OL()}/search.json?${p}`);
        const d = j && (j.docs || [])[0];
        if (!d || !d.title) return null;
        return {
          title: d.title,
          author: (d.author_name || [])[0] || "",
          year: d.first_publish_year || "",
          thumb: olThumb(d.cover_i) || `${config.upstream.covers}/b/isbn/${code}-M.jpg`,
        };
      },
      async () => {
        const j = await getJson(`${GB()}/volumes?q=isbn:${code}&maxResults=1`);
        const v = j && ((j.items || [])[0] || {}).volumeInfo;
        return v && v.title ? googleBook(v) : null;
      },
    ])
  );
}

/* ---------------- title / author search ---------------- */
function search(db, title, author) {
  const key = "search:" + (normTitle(title) + "|" + surname(author)).slice(0, 300);
  return cached(db, key, 7 * DAY, DAY, async () => {
    const list = [];
    let reached = false;
    try {
      const p = new URLSearchParams({ q: `${title} ${author}`.trim(), limit: "8", fields: "title,author_name,first_publish_year,cover_i" });
      const j = await getJson(`${OL()}/search.json?${p}`);
      reached = true;
      for (const d of (j && j.docs) || [])
        if (d.title) list.push({ title: d.title, author: (d.author_name || [])[0] || "", year: d.first_publish_year || "", thumb: olThumb(d.cover_i), isbn: "" });
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
    }
    // Google Books copes better with typos; use it when Open Library comes up short.
    if (list.length < 4) {
      try {
        const q = [title && `intitle:${title}`, author && `inauthor:${author}`].filter(Boolean).join(" ");
        let j = await getJson(`${GB()}/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books`);
        reached = true;
        let items = (j && j.items) || [];
        if (!items.length) {
          j = await getJson(`${GB()}/volumes?q=${encodeURIComponent(`${title} ${author}`.trim())}&maxResults=8&printType=books`);
          items = (j && j.items) || [];
        }
        for (const it of items) if (it.volumeInfo && it.volumeInfo.title) list.push(googleBook(it.volumeInfo));
      } catch (e) {
        if (!(e instanceof UpstreamError)) throw e;
      }
    }
    if (!reached) throw new UpstreamError("book catalogs unreachable");
    const seen = new Set();
    return list
      .filter((c) => {
        const k = surname(c.author) + "|" + normTitle(c.title);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 8);
  });
}

/* ---------------- summaries ---------------- */
function cleanDesc(s) {
  s = s.replace(/\r/g, "").trim();
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // flatten [text](url)
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1"); // flatten [text][ref]
  s = s.replace(/^\s*(?:from\s+wikipedia|source)\s*[:.]?\s*/i, ""); // strip boilerplate lead-in
  s = s.split(/\n-{3,}/)[0]; // drop content after a horizontal rule
  s = s.replace(/\n\[\d+\]:\s*\S+/g, ""); // drop reference-link definitions
  s = s.replace(/\(\s*(?:source|see also)[^)]*\)\s*$/i, "").trim(); // drop trailing source note
  s = s.replace(/\\([[\]*_])/g, "$1"); // unescape markdown-escaped chars
  s = s.replace(/\*{1,2}([^*\n]+)\*{1,2}/g, "$1"); // strip *emphasis* / **bold**
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > 900) s = s.slice(0, 900).replace(/\s+\S*$/, "") + "…";
  return s;
}

async function wikiSummary(title, author) {
  const q = encodeURIComponent(`${title} ${author || ""}`.trim());
  const sj = await getJson(`${WP()}/w/api.php?action=query&list=search&srsearch=${q}&srlimit=1&format=json`);
  const hit = sj && sj.query && sj.query.search && sj.query.search[0];
  if (!hit) return "";
  const rj = await getJson(`${WP()}/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
  if (!rj || rj.type === "disambiguation") return "";
  return rj.extract || "";
}

function summaryKey(b) {
  const code = (b.isbn || "").replace(/[^0-9Xx]/g, "");
  return "desc:" + (code ? "i:" + code : "t:" + surname(b.author) + "|" + normTitle(b.title));
}

function summary(db, b) {
  if (b.custom) return Promise.resolve("");
  return cached(db, summaryKey(b), 90 * DAY, 7 * DAY, async () => {
    let workKey = null;
    const code = (b.isbn || "").replace(/[^0-9Xx]/g, "");
    let reached = false;
    const attempt = async (fn) => {
      try {
        const v = await fn();
        reached = true;
        return v;
      } catch (e) {
        if (!(e instanceof UpstreamError)) throw e;
        return null;
      }
    };
    if (code) {
      const ed = await attempt(() => getJson(`${OL()}/isbn/${code}.json`));
      workKey = ed && ed.works && ed.works[0] && ed.works[0].key;
    }
    if (!workKey) {
      const p = new URLSearchParams({ title: b.title, limit: "1", fields: "key" });
      if (b.author) p.set("author", b.author);
      const j = await attempt(() => getJson(`${OL()}/search.json?${p}`));
      workKey = j && j.docs && j.docs[0] && j.docs[0].key;
    }
    if (workKey) {
      const wj = await attempt(() => getJson(`${OL()}${workKey}.json`));
      let d = wj && wj.description;
      if (d && typeof d === "object") d = d.value;
      if (typeof d === "string" && d.trim()) return cleanDesc(d);
    }
    // fallback: Wikipedia (searched with title + author to land on the right page)
    const wiki = await attempt(() => wikiSummary(b.title, b.author));
    if (!reached) throw new UpstreamError("summary sources unreachable");
    return wiki ? cleanDesc(wiki) : "";
  });
}

module.exports = { isbn, search, summary, cleanDesc };
