/* Library database: library.md in this repo.
 *
 * The whole library lives in one human-readable Markdown file. This module
 * parses and writes that format and knows three ways to reach the file:
 *   - local:  `node server.js` serves the app and reads/writes library.md on disk;
 *   - github: the GitHub contents API reads library.md and commits every save
 *             (token kept only in this browser, set via the storage dialog);
 *   - static: anywhere else (e.g. GitHub Pages without a token) the file is
 *             read-only — changes last until the page is closed.
 */
window.LibraryStore = (() => {
  "use strict";

  const DB_PATH = "library.md";
  const GH_KEY = "libraryStore.github"; // connection settings; never written to the repo

  /* ---------------- Markdown list parsing ----------------
   * Hand-written lists and the database share one format:
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

  /* ---------------- database file ---------------- */
  const HEADER = `# Library

<!--
  The database for the Library app. The app keeps this file up to date, and it is
  safe to edit by hand. Two sections: "# Reading List" and "# Goodreads".
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

  /* ---------------- backends ---------------- */
  const LOCAL = {
    kind: "local",
    label: "library.md on this computer",
    writable: true,
    async load() {
      const r = await fetch("api/library", { cache: "no-store" });
      if (!r.ok) throw new Error(`local server ${r.status}`);
      return r.text();
    },
    async save(text) {
      const r = await fetch("api/library", {
        method: "PUT",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body: text,
      });
      if (!r.ok) throw new Error(`local server ${r.status}`);
    },
  };

  const STATIC = {
    kind: "static",
    label: "library.md (read-only)",
    writable: false,
    async load() {
      try {
        const r = await fetch(DB_PATH, { cache: "no-cache" });
        return r.ok ? r.text() : "";
      } catch (e) {
        return ""; // opened from file://
      }
    },
    async save() {
      throw new Error("read-only");
    },
  };

  const b64encode = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64decode = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  function github(cfg) {
    const api =
      `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/` +
      cfg.path.split("/").map(encodeURIComponent).join("/");
    const ref = `?ref=${encodeURIComponent(cfg.branch)}`;
    const headers = {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    let sha = null;
    async function load() {
      const r = await fetch(api + ref, { headers, cache: "no-store" });
      if (r.status === 404) {
        sha = null;
        return ""; // first save creates the file
      }
      if (!r.ok) throw new Error(r.status === 401 ? "token rejected (401)" : `GitHub ${r.status}`);
      const j = await r.json();
      sha = j.sha;
      if (j.content && j.encoding === "base64") return b64decode(j.content);
      // files over 1 MB come back without content
      const raw = await fetch(api + ref, { headers: { ...headers, Accept: "application/vnd.github.raw" }, cache: "no-store" });
      return raw.text();
    }
    return {
      kind: "github",
      label: `${cfg.owner}/${cfg.repo} · ${cfg.path} (${cfg.branch})`,
      writable: true,
      load,
      async save(text, message) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const body = { message, content: b64encode(text), branch: cfg.branch };
          if (sha) body.sha = sha;
          const r = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
          if (r.ok) {
            sha = (await r.json()).content.sha;
            return;
          }
          // file changed elsewhere (another device / a hand edit): take the latest sha and write ours
          if ((r.status === 409 || r.status === 422) && attempt === 0) {
            await load();
            continue;
          }
          throw new Error(r.status === 401 ? "token rejected (401)" : `GitHub ${r.status}`);
        }
      },
    };
  }

  function githubSettings() {
    try {
      return JSON.parse(localStorage.getItem(GH_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function setGithubSettings(cfg) {
    try {
      if (cfg) localStorage.setItem(GH_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(GH_KEY);
    } catch (e) {}
  }
  // Sensible defaults: this repo, guessed from a GitHub Pages URL.
  function githubDefaults() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    const repo = m && location.pathname.split("/").filter(Boolean)[0];
    return { owner: m ? m[1] : "abetrs", repo: repo || "book-library", branch: "main", path: DB_PATH, token: "" };
  }

  // Pick the backend: local server > GitHub (if connected) > read-only file.
  async function open() {
    try {
      const r = await fetch("api/library", { cache: "no-store" });
      if (r.headers.get("X-Library-Store") === "local") return { backend: LOCAL, text: r.ok ? await r.text() : "" };
    } catch (e) {}
    const cfg = githubSettings();
    if (cfg && cfg.token) {
      const gh = github(cfg);
      try {
        return { backend: gh, text: await gh.load() };
      } catch (e) {
        return { backend: STATIC, text: await STATIC.load(), error: `Couldn't reach GitHub: ${e.message}` };
      }
    }
    return { backend: STATIC, text: await STATIC.load() };
  }

  return { open, parseList, parseDatabase, serialize, github, githubSettings, setGithubSettings, githubDefaults };
})();
