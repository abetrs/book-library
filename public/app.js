/* Library — client.
 * Talks to the server's JSON API (see server/app.js). The library is kept in
 * memory and mirrored in localStorage, so repeat visits render instantly from
 * the last snapshot and then fetch only what changed since (by revision).
 * Dewey helpers (DDC), the outline (DEWEY) and book identity (Dedupe) are
 * shared with the server from /shared.
 */
(() => {
  "use strict";

  const DEWEY = window.DEWEY;
  const { cleanDdc, sectionLabel, divisionLabel, ddcLabel, ddcPath, looksLikeDdc, parseDdcQuery, ddcMatches, prefixDisplay, prefixQuery, shortMain } = window.DDC;
  const { surname, normTitle } = window.Dedupe;
  const SHELVES = { read: "Read", "to-read": "To Read", "currently-reading": "Currently Reading" };
  const prettyShelf = (s) => SHELVES[s] || s;

  let READING = [];
  let GOODREADS = [];
  const books = new Map(); // id -> book (both lists)
  let libRev = -1; // library revision we have
  let pending = 0; // books the server is still classifying

  const state = {
    tab: "reading",
    q: "",
    ddc: "", // Dewey query: "8", "82", "8238" (prefix digits), "300-399", or "none"
    author: "",
    status: "",
    sort: "ddc",
    view: "grid",
  };

  const els = {
    results: document.getElementById("results"),
    count: document.getElementById("count"),
    empty: document.getElementById("empty"),
    search: document.getElementById("search"),
    ddcInput: document.getElementById("ddcInput"),
    authorFilter: document.getElementById("authorFilter"),
    statusFilter: document.getElementById("statusFilter"),
    sortBy: document.getElementById("sortBy"),
    viewToggle: document.getElementById("viewToggle"),
    tagbar: document.getElementById("tagbar"),
    tabs: document.getElementById("tabs"),
    footNote: document.getElementById("footNote"),
    syncState: document.getElementById("syncState"),
  };

  function currentData() {
    return state.tab === "reading" ? READING : GOODREADS;
  }

  /* ---------------- API ---------------- */
  class ApiError extends Error {}
  async function api(method, path, body) {
    const opts = { method, headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (method !== "GET") opts.headers["X-Library"] = "1";
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let r;
    try {
      r = await fetch(path, opts);
    } catch (e) {
      setSync("offline");
      const err = new ApiError("You're offline — couldn't reach the server");
      err.network = true;
      throw err;
    }
    let data = null;
    try {
      data = await r.json();
    } catch (e) {}
    if (r.status === 401 && path !== "/api/login") {
      showLogin();
      throw new ApiError("Please log in");
    }
    if (!r.ok) {
      const err = new ApiError((data && data.error) || `Request failed (${r.status})`);
      err.status = r.status;
      err.offline = !!(data && data.offline);
      throw err;
    }
    return data;
  }

  /* ---------------- library sync ----------------
   * The server stamps every change with a revision. We ask for changes since the
   * revision we hold; a snapshot in localStorage makes reloads instant.
   */
  const SNAP_KEY = "library.snapshot.v2";
  function saveSnapshot() {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({ rev: libRev, books: [...books.values()] }));
    } catch (e) {} // storage full / disabled: we'll just fetch in full next time
  }
  function loadSnapshot() {
    try {
      const s = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
      if (s && Array.isArray(s.books)) {
        s.books.forEach((b) => books.set(b.id, b));
        libRev = s.rev;
        rebuildLists();
        return true;
      }
    } catch (e) {}
    return false;
  }
  const byPosition = (a, b) => a.position - b.position || a.id - b.id;
  function rebuildLists() {
    const all = [...books.values()];
    READING = all.filter((b) => b.list === "reading").sort(byPosition);
    GOODREADS = all.filter((b) => b.list === "goodreads").sort(byPosition);
  }

  let syncing = null;
  let pollT = null;
  // Pull changes; `rerender` re-shelves when books were added/removed/reclassified.
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const d = await api("GET", libRev >= 0 ? `/api/books?since=${libRev}` : "/api/books");
        const before = { ids: new Set(books.keys()), ddc: new Map([...books.values()].map((b) => [b.id, b.ddc])) };
        if (d.full) books.clear();
        d.books.forEach((b) => books.set(b.id, b));
        d.deleted.forEach((id) => books.delete(id));
        const changed = d.full || d.books.length || d.deleted.length;
        libRev = d.rev;
        const wasPending = pending;
        pending = d.pending;
        if (changed) {
          rebuildLists();
          saveSnapshot();
          const structural =
            d.full || d.deleted.length || d.books.some((b) => !before.ids.has(b.id)) ||
            d.books.some((b) => before.ddc.get(b.id) !== b.ddc && state.sort === "ddc");
          if (structural) {
            buildFilters();
            render();
          } else {
            d.books.forEach(updateCardTag);
            scheduleChipRefresh();
          }
          if (modalBookId != null && d.books.some((b) => b.id === modalBookId)) refreshDetail(modalBookId);
        } else if (wasPending !== pending) scheduleChipRefresh();
        setSync("ok");
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      } finally {
        syncing = null;
        schedulePoll();
      }
    })();
    return syncing;
  }
  // Poll quickly while the server is classifying, lazily otherwise.
  function schedulePoll() {
    clearTimeout(pollT);
    if (document.hidden) return;
    pollT = setTimeout(sync, pending > 0 ? 2500 : 60000);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sync();
    else clearTimeout(pollT);
  });

  function setSync(st) {
    if (!els.syncState) return;
    els.syncState.textContent = st === "offline" ? "Offline — showing your last copy" : "";
    els.syncState.hidden = st !== "offline";
  }

  /* ---------------- filtering ---------------- */
  function apply(asText = false) {
    const data = currentData();
    let q = state.q.trim().toLowerCase();
    // A Dewey number typed straight into the main search box searches by class
    // (falling back to plain text, so a title like "1984" or "451" still works).
    const qDdc = !asText && looksLikeDdc(q) ? parseDdcQuery(q) : null;
    if (qDdc) q = "";
    const fDdc = parseDdcQuery(state.ddc);
    let out = data.filter((b) => {
      if (fDdc && !ddcMatches(b.ddc, fDdc)) return false;
      if (qDdc && !ddcMatches(b.ddc, qDdc)) return false;
      if (state.author && b.author !== state.author) return false;
      if (state.status === "read" && !b.read) return false;
      if (state.status === "unread" && b.read) return false;
      if (state.status === "primary" && !b.primary) return false;
      if (q) {
        const hay = [b.title, b.author, b.category, b.subcategory, (b.genres || []).join(" "), b.ddc, ddcLabel(b.ddc)]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (qDdc && !out.length) return apply(true);

    if (state.sort === "ddc") out = out.slice().sort(compareShelf);
    else if (state.sort === "title") out = out.slice().sort((a, b) => a.title.localeCompare(b.title));
    else if (state.sort === "author")
      out = out.slice().sort((a, b) => (a.author || "￿").localeCompare(b.author || "￿"));

    return out;
  }

  // Shelf order: Dewey number digit by digit, then author surname, then title.
  // Unclassified books go last.
  function compareShelf(a, b) {
    if (a.ddc !== b.ddc) {
      if (!a.ddc) return 1;
      if (!b.ddc) return -1;
      return a.ddc < b.ddc ? -1 : 1; // fixed 3-digit integer part => string order is shelf order
    }
    return surname(a.author).localeCompare(surname(b.author)) || a.title.localeCompare(b.title);
  }

  /* ---------------- rendering ---------------- */
  let firstRender = true;
  function render() {
    updateActionButtons();
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
    let shelf = null;
    list.forEach((b, i) => {
      // In shelf order, head each Dewey division (e.g. "820 English & Old English literatures").
      if (state.sort === "ddc") {
        const div = b.ddc ? b.ddc.slice(0, 2) : "";
        if (div !== shelf) {
          shelf = div;
          const h = document.createElement("h4");
          h.className = "shelf-head";
          h.innerHTML = div
            ? `<span class="sh-n">${div}0</span>${escapeHtml(divisionLabel(div))}<span class="sh-c">${escapeHtml(DEWEY.MAIN[div[0]])}</span>`
            : `<span class="sh-n">—</span>Not yet classified`;
          frag.appendChild(h);
        }
      }
      frag.appendChild(card(b, i));
    });
    els.results.appendChild(frag);

    updateChrome(list, currentData());
    firstRender = false;
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
    if (firstRender) el.style.animationDelay = Math.min(i * 12, 320) + "ms";
    else el.classList.add("still"); // re-renders (sync, filters) don't replay the entrance

    const initials = escapeHtml(b.title);
    const badge = b.read ? '<div class="badge" title="Read">✓</div>' : "";
    const primary = b.primary ? '<div class="badge primary">Primary</div>' : "";

    el.innerHTML = `
      <div class="cover">
        ${coverImg(b)}
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
    if (b.ddc) return `${b.ddc}${b.ddcSrc === "est" ? "~" : ""} · ${ddcLabel(b.ddc)}`;
    return b.classified ? "Unclassified" : "Classifying…";
  }

  /* ---------------- covers ----------------
   * Served by our server from its disk cache (/covers/<key>.jpg, immutable), so
   * the browser fetches each cover once; native lazy loading does the pacing.
   */
  function coverImg(b) {
    if (b.custom) return "";
    return `<img src="/covers/${b.cover}.jpg" alt="" loading="lazy" decoding="async" />`;
  }
  // Fade covers in when they arrive; cached ones appear immediately; misses keep the typographic cover.
  els.results.addEventListener("load", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    img.classList.add("loaded");
    const fb = img.parentElement.querySelector(".fallback");
    if (fb) fb.style.opacity = "0";
  }, true);
  // Any image that fails (no cover, offline) is dropped, leaving the fallback underneath.
  document.addEventListener("error", (e) => {
    if (e.target.tagName === "IMG") e.target.remove();
  }, true);
  // Search-result thumbnails come through our server's image cache too.
  const proxied = (url) => `/img?u=${encodeURIComponent(url)}`;

  function updateCardTag(b) {
    if (!currentData().includes(b)) return;
    const c = els.results.querySelector(`.card[data-id="${b.id}"] .c`);
    if (c) c.textContent = cardTag(b);
  }
  let refreshT;
  function scheduleChipRefresh() {
    clearTimeout(refreshT);
    refreshT = setTimeout(() => {
      if (currentData().length) buildDdcChips(currentData());
    }, 300);
  }

  /* ---------------- Dewey chips: class › division › section drill-down ---------------- */
  function ddcCounts(data) {
    const c = { none: 0 };
    for (const b of data) {
      if (!b.ddc) {
        if (b.classified) c.none++;
        continue;
      }
      const d = b.ddc.replace(".", "");
      for (let i = 1; i <= 3; i++) c[d.slice(0, i)] = (c[d.slice(0, i)] || 0) + 1;
    }
    return c;
  }

  function buildDdcChips(data) {
    const counts = ddcCounts(data);
    const f = parseDdcQuery(state.ddc);
    const p = f && f.type === "prefix" ? f.p : "";
    const chip = (code, label, n, active, title) =>
      `<button class="chip ${active ? "is-active" : ""}" data-ddc="${attr(code)}" title="${attr(title || label)}">${escapeHtml(
        label
      )}<span class="n">${n}</span></button>`;

    let html = `<div class="chip-row">` + chip("", "All", data.length, !state.ddc);
    for (let d = 0; d <= 9; d++) {
      const k = String(d);
      if (!counts[k] && p[0] !== k) continue;
      html += chip(k, `${k}00 ${shortMain(k)}`, counts[k] || 0, p[0] === k, DEWEY.MAIN[k]);
    }
    if (counts.none) html += chip("none", "Unclassified", counts.none, state.ddc === "none");
    const waiting = data.filter((b) => !b.classified).length;
    if (waiting > 0) html += `<span class="chip-loading">classifying… ${data.length - waiting}/${data.length}</span>`;
    html += `</div>`;

    // second / third rows: divisions of the chosen class, sections of the chosen division
    for (let lvl = 1; lvl <= 2 && p.length >= lvl; lvl++) {
      const parent = p.slice(0, lvl);
      let row = "";
      for (let d = 0; d <= 9; d++) {
        const k = parent + d;
        if (!counts[k]) continue;
        const label = lvl === 1 ? divisionLabel(k) : sectionLabel(k);
        row += chip(k, `${prefixDisplay(k)} ${label}`, counts[k], p.startsWith(k), label);
      }
      if (row) html += `<div class="chip-row sub">${row}</div>`;
    }
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
    els.ddcInput.value = state.ddc === "none" ? "" : state.ddc;

    buildDdcChips(data);
  }

  // code: prefix digits ("8", "82", "8238"), "none" for unclassified, or "" for all
  function setDdcFilter(code) {
    state.ddc = !code ? "" : code === "none" ? "none" : prefixQuery(code);
    els.ddcInput.value = state.ddc === "none" ? "" : state.ddc;
    buildDdcChips(currentData());
    render();
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
    reader.onload = () => upload({ list: "goodreads", format: "csv", text: reader.result });
    reader.readAsText(file);
  }

  // Send an import to the server (it parses, de-duplicates and merges), then pull the changes.
  async function upload(body) {
    try {
      const r = await api("POST", "/api/import", body);
      closeModal();
      await sync();
      const skipped = r.dup ? ` · ${r.dup} duplicate${r.dup === 1 ? "" : "s"} skipped` : "";
      toast(r.added ? `Added ${r.added} new${skipped}` : `Nothing new${skipped}`);
    } catch (e) {
      alert(e.message);
    }
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
          Goodreads library — shelved and searchable by Dewey Decimal number, with every cover. Everything
          lives in the library database on your own server.</p>
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

  // A pasted/dropped list. A full backup (with "# Reading List" / "# Goodreads"
  // sections) restores both lists; anything else goes into the Reading List.
  function importReadingText(text) {
    text = String(text || "");
    if (!text.trim()) return alert("No books found. Use lines like:  - Author — _Title_  under a ## Category heading.");
    const isBackup = /^#\s+(reading list|goodreads)\s*$/im.test(text);
    upload(isBackup ? { format: "export", text } : { list: "reading", format: "markdown", text });
  }

  /* ---------------- events ---------------- */
  function resetFiltersForTab() {
    state.author = "";
    state.ddc = "";
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
    // clicking the active chip steps back up one level
    const code = chip.dataset.ddc;
    setDdcFilter(chip.classList.contains("is-active") && code && code !== "none" ? code.slice(0, -1) : code);
  });

  let ddcT;
  els.ddcInput.addEventListener("input", () => {
    clearTimeout(ddcT);
    ddcT = setTimeout(() => {
      const v = els.ddcInput.value.trim();
      if (v && !parseDdcQuery(v)) {
        els.ddcInput.classList.add("bad");
        return;
      }
      els.ddcInput.classList.remove("bad");
      state.ddc = v;
      buildDdcChips(currentData());
      render();
    }, 200);
  });
  document.getElementById("ddcBrowse").addEventListener("click", () => openDdcPicker({ mode: "search" }));
  document.getElementById("ddcGuide").addEventListener("click", openDdcGuide);

  /* ---------------- helpers ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function attr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  /* ---------------- clear library (deliberately hard to do by accident) ---------------- */
  function openClearDialog() {
    const counts = { reading: READING.length, goodreads: GOODREADS.length };
    const total = counts.reading + counts.goodreads;
    if (!total) return toast("Your library is already empty");
    const opt = (v, label, n, checked) =>
      `<label class="row-check"><input type="radio" name="clrScope" value="${v}" ${checked ? "checked" : ""} ${n ? "" : "disabled"} /> ${label} <span class="muted">(${n} book${n === 1 ? "" : "s"})</span></label>`;
    openModal(`
      <div class="mform clear-dlg">
        <h3>Clear library</h3>
        <p class="pk-hint">This permanently deletes books from the library database on your server.
        There's no undo — the only way back is a backup.</p>
        <div class="clr-scope">
          ${opt("all", "Everything", total, true)}
          ${opt("reading", "Only the Reading List", counts.reading, false)}
          ${opt("goodreads", "Only the Goodreads library", counts.goodreads, false)}
        </div>
        <p class="pk-hint">Download a backup first — you can bring it back with <strong>Import list</strong> or by restoring the file.</p>
        <div class="mform-actions">
          <button type="button" class="btn-ghost" id="clrBackup">Download backup</button>
          <button type="button" class="btn-ghost" id="clrCancel">Cancel</button>
          <button type="button" class="btn-danger" id="clrNext">Continue…</button>
        </div>
      </div>`);
    document.getElementById("clrBackup").addEventListener("click", downloadBackup);
    document.getElementById("clrCancel").addEventListener("click", closeModal);
    document.getElementById("clrNext").addEventListener("click", () => {
      const scope = document.querySelector('#modalHost input[name="clrScope"]:checked').value;
      confirmClear(scope, scope === "all" ? total : counts[scope]);
    });
  }

  // Second step: type a phrase, then wait out a short countdown before the button arms.
  function confirmClear(scope, n) {
    const what = { all: "your entire library", reading: "your Reading List", goodreads: "your Goodreads library" }[scope];
    const phrase = `delete ${n} book${n === 1 ? "" : "s"}`;
    openModal(`
      <div class="mform clear-dlg">
        <h3>Are you really sure?</h3>
        <p class="st-err">You're about to delete ${what}: <strong>${n} book${n === 1 ? "" : "s"}</strong>, with their Dewey numbers, ratings and notes.</p>
        <label>Type <code>${phrase}</code> to confirm<input type="text" id="clrPhrase" autocomplete="off" spellcheck="false" /></label>
        <div class="mform-actions">
          <button type="button" class="btn-ghost" id="clrCancel">Cancel — keep my books</button>
          <button type="button" class="btn-danger armed-off" id="clrGo" disabled>Delete ${n} book${n === 1 ? "" : "s"}</button>
        </div>
      </div>`);
    const inp = document.getElementById("clrPhrase");
    const go = document.getElementById("clrGo");
    let wait = 5;
    const label = go.textContent;
    const update = () => {
      const typed = inp.value.trim().toLowerCase() === phrase;
      go.disabled = !(typed && wait <= 0);
      go.classList.toggle("armed-off", go.disabled);
      go.textContent = typed && wait > 0 ? `${label} (${wait})` : label;
    };
    const tick = setInterval(() => {
      if (!document.getElementById("clrGo")) return clearInterval(tick);
      wait--;
      update();
      if (wait <= 0) clearInterval(tick);
    }, 1000);
    inp.addEventListener("input", update);
    document.getElementById("clrCancel").addEventListener("click", closeModal);
    go.addEventListener("click", async () => {
      if (go.disabled) return;
      go.disabled = true;
      try {
        // the server re-checks the phrase against its own count
        const r = await api("POST", "/api/clear", { scope, confirm: inp.value.trim().toLowerCase() });
        Object.assign(state, { q: "", ddc: "", author: "", status: "" });
        els.search.value = "";
        els.statusFilter.value = "";
        closeModal();
        await sync();
        toast(`Deleted ${r.deleted} book${r.deleted === 1 ? "" : "s"}`);
      } catch (e) {
        toast(e.message);
        go.disabled = false;
      }
    });
    setTimeout(() => inp.focus(), 30);
  }

  /* ---------------- modal (detail popup + add form) ---------------- */
  let modalBookId = null;
  function closeModal() {
    modalBookId = null;
    document.getElementById("modalHost").innerHTML = "";
    document.removeEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function openModal(inner, cls = "") {
    const host = document.getElementById("modalHost");
    host.innerHTML =
      `<div class="overlay" id="overlay"><div class="modal ${cls}" role="dialog" aria-modal="true">` +
      `<button class="modal-close" aria-label="Close">×</button>${inner}</div></div>`;
    const overlay = host.querySelector(".overlay");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    host.querySelector(".modal-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", escClose);
  }

  function detailTags(b) {
    const base = state.tab === "reading" ? [b.category, b.subcategory].filter((c) => c && c !== "Uncategorized") : [];
    return [...new Set([...base, ...(b.genres || [])])];
  }

  function openDetail(id) {
    const b = bookById(id);
    if (!b) return;
    modalBookId = b.id;
    const tags = detailTags(b);
    const meta = [b.read ? "✓ Read" : "Unread"];
    if (b.primary) meta.push("Primary source");
    if (b.custom) meta.push("Custom book");
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
        <div class="d-ddc" id="dDdc"></div>
        <div class="d-summary muted" id="dSummary">Loading summary…</div>
        <div class="d-actions"><button class="btn-danger" id="dDelete">Delete book</button></div>
      </div>`);
    renderDetailDdc(b);
    setDetailCover(document.getElementById("dCover"), b);
    document.getElementById("dDelete").addEventListener("click", () => { closeModal(); deleteBook(id); });
    loadDetailExtras(b);
  }

  const DDC_SRC = {
    ol: "From library catalog records (Open Library)",
    est: "Estimated from subjects & genres — no catalog record found. Check it or set your own.",
    manual: "Set by you",
  };
  function renderDetailDdc(b) {
    const el = document.getElementById("dDdc");
    if (!el) return;
    const path = ddcPath(b.ddc);
    const head = b.ddc
      ? `<div class="ddc-num">${escapeHtml(b.ddc)}${b.ddcSrc === "est" ? '<span class="ddc-est">est.</span>' : ""}</div>
         <div class="ddc-path">${path
           .map((n) => `<button type="button" class="crumb" data-p="${n.p}" title="Show every book in ${n.code}"><b>${n.code}</b> ${escapeHtml(n.label)}</button>`)
           .join('<span class="sep">›</span>')}${
           b.ddc.length > 3 ? `<span class="sep">›</span><button type="button" class="crumb" data-p="${b.ddc.replace(".", "")}"><b>${escapeHtml(b.ddc)}</b></button>` : ""
         }</div>
         <div class="ddc-src">${escapeHtml(DDC_SRC[b.ddcSrc] || "")}</div>`
      : `<div class="ddc-num muted">${b.classified ? "Unclassified" : "Classifying…"}</div>
         <div class="ddc-src">${b.classified ? "No catalog number or subject match found. Assign one below." : "Looking up the catalog record…"}</div>`;
    el.innerHTML = `
      <div class="ddc-label">Dewey Decimal</div>
      ${head}
      <div class="ddc-edit">
        <input type="text" id="dDdcIn" placeholder="${b.ddc ? "Change number, e.g. " + escapeHtml(b.ddc) : "e.g. 823.8"}" inputmode="decimal" autocomplete="off" spellcheck="false" />
        <button type="button" class="btn-ghost sm" id="dDdcSave">Save</button>
        <button type="button" class="btn-ghost sm" id="dDdcPick">Pick by category…</button>
        ${b.ddcSrc === "manual" ? '<button type="button" class="btn-ghost sm" id="dDdcReset" title="Use the catalog / estimated number again">Reset</button>' : ""}
      </div>`;
    el.querySelectorAll(".crumb").forEach((c) =>
      c.addEventListener("click", () => { closeModal(); setDdcFilter(c.dataset.p); })
    );
    const inp = document.getElementById("dDdcIn");
    const save = () => {
      const n = cleanDdc(inp.value);
      if (!n) { inp.classList.add("bad"); inp.focus(); return; }
      setBookDdc(b, n);
    };
    document.getElementById("dDdcSave").addEventListener("click", save);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    document.getElementById("dDdcPick").addEventListener("click", () =>
      openDdcPicker({ mode: "assign", start: b.ddc, book: b })
    );
    const reset = document.getElementById("dDdcReset");
    if (reset)
      reset.addEventListener("click", async () => {
        try {
          // clearing your number sends the book back through classification
          const r = await api("PATCH", `/api/books/${b.id}`, { ddc: null });
          books.set(r.book.id, r.book);
          await sync();
          refreshDetail(b.id);
        } catch (e) {
          toast(e.message);
        }
      });
  }

  async function setBookDdc(b, n) {
    try {
      const r = await api("PATCH", `/api/books/${b.id}`, { ddc: n });
      books.set(r.book.id, r.book);
      await sync();
      toast(`Filed “${b.title}” under ${n}`);
      openDetail(b.id);
    } catch (e) {
      toast(e.message);
    }
  }

  // Re-draw the open popup's live parts after a sync (classification finished, etc.).
  function refreshDetail(id) {
    const b = books.get(id);
    if (!b || modalBookId !== id) return;
    const tagsEl = document.getElementById("dTags");
    if (tagsEl) tagsEl.innerHTML = detailTags(b).map((t) => `<span class="d-tag">${escapeHtml(t)}</span>`).join("");
    const inp = document.getElementById("dDdcIn");
    if (!inp || !inp.value) renderDetailDdc(b); // don't wipe a number being typed
  }

  function setDetailCover(cov, b) {
    if (!cov || b.custom) return;
    const im = new Image();
    im.alt = "";
    im.addEventListener("load", () => {
      if (modalBookId === b.id) {
        cov.innerHTML = "";
        cov.appendChild(im);
      }
    });
    im.src = `/covers/${b.cover}.jpg`;
  }

  async function loadDetailExtras(b) {
    let desc = "";
    try {
      desc = (await api("GET", `/api/books/${b.id}/summary`)).summary;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    if (modalBookId !== b.id) return; // modal closed or switched
    const sEl = document.getElementById("dSummary");
    if (sEl) {
      if (desc) { sEl.textContent = desc; sEl.classList.remove("muted"); }
      else { sEl.textContent = "No summary found for this edition."; }
    }
  }

  function openAddForm(prefill = {}) {
    const gr = state.tab === "goodreads";
    const hint = (t) => `<span style="text-transform:none;letter-spacing:normal;color:var(--faint)">— ${t}</span>`;
    openModal(`
      <form class="mform" id="addForm" novalidate>
        <h3>Add a book${gr ? " to your Goodreads library" : " to your reading list"}</h3>
        <label>ISBN ${hint("paste one to fill in the title and author")}<input type="text" id="fIsbn" inputmode="numeric" autocomplete="off" spellcheck="false" /></label>
        <div class="isbn-status" id="fIsbnStatus" hidden></div>
        <label>Title<input type="text" id="fTitle" autocomplete="off" spellcheck="false" /></label>
        <label>Author<input type="text" id="fAuthor" autocomplete="off" spellcheck="false" /></label>
        ${gr
          ? `<label>Shelf<select id="fShelf"><option value="read">Read</option><option value="to-read">To Read</option><option value="currently-reading">Currently Reading</option></select></label>`
          : `<label>Category<input type="text" id="fCat" placeholder="e.g. Philosophy" autocomplete="off" spellcheck="false" /></label>
             <label class="row-check"><input type="checkbox" id="fRead" /> I've read this</label>`}
        <label>Dewey number ${hint("optional, looked up automatically if blank")}<input type="text" id="fDdc" placeholder="e.g. 823.8" inputmode="decimal" autocomplete="off" spellcheck="false" /></label>
        <div class="mform-actions">
          <button type="button" class="btn-ghost" id="fCancel">Cancel</button>
          <button type="submit" class="btn-primary" id="fSubmit">Add book</button>
        </div>
      </form>`);
    const $ = (id) => document.getElementById(id);
    for (const [id, v] of Object.entries(prefill)) {
      const el = $(id);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = v;
    }
    $("fCancel").addEventListener("click", closeModal);

    // ISBN autofill: fires as soon as a complete, valid ISBN is pasted or typed.
    let verified = null; // {title, author} confirmed by the ISBN lookup
    let seq = 0;
    const status = $("fIsbnStatus");
    const showStatus = (html) => {
      status.hidden = !html;
      status.innerHTML = html || "";
    };
    const onIsbn = async () => {
      const isbn = $("fIsbn").value.replace(/[^0-9Xx]/g, "").toUpperCase();
      const mine = ++seq;
      verified = null;
      if (isbn.length < 10) return showStatus("");
      if (!window.Dedupe.isValidIsbn(isbn)) return showStatus(isbn.length >= 13 || (isbn.length === 10 && !/^97[89]/.test(isbn)) ? "That doesn't look like a valid ISBN." : "");
      showStatus('<span class="muted">Looking up ISBN…</span>');
      let hit = null;
      try {
        hit = (await api("GET", `/api/lookup/isbn/${isbn}`)).result;
      } catch (e) {
        if (mine === seq) showStatus(escapeHtml(e.message));
        return;
      }
      if (mine !== seq || !$("fIsbn")) return;
      if (!hit) return showStatus("No book found for this ISBN — fill in the details yourself.");
      $("fTitle").value = hit.title;
      $("fAuthor").value = hit.author;
      verified = { title: hit.title, author: hit.author };
      showStatus(
        `${hit.thumb ? `<img src="${attr(proxied(hit.thumb))}" alt="" />` : ""}<div><strong>${escapeHtml(hit.title)}</strong><br />${escapeHtml(
          hit.author || "Unknown author"
        )}${hit.year ? ` · ${escapeHtml(String(hit.year))}` : ""}<br /><span class="muted">Filled in from the ISBN ✓</span></div>`
      );
    };
    let isbnT;
    $("fIsbn").addEventListener("input", () => {
      clearTimeout(isbnT);
      isbnT = setTimeout(onIsbn, 150);
    });

    const readForm = () => {
      const ddcRaw = $("fDdc").value.trim();
      const ddc = cleanDdc(ddcRaw);
      const base = {
        title: $("fTitle").value.trim(),
        author: $("fAuthor").value.trim(),
        isbn: $("fIsbn").value.replace(/[^0-9Xx]/g, ""),
      };
      if (gr) {
        const shelf = $("fShelf").value;
        Object.assign(base, { category: prettyShelf(shelf), read: shelf === "read", rating: 0 });
      } else {
        Object.assign(base, { category: $("fCat").value.trim() || "Uncategorized", read: $("fRead").checked, primary: false });
      }
      if (ddc) Object.assign(base, { ddc, ddcSrc: "manual" });
      return { data: base, ddcRaw, ddcOk: !ddcRaw || !!ddc };
    };
    const snapshot = () => {
      const p = { fIsbn: $("fIsbn").value, fTitle: $("fTitle").value, fAuthor: $("fAuthor").value, fDdc: $("fDdc").value };
      if (gr) p.fShelf = $("fShelf").value;
      else Object.assign(p, { fCat: $("fCat").value, fRead: $("fRead").checked });
      return p;
    };

    $("addForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { data, ddcOk } = readForm();
      if (!ddcOk) return $("fDdc").classList.add("bad");
      if (!data.title) {
        $("fTitle").classList.add("bad");
        return $("fTitle").focus();
      }
      // Confirmed by ISBN and untouched since: add as is.
      if (verified && verified.title === data.title && verified.author === data.author) {
        closeModal();
        return addBookToCurrent(data);
      }
      const btn = $("fSubmit");
      btn.disabled = true;
      btn.textContent = "Checking…";
      const form = snapshot();
      let list = [],
        reached = true;
      try {
        list = (await api("GET", `/api/lookup/search?${new URLSearchParams({ title: data.title, author: data.author })}`)).results;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        reached = false; // catalogs (or the server) unreachable
      }
      if (!$("addForm")) return; // closed meanwhile
      if (!reached) {
        closeModal();
        toast("Couldn't reach the book catalog — added as typed");
        return addBookToCurrent(data);
      }
      const exact = list.find(
        (c) => normTitle(c.title) === normTitle(data.title) && (!data.author || surname(c.author) === surname(data.author))
      );
      if (exact) {
        if (!data.author) data.author = exact.author; // fill a missing author from the match
        closeModal();
        return addBookToCurrent(data);
      }
      openMatchPicker(data, list, form);
    });
    setTimeout(() => { const t = $(prefill.fTitle ? "fTitle" : "fIsbn"); if (t) t.focus(); }, 30);
  }

  // Nothing matched exactly: show real books to pick from, or keep it as a custom entry.
  function openMatchPicker(data, list, form) {
    const typed = `“${escapeHtml(data.title)}”${data.author ? ` by ${escapeHtml(data.author)}` : ""}`;
    openModal(
      `<div class="mform">
        <h3>${list.length ? "Did you mean…" : "No matching book found"}</h3>
        <p class="pk-hint">${
          list.length
            ? `Couldn't find ${typed} exactly. Pick the book you meant, or keep yours as a custom book.`
            : `Nothing in the catalogs matches ${typed}. You can go back and fix it, or add it as a custom book.`
        }</p>
        <div class="cand-list">${list
          .map(
            (c, i) => `<button type="button" class="cand" data-i="${i}">
              <span class="cand-cover">${c.thumb ? `<img src="${attr(proxied(c.thumb))}" alt="" loading="lazy" />` : ""}</span>
              <span class="cand-txt"><strong>${escapeHtml(c.title)}</strong><span>${escapeHtml(c.author || "Unknown author")}${
                c.year ? ` · ${escapeHtml(String(c.year))}` : ""
              }</span></span></button>`
          )
          .join("")}</div>
        <div class="mform-actions">
          <button type="button" class="btn-ghost" id="mBack">Back to edit</button>
          <button type="button" class="${list.length ? "btn-ghost" : "btn-primary"}" id="mCustom">Add as custom book</button>
        </div>
      </div>`
    );
    document.querySelectorAll("#modalHost .cand").forEach((el) =>
      el.addEventListener("click", () => {
        const c = list[+el.dataset.i];
        closeModal();
        addBookToCurrent({ ...data, title: c.title, author: c.author || data.author, isbn: data.isbn || c.isbn || "" });
      })
    );
    document.getElementById("mBack").addEventListener("click", () => openAddForm(form));
    document.getElementById("mCustom").addEventListener("click", () => {
      closeModal();
      addBookToCurrent({ ...data, custom: true });
    });
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

  /* ---------------- Dewey picker: assemble a number by choosing categories ----------------
   * mode "search": filter the library at whatever level you stop (class, division,
   * section, or deeper with decimals). mode "assign": file one book under a number.
   */
  function openDdcPicker({ mode, start = "", book = null }) {
    const digits = (start || "").replace(".", "");
    const st = { p: digits.slice(0, 3), dec: digits.slice(3) };
    const counts = ddcCounts(currentData());
    const assign = mode === "assign";

    function assembled() {
      const d = st.p.padEnd(3, "_");
      return d + (st.dec ? "." + st.dec : "");
    }
    function query() {
      return st.p.length === 3 ? st.p + st.dec : st.p;
    }
    function rows() {
      const lvl = st.p.length;
      if (lvl === 3) return "";
      let out = "";
      for (let d = 0; d <= 9; d++) {
        const k = st.p + d;
        const code = k.padEnd(3, "0");
        const label = lvl === 0 ? DEWEY.MAIN[k] : lvl === 1 ? divisionLabel(k) : sectionLabel(k);
        const blurb = lvl === 0 ? DEWEY.BLURB[k] : "";
        const n = counts[k] || 0;
        out += label
          ? `<button type="button" class="pk-row" data-d="${d}"><span class="pk-code">${code}</span><span class="pk-lbl">${escapeHtml(label)}${
              blurb ? `<small>${escapeHtml(blurb)}</small>` : ""
            }</span><span class="pk-n">${n || ""}</span></button>`
          : `<div class="pk-row off"><span class="pk-code">${code}</span><span class="pk-lbl">Unassigned</span><span class="pk-n"></span></div>`;
      }
      return out;
    }
    function crumbs() {
      const parts = [`<button type="button" class="crumb" data-lvl="0">All classes</button>`];
      for (let i = 1; i <= st.p.length; i++) {
        const k = st.p.slice(0, i);
        const label = i === 1 ? shortMain(k) : i === 2 ? divisionLabel(k) : sectionLabel(k);
        parts.push(`<button type="button" class="crumb" data-lvl="${i}"><b>${k.padEnd(3, "0")}</b> ${escapeHtml(label)}</button>`);
      }
      return parts.join('<span class="sep">›</span>');
    }
    function hint() {
      const lvl = st.p.length;
      if (lvl === 0) return "Step 1 of 3 — pick a main class (the hundreds digit).";
      if (lvl === 1) return "Step 2 of 3 — pick a division (the tens digit).";
      if (lvl === 2) {
        const lit = st.p[0] === "8" && st.p[1] >= "1" && st.p[1] <= "8";
        return "Step 3 of 3 — pick a section (the units digit)." + (lit ? " In literature the last digit is the form: 1 poetry, 2 drama, 3 fiction, 4 essays…" : "");
      }
      return assign
        ? "Add decimals if you know them (e.g. .8 for Victorian-era English fiction), or file it as is."
        : "Optionally add decimals to narrow further.";
    }
    function sectionBooks() {
      if (st.p.length !== 3) return "";
      const here = currentData()
        .filter((b) => b.ddc && b.ddc.startsWith(st.p) && b !== book)
        .sort(compareShelf)
        .slice(0, 8);
      if (!here.length) return "";
      return `<div class="pk-near"><div class="ddc-label">Already on this shelf</div>${here
        .map((b) => `<div><span class="pk-code">${escapeHtml(b.ddc)}</span> ${escapeHtml(b.title)}</div>`)
        .join("")}</div>`;
    }
    function draw() {
      const lvl = st.p.length;
      const q = query();
      const n = q ? currentData().filter((b) => ddcMatches(b.ddc, { type: "prefix", p: q })).length : 0;
      const canGo = assign ? lvl === 3 : lvl >= 1;
      const num = lvl === 3 ? st.p + (st.dec ? "." + st.dec : "") : prefixDisplay(st.p || "0");
      const action = assign
        ? `File under ${lvl === 3 ? num : "…"}`
        : lvl ? `Show ${n} book${n === 1 ? "" : "s"} in ${num}${lvl < 3 ? "s" : ""}` : "Choose a class";
      openModal(
        `<div class="picker">
          <h3>${assign ? `File “${escapeHtml(book.title)}”` : "Find books by category"}</h3>
          <div class="pk-num" aria-label="Assembled Dewey number">${escapeHtml(assembled())}</div>
          <div class="ddc-path pk-crumbs">${crumbs()}</div>
          <p class="pk-hint">${hint()}</p>
          <div class="pk-list">${rows()}</div>
          ${lvl === 3
            ? `<label class="pk-dec">Decimals <span class="dot">${st.p}.</span><input type="text" id="pkDec" value="${attr(st.dec)}" inputmode="numeric" placeholder="optional" autocomplete="off" /></label>`
            : ""}
          ${sectionBooks()}
          <div class="mform-actions">
            ${lvl ? '<button type="button" class="btn-ghost" id="pkBack">Back</button>' : ""}
            <button type="button" class="btn-ghost" id="pkGuide">How DDC works</button>
            <button type="button" class="btn-primary" id="pkGo" ${canGo ? "" : "disabled"}>${escapeHtml(action)}</button>
          </div>
        </div>`,
        "wide"
      );
      const host = document.getElementById("modalHost");
      host.querySelectorAll(".pk-row[data-d]").forEach((r) =>
        r.addEventListener("click", () => {
          st.p += r.dataset.d;
          draw();
        })
      );
      host.querySelectorAll(".crumb").forEach((c) =>
        c.addEventListener("click", () => {
          st.p = st.p.slice(0, +c.dataset.lvl);
          st.dec = "";
          draw();
        })
      );
      const back = document.getElementById("pkBack");
      if (back)
        back.addEventListener("click", () => {
          st.p = st.p.slice(0, -1);
          st.dec = "";
          draw();
        });
      const dec = document.getElementById("pkDec");
      if (dec) {
        dec.addEventListener("input", () => {
          dec.value = dec.value.replace(/\D/g, "");
          st.dec = dec.value;
          host.querySelector(".pk-num").textContent = assembled();
          const q2 = query();
          const n2 = currentData().filter((b) => ddcMatches(b.ddc, { type: "prefix", p: q2 })).length;
          const num2 = st.p + (st.dec ? "." + st.dec : "");
          document.getElementById("pkGo").textContent = assign
            ? `File under ${num2}`
            : `Show ${n2} book${n2 === 1 ? "" : "s"} in ${num2}`;
        });
        dec.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        setTimeout(() => dec.focus(), 30);
      }
      document.getElementById("pkGuide").addEventListener("click", openDdcGuide);
      document.getElementById("pkGo").addEventListener("click", go);
    }
    function go() {
      if (assign) {
        if (st.p.length !== 3) return;
        setBookDdc(book, cleanDdc(st.p + (st.dec ? "." + st.dec : "")));
      } else if (st.p.length) {
        closeModal();
        setDdcFilter(query());
      }
    }
    draw();
  }

  /* ---------------- DDC guide ---------------- */
  function openDdcGuide() {
    const counts = ddcCounts(currentData());
    const cnt = (k) => (counts[k] ? `<span class="g-n">${counts[k]}</span>` : "");
    const code = (p, label) => `<button type="button" class="g-code" data-p="${p}">${prefixDisplay(p)}</button> ${escapeHtml(label)}`;
    let outline = "";
    for (let c = 0; c <= 9; c++) {
      const k = String(c);
      let divs = "";
      for (let d = 0; d <= 9; d++) {
        const dk = k + d;
        let secs = "";
        for (let x = 0; x <= 9; x++) {
          const sk = dk + x;
          const lbl = sectionLabel(sk);
          if (lbl) secs += `<li>${code(sk, lbl)}${cnt(sk)}</li>`;
        }
        divs += `<details><summary>${code(dk, divisionLabel(dk))}${cnt(dk)}</summary><ul>${secs}</ul></details>`;
      }
      outline += `<details class="g-class"><summary>${code(k, DEWEY.MAIN[k])}${cnt(k)}<small>${escapeHtml(DEWEY.BLURB[k])}</small></summary>${divs}</details>`;
    }
    const langs = [["81", "American"], ["82", "English"], ["83", "German"], ["84", "French"], ["85", "Italian"], ["86", "Spanish"], ["87", "Latin"], ["88", "Greek"]];
    const litGrid =
      `<table class="g-table"><thead><tr><th></th>${DEWEY.LIT_FORMS.slice(0, 4).map(([, f]) => `<th>${f}</th>`).join("")}</tr></thead><tbody>` +
      langs.map(([b, l]) => `<tr><th>${l}</th>${DEWEY.LIT_FORMS.slice(0, 4).map(([d]) => `<td>${b}${d}</td>`).join("")}</tr>`).join("") +
      `</tbody></table>`;

    openModal(
      `<div class="guide">
        <h3>A guide to the Dewey Decimal Classification</h3>
        <p>Libraries shelve nonfiction — and, in the 800s, literature — by <strong>Dewey Decimal number</strong>.
        Every subject gets a number, and the number reads from general to specific: each digit narrows the one before it.
        Your library is shelved in this order, so books on the same subject sit together.</p>

        <h4>Reading a number</h4>
        <div class="g-anatomy">
          <div><span class="g-dig">8</span><small>Class</small>Literature</div>
          <div><span class="g-dig">2</span><small>Division</small>English literature</div>
          <div><span class="g-dig">3</span><small>Section</small>English fiction</div>
          <div><span class="g-dig">.8</span><small>Decimals</small>Victorian period, 1837–1899</div>
        </div>
        <p><strong>823.8</strong> = Literature › English › Fiction › Victorian — where you'd find <em>Great Expectations</em>.
        There are always three digits before the point (use zeros: 500 is Science in general, 510 Mathematics).
        Decimals only ever narrow: 823.8 sits inside 823, which sits inside 820, inside 800.
        Shelve by comparing digit by digit, so 823.8 comes <em>before</em> 823.91.</p>

        <h4>The ten main classes</h4>
        <ul class="g-classes">${Object.keys(DEWEY.MAIN)
          .map((k) => `<li>${code(k, DEWEY.MAIN[k])}${cnt(k)}<small>${escapeHtml(DEWEY.BLURB[k])}</small></li>`)
          .join("")}</ul>

        <h4>Searching by number</h4>
        <table class="g-table g-syntax"><tbody>
          <tr><td><code>8</code> or <code>800</code></td><td>the whole class — everything 800–899</td></tr>
          <tr><td><code>82</code>, <code>820</code> or <code>82x</code></td><td>a division — 820–829</td></tr>
          <tr><td><code>823</code></td><td>one section, including all its decimals</td></tr>
          <tr><td><code>320.</code> or <code>80x</code></td><td>exactly section 320 / division 800–809 (a bare <code>320</code> means the 320s)</td></tr>
          <tr><td><code>823.8</code></td><td>823.8 and anything more specific (823.809, 823.81…)</td></tr>
          <tr><td><code>300-399</code></td><td>a range</td></tr>
        </tbody></table>
        <p>Type these in the <strong>Dewey</strong> box, or straight into the main search. Don't know the number?
        Use <strong>Find by category</strong> to assemble it step by step, or click any code in the outline below.</p>

        <h4>The literature pattern (800s)</h4>
        <p>The second digit is the language, the third the form — the same in every language:
        1 poetry, 2 drama, 3 fiction, 4 essays, 5 speeches, 6 letters, 7 humor &amp; satire, 8 miscellaneous.
        Other languages live in 890s (Russian fiction is 891.73). Literature is classed by the <em>original</em> language, so a translation of Tolstoy stays in 891.73.</p>
        ${litGrid}

        <h4>Common add-ons</h4>
        <p>Standard subdivisions can be tacked onto most numbers: ${DEWEY.STD_SUBDIVISIONS.map(([n, l]) => `<code>-${n}</code> ${escapeHtml(l.toLowerCase())}`).join(", ")}.
        For example 509 is the history of science and 780.3 a dictionary of music.</p>

        <h4>Where your numbers come from</h4>
        <ul class="g-src">
          <li><strong>Catalog</strong> — the number libraries assigned, from Open Library's catalog records for the edition (by ISBN) or matching editions.</li>
          <li><strong>Estimated</strong> <code>~</code> — no catalog record, so the number is worked out from the book's subjects, genres and your category. Check these.</li>
          <li><strong>Yours</strong> — anything you set in a book's popup always wins.</li>
        </ul>

        <h4>Full outline — 10 classes, 100 divisions, 1,000 sections</h4>
        <p class="muted">Counts show books in your current tab. Click a number to see those books.</p>
        <div class="g-outline">${outline}</div>
      </div>`,
      "wide"
    );
    document.querySelectorAll("#modalHost .g-code").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.preventDefault(); // don't toggle the <details> when clicking its code
        closeModal();
        setDdcFilter(b.dataset.p);
      })
    );
  }

  /* ---------------- reading list: import more (merge, skipping duplicates) ---------------- */
  function openReadingImportModal() {
    openModal(`
      <div class="mform">
        <h3>Import into your reading list</h3>
        <p class="pk-hint">Paste Markdown (<code>## Category</code>, then <code>- Author — _Title_</code>). Books already in your list are skipped.
        Optionally add a Dewey number in braces: <code>- Plato — _The Republic_ {321.07}</code>.</p>
        <div class="import"><textarea id="rmInput" spellcheck="false" placeholder="## Philosophy&#10;- Plato — _The Republic_ ✅"></textarea></div>
        <input type="file" id="rmFile" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden />
        <div class="mform-actions">
          <button type="button" class="btn-ghost" id="rmFileBtn">Choose file…</button>
          <button type="button" class="btn-primary" id="rmLoad">Import</button>
        </div>
      </div>`);
    const file = document.getElementById("rmFile");
    document.getElementById("rmFileBtn").addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importReadingText(reader.result);
      reader.readAsText(f);
    });
    document.getElementById("rmLoad").addEventListener("click", () =>
      importReadingText(document.getElementById("rmInput").value)
    );
  }

  /* ---------------- books: add / delete ---------------- */
  function bookById(id) {
    return books.get(Number(id)) || null;
  }

  async function deleteBook(id) {
    try {
      const r = await api("DELETE", `/api/books/${id}`);
      await sync();
      toast(`Removed “${r.title}”`);
    } catch (e) {
      toast(e.message);
    }
  }

  // The server merges duplicates into the existing entry and says so.
  async function addBookToCurrent(data) {
    try {
      const r = await api("POST", "/api/books", { ...data, list: state.tab });
      books.set(r.book.id, r.book);
      await sync();
      if (r.duplicate) {
        toast(`“${r.book.title}” is already in your library`);
        openDetail(r.book.id);
      } else toast(`Added “${r.book.title}”`);
    } catch (e) {
      toast(e.message);
    }
  }

  function downloadBackup() {
    const a = document.createElement("a");
    a.href = "/api/export";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------------- login (only when the server has a password) ---------------- */
  function showLogin(message = "") {
    if (document.getElementById("loginForm")) return;
    document.body.classList.add("locked");
    const host = document.createElement("div");
    host.className = "login";
    host.innerHTML = `
      <form class="login-card" id="loginForm">
        <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 8.5C13 6.5 8 6 4.5 7v18C8 24 13 24.5 16 26.5 19 24.5 24 24 27.5 25V7C24 6 19 6.5 16 8.5Z" /><path d="M16 8.5v18" />
        </svg>
        <h1>Library</h1>
        <input type="password" id="loginPw" placeholder="Password" autocomplete="current-password" autofocus />
        <p class="login-err" id="loginErr">${escapeHtml(message)}</p>
        <button type="submit" class="btn-primary">Unlock</button>
      </form>`;
    document.body.appendChild(host);
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("loginErr");
      err.textContent = "";
      try {
        await api("POST", "/api/login", { password: document.getElementById("loginPw").value });
        host.remove();
        document.body.classList.remove("locked");
        start();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    setTimeout(() => document.getElementById("loginPw").focus(), 30);
  }

  /* ---------------- action buttons + card clicks ---------------- */
  function updateActionButtons() {
    const btn = document.getElementById("importMore");
    const empty = currentData().length === 0; // the landing panel has its own importer
    btn.hidden = empty;
    btn.textContent = state.tab === "goodreads" ? "Import CSV" : "Import list";
  }
  document.getElementById("addBook").addEventListener("click", () => openAddForm());
  const importMoreInput = document.getElementById("importMoreInput");
  document.getElementById("importMore").addEventListener("click", () => {
    if (state.tab === "goodreads") importMoreInput.click();
    else openReadingImportModal();
  });
  importMoreInput.addEventListener("change", () => {
    if (importMoreInput.files[0]) importCsv(importMoreInput.files[0]);
    importMoreInput.value = "";
  });
  els.results.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card && card.dataset.id != null) openDetail(card.dataset.id);
  });

  document.getElementById("exportBtn").addEventListener("click", downloadBackup);
  document.getElementById("clearBtn").addEventListener("click", openClearDialog);
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("POST", "/api/logout").catch(() => {});
    try {
      localStorage.removeItem(SNAP_KEY);
    } catch (e) {}
    location.reload();
  });

  /* ---------------- boot ---------------- */
  // Lists that the old static version kept in this browser move into the database once.
  async function migrateBrowserLists() {
    for (const [key, list] of [["readinglist.v1", "reading"], ["goodreads.v1", "goodreads"]]) {
      let old;
      try {
        old = JSON.parse(localStorage.getItem(key) || "null");
      } catch (e) {
        old = null;
      }
      if (!Array.isArray(old) || !old.length) continue;
      try {
        const r = await api("POST", "/api/import", { list, format: "json", books: old });
        localStorage.removeItem(key);
        if (r.added) toast(`Moved ${r.added} book${r.added === 1 ? "" : "s"} from this browser into your library`);
      } catch (e) {} // try again next visit
    }
  }

  let started = false;
  async function start() {
    if (started) return;
    started = true;
    await migrateBrowserLists();
    await sync();
    if (libRev < 0) {
      // first visit and the server wasn't reachable
      buildFilters();
      render();
    }
  }

  els.sortBy.value = state.sort;
  // Instant paint from the last snapshot, then catch up with the server.
  if (loadSnapshot()) {
    buildFilters();
    render();
  }
  api("GET", "/api/session")
    .then((s) => {
      document.getElementById("logoutBtn").hidden = !s.required;
      if (s.required && !s.ok) showLogin();
      else start();
    })
    .catch(() => {
      if (libRev >= 0) setSync("offline");
      else {
        buildFilters();
        render();
      }
    });

  // Service worker: keeps the app shell and covers cached for fast, offline-capable repeat loads.
  if ("serviceWorker" in navigator && location.protocol !== "file:")
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
})();
