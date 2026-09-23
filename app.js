/* Library — minimalist reading dashboard
 * Two lists: the curated Reading List and the Goodreads library (imported CSV).
 * Books are organized by Dewey Decimal Classification (window.DEWEY). The library
 * itself lives in library.md in the repo (see store.js); covers, genres and summaries
 * are fetched lazily from Open Library and cached in localStorage.
 */
(() => {
  "use strict";

  const DEWEY = window.DEWEY;
  let READING = [];
  let GOODREADS = [];

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
  };

  function normalize(b, i) {
    const ddc = cleanDdc(b.ddc);
    return {
      id: b.id != null ? b.id : i,
      title: b.title || "",
      author: b.author || "",
      category: b.category || "Uncategorized",
      subcategory: b.subcategory || "",
      subsubcategory: b.subsubcategory || "",
      read: !!b.read,
      primary: !!b.primary,
      custom: !!b.custom, // not a catalogued book: never looked up by title
      rating: b.rating || 0,
      isbn: b.isbn || "",
      note: b.note || "",
      ddc: ddc || "",
      ddcSrc: ddc ? b.ddcSrc || "manual" : "", // "ol" (catalog) | "est" (estimated) | "manual"
    };
  }

  function currentData() {
    return state.tab === "reading" ? READING : GOODREADS;
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

    observeCovers();
    updateChrome(list, currentData());

    ensureClassified();
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
    if (b.ddc) return `${b.ddc}${b.ddcSrc === "est" ? "~" : ""} · ${ddcLabel(b.ddc)}`;
    return b._c ? "Unclassified" : "Classifying…";
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

  // Independent work queues so classification lookups never starve cover loading.
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
  const classQ = makeQueue(2);

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

  /* ---------------- Dewey Decimal helpers ---------------- */
  // Catalog DDC strings come in many shapes: "823/.8", "891.73/3", "320.5/32 21",
  // "[Fic]", "B". Keep the digits (prime marks removed), drop the edition suffix.
  function cleanDdc(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(/[[\]'’/]/g, "").trim();
    const m = s.match(/^(\d{3})(?:\.(\d+))?/);
    if (!m) return null;
    const dec = (m[2] || "").replace(/0+$/, "");
    return dec ? `${m[1]}.${dec}` : m[1];
  }

  function sectionLabel(n3) {
    const arr = DEWEY.SECTIONS[n3.slice(0, 2)];
    return (arr && arr[+n3[2]]) || "";
  }
  function divisionLabel(n2) {
    const arr = DEWEY.SECTIONS[n2];
    return (arr && arr[0]) || "";
  }
  // Most specific heading we know for a number (section, else division, else class).
  function ddcLabel(ddc) {
    if (!ddc) return "";
    return sectionLabel(ddc.slice(0, 3)) || divisionLabel(ddc.slice(0, 2)) || DEWEY.MAIN[ddc[0]] || "";
  }
  // Hierarchy for a number: class › division › section (› the full number).
  function ddcPath(ddc) {
    if (!ddc) return [];
    const out = [{ code: ddc[0] + "00", p: ddc[0], label: DEWEY.MAIN[ddc[0]] }];
    const div = divisionLabel(ddc.slice(0, 2));
    if (div && ddc[1] !== "0") out.push({ code: ddc.slice(0, 2) + "0", p: ddc.slice(0, 2), label: div });
    const sec = sectionLabel(ddc.slice(0, 3));
    if (sec && ddc[2] !== "0") out.push({ code: ddc.slice(0, 3), p: ddc.slice(0, 3), label: sec });
    return out;
  }

  // Dewey queries. Prefix digits carry the hierarchy: "8" = 800s, "82" = 820s,
  // "823" = 823, "8238" = 823.8 and everything under it.
  function looksLikeDdc(q) {
    return /^(\d{1,3}(\.\d*)?|\d{1,2}[x*]{1,2}|\d{1,3}(\.\d+)?\s*[-–]\s*\d{1,3}(\.\d+)?)$/i.test(q.trim());
  }
  function parseDdcQuery(q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return null;
    if (q === "none") return { type: "none" };
    let m = q.match(/^(\d{1,3}(?:\.\d+)?)\s*[-–]\s*(\d{1,3}(?:\.\d+)?)$/);
    if (m) {
      const lo = parseFloat(m[1].padEnd(3, "0")),
        hiRaw = m[2].includes(".") ? m[2] : m[2].padEnd(3, "9");
      const hi = parseFloat(hiRaw);
      return { type: "range", lo: Math.min(lo, hi), hi: Math.max(lo, hi), inclusiveTail: !m[2].includes(".") };
    }
    m = q.match(/^(\d{1,3})[x*]*(?:\.(\d*))?$/);
    if (!m) return null;
    let int = m[1];
    const dec = m[2] || "";
    // "800" means the 800s and "820" the 820s — trailing zeros mark a broader class
    // (unless decimals follow: "800.1" is literal).
    // "800." / "80x" pin the exact section / division.
    if (!dec && int.length === 3 && !/[x*.]/.test(q)) int = int.replace(/0+$/, "") || "0";
    if (dec && int.length < 3) int = int.padEnd(3, "0");
    return { type: "prefix", p: int + dec };
  }
  function ddcMatches(ddc, f) {
    if (!f) return true;
    if (f.type === "none") return !ddc;
    if (!ddc) return false;
    if (f.type === "prefix") return ddc.replace(".", "").startsWith(f.p);
    const v = parseFloat(ddc);
    return v >= f.lo && (f.inclusiveTail ? v < Math.floor(f.hi) + 1 : v <= f.hi);
  }
  // prefix digits -> human notation ("8" -> "800", "82" -> "820", "8238" -> "823.8")
  function prefixDisplay(p) {
    if (p.length <= 3) return p.padEnd(3, "0");
    return p.slice(0, 3) + "." + p.slice(3);
  }
  // prefix digits -> a query string that parses back to the same prefix
  // ("8" -> "800", "82" -> "820", "80" -> "80x", "320" -> "320.", "8917" -> "891.7")
  function prefixQuery(p) {
    if (p.length === 1) return p + "00";
    if (p.length === 2) return p[1] === "0" ? p + "x" : p + "0";
    if (p.length === 3) return p.endsWith("0") ? p + "." : p;
    return prefixDisplay(p);
  }


  /* ---------------- classification (Dewey number + genres) ----------------
   * One Open Library lookup per book yields both:
   *  - the Dewey number from library catalog records (edition `dewey_decimal_class`,
   *    search `ddc`), picking the most-cited section and its most detailed form;
   *  - raw subjects, canonicalized into a small genre vocabulary.
   * Books with no catalog number get an estimate from subjects/genres/category
   * (marked "~"); any number can be overridden by hand.
   */
  const CLASS_CACHE_KEY = "classCache.v1";
  let classCache = {};
  try {
    classCache = JSON.parse(localStorage.getItem(CLASS_CACHE_KEY) || "{}");
  } catch (e) {
    classCache = {};
  }
  let classDirty = false;
  setInterval(() => {
    if (classDirty) {
      try {
        localStorage.setItem(CLASS_CACHE_KEY, JSON.stringify(classCache));
      } catch (e) {}
      classDirty = false;
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

  // Pick a catalog number: the section (first 3 digits) cited most across records,
  // then the most detailed number that refines the best-supported one.
  function pickDdc(cands) {
    if (!cands.length) return null;
    const secW = {};
    const numW = {};
    for (const { n, w } of cands) {
      secW[n.slice(0, 3)] = (secW[n.slice(0, 3)] || 0) + w;
      numW[n] = (numW[n] || 0) + w;
    }
    const sec = Object.keys(secW).sort((a, b) => secW[b] - secW[a])[0];
    const inSec = Object.keys(numW).filter((n) => n.startsWith(sec));
    inSec.sort((a, b) => numW[b] - numW[a] || b.length - a.length);
    const top = inSec[0];
    const refined = inSec.filter((n) => n.startsWith(top)).sort((a, b) => b.length - a.length)[0];
    return refined || top;
  }

  // --- estimation (no catalog number found) ---
  // Literature is classed by original language, then form: 8 + language + form digit.
  const LIT_LANG = [
    [/^american|^united states/i, "81"], [/^(english|british|irish|scottish|welsh|australian|new zealand)/i, "82"],
    [/^canadian/i, "81"], [/^(german|austrian|swiss)/i, "83"], [/^french|^belgian/i, "84"], [/^italian/i, "85"],
    [/^(spanish|latin american|mexican|argentine|colombian|chilean|cuban|peruvian)/i, "86"],
    [/^(portuguese|brazilian)/i, "869"], [/^latin\b/i, "87"], [/^(greek|classical greek)/i, "88"],
    [/^modern greek/i, "889"], [/^russian/i, "891.7"], [/^ukrainian/i, "891.79"], [/^polish/i, "891.85"],
    [/^czech/i, "891.86"], [/^(persian|iranian)/i, "891.55"], [/^hindi/i, "891.43"], [/^urdu/i, "891.439"],
    [/^bengali/i, "891.44"], [/^sanskrit/i, "891.2"], [/^(irish gaelic|gaelic)/i, "891.6"], [/^yiddish/i, "839.1"],
    [/^swedish/i, "839.7"], [/^danish/i, "839.81"], [/^norwegian/i, "839.82"], [/^icelandic|^old norse/i, "839.6"],
    [/^dutch|^flemish/i, "839.31"], [/^hebrew|^israeli/i, "892.4"], [/^arabic/i, "892.7"], [/^turkish/i, "894.35"],
    [/^chinese/i, "895.1"], [/^japanese/i, "895.6"], [/^korean/i, "895.7"], [/^vietnamese/i, "895.92"],
  ];
  const LANG_CODE = {
    eng: "82", ger: "83", fre: "84", ita: "85", spa: "86", por: "869", lat: "87", grc: "88", gre: "889",
    rus: "891.7", ukr: "891.79", pol: "891.85", cze: "891.86", per: "891.55", hin: "891.43", urd: "891.439",
    ben: "891.44", san: "891.2", yid: "839.1", swe: "839.7", dan: "839.81", nor: "839.82", ice: "839.6",
    dut: "839.31", heb: "892.4", ara: "892.7", tur: "894.35", chi: "895.1", jpn: "895.6", kor: "895.7",
  };
  const LIT_FORM = [
    [/epic/i, "epic"], [/poetry|poems|verse/i, "1"], [/drama|plays|tragedy|comedies/i, "2"],
    [/fiction|novel|short stories|stories|fantasy/i, "3"], [/essays/i, "4"], [/speeches|orations/i, "5"],
    [/letters|correspondence/i, "6"], [/humor|wit|satire/i, "7"], [/literature|prose|writings/i, "0"],
  ];
  function litNumber(base, form) {
    // Greek & Latin put epic poetry with fiction (883, 873); elsewhere it's poetry.
    if (form === "epic") form = base === "87" || base === "88" ? "3" : "1";
    if (form === "0") return base.length === 2 ? base + "0" : base;
    if (base.length === 2) return base + form;
    return base.includes(".") ? base + form : base + "." + form;
  }
  function formOf(text) {
    for (const [re, f] of LIT_FORM) if (re.test(text)) return f;
    return null;
  }
  // "Russian fiction", "English poetry", "Epic poetry, Greek", "Fiction -- Russian"
  function literatureFromSubjects(subjects) {
    const votes = {};
    for (const raw of subjects) {
      if (typeof raw !== "string") continue;
      const s = raw.replace(/\s+--\s+/g, ", ").trim();
      let lang = null,
        form = null;
      let m = s.match(/^([A-Za-z ]+?)\s+(epic poetry|poetry|drama|fiction|literature|essays|letters|short stories|wit and humor|prose literature)\b/i);
      if (m) {
        lang = m[1];
        form = m[2];
      } else if ((m = s.match(/^(epic poetry|poetry|drama|fiction|literature|essays|short stories)\s*,\s*([A-Za-z ]+)/i))) {
        form = m[1];
        lang = m[2];
      }
      if (!lang) continue;
      const hit = LIT_LANG.find(([re]) => re.test(lang.trim()));
      if (!hit) continue;
      const n = litNumber(hit[1], formOf(form) || "0");
      votes[n] = (votes[n] || 0) + (n.length > 3 || !n.endsWith("0") ? 2 : 1); // favor form-specific numbers
    }
    const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a] || b.length - a.length)[0];
    return best || null;
  }

  // Subject / category keywords -> Dewey number. Ordered specific to broad.
  const KEYWORD_DDC = [
    [/\bbible\b|scripture|gospels?\b/i, "220"], [/buddh|\bzen\b/i, "294.3"], [/hindu|vedanta|upanishad|bhagavad/i, "294.5"],
    [/\bislam|muslim|qur.?an|koran|sufi/i, "297"], [/juda|jewish|torah|talmud/i, "296"], [/christian|church|jesus|catholic|protestant/i, "230"],
    [/mytholog/i, "201.3"], [/religio|theolog|spiritual/i, "200"],
    [/stoic/i, "188"], [/existential/i, "142.78"], [/phenomenolog/i, "142.7"], [/ethic|moral philosophy/i, "170"],
    [/\blogic\b/i, "160"], [/metaphysic|ontolog/i, "110"], [/epistemolog/i, "121"],
    [/self-help|self help|personal development|success|happiness|mindfulness/i, "158.1"],
    [/psycholog|neuroscience|cognitive/i, "150"], [/ancient philosoph|greek philosoph/i, "180"], [/philosoph/i, "100"],
    [/marxis|communis|socialis|anarchis/i, "335"], [/investing|investment|stock/i, "332.6"], [/econom|capitalism|finance|money|wealth/i, "330"],
    [/international relations|geopolit|foreign relations|diplomacy/i, "327"], [/civil rights|human rights/i, "323"],
    [/politic|government|democracy|nationalism|imperialism|colonialism/i, "320"], [/\blaw\b|legal|jurisprudence/i, "340"],
    [/military|warfare|\bwar\b|strategy/i, "355"], [/education|pedagog|teaching/i, "370"], [/crime|criminal/i, "364"],
    [/femini|gender|women/i, "305.4"], [/\brace\b|racism|ethnic/i, "305.8"], [/folklore|fairy tales|legends/i, "398.2"],
    [/anthropolog|ethnograph|culture/i, "306"], [/sociolog|society|social/i, "301"],
    [/marketing|advertising/i, "658.8"], [/business|management|leadership|entrepreneur/i, "658"],
    [/linguist|language|grammar/i, "410"],
    [/mathemat|statistics/i, "510"], [/astronom|cosmolog|universe|astrophysic/i, "520"], [/quantum|relativity|physics/i, "530"],
    [/chemistr/i, "540"], [/geolog|earth science/i, "550"], [/evolution|darwin|natural selection/i, "576.8"], [/genetic|\bdna\b|genome/i, "576.5"],
    [/ecology|environment|climate/i, "577"], [/paleontolog|dinosaur|fossil/i, "560"], [/botany|plants/i, "580"],
    [/zoolog|animals|birds|mammals/i, "590"], [/biolog|life science/i, "570"], [/science/i, "500"],
    [/programming|software|algorithm/i, "005"], [/artificial intelligence|machine learning/i, "006.3"], [/computer|internet|digital|information technology/i, "004"],
    [/nutrition|diet/i, "613.2"], [/medicine|medical|health|disease/i, "610"], [/cooking|cookbook|recipes|cookery/i, "641.5"],
    [/engineering/i, "620"], [/agricultur|farming|gardening/i, "630"], [/parenting|child rearing/i, "649"], [/technolog/i, "600"],
    [/architect/i, "720"], [/painting|painters/i, "750"], [/photograph/i, "770"], [/\bfilm|cinema|motion picture/i, "791.43"],
    [/music|jazz|opera/i, "780"], [/theater|theatre/i, "792"], [/chess/i, "794.1"], [/sports?\b|football|baseball|basketball|soccer|running/i, "796"],
    [/\bart\b|\barts\b|design|sculpture|aesthetic/i, "700"],
    [/literary criticism|history and criticism/i, "809"], [/writing|rhetoric|authorship/i, "808"],
    [/autobiograph|memoir|biograph/i, "920"], [/travel/i, "910"],
    [/world war,? 1939|world war ii|second world war/i, "940.53"], [/world war,? 1914|world war i\b|first world war/i, "940.3"],
    [/ancient (greece|greek)/i, "938"], [/ancient rome|roman empire|\brome\b/i, "937"], [/ancient egypt/i, "932"],
    [/ancient|antiquity|classical/i, "930"], [/medieval|middle ages/i, "940.1"], [/europe/i, "940"], [/china|chinese/i, "951"],
    [/japan/i, "952"], [/india\b|indian subcontinent/i, "954"], [/middle east|arab/i, "956"], [/africa/i, "960"],
    [/united states|american history/i, "973"], [/latin america|south america/i, "980"], [/histor/i, "900"], [/geograph/i, "910"],
  ];
  function keywordDdc(text) {
    for (const [re, n] of KEYWORD_DDC) if (re.test(text)) return n;
    return null;
  }
  const LIT_GENRES = { Fiction: "3", "Science Fiction": "3", Fantasy: "3", Poetry: "1", Drama: "2" };

  function estimateDdc(b, subjects, genres, langs) {
    const leads = subjects
      .filter((s) => typeof s === "string" && !JUNK.test(s))
      .map((s) => s.split(/\s+--\s+|[,(]/)[0].trim());
    // 1) your own category / shelves on the reading list (explicit intent)
    const own = [b.subsubcategory, b.subcategory, b.category].filter((c) => c && !/^(uncategorized|read|to read|currently reading)$/i.test(c));
    for (const c of own) {
      const lit = literatureFromSubjects([c]);
      if (lit) return lit;
      const n = keywordDdc(c);
      if (n) return n;
    }
    // 2) literature by language + form, from catalog subjects
    const lit = literatureFromSubjects(subjects);
    if (lit) return lit;
    // 3) creative writing without a stated nationality: form from genres, language from the edition
    const litGenre = genres.find((g) => LIT_GENRES[g]);
    if (litGenre) {
      const code = langs.length === 1 ? langs[0] : langs.includes("eng") ? "eng" : null;
      const base = code && LANG_CODE[code] ? LANG_CODE[code] : "82";
      const us = leads.some((s) => /united states|america/i.test(s));
      return litNumber(base === "82" && us ? "81" : base, LIT_GENRES[litGenre]);
    }
    // 4) subject keywords: majority vote across the catalog subjects
    const votes = {};
    leads.forEach((s, i) => {
      const n = keywordDdc(s);
      if (n) votes[n] = (votes[n] || 0) + 1 + 1 / (i + 2); // earlier subjects break ties
    });
    const top = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    if (top) return top;
    // 5) canonical genres, then the title itself
    for (const g of genres) {
      const n = keywordDdc(g);
      if (n) return n;
    }
    return keywordDdc(b.title);
  }

  async function resolveMeta(b) {
    // custom entries aren't real catalog books: a title search would find the wrong one
    if (b.custom) return { g: [], d: estimateDdc(b, [], [], []), e: true, ok: false };
    const isbn = (b.isbn || "").replace(/[^0-9Xx]/g, "");
    const cands = [];
    let subjects = [];
    let langs = [];
    let genres = [];
    let reached = false; // did any lookup reach Open Library?
    const addDdc = (list, w) =>
      (Array.isArray(list) ? list : [list]).forEach((raw) => {
        const n = cleanDdc(raw);
        if (n) cands.push({ n, w });
      });

    if (isbn) {
      try {
        const e = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
        reached = reached || e.ok || e.status === 404;
        if (e.ok) {
          const ed = await e.json();
          addDdc(ed.dewey_decimal_class || [], 6); // this exact edition's catalog record
          langs = (ed.languages || []).map((l) => String(l.key || "").split("/").pop()).filter(Boolean);
          const wk = ed.works && ed.works[0] && ed.works[0].key;
          if (wk) {
            const w = await fetch(`https://openlibrary.org${wk}.json`);
            if (w.ok) {
              const wj = await w.json();
              subjects = wj.subjects || [];
              genres = canonGenres(subjects);
            }
          }
        }
      } catch (e) {}
    }
    if (!cands.length || !genres.length) {
      try {
        const p = new URLSearchParams({ title: b.title, limit: "5", fields: "ddc,subject,language" });
        if (b.author) p.set("author", b.author);
        const r = await fetch(`https://openlibrary.org/search.json?${p}`);
        reached = reached || r.ok;
        if (r.ok) {
          const j = await r.json();
          (j.docs || []).forEach((d, i) => {
            addDdc(d.ddc || [], 5 - i); // better-ranked matches count more
            if (!genres.length && d.subject && d.subject.length) {
              const g = canonGenres(d.subject);
              if (g.length) {
                genres = g;
                if (!subjects.length) subjects = d.subject;
              }
            }
            if (!langs.length && d.language) langs = d.language;
          });
        }
      } catch (e) {}
    }
    let ddc = pickDdc(cands);
    let est = false;
    if (!ddc) {
      ddc = estimateDdc(b, subjects, genres, langs);
      est = !!ddc;
    }
    return { g: genres, d: ddc || null, e: est, ok: reached };
  }

  function applyMeta(b, m) {
    b.genres = m.g || [];
    // never replace your number, and never trade a catalog number for a guess
    const keep = b.ddcSrc === "manual" || !m.d || (b.ddcSrc === "ol" && m.e);
    if (!keep) {
      b.ddc = m.d;
      b.ddcSrc = m.e ? "est" : "ol";
    }
    b._c = true;
  }

  async function getMeta(b) {
    const k = genreKey(b);
    let m = classCache[k];
    if (m === undefined) {
      m = await resolveMeta(b);
      // offline: keep the estimate for this session but try the catalog again next time
      if (m.ok) {
        classCache[k] = { g: m.g, d: m.d, e: m.e };
        classDirty = true;
      }
    }
    return m;
  }

  let classJobs = 0;
  function ensureClassified() {
    const data = currentData();
    if (!data.length) return;
    let assigned = false;
    for (const b of data) {
      if (b._c || b._q) continue;
      const m = classCache[genreKey(b)];
      if (m !== undefined) {
        applyMeta(b, m);
        assigned = true;
      } else if (b.ddc) {
        b._c = true; // already numbered in library.md; genres load when the book is opened
      } else {
        b._q = true;
        classJobs++;
        classQ.add(() => loadClass(b));
      }
    }
    if (assigned) {
      scheduleChipRefresh();
      schedulePersist();
    }
    if (!assigned && data.every((b) => b._c)) scheduleChipRefresh();
  }

  async function loadClass(b) {
    const m = await getMeta(b);
    applyMeta(b, m);
    b._q = false;
    updateCardTag(b);
    scheduleChipRefresh();
    schedulePersist();
    classJobs--;
    // re-shelve once the queue drains (order/filters depend on the numbers)
    if (classJobs === 0 && (state.sort === "ddc" || state.ddc || looksLikeDdc(state.q))) render();
  }

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
    }, 400);
  }

  // Classification results are batched into one save (one commit on GitHub).
  function schedulePersist() {
    persist("Update Dewey numbers", 10000);
  }

  /* ---------------- Dewey chips: class › division › section drill-down ---------------- */
  function ddcCounts(data) {
    const c = { none: 0 };
    for (const b of data) {
      if (!b.ddc) {
        if (b._c) c.none++;
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
    const pending = data.filter((b) => !b._c).length;
    if (pending > 0) html += `<span class="chip-loading">classifying… ${data.length - pending}/${data.length}</span>`;
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

  function shortMain(k) {
    return {
      0: "General works", 1: "Philosophy", 2: "Religion", 3: "Social sciences", 4: "Language",
      5: "Science", 6: "Technology", 7: "Arts", 8: "Literature", 9: "History",
    }[k];
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

  /* ---------------- duplicate detection ----------------
   * Two entries are the same book when they share an ISBN (ISBN-10 and -13 are
   * unified) OR the same author surname + normalized title. Title normalization
   * drops accents, punctuation, leading articles, subtitles and Goodreads series
   * tags, so "The Republic" / "Republic (Penguin Classics)" / "Republic: A New
   * Translation" all match, and so do different editions of one book.
   */
  function fold(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ");
  }
  function normTitle(t) {
    let s = fold(t)
      .replace(/\s*[([][^)\]]*[)\]]\s*/g, " ") // "(The Expanse, #1)", "[Illustrated]"
      .split(/\s*[:;]\s+|\s+[-—–]\s+/)[0] // subtitle
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    s = s.replace(/^(the|a|an|le|la|les|el|los|las|il|der|die|das) /, "");
    return s;
  }
  function surname(a) {
    let s = fold(a).trim();
    if (!s) return "";
    if (s.includes(",")) return s.split(",")[0].replace(/[^a-z0-9]+/g, "");
    const parts = s.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv|phd|md)$/.test(w));
    return parts[parts.length - 1] || "";
  }
  function isbnKey(raw) {
    let d = String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
    if (d.length === 10) {
      // ISBN-10 -> ISBN-13 so both forms of one edition match
      const core = "978" + d.slice(0, 9);
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += +core[i] * (i % 2 ? 3 : 1);
      d = core + ((10 - (sum % 10)) % 10);
    }
    return d.length === 13 ? "i:" + d : "";
  }
  function bookKeys(b) {
    const keys = [];
    const ik = isbnKey(b.isbn);
    if (ik) keys.push(ik);
    const t = normTitle(b.title);
    if (t) keys.push("t:" + surname(b.author) + "|" + t);
    return keys;
  }
  // Fold what the duplicate knows into the entry we keep.
  function mergeInto(keep, dup) {
    keep.read = keep.read || !!dup.read;
    keep.primary = keep.primary || !!dup.primary;
    keep.rating = Math.max(keep.rating || 0, dup.rating || 0);
    if (!keep.isbn && dup.isbn) keep.isbn = dup.isbn;
    if (!keep.note && dup.note) keep.note = dup.note;
    const dd = cleanDdc(dup.ddc);
    if (dd && (!keep.ddc || (dup.ddcSrc === "manual" && keep.ddcSrc !== "manual"))) {
      keep.ddc = dd;
      keep.ddcSrc = dup.ddcSrc || "manual";
    }
  }
  function makeIndex(list) {
    const idx = new Map();
    for (const b of list) for (const k of bookKeys(b)) if (!idx.has(k)) idx.set(k, b);
    return idx;
  }
  function findIn(idx, b) {
    for (const k of bookKeys(b)) if (idx.has(k)) return idx.get(k);
    return null;
  }
  // Append `incoming` to `target` (in place), skipping duplicates of existing
  // entries and of each other. Returns counts for the toast.
  function mergeBooks(target, incoming, fresh = true) {
    const idx = makeIndex(target);
    let id = nextId(target);
    let added = 0,
      dup = 0;
    for (const nb of incoming) {
      const hit = findIn(idx, nb);
      if (hit) {
        mergeInto(hit, nb);
        dup++;
        continue;
      }
      const n = fresh ? normalize({ ...nb, id: null }, id++) : nb; // fresh ids: never collide
      target.push(n);
      for (const k of bookKeys(n)) if (!idx.has(k)) idx.set(k, n);
      added++;
    }
    return { added, dup };
  }
  // Remove duplicates already inside a list (e.g. saved before this check existed).
  function dedupeList(list) {
    const out = [];
    const r = mergeBooks(out, list, false);
    return { list: out, removed: r.dup };
  }
  function importToast(r) {
    const skipped = r.dup ? ` · ${r.dup} duplicate${r.dup === 1 ? "" : "s"} skipped` : "";
    toast(r.added ? `Added ${r.added} new${skipped}` : `Nothing new${skipped}`);
  }

  function importGoodreadsBooks(books) {
    const r = mergeBooks(GOODREADS, books);
    if (r.added) persist(`Import ${r.added} book${r.added === 1 ? "" : "s"} from Goodreads`);
    else if (r.dup) persist("Update Goodreads library");
    buildFilters();
    render();
    importToast(r);
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
          is saved to <code>library.md</code> in this repo.</p>
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
    const books = LibraryStore.parseList(text || "");
    if (!books.length) {
      alert("No books found. Use lines like:  - Author — _Title_  under a ## Category heading.");
      return;
    }
    const r = mergeBooks(READING, books);
    if (r.added) persist(`Import ${r.added} book${r.added === 1 ? "" : "s"} into Reading List`);
    else if (r.dup) persist("Update Reading List");
    closeModal();
    buildFilters();
    render();
    importToast(r);
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

  /* ---------------- saving to library.md ----------------
   * Every change is written back to library.md through the backend store.js
   * picked (local server / GitHub commit / read-only). Saves are debounced and
   * coalesced; identical content is never re-saved.
   */
  const store = { backend: null, error: "" };
  let savedText = ""; // what library.md holds right now
  let saveT = null,
    saveDue = 0,
    saving = false,
    saveAgain = false,
    saveState = "saved";
  const saveReasons = new Set();

  function persist(reason = "Update library", delay = 1500) {
    saveReasons.add(reason);
    refreshSaveLabel();
    if (!store.backend || !store.backend.writable) return;
    const due = Date.now() + delay;
    if (!saveT || due < saveDue) {
      clearTimeout(saveT);
      saveDue = due;
      saveT = setTimeout(flushSave, delay);
    }
  }
  // Say "unsaved" only when library.md would actually change (background
  // classification often re-confirms numbers the file already has).
  let labelT;
  function refreshSaveLabel() {
    clearTimeout(labelT);
    labelT = setTimeout(() => {
      if (saveState === "saving" || saveState === "error") return;
      const dirty = isDirty();
      if (!store.backend.writable) setSaveState(dirty ? "readonly" : "saved");
      else setSaveState(dirty ? "pending" : "saved");
    }, 300);
  }

  async function flushSave() {
    clearTimeout(saveT);
    saveT = null;
    if (!store.backend || !store.backend.writable) return;
    if (saving) {
      saveAgain = true;
      return;
    }
    const text = LibraryStore.serialize({ reading: READING, goodreads: GOODREADS });
    const reasons = [...saveReasons];
    saveReasons.clear();
    if (text === savedText) return setSaveState("saved");
    const message =
      reasons.length <= 1
        ? reasons[0] || "Update library"
        : `Update library: ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ""}`;
    saving = true;
    setSaveState("saving");
    try {
      await store.backend.save(text, message);
      savedText = text;
      store.error = "";
      setSaveState("saved");
      dropLegacyStorage();
    } catch (e) {
      reasons.forEach((r) => saveReasons.add(r));
      store.error = e.message;
      setSaveState("error");
    }
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      flushSave();
    }
  }

  function isDirty() {
    return LibraryStore.serialize({ reading: READING, goodreads: GOODREADS }) !== savedText;
  }

  function setSaveState(st) {
    saveState = st;
    const btn = document.getElementById("storeBtn");
    if (!btn || !store.backend) return;
    const where = { local: "library.md", github: "library.md on GitHub", static: "library.md" }[store.backend.kind];
    btn.textContent = {
      saved: `Saved · ${where}`,
      pending: "Unsaved changes…",
      saving: "Saving…",
      error: "Save failed — click for details",
      readonly: "Read-only — changes aren't saved",
    }[st];
    if (st === "saved" && store.backend.kind === "static") btn.textContent = "Read-only · connect to save";
    btn.classList.toggle("warn", st === "error" || st === "readonly");
  }

  window.addEventListener("beforeunload", (e) => {
    if (saveState === "pending") flushSave();
    if (saveState === "pending" || saveState === "saving" || saveState === "error" || (saveState === "readonly" && isDirty())) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // One-time move of lists that older versions kept in this browser's localStorage.
  const LEGACY_KEYS = ["readinglist.v1", "goodreads.v1"];
  let legacyMoved = false;
  function legacyLists() {
    const read = (k) => {
      try {
        const v = JSON.parse(localStorage.getItem(k) || "null");
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    };
    return { reading: read(LEGACY_KEYS[0]), goodreads: read(LEGACY_KEYS[1]) };
  }
  function dropLegacyStorage() {
    if (!legacyMoved) return;
    try {
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
    legacyMoved = false;
  }

  function downloadLibrary() {
    const text = LibraryStore.serialize({ reading: READING, goodreads: GOODREADS });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    a.download = "library.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
        <p class="pk-hint">This permanently removes books from <code>library.md</code>.${
          store.backend.kind === "github"
            ? " The change is committed to GitHub — the only way back is the repo's history."
            : store.backend.kind === "local"
            ? " The file on disk is overwritten — the only way back is git (if you committed) or a backup."
            : " (Read-only here, so this only clears what's on screen until you reload.)"
        }</p>
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
    document.getElementById("clrBackup").addEventListener("click", downloadLibrary);
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
    go.addEventListener("click", () => {
      if (go.disabled) return;
      if (scope !== "goodreads") READING = [];
      if (scope !== "reading") GOODREADS = [];
      Object.assign(state, { q: "", ddc: "", author: "", status: "" });
      els.search.value = "";
      els.statusFilter.value = "";
      closeModal();
      persist({ all: "Clear library", reading: "Clear Reading List", goodreads: "Clear Goodreads library" }[scope], 0);
      buildFilters();
      render();
      toast(`Deleted ${n} book${n === 1 ? "" : "s"}`);
    });
    setTimeout(() => inp.focus(), 30);
  }

  function openStorageDialog() {
    const kind = store.backend.kind;
    const cfg = { ...LibraryStore.githubDefaults(), ...(LibraryStore.githubSettings() || {}) };
    const now = {
      local: "Saving straight into <code>library.md</code> in your repo folder (local server).",
      github: `Committing every change to <code>${escapeHtml(cfg.path)}</code> in <strong>${escapeHtml(cfg.owner)}/${escapeHtml(cfg.repo)}</strong> (${escapeHtml(cfg.branch)}).`,
      static: "Reading <code>library.md</code> from this site. <strong>Changes you make here aren't saved.</strong>",
    }[kind];
    openModal(
      `<div class="mform storage">
        <h3>Where your library is saved</h3>
        <p class="st-now">${now}</p>
        ${store.error ? `<p class="st-err">Last error: ${escapeHtml(store.error)}</p>` : ""}
        <p class="pk-hint">Your whole library is one Markdown file, <code>library.md</code>, in the repo — readable on GitHub and safe to edit by hand.</p>
        <h4>On your computer</h4>
        <p class="pk-hint">Run <code>node server.js</code> in the repo folder and open <code>http://localhost:8000</code>. Every change is written straight into <code>library.md</code>; commit it whenever you like.</p>
        ${kind === "local" ? "" : `
        <h4>Anywhere — commit through GitHub</h4>
        <p class="pk-hint">Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
        for just this repository with <strong>Contents: Read and write</strong>. It's kept only in this browser, never in the repo.
        Each save becomes a commit to <code>library.md</code>.</p>
        <div class="st-grid">
          <label>Owner<input type="text" id="ghOwner" value="${attr(cfg.owner)}" autocomplete="off" spellcheck="false" /></label>
          <label>Repository<input type="text" id="ghRepo" value="${attr(cfg.repo)}" autocomplete="off" spellcheck="false" /></label>
          <label>Branch<input type="text" id="ghBranch" value="${attr(cfg.branch)}" autocomplete="off" spellcheck="false" /></label>
          <label>File<input type="text" id="ghPath" value="${attr(cfg.path)}" autocomplete="off" spellcheck="false" /></label>
        </div>
        <label>Token<input type="password" id="ghToken" value="${attr(cfg.token || "")}" placeholder="github_pat_…" autocomplete="off" spellcheck="false" /></label>`}
        <div class="mform-actions">
          <button type="button" class="btn-ghost" id="stDownload">Download library.md</button>
          ${store.error ? '<button type="button" class="btn-ghost" id="stRetry">Retry save</button>' : ""}
          ${kind === "github" ? '<button type="button" class="btn-ghost" id="stDisconnect">Disconnect</button>' : ""}
          ${kind === "local" ? "" : `<button type="button" class="btn-primary" id="stConnect">${kind === "github" ? "Save settings" : "Connect"}</button>`}
        </div>
      </div>`
    );
    document.getElementById("stDownload").addEventListener("click", downloadLibrary);
    const retry = document.getElementById("stRetry");
    if (retry) retry.addEventListener("click", () => { closeModal(); flushSave(); });
    const disc = document.getElementById("stDisconnect");
    if (disc)
      disc.addEventListener("click", () => {
        if (isDirty() && !confirm("Some changes haven't been saved yet. Disconnect anyway?")) return;
        LibraryStore.setGithubSettings(null);
        location.reload();
      });
    const conn = document.getElementById("stConnect");
    if (conn)
      conn.addEventListener("click", async () => {
        const val = (id) => document.getElementById(id).value.trim();
        const next = { owner: val("ghOwner"), repo: val("ghRepo"), branch: val("ghBranch") || "main", path: val("ghPath") || "library.md", token: val("ghToken") };
        if (!next.owner || !next.repo || !next.token) return toast("Owner, repository and token are required");
        conn.disabled = true;
        conn.textContent = "Connecting…";
        const gh = LibraryStore.github(next);
        let text;
        try {
          text = await gh.load();
        } catch (e) {
          conn.disabled = false;
          conn.textContent = "Connect";
          return toast(`Couldn't connect: ${e.message}`);
        }
        LibraryStore.setGithubSettings(next);
        store.backend = gh;
        store.error = "";
        const db = LibraryStore.parseDatabase(text);
        savedText = text;
        if (db.reading.length || db.goodreads.length) {
          // the repo copy wins; anything only in this browser is merged in
          const localR = READING, localG = GOODREADS;
          READING = db.reading.map(normalize);
          GOODREADS = db.goodreads.map(normalize);
          const r = mergeBooks(READING, localR).added + mergeBooks(GOODREADS, localG).added;
          if (r) persist(`Add ${r} book${r === 1 ? "" : "s"} from this browser`);
        } else if (READING.length || GOODREADS.length) {
          persist("Create library.md", 0);
        }
        setSaveState(isDirty() ? "pending" : "saved");
        closeModal();
        buildFilters();
        render();
        toast(`Connected to ${next.owner}/${next.repo}`);
      });
  }

  /* ---------------- data mutations (add / delete) ---------------- */
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
    persist(`Remove “${removed.title}”`);
    buildFilters();
    render();
    toast(`Removed “${removed.title}”`);
  }
  function addBookToCurrent(data) {
    const arr = currentData();
    const existing = findIn(makeIndex(arr), data);
    if (existing) {
      mergeInto(existing, data);
      persist(`Update “${existing.title}”`);
      toast(`“${existing.title}” is already in your library`);
      render();
      openDetail(existing.id);
      return;
    }
    const b = normalize(data, nextId(arr));
    arr.unshift(b);
    persist(`Add “${b.title}”`);
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
      : `<div class="ddc-num muted">${b._c ? "Unclassified" : "Classifying…"}</div>
         <div class="ddc-src">${b._c ? "No catalog number or subject match found. Assign one below." : "Looking up the catalog record…"}</div>`;
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
        b.ddcSrc = "";
        b.ddc = "";
        b._c = false;
        renderDetailDdc(b);
        applyMeta(b, await getMeta(b));
        persist(`Reset Dewey number of “${b.title}”`);
        render();
        if (modalBookId === b.id) renderDetailDdc(b);
      });
  }

  function setBookDdc(b, n) {
    b.ddc = n;
    b.ddcSrc = "manual";
    b._c = true;
    persist(`File “${b.title}” under ${n}`);
    buildDdcChips(currentData());
    render();
    toast(`Filed “${b.title}” under ${n}`);
    openDetail(b.id);
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
    const needMeta = !b._c;
    const [desc, m] = await Promise.all([getDescription(b), needMeta ? getMeta(b) : Promise.resolve(null)]);
    if (m && !b._c) {
      applyMeta(b, m);
      updateCardTag(b);
      scheduleChipRefresh();
      schedulePersist();
    }
    if (modalBookId !== b.id) return; // modal closed or switched
    if (m) {
      const tagsEl = document.getElementById("dTags");
      if (tagsEl) tagsEl.innerHTML = detailTags(b).map((t) => `<span class="d-tag">${escapeHtml(t)}</span>`).join("");
      renderDetailDdc(b);
    }
    const sEl = document.getElementById("dSummary");
    if (sEl) {
      if (desc) { sEl.textContent = desc; sEl.classList.remove("muted"); }
      else { sEl.textContent = "No summary found for this edition."; }
    }
  }

  /* ---------------- add a book: ISBN autofill + "did you mean" ---------------- */
  function isValidIsbn(d) {
    if (/^\d{9}[\dX]$/.test(d)) {
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += (d[i] === "X" ? 10 : +d[i]) * (10 - i);
      return sum % 11 === 0;
    }
    if (/^\d{13}$/.test(d)) {
      let sum = 0;
      for (let i = 0; i < 13; i++) sum += +d[i] * (i % 2 ? 3 : 1);
      return sum % 10 === 0;
    }
    return false;
  }

  // ISBN -> {title, author, year, cover}. Open Library first, Google Books as a fallback.
  async function lookupIsbn(isbn) {
    try {
      const p = new URLSearchParams({ q: `isbn:${isbn}`, limit: "1", fields: "title,author_name,first_publish_year,cover_i" });
      const r = await fetch(`https://openlibrary.org/search.json?${p}`);
      if (r.ok) {
        const d = ((await r.json()).docs || [])[0];
        if (d && d.title)
          return {
            title: d.title,
            author: (d.author_name || [])[0] || "",
            year: d.first_publish_year || "",
            cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : "",
          };
      }
    } catch (e) {}
    try {
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
      if (r.ok) {
        const v = (((await r.json()).items || [])[0] || {}).volumeInfo;
        if (v && v.title) return googleBook(v);
      }
    } catch (e) {}
    return null;
  }
  function googleBook(v) {
    const ids = v.industryIdentifiers || [];
    const isbn = (ids.find((i) => i.type === "ISBN_13") || ids.find((i) => i.type === "ISBN_10") || {}).identifier || "";
    return {
      title: v.title,
      author: (v.authors || [])[0] || "",
      year: (v.publishedDate || "").slice(0, 4),
      cover: ((v.imageLinks || {}).smallThumbnail || "").replace(/^http:/, "https:"),
      isbn,
    };
  }

  // Real books matching what was typed. {list, reached} — reached=false when offline.
  async function searchBooks(title, author) {
    const list = [];
    let reached = false;
    try {
      const p = new URLSearchParams({ q: `${title} ${author}`.trim(), limit: "8", fields: "title,author_name,first_publish_year,cover_i,edition_count" });
      const r = await fetch(`https://openlibrary.org/search.json?${p}`);
      if (r.ok) {
        reached = true;
        for (const d of (await r.json()).docs || [])
          if (d.title)
            list.push({
              title: d.title,
              author: (d.author_name || [])[0] || "",
              year: d.first_publish_year || "",
              cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : "",
              isbn: "",
            });
      }
    } catch (e) {}
    // Google Books copes better with typos; use it when Open Library comes up short.
    if (list.length < 4) {
      try {
        const q = [title && `intitle:${title}`, author && `inauthor:${author}`].filter(Boolean).join(" ");
        let r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books`);
        let items = r.ok ? (await r.json()).items || [] : [];
        if (r.ok) reached = true;
        if (!items.length) {
          r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`${title} ${author}`.trim())}&maxResults=8&printType=books`);
          items = r.ok ? (await r.json()).items || [] : [];
        }
        for (const it of items) if (it.volumeInfo && it.volumeInfo.title) list.push(googleBook(it.volumeInfo));
      } catch (e) {}
    }
    // one row per book
    const seen = new Set();
    const uniq = list.filter((c) => {
      const k = surname(c.author) + "|" + normTitle(c.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { list: uniq.slice(0, 8), reached };
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
      if (!isValidIsbn(isbn)) return showStatus(isbn.length >= 13 || (isbn.length === 10 && !/^97[89]/.test(isbn)) ? "That doesn't look like a valid ISBN." : "");
      showStatus('<span class="muted">Looking up ISBN…</span>');
      const hit = await lookupIsbn(isbn);
      if (mine !== seq || !$("fIsbn")) return;
      if (!hit) return showStatus("No book found for this ISBN — fill in the details yourself.");
      $("fTitle").value = hit.title;
      $("fAuthor").value = hit.author;
      verified = { title: hit.title, author: hit.author };
      showStatus(
        `${hit.cover ? `<img src="${attr(hit.cover)}" alt="" onerror="this.remove()" />` : ""}<div><strong>${escapeHtml(hit.title)}</strong><br />${escapeHtml(
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
      const { list, reached } = await searchBooks(data.title, data.author);
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
              <span class="cand-cover">${c.cover ? `<img src="${attr(c.cover)}" alt="" loading="lazy" onerror="this.remove()" />` : ""}</span>
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

  /* ---------------- action buttons + card clicks ---------------- */
  function updateActionButtons() {
    const btn = document.getElementById("importMore");
    const empty = currentData().length === 0; // the landing panel has its own importer
    btn.hidden = empty;
    btn.textContent = state.tab === "goodreads" ? "Import CSV" : "Import list";
  }
  document.getElementById("addBook").addEventListener("click", openAddForm);
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

  /* ---------------- boot ---------------- */
  document.getElementById("storeBtn").addEventListener("click", openStorageDialog);
  document.getElementById("clearBtn").addEventListener("click", openClearDialog);
  els.sortBy.value = state.sort;
  (async () => {
    const opened = await LibraryStore.open();
    store.backend = opened.backend;
    savedText = opened.text;
    const db = LibraryStore.parseDatabase(opened.text);
    READING = db.reading.map(normalize);
    GOODREADS = db.goodreads.map(normalize);
    const notes = [];

    // Books older versions kept in this browser move into library.md.
    const legacy = legacyLists();
    if (legacy.reading.length || legacy.goodreads.length) {
      const moved = mergeBooks(READING, legacy.reading).added + mergeBooks(GOODREADS, legacy.goodreads).added;
      legacyMoved = true;
      if (moved) {
        persist(`Move ${moved} book${moved === 1 ? "" : "s"} from browser storage into library.md`, 0);
        notes.push(`Moved ${moved} book${moved === 1 ? "" : "s"} from this browser into library.md`);
      } else dropLegacyStorage();
    }
    // Duplicates (e.g. from hand edits) are merged.
    let removed = 0;
    const r = dedupeList(READING);
    if (r.removed) [READING, removed] = [r.list, removed + r.removed];
    const g = dedupeList(GOODREADS);
    if (g.removed) [GOODREADS, removed] = [g.list, removed + g.removed];
    if (removed) {
      persist("Merge duplicate books", 0);
      notes.push(`Merged ${removed} duplicate book${removed === 1 ? "" : "s"}`);
    }

    setSaveState("saved");
    refreshSaveLabel();
    updateActionButtons();
    buildFilters();
    render();
    if (opened.error) notes.unshift(opened.error);
    if (notes.length) toast(notes.join(" · "));
  })();
})();
