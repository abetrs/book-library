/* Import/export formats: the Markdown list format (also the backup format)
 * and the Goodreads library-export CSV.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ListFormat = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------- Markdown list parsing ----------------
   * Hand-written lists and exports share one format:
   *   ## Category / ### Subcategory / #### Sub-subcategory
   *   - Author — _Title_ (note) ✅ !primary ★4 isbn:9780141439518 {823.8 catalog}
   * Section headers are never books: besides # headings, a bullet counts as a
   * header when it has nested bullets under it (and no "Author — Title" shape),
   * is entirely bold (- **Poetry**), or ends with a colon (- Poetry:). Standalone
   * bold lines (**Poetry**) are headers too.
   */
  const stripMd = (s) => String(s).trim().replace(/:\s*$/, "").replace(/^[*_`]+|[*_`]+$/g, "").replace(/:\s*$/, "").trim();
  const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
  const indentOf = (ws) => ws.replace(/\t/g, "    ").length;

  function cleanTitle(t) {
    t = (t || "").trim();
    let note = "";
    const m = t.match(/\s*\(([^()]*)\)\s*$/);
    if (m) {
      note = m[1].trim();
      t = t.slice(0, m.index).trim();
    }
    t = t.replace(/[_*]/g, "").trim().replace(/^["']|["']$/g, "").trim();
    return { title: t, note };
  }

  const hasBookShape = (item) =>
    /\s[—–-]\s/.test(item) || /(^|\s)_[^_]+_/.test(item) || /(^|\s)\*(?!\*)[^*]+\*(?!\*)/.test(item) ||
    /✅|\bisbn[:\s]|\{\s*\d{3}/i.test(item);

  function isHeaderItem(item, lines, i, indent) {
    if (/^(\*\*|__)[^*_]+(\*\*|__):?$/.test(item)) return true; // - **Poetry**
    if (hasBookShape(item)) return false;
    if (/:$/.test(item)) return true; // - Poetry:
    return hasChildren(lines, i, indent); // has nested bullets -> a group label, not a book
  }
  function hasChildren(lines, i, indent) {
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      const m = lines[j].match(BULLET);
      return !!m && indentOf(m[1]) > indent;
    }
    return false;
  }

  function parseItem(raw) {
    let item = raw;
    const read = /✅|✔️|\[x\]/i.test(item);
    const primary = /!primary\b/i.test(item);
    const custom = /!custom\b/i.test(item);
    let ddc = "",
      ddcSrc = "";
    const dm = item.match(/\{\s*(\d{3}(?:\.\d+)?)(?:\s+(catalog|est|manual))?\s*\}/i);
    if (dm) {
      ddc = dm[1];
      ddcSrc = { catalog: "ol", est: "est" }[(dm[2] || "").toLowerCase()] || "manual";
    }
    const im = item.match(/\bisbn[:\s]\s*([0-9Xx-]{10,17})/i);
    const rm = item.match(/★\s*([1-5])/);
    item = item
      .replace(/✅|✔️/g, "")
      .replace(/!primary\b|!custom\b/gi, "")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\bisbn[:\s]\s*[0-9Xx-]{10,17}/gi, "")
      .replace(/★\s*[1-5]/g, "")
      .replace(/^\[[ xX]\]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    let author = "",
      title = "",
      note = "";
    // Preferred: "Author — _Title_ (note)" — the italics delimit the title exactly.
    const it =
      item.match(/(^|\s)_((?:\\_|[^_])+?)_(?=\s|$|[(.,;])/) || item.match(/(^|\s)\*(?!\*)([^*]+?)\*(?=\s|$|[(.,;])/);
    if (it) {
      title = it[2].replace(/\\_/g, "_").trim();
      author = item.slice(0, it.index).replace(/\s*[—–-]\s*$/, "").trim();
      const rest = item.slice(it.index + it[0].length).trim();
      const nm = rest.match(/^\((.*)\)$/);
      note = nm ? nm[1].trim() : rest.replace(/^[—–-]\s*/, "").trim();
    } else {
      const split = item.match(/^(.*?)\s[—–-]\s(.*)$/); // "Author — Title" (em/en/hyphen)
      ({ title, note } = cleanTitle(split ? split[2] : item));
      if (split) author = split[1].trim();
    }
    author = author.replace(/[_*]/g, "").trim();
    if (!title) return null;
    return {
      title, author, note, read, primary, custom, ddc, ddcSrc,
      isbn: im ? im[1].replace(/-/g, "") : "",
      rating: rm ? +rm[1] : 0,
    };
  }

  function parseList(text) {
    let cat = "",
      sub = "",
      subsub = "";
    const groups = []; // bullet-style headers above the current line: {indent, name}
    const books = [];
    const lines = String(text).replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\s+$/, "");
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lvl = h[1].length,
          name = stripMd(h[2]);
        if (lvl <= 2) [cat, sub, subsub] = [name, "", ""];
        else if (lvl === 3) [sub, subsub] = [name, ""];
        else subsub = name;
        groups.length = 0;
        continue;
      }
      const bold = line.match(/^\s*(?:\*\*|__)([^*_]+)(?:\*\*|__)\s*:?\s*$/);
      if (bold) {
        [sub, subsub] = [stripMd(bold[1]), ""];
        groups.length = 0;
        continue;
      }
      const m = line.match(BULLET);
      if (!m) continue;
      const indent = indentOf(m[1]);
      const item = m[2].trim();
      if (!item) continue;
      // A header with nested bullets covers its children; a flat one ("- **Stoics**"
      // followed by same-level items) covers its siblings until the next header.
      const header = isHeaderItem(item, lines, i, indent);
      while (groups.length) {
        const top = groups[groups.length - 1];
        if (top.indent > indent || (top.indent === indent && (header || !top.flat))) groups.pop();
        else break;
      }
      if (header) {
        groups.push({ indent, name: stripMd(item), flat: !hasChildren(lines, i, indent) });
        continue;
      }
      const b = parseItem(item);
      if (!b) continue;
      // bullet headers fill the deepest free heading levels
      const trail = [sub, subsub, ...groups.map((g) => g.name)].filter(Boolean);
      books.push({ ...b, category: cat || "Uncategorized", subcategory: trail[0] || "", subsubcategory: trail.slice(1).join(" · ") });
    }
    return books;
  }

  /* ---------------- backup / export file ---------------- */
  const HEADER = `# Library

<!--
  Export of the Library app (the live library is its SQLite database).
  Re-import with "Import list" or restore on a fresh server with LIBRARY_IMPORT.
  Two sections: "# Reading List" and "# Goodreads".
  Inside each: ## Category / ### Subcategory / #### Sub-subcategory, then one book per line:

    - Author — _Title_ (note) ✅ !primary ★4 isbn:9780141439518 {823.8 catalog}

  ✅ read · !primary primary source · !custom not a catalogued book · ★N rating
  {number} your Dewey number · {number catalog} from library records · {number est} estimated
-->
`;

  function parseDatabase(text) {
    const out = { reading: "", goodreads: "" };
    let cur = null;
    for (const line of String(text || "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
      const h = line.match(/^#\s+(.+?)\s*$/);
      if (h) {
        if (/reading/i.test(h[1])) { cur = "reading"; continue; }
        if (/goodreads/i.test(h[1])) { cur = "goodreads"; continue; }
        if (!cur) continue; // the "# Library" title
      }
      if (cur) out[cur] += line + "\n";
    }
    return { reading: parseList(out.reading), goodreads: parseList(out.goodreads) };
  }

  function bookLine(b) {
    const author = String(b.author || "").replace(/[_*]/g, "");
    let s = "- " + (author ? author + " — " : "") + "_" + String(b.title).replace(/_/g, "\\_") + "_";
    if (b.note) s += ` (${b.note})`;
    if (b.read) s += " ✅";
    if (b.primary) s += " !primary";
    if (b.custom) s += " !custom";
    if (b.rating) s += ` ★${b.rating}`;
    if (b.isbn) s += ` isbn:${b.isbn}`;
    if (b.ddc) s += ` {${b.ddc}${b.ddcSrc === "ol" ? " catalog" : b.ddcSrc === "est" ? " est" : ""}}`;
    return s;
  }

  // Group under headings in order of first appearance. Books without a
  // subheading are written first so they don't fall under a sibling's heading.
  function serializeList(books) {
    const cats = new Map();
    for (const b of books) {
      const c = b.category || "Uncategorized";
      if (!cats.has(c)) cats.set(c, new Map());
      const subs = cats.get(c);
      const s1 = b.subcategory || "";
      if (!subs.has(s1)) subs.set(s1, new Map());
      const s2s = subs.get(s1);
      const s2 = b.subsubcategory || "";
      if (!s2s.has(s2)) s2s.set(s2, []);
      s2s.get(s2).push(b);
    }
    const out = [];
    const emptyFirst = (m) => [...m.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
    for (const [c, subs] of cats) {
      out.push(`## ${c}`, "");
      for (const s1 of emptyFirst(subs)) {
        if (s1) out.push(`### ${s1}`, "");
        const s2s = subs.get(s1);
        for (const s2 of emptyFirst(s2s)) {
          if (s2) out.push(`#### ${s2}`, "");
          out.push(...s2s.get(s2).map(bookLine), "");
        }
      }
    }
    return out.join("\n");
  }

  function serialize({ reading, goodreads }) {
    return `${HEADER}\n# Reading List\n\n${serializeList(reading)}\n# Goodreads\n\n${serializeList(goodreads)}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  /* ---------------- Goodreads CSV ---------------- */
  // Minimal RFC-4180 CSV parser (handles quotes, commas, newlines in fields)
  function parseCsv(text) {
    const rows = [];
    let row = [],
      field = "",
      inQ = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        /* ignore */
      } else field += c;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function parseGoodreadsCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    const idx = (name) => head.indexOf(name);
    const iTitle = idx("Title"),
      iAuthor = idx("Author"),
      iISBN13 = idx("ISBN13"),
      iISBN = idx("ISBN"),
      iRating = idx("My Rating"),
      iShelf = idx("Exclusive Shelf"),
      iShelves = idx("Bookshelves");
    if (iTitle < 0) throw new Error("missing Title column");

    const clean = (s) => (s || "").replace(/^="?|"?$/g, "").trim();
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[iTitle]) continue;
      const shelf = clean(row[iShelf]) || "read";
      const isbn = clean(row[iISBN13]) || clean(row[iISBN]);
      const shelves = clean(row[iShelves]);
      out.push({
        title: clean(row[iTitle]),
        author: clean(row[iAuthor]),
        category: prettyShelf(shelf),
        subcategory: shelves ? shelves.split(",")[0].trim() : "",
        read: shelf === "read",
        primary: false,
        rating: Number(clean(row[iRating])) || 0,
        isbn: isbn.replace(/[^0-9Xx]/g, ""),
      });
    }
    return out;
  }

  function prettyShelf(s) {
    return (
      {
        read: "Read",
        "currently-reading": "Currently Reading",
        "to-read": "To Read",
      }[s] || (s || "Read").replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
    );
  }

  return { parseList, parseDatabase, serialize, parseCsv, parseGoodreadsCsv, prettyShelf };
});
