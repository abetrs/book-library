/* Library — minimalist reading dashboard
 * Two datasets: window.READING_LIST (curated) and window.GOODREADS (imported CSV).
 * Covers are fetched lazily from Open Library and cached in localStorage.
 */
(() => {
  "use strict";

  let READING = loadStoredReading() || (window.READING_LIST || []).map(normalize);
  let GOODREADS = loadStoredGoodreads() || (window.GOODREADS || []).map(normalize);

  const state = {
    tab: "reading",
    q: "",
    author: "",
    status: "",
    category: "",
    genre: "",
    sort: "curated",
    view: "grid",
  };

  const els = {
    results: document.getElementById("results"),
    count: document.getElementById("count"),
    empty: document.getElementById("empty"),
    search: document.getElementById("search"),
    authorFilter: document.getElementById("authorFilter"),
    statusFilter: document.getElementById("statusFilter"),
    sortBy: document.getElementById("sortBy"),
    viewToggle: document.getElementById("viewToggle"),
    tagbar: document.getElementById("tagbar"),
    tabs: document.getElementById("tabs"),
    footNote: document.getElementById("footNote"),
  };

  function normalize(b, i) {
    return {
      id: b.id != null ? b.id : i,
      title: b.title || "",
      author: b.author || "",
      category: b.category || "Uncategorized",
      subcategory: b.subcategory || "",
      subsubcategory: b.subsubcategory || "",
      read: !!b.read,
      primary: !!b.primary,
      rating: b.rating || 0,
      isbn: b.isbn || "",
      note: b.note || "",
    };
  }

  function currentData() {
    return state.tab === "reading" ? READING : GOODREADS;
  }

  /* ---------------- filtering ---------------- */
  function apply() {
    const data = currentData();
    const q = state.q.trim().toLowerCase();
    let out = data.filter((b) => {
      if (state.tab === "reading") {
        if (state.category && b.category !== state.category) return false;
      } else {
        if (state.genre && !(b.genres || []).includes(state.genre)) return false;
      }
      if (state.author && b.author !== state.author) return false;
      if (state.status === "read" && !b.read) return false;
      if (state.status === "unread" && b.read) return false;
      if (state.status === "primary" && !b.primary) return false;
      if (q) {
        const hay = (b.title + " " + b.author + " " + b.category + " " + b.subcategory).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (state.sort === "title") out = out.slice().sort((a, b) => a.title.localeCompare(b.title));
    else if (state.sort === "author")
      out = out.slice().sort((a, b) => (a.author || "￿").localeCompare(b.author || "￿"));

    return out;
  }

  /* ---------------- rendering ---------------- */
  function render() {
    // Reading list empty -> import panel
    if (state.tab === "reading" && READING.length === 0) {
      renderReadingImport();
      els.empty.hidden = true;
      updateChrome([], currentData());
      return;
    }
    // Goodreads empty -> import panel
    if (state.tab === "goodreads" && GOODREADS.length === 0) {
      renderImport();
      els.empty.hidden = true;
      updateChrome([], currentData());
      return;
    }

    const list = apply();
    els.results.className = "grid" + (state.view === "list" ? " list" : "");
    els.results.innerHTML = "";
    els.empty.hidden = list.length !== 0;

    const frag = document.createDocumentFragment();
    list.forEach((b, i) => frag.appendChild(card(b, i)));
    els.results.appendChild(frag);

    observeCovers();
    updateChrome(list, currentData());

    if (state.tab === "goodreads" && GOODREADS.length) ensureGenres();
  }

  function updateChrome(list, data) {
    els.count.textContent = `${list.length} / ${data.length}`;
    const read = data.filter((b) => b.read).length;
    const label = state.tab === "reading" ? "curated reading list" : "goodreads library";
    els.footNote.textContent = `${data.length} books · ${read} read · ${label}`;
  }

  function card(b, i) {
    const el = document.createElement("article");
    el.className = "card";
    el.dataset.id = b.id;
    el.style.animationDelay = Math.min(i * 12, 320) + "ms";

    const initials = escapeHtml(b.title);
    const badge = b.read ? '<div class="badge" title="Read">✓</div>' : "";
    const primary = b.primary ? '<div class="badge primary">Primary</div>' : "";

    el.innerHTML = `
      <div class="cover" data-title="${attr(b.title)}" data-author="${attr(b.author)}" data-isbn="${attr(b.isbn)}">
        <div class="fallback"><div class="ft">${initials}</div><div class="fa">${escapeHtml(b.author || "—")}</div></div>
        ${badge}${primary}
      </div>
      <div class="meta">
        <div class="t">${escapeHtml(b.title)}</div>
        <div class="a">${escapeHtml(b.author || "—")}</div>
        <div class="c">${escapeHtml(cardTag(b))}</div>
      </div>`;
    return el;
  }

  function cardTag(b) {
    if (state.tab === "goodreads") {
      if (b.genres && b.genres.length) return b.genres.join(" · ");
      return b._g ? b.category : "…";
    }
    return b.subcategory || b.category;
  }

  /* ---------------- covers (Open Library, lazy + cached) ---------------- */
  const CACHE_KEY = "coverCache.v1";
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch (e) {
    cache = {};
  }
  let cacheDirty = false;
  setInterval(() => {
    if (cacheDirty) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch (e) {}
      cacheDirty = false;
    }
  }, 1500);

  // Independent work queues so genre lookups never starve cover loading.
  // (They used to share one queue; on the Goodreads tab the per-book genre jobs
  // were enqueued first and blocked every cover.)
  function makeQueue(max) {
    const q = [];
    let active = 0;
    const pump = () => {
      while (active < max && q.length) {
        const job = q.shift();
        active++;
        job().finally(() => {
          active--;
          pump();
        });
      }
    };
    return { add: (job) => { q.push(job); pump(); } };
  }
  const coverQ = makeQueue(4);
  const genreQ = makeQueue(2);

  // Viewport scanner: queues covers within (or near) the viewport. Driven by
  // scroll/resize + an initial pass. Avoids IntersectionObserver, which does not
  // fire in some embedded/headless renderers.
  let scanScheduled = false;
  function scanCovers() {
    const margin = 400;
    const covers = els.results.querySelectorAll(".cover:not([data-req])");
    for (const c of covers) {
      const r = c.getBoundingClientRect();
      if (r.bottom > -margin && r.top < window.innerHeight + margin) {
        c.setAttribute("data-req", "1");
        coverQ.add(() => loadCover(c));
      }
    }
  }
  function requestScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scanCovers();
    }, 30);
  }
  function observeCovers() {
    // run a couple of passes to catch layout settling, then rely on scroll
    requestScan();
    setTimeout(requestScan, 60);
    setTimeout(requestScan, 300);
  }
  window.addEventListener("scroll", requestScan, { passive: true });
  window.addEventListener("resize", requestScan, { passive: true });

  function keyFor(author, title) {
    return (author + "|" + title).toLowerCase().replace(/\s+/g, " ").trim();
  }

  async function loadCover(coverEl) {
    const title = coverEl.dataset.title;
    const author = coverEl.dataset.author || "";
    const isbn = (coverEl.dataset.isbn || "").replace(/[^0-9Xx]/g, "");
    const key = keyFor(author, title);

    let url = cache[key];
    if (url === undefined) {
      url = await resolveCover(title, author, isbn);
      cache[key] = url; // may be null
      cacheDirty = true;
    }
    if (url) setCover(coverEl, url);
  }

  async function resolveCover(title, author, isbn) {
    // 1) direct ISBN cover (fast, exact) when available
    if (isbn) {
      const u = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
      if (await imageOk(u)) return u;
    }
    // 2) Open Library search -> cover_i
    try {
      const params = new URLSearchParams({ title, limit: "1", fields: "cover_i,isbn" });
      if (author) params.set("author", author);
      const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const j = await res.json();
        const doc = j.docs && j.docs[0];
        if (doc && doc.cover_i) return `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
        if (doc && doc.isbn && doc.isbn[0]) {
          const u = `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-M.jpg?default=false`;
          if (await imageOk(u)) return u;
        }
      }
    } catch (e) {
      /* offline / blocked — keep typographic fallback */
    }
    return null;
  }

  function imageOk(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 2 && img.naturalHeight > 2);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  function setCover(coverEl, url) {
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.addEventListener("load", () => {
      img.classList.add("loaded");
      const fb = coverEl.querySelector(".fallback");
      if (fb) fb.style.opacity = "0";
    });
    img.addEventListener("error", () => img.remove());
    coverEl.insertBefore(img, coverEl.firstChild); // attach first so it actually loads
    img.src = url;
  }

  /* ---------------- genres (Goodreads tab) ----------------
   * Raw subjects come from Open Library (ISBN -> work subjects, else title/author
   * search) and are canonicalized into a small, clean, filterable vocabulary.
   */
  const GENRE_CACHE_KEY = "genreCache.v2";
  let genreCache = {};
  try {
    genreCache = JSON.parse(localStorage.getItem(GENRE_CACHE_KEY) || "{}");
  } catch (e) {
    genreCache = {};
  }
  let genreDirty = false;
  setInterval(() => {
    if (genreDirty) {
      try {
        localStorage.setItem(GENRE_CACHE_KEY, JSON.stringify(genreCache));
      } catch (e) {}
      genreDirty = false;
    }
  }, 1500);

  // priority-ordered: specific genres before broad ones. Word boundaries matter —
  // e.g. \bfiction\b must not match "nonfiction", \bscience\b not "conscience".
  const GENRE_MAP = [
    [/science ?fiction|sci-?fi|speculative fiction/i, "Science Fiction"],
    [/fantasy/i, "Fantasy"],
    [/poetry|poems|\bverse\b/i, "Poetry"],
    [/\bdrama\b|\bplays\b|theatre|theater/i, "Drama"],
    [/biograph|memoir|autobiograph|correspondence|diaries/i, "Biography & Memoir"],
    [/\bmusic\b|\bjazz\b|\bopera\b/i, "Music"],
    [/\bfilm\b|cinema|motion picture/i, "Film"],
    [/\bart\b|\barts\b|painting|sculpture|architecture|photograph|aesthetic|\bdesign\b|bauhaus/i, "Art & Design"],
    [/marxis|socialis|communis|\brevolution|anarchis|leninis/i, "Marxism & Revolution"],
    [/femini|\bgender\b|\bwomen\b|\blgbt|\bqueer\b|sexuality/i, "Gender & Feminism"],
    [/philosoph|metaphysic|epistemolog|\bethics\b|existential/i, "Philosophy"],
    [/religio|theolog|\bislam|christian|hindu|buddh|\bbible\b|\bquran\b|sacred|\bchurch\b/i, "Religion"],
    [/econom|\bcapital\b|capitalism|\bfinance\b|\bwealth\b|\btrade\b|\bmoney\b|\bmarket/i, "Economics"],
    [/politic|\bgovernment\b|\bstate\b|democracy|imperial|colonial|nationalism|geopolit/i, "Politics"],
    [/\bwar\b|\bmilitary\b|world war/i, "War & Military"],
    [/anthropolog|ethnograph/i, "Anthropology"],
    [/psycholog|neuroscience/i, "Psychology"],
    [/sociolog|social science|\bsociety\b|social ?class|\bcaste\b|\blabor\b|\blabour\b/i, "Society"],
    [/technolog|\bcomputer|internet|\bdigital\b|\bcyber|artificial intelligence|information society|automation/i, "Technology"],
    [/\blaw\b|\blegal\b|jurisprudence/i, "Law"],
    [/education|pedagog/i, "Education"],
    [/histor|antiquity|medieval|\bancient\b|\bempire\b/i, "History"],
    [/\bscience\b|physics|biolog|chemistr|mathemat|astronom|\bcosmo|\bevolution\b/i, "Science"],
    [/\bfiction\b|\bnovel\b|short stories|literature|literary/i, "Fiction"],
  ];

  // subject strings that are metadata noise, not genres
  const JUNK = /^nyt:|=|bestseller|reviewed|staff pick|award:|accessible book|in library|protected daisy|overdrive|large type|lending library|^\d/i;

  function canonOne(raw) {
    for (const [re, name] of GENRE_MAP) if (re.test(raw)) return name;
    return null;
  }
  function canonGenres(list) {
    const counts = {};
    for (const raw of list || []) {
      if (typeof raw !== "string" || JUNK.test(raw)) continue;
      const lead = raw.split(/[,/(]/)[0].trim(); // subjects usually lead with the genre term
      const g = canonOne(lead);
      if (g) counts[g] = (counts[g] || 0) + 1;
    }
    // "Fiction" needs >=2 supporting subjects: guards against a single stray
    // wrong-edition subject tagging a nonfiction book as fiction.
    if (counts.Fiction && counts.Fiction < 2) delete counts.Fiction;
    return Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
      .slice(0, 4);
  }

  function genreKey(b) {
    const isbn = (b.isbn || "").replace(/[^0-9Xx]/g, "");
    return isbn ? "i:" + isbn : "t:" + (b.author + "|" + b.title).toLowerCase().trim();
  }

  async function resolveGenres(b) {
    const isbn = (b.isbn || "").replace(/[^0-9Xx]/g, "");
    if (isbn) {
      try {
        const e = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
        if (e.ok) {
          const ed = await e.json();
          const wk = ed.works && ed.works[0] && ed.works[0].key;
          if (wk) {
            const w = await fetch(`https://openlibrary.org${wk}.json`);
            if (w.ok) {
              const wj = await w.json();
              const g = canonGenres(wj.subjects);
              if (g.length) return g;
            }
          }
        }
      } catch (e) {}
    }
    try {
      const p = new URLSearchParams({ title: b.title, limit: "5", fields: "subject" });
      if (b.author) p.set("author", b.author);
      const r = await fetch(`https://openlibrary.org/search.json?${p}`);
      if (r.ok) {
        const j = await r.json();
        for (const d of j.docs || []) {
          if (d.subject && d.subject.length) {
            const g = canonGenres(d.subject);
            if (g.length) return g;
          }
        }
      }
    } catch (e) {}
    return [];
  }

  let genreJobs = 0;
  function ensureGenres() {
    let assigned = false;
    for (const b of GOODREADS) {
      if (b._g) continue;
      const k = genreKey(b);
      if (genreCache[k] !== undefined) {
        b.genres = genreCache[k];
        b._g = true;
        assigned = true;
      }
    }
    if (assigned) scheduleGenreRefresh();
    const need = GOODREADS.filter((b) => !b._g);
    need.forEach((b) => {
      genreJobs++;
      genreQ.add(() => loadGenre(b));
    });
  }

  async function loadGenre(b) {
    const k = genreKey(b);
    let g = genreCache[k];
    if (g === undefined) {
      g = await resolveGenres(b);
      genreCache[k] = g;
      genreDirty = true;
    }
    b.genres = g || [];
    b._g = true;
    updateCardTag(b);
    scheduleGenreRefresh();
    genreJobs--;
    if (genreJobs === 0 && state.tab === "goodreads" && state.genre) render();
  }

  function updateCardTag(b) {
    if (state.tab !== "goodreads") return;
    const c = els.results.querySelector(`.card[data-id="${b.id}"] .c`);
    if (c) c.textContent = cardTag(b);
  }

  let refreshT;
  function scheduleGenreRefresh() {
    clearTimeout(refreshT);
    refreshT = setTimeout(() => {
      if (state.tab === "goodreads" && GOODREADS.length) buildGenreChips(GOODREADS);
    }, 400);
  }

  function buildGenreChips(data) {
    const counts = {};
    data.forEach((b) => (b.genres || []).forEach((g) => (counts[g] = (counts[g] || 0) + 1)));
    const genres = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    const resolved = data.filter((b) => b._g).length;
    const pending = data.length - resolved;
    let html =
      `<button class="chip ${state.genre === "" ? "is-active" : ""}" data-genre="">All<span class="n">${data.length}</span></button>` +
      genres
        .map(
          (g) =>
            `<button class="chip ${state.genre === g ? "is-active" : ""}" data-genre="${attr(g)}">${escapeHtml(
              g
            )}<span class="n">${counts[g]}</span></button>`
        )
        .join("");
    if (pending > 0) html += `<span class="chip-loading">finding genres… ${resolved}/${data.length}</span>`;
    els.tagbar.innerHTML = html;
  }

  /* ---------------- filter chrome ---------------- */
  function buildFilters() {
    const data = currentData();

    // author dropdown
    const authors = [...new Set(data.map((b) => b.author).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
    els.authorFilter.innerHTML =
      '<option value="">All</option>' +
      authors.map((a) => `<option value="${attr(a)}">${escapeHtml(a)}</option>`).join("");
    els.authorFilter.value = state.author;

    if (state.tab === "goodreads") {
      buildGenreChips(data);
      return;
    }

    // category chips (reading list)
    const counts = {};
    data.forEach((b) => (counts[b.category] = (counts[b.category] || 0) + 1));
    const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    els.tagbar.innerHTML =
      `<button class="chip ${state.category === "" ? "is-active" : ""}" data-cat="">All<span class="n">${data.length}</span></button>` +
      cats
        .map(
          (c) =>
            `<button class="chip ${state.category === c ? "is-active" : ""}" data-cat="${attr(c)}">${escapeHtml(
              c
            )}<span class="n">${counts[c]}</span></button>`
        )
        .join("");
  }

  /* ---------------- goodreads import ---------------- */
  function renderImport() {
    els.results.className = "";
    els.results.innerHTML = `
      <section class="import">
        <h2>Import your Goodreads library</h2>
        <p>Goodreads blocks automated shelf reading, so bring your full library in one click with a CSV export. It stays on your device.</p>
        <ol>
          <li>Open <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener">Goodreads → My Books → Import/Export</a>.</li>
          <li>Click <strong>Export Library</strong>, wait for the file, then download <code>goodreads_library_export.csv</code>.</li>
          <li>Drop it below — every shelf, rating and read date comes across.</li>
        </ol>
        <label class="dropzone" id="dropzone">
          <strong>Choose or drop your CSV</strong>
          <span>goodreads_library_export.csv</span>
          <input type="file" id="csvInput" accept=".csv,text/csv" hidden />
        </label>
      </section>`;
    els.tagbar.innerHTML = "";
    wireDropzone();
  }

  function wireDropzone() {
    const dz = document.getElementById("dropzone");
    const input = document.getElementById("csvInput");
    if (!dz) return;
    dz.addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && importCsv(input.files[0]));
    ["dragover", "dragenter"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add("drag");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove("drag");
      })
    );
    dz.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (f) importCsv(f);
    });
  }

  function importCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const books = parseGoodreadsCsv(reader.result);
        if (!books.length) {
          alert("No books found in that CSV. Make sure it's the Goodreads Library Export file.");
          return;
        }
        importGoodreadsBooks(books);
      } catch (err) {
        alert("Could not parse that CSV: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // Merge new books in, skipping any already present (by ISBN, else author+title).
  function dedupeKey(b) {
    const isbn = (b.isbn || "").replace(/[^0-9Xx]/g, "");
    return isbn ? "i:" + isbn : "t:" + (b.author + "|" + b.title).toLowerCase().trim();
  }
  function importGoodreadsBooks(books) {
    const seen = new Set(GOODREADS.map(dedupeKey));
    let id = nextId(GOODREADS);
    let added = 0;
    for (const nb of books) {
      const k = dedupeKey(nb);
      if (seen.has(k)) continue;
      seen.add(k);
      const n = normalize(nb, id);
      id++;
      GOODREADS.push(n);
      added++;
    }
    persistGoodreads();
    buildFilters();
    render();
    const dup = books.length - added;
    toast(added ? `Added ${added} new · ${dup} already in your library` : `Nothing new · ${dup} already in your library`);
  }

  function loadStoredGoodreads() {
    try {
      const raw = localStorage.getItem("goodreads.v1");
      if (raw) return JSON.parse(raw).map(normalize);
    } catch (e) {}
    return null;
  }

  /* ---------------- reading list import (paste Markdown) ---------------- */
  const READING_SAMPLE = `## Philosophy
- Plato — _The Republic_ ✅
- Aristotle — _Nicomachean Ethics_
- Marcus Aurelius — _Meditations_

## Epic & Classics
- Homer — _The Odyssey_ ✅
- Homer — _The Iliad_
- Dante — _The Divine Comedy_

## Fiction
- Mary Shelley — _Frankenstein_
- Jane Austen — _Pride and Prejudice_ ✅
- Fyodor Dostoevsky — _Crime and Punishment_
- Herman Melville — _Moby-Dick_

## Science
- Charles Darwin — _On the Origin of Species_
- Nicolaus Copernicus — _On the Revolutions of the Heavenly Spheres_

## History
- Herodotus — _The Histories_
- Edward Gibbon — _The Decline and Fall of the Roman Empire_`;

  function renderReadingImport() {
    els.results.className = "";
    els.results.innerHTML = `
      <section class="import">
        <div class="hero">
          <svg class="hero-logo" viewBox="0 0 32 32" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 8.5C13 6.5 8 6 4.5 7v18C8 24 13 24.5 16 26.5 19 24.5 24 24 27.5 25V7C24 6 19 6.5 16 8.5Z" />
            <path d="M16 8.5v18" />
          </svg>
          <h1>Library</h1>
          <p class="tagline">A minimalist dashboard for your reading. Build a reading list and browse your
          Goodreads library — search, filter by genre, and see every cover. Everything runs in your
          browser; nothing is uploaded.</p>
          <ol class="how">
            <li><span class="step">1</span><div><strong>Build a reading list</strong>Paste a Markdown list below, or load the sample to see how it works.</div></li>
            <li><span class="step">2</span><div><strong>Import Goodreads</strong>Open the Goodreads tab and drop your library export CSV — genres are tagged automatically.</div></li>
            <li><span class="step">3</span><div><strong>Search &amp; filter</strong>Filter by author, category, genre, and read status; toggle grid or list.</div></li>
          </ol>
        </div>
        <h2>Build your reading list</h2>
        <p>Paste a Markdown list below. Use <code>##</code> / <code>###</code> for categories and one book per line:
        <code>- Author — _Title_</code>. Add <code>✅</code> for books you've read and <code>!primary</code> for primary sources.</p>
        <textarea id="mdInput" spellcheck="false" placeholder="## Philosophy&#10;- Plato — _The Republic_ ✅&#10;- Aristotle — _Nicomachean Ethics_"></textarea>
        <div class="import-actions">
          <button class="btn-primary" id="mdLoad" type="button">Load list</button>
          <button class="btn-ghost" id="mdSample" type="button">Try a sample</button>
        </div>
        <label class="dropzone" id="mdDrop">
          <strong>…or drop a .md / .txt file</strong>
          <span>your reading list as Markdown</span>
          <input type="file" id="mdFile" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden />
        </label>
      </section>`;
    els.tagbar.innerHTML = "";
    wireReadingImport();
  }

  function wireReadingImport() {
    const ta = document.getElementById("mdInput");
    document.getElementById("mdLoad").addEventListener("click", () => importReadingText(ta.value));
    document.getElementById("mdSample").addEventListener("click", () => importReadingText(READING_SAMPLE));
    const drop = document.getElementById("mdDrop");
    const file = document.getElementById("mdFile");
    drop.addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importReadingText(reader.result);
      reader.readAsText(f);
    });
    ["dragover", "dragenter"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("drag");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("drag");
      })
    );
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importReadingText(reader.result);
      reader.readAsText(f);
    });
  }

  function importReadingText(text) {
    const books = parseReadingMarkdown(text || "");
    if (!books.length) {
      alert("No books found. Use lines like:  - Author — _Title_  under a ## Category heading.");
      return;
    }
    READING = books.map(normalize);
    try {
      localStorage.setItem("readinglist.v1", JSON.stringify(READING));
    } catch (e) {}
    buildFilters();
    render();
  }

  function loadStoredReading() {
    try {
      const raw = localStorage.getItem("readinglist.v1");
      if (raw) return JSON.parse(raw).map(normalize);
    } catch (e) {}
    return null;
  }

  function cleanReadingTitle(t) {
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

  function parseReadingMarkdown(text) {
    let cat = "",
      sub = "",
      subsub = "";
    const books = [];
    const seen = new Set();
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, "");
      if (line.startsWith("#### ")) {
        subsub = line.slice(5).trim();
        continue;
      }
      if (line.startsWith("### ")) {
        sub = line.slice(4).trim();
        subsub = "";
        continue;
      }
      if (line.startsWith("## ")) {
        cat = line.slice(3).trim();
        sub = subsub = "";
        continue;
      }
      if (line.startsWith("# ")) {
        cat = line.slice(2).trim();
        sub = subsub = "";
        continue;
      }
      const m = line.match(/^\s*[-*]\s+(.*)$/);
      if (!m) continue;
      let item = m[1].trim();
      if (!item) continue;
      const read = item.includes("✅") || /\[x\]/i.test(item);
      const primary = /!primary/i.test(item);
      item = item.replace(/✅/g, "").replace(/!primary/gi, "").replace(/^\[[ xX]\]\s*/, "").trim();
      let author = "";
      let parsed;
      const split = item.match(/^(.*?)\s[—–-]\s(.*)$/); // "Author — Title" (em/en/hyphen)
      if (split) {
        author = split[1].trim();
        parsed = cleanReadingTitle(split[2]);
      } else {
        parsed = cleanReadingTitle(item);
      }
      if (!parsed.title) continue;
      const key = (author + "|" + parsed.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      books.push({
        title: parsed.title,
        author,
        category: cat || "Uncategorized",
        subcategory: sub,
        subsubcategory: subsub,
        read,
        primary,
        note: parsed.note,
        id: books.length,
      });
    }
    return books;
  }

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

  /* ---------------- events ---------------- */
  function resetFiltersForTab() {
    state.author = "";
    state.category = "";
    state.genre = "";
    state.status = "";
    els.statusFilter.value = "";
    els.search.value = state.q; // keep search across tabs
  }

  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === btn));
    resetFiltersForTab();
    updateActionButtons();
    buildFilters();
    render();
  });

  let searchT;
  els.search.addEventListener("input", (e) => {
    clearTimeout(searchT);
    state.q = e.target.value;
    searchT = setTimeout(render, 120);
  });

  els.authorFilter.addEventListener("change", (e) => {
    state.author = e.target.value;
    render();
  });
  els.statusFilter.addEventListener("change", (e) => {
    state.status = e.target.value;
    render();
  });
  els.sortBy.addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });
  els.viewToggle.addEventListener("click", () => {
    state.view = state.view === "grid" ? "list" : "grid";
    els.viewToggle.textContent = state.view === "grid" ? "Grid" : "List";
    render();
  });

  els.tagbar.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (state.tab === "goodreads") state.genre = chip.dataset.genre;
    else state.category = chip.dataset.cat;
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    render();
  });

  /* ---------------- helpers ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function attr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  /* ---------------- data mutations (add / delete) ---------------- */
  function persist() {
    if (state.tab === "reading") {
      try { localStorage.setItem("readinglist.v1", JSON.stringify(READING)); } catch (e) {}
    } else {
      persistGoodreads();
    }
  }
  function persistGoodreads() {
    try { localStorage.setItem("goodreads.v1", JSON.stringify(GOODREADS)); } catch (e) {}
  }
  function nextId(arr) {
    return arr.reduce((m, b) => Math.max(m, b.id || 0), -1) + 1;
  }
  function bookById(id) {
    return currentData().find((b) => String(b.id) === String(id));
  }
  function deleteBook(id) {
    const arr = currentData();
    const i = arr.findIndex((b) => String(b.id) === String(id));
    if (i < 0) return;
    const [removed] = arr.splice(i, 1);
    persist();
    buildFilters();
    render();
    toast(`Removed “${removed.title}”`);
  }
  function addBookToCurrent(data) {
    const arr = currentData();
    const b = normalize(data, nextId(arr));
    arr.unshift(b);
    persist();
    buildFilters();
    render();
    toast(`Added “${b.title}”`);
  }

  /* ---------------- book summaries (Open Library work descriptions) ---------------- */
  const DESC_KEY = "descCache.v1";
  let descCache = {};
  try { descCache = JSON.parse(localStorage.getItem(DESC_KEY) || "{}"); } catch (e) { descCache = {}; }
  let descDirty = false;
  setInterval(() => {
    if (descDirty) {
      try { localStorage.setItem(DESC_KEY, JSON.stringify(descCache)); } catch (e) {}
      descDirty = false;
    }
  }, 1500);

  async function getDescription(b) {
    const k = genreKey(b);
    if (descCache[k] !== undefined) return descCache[k];
    const d = await resolveDescription(b);
    descCache[k] = d;
    descDirty = true;
    return d;
  }
  async function resolveDescription(b) {
    let workKey = null;
    const isbn = (b.isbn || "").replace(/[^0-9Xx]/g, "");
    if (isbn) {
      try {
        const e = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
        if (e.ok) { const ed = await e.json(); workKey = ed.works && ed.works[0] && ed.works[0].key; }
      } catch (e) {}
    }
    if (!workKey) {
      try {
        const p = new URLSearchParams({ title: b.title, limit: "1", fields: "key" });
        if (b.author) p.set("author", b.author);
        const r = await fetch(`https://openlibrary.org/search.json?${p}`);
        if (r.ok) { const j = await r.json(); workKey = j.docs && j.docs[0] && j.docs[0].key; }
      } catch (e) {}
    }
    if (workKey) {
      try {
        const w = await fetch(`https://openlibrary.org${workKey}.json`);
        if (w.ok) {
          const wj = await w.json();
          let d = wj.description;
          if (d && typeof d === "object") d = d.value;
          if (typeof d === "string" && d.trim()) return cleanDesc(d);
        }
      } catch (e) {}
    }
    // fallback: Wikipedia (searched with title + author to land on the right page)
    const wiki = await wikiSummary(b.title, b.author);
    return wiki ? cleanDesc(wiki) : "";
  }
  async function wikiSummary(title, author) {
    try {
      const q = encodeURIComponent(`${title} ${author || ""}`.trim());
      const s = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=1&format=json&origin=*`
      );
      if (!s.ok) return "";
      const sj = await s.json();
      const hit = sj.query && sj.query.search && sj.query.search[0];
      if (!hit) return "";
      const r = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`
      );
      if (!r.ok) return "";
      const rj = await r.json();
      if (rj.type === "disambiguation") return "";
      return rj.extract || "";
    } catch (e) {
      return "";
    }
  }
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

  /* ---------------- modal (detail popup + add form) ---------------- */
  let modalBookId = null;
  function closeModal() {
    modalBookId = null;
    document.getElementById("modalHost").innerHTML = "";
    document.removeEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function openModal(inner) {
    const host = document.getElementById("modalHost");
    host.innerHTML =
      `<div class="overlay" id="overlay"><div class="modal" role="dialog" aria-modal="true">` +
      `<button class="modal-close" aria-label="Close">×</button>${inner}</div></div>`;
    const overlay = host.querySelector(".overlay");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    host.querySelector(".modal-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", escClose);
  }

  function openDetail(id) {
    const b = bookById(id);
    if (!b) return;
    modalBookId = b.id;
    const tags = b.genres && b.genres.length ? b.genres : [b.category, b.subcategory].filter(Boolean);
    const meta = [b.read ? "✓ Read" : "Unread"];
    if (b.primary) meta.push("Primary source");
    if (b.rating) meta.push("★ " + b.rating + "/5");
    openModal(`
      <div class="detail">
        <div class="d-cover" id="dCover"><div class="fallback"><div class="ft">${escapeHtml(b.title)}</div></div></div>
        <div class="d-info">
          <h3>${escapeHtml(b.title)}</h3>
          <div class="d-author">${escapeHtml(b.author || "Unknown author")}</div>
          <div class="d-tags" id="dTags">${tags.map((t) => `<span class="d-tag">${escapeHtml(t)}</span>`).join("")}</div>
          <div class="d-meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join("")}</div>
        </div>
        <div class="d-summary muted" id="dSummary">Loading summary…</div>
        <div class="d-actions"><button class="btn-danger" id="dDelete">Delete book</button></div>
      </div>`);
    setDetailCover(document.getElementById("dCover"), b);
    document.getElementById("dDelete").addEventListener("click", () => { closeModal(); deleteBook(id); });
    loadDetailExtras(b);
  }

  async function setDetailCover(cov, b) {
    if (!cov) return;
    const key = keyFor(b.author, b.title);
    let url = cache[key];
    if (url === undefined) {
      url = await resolveCover(b.title, b.author, (b.isbn || "").replace(/[^0-9Xx]/g, ""));
      cache[key] = url;
      cacheDirty = true;
    }
    if (url && modalBookId === b.id) {
      const im = new Image();
      im.alt = "";
      im.addEventListener("load", () => { if (modalBookId === b.id) { cov.innerHTML = ""; cov.appendChild(im); } });
      im.src = url;
    }
  }

  async function loadDetailExtras(b) {
    const needGenres = !(b.genres && b.genres.length);
    const [desc, genres] = await Promise.all([
      getDescription(b),
      needGenres ? resolveGenres(b) : Promise.resolve(b.genres || []),
    ]);
    if (modalBookId !== b.id) return; // modal closed or switched
    if (needGenres && genres.length) {
      b.genres = genres;
      const base = state.tab === "reading" ? [b.category, b.subcategory].filter(Boolean) : [];
      const all = [...new Set([...base, ...genres])];
      const tagsEl = document.getElementById("dTags");
      if (tagsEl) tagsEl.innerHTML = all.map((t) => `<span class="d-tag">${escapeHtml(t)}</span>`).join("");
    }
    const sEl = document.getElementById("dSummary");
    if (sEl) {
      if (desc) { sEl.textContent = desc; sEl.classList.remove("muted"); }
      else { sEl.textContent = "No summary found for this edition."; }
    }
  }

  function openAddForm() {
    const gr = state.tab === "goodreads";
    openModal(`
      <form class="mform" id="addForm">
        <h3>Add a book${gr ? " to your Goodreads library" : " to your reading list"}</h3>
        <label>Title<input type="text" id="fTitle" required autocomplete="off" spellcheck="false" /></label>
        <label>Author<input type="text" id="fAuthor" autocomplete="off" spellcheck="false" /></label>
        <label>ISBN <span style="text-transform:none;letter-spacing:normal;color:var(--faint)">— optional, improves cover &amp; genres</span><input type="text" id="fIsbn" autocomplete="off" spellcheck="false" /></label>
        ${gr
          ? `<label>Shelf<select id="fShelf"><option value="read">Read</option><option value="to-read">To Read</option><option value="currently-reading">Currently Reading</option></select></label>`
          : `<label>Category<input type="text" id="fCat" placeholder="e.g. Philosophy" autocomplete="off" spellcheck="false" /></label>
             <label class="row-check"><input type="checkbox" id="fRead" /> I've read this</label>`}
        <div class="mform-actions">
          <button type="button" class="btn-ghost" id="fCancel">Cancel</button>
          <button type="submit" class="btn-primary">Add book</button>
        </div>
      </form>`);
    document.getElementById("fCancel").addEventListener("click", closeModal);
    document.getElementById("addForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const title = document.getElementById("fTitle").value.trim();
      if (!title) return;
      const author = document.getElementById("fAuthor").value.trim();
      const isbn = document.getElementById("fIsbn").value.replace(/[^0-9Xx]/g, "");
      let data;
      if (gr) {
        const shelf = document.getElementById("fShelf").value;
        data = { title, author, isbn, category: prettyShelf(shelf), read: shelf === "read", rating: 0 };
      } else {
        const category = document.getElementById("fCat").value.trim() || "Uncategorized";
        data = { title, author, isbn, category, read: document.getElementById("fRead").checked, primary: false };
      }
      closeModal();
      addBookToCurrent(data);
    });
    setTimeout(() => { const t = document.getElementById("fTitle"); if (t) t.focus(); }, 30);
  }

  /* ---------------- toast ---------------- */
  let toastT;
  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    void t.offsetWidth; // force reflow so the transition plays
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => { t.hidden = true; }, 250);
    }, 2600);
  }

  /* ---------------- action buttons + card clicks ---------------- */
  function updateActionButtons() {
    document.getElementById("importMore").hidden = state.tab !== "goodreads";
  }
  document.getElementById("addBook").addEventListener("click", openAddForm);
  const importMoreInput = document.getElementById("importMoreInput");
  document.getElementById("importMore").addEventListener("click", () => importMoreInput.click());
  importMoreInput.addEventListener("change", () => {
    if (importMoreInput.files[0]) importCsv(importMoreInput.files[0]);
    importMoreInput.value = "";
  });
  els.results.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card && card.dataset.id != null) openDetail(card.dataset.id);
  });

  /* ---------------- boot ---------------- */
  updateActionButtons();
  buildFilters();
  render();
})();
