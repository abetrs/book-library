"use strict";
/* Dewey numbers + genres for every book, worked out on the server.
 *
 * One Open Library lookup per book yields both:
 *  - the Dewey number from library catalog records (edition `dewey_decimal_class`,
 *    search `ddc`), picking the most-cited section and its most detailed form;
 *  - raw subjects, canonicalized into a small genre vocabulary.
 * Books with no catalog number get an estimate from subjects/genres/category
 * (shown with "~"); your own number is never replaced.
 *
 * A background worker classifies new books a few at a time; results are cached
 * per edition/title so re-imports and duplicates cost nothing.
 */
const config = require("./config");
const { getJson, UpstreamError } = require("./net");
const { cacheGet, cacheSet } = require("./db");
const Books = require("./books");
const { cleanDdc } = require("../shared/ddc");
const { normTitle, surname } = require("../shared/dedupe");

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
  if (b.custom) return { g: [], d: estimateDdc(b, [], [], []), e: true };
  const OL = config.upstream.openLibrary;
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
  const attempt = async (url) => {
    try {
      const j = await getJson(url);
      reached = true;
      return j;
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      return null;
    }
  };

  if (isbn) {
    const ed = await attempt(`${OL}/isbn/${isbn}.json`);
    if (ed) {
      addDdc(ed.dewey_decimal_class || [], 6); // this exact edition's catalog record
      langs = (ed.languages || []).map((l) => String(l.key || "").split("/").pop()).filter(Boolean);
      const wk = ed.works && ed.works[0] && ed.works[0].key;
      const wj = wk && (await attempt(`${OL}${wk}.json`));
      if (wj) {
        subjects = wj.subjects || [];
        genres = canonGenres(subjects);
      }
    }
  }
  if (!cands.length || !genres.length) {
    const p = new URLSearchParams({ title: b.title, limit: "5", fields: "ddc,subject,language" });
    if (b.author) p.set("author", b.author);
    const j = await attempt(`${OL}/search.json?${p}`);
    ((j && j.docs) || []).forEach((d, i) => {
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
  if (!reached) throw new UpstreamError("Open Library unreachable");
  let ddc = pickDdc(cands);
  let est = false;
  if (!ddc) {
    ddc = estimateDdc(b, subjects, genres, langs);
    est = !!ddc;
  }
  return { g: genres, d: ddc || null, e: est };
}

// Cached per edition (ISBN) or author + title. The estimate part depends on the
// book's category, so category-only estimates are recomputed per book.
function metaKey(b) {
  const isbn = (b.isbn || "").replace(/[^0-9Xx]/g, "");
  return "meta:" + (isbn ? "i:" + isbn : "t:" + surname(b.author) + "|" + normTitle(b.title));
}

async function classify(db, b) {
  if (b.custom) return resolveMeta(b);
  const key = metaKey(b);
  let m = cacheGet(db, key);
  if (m === undefined) {
    m = await resolveMeta(b);
    cacheSet(db, key, m, 90 * 864e5);
  } else if (m.e || !m.d) {
    // cached lookups keep their subjects out of the cache, so re-estimate only from what we have
    const est = estimateDdc(b, [], m.g || [], []);
    if (est && !m.d) m = { ...m, d: est, e: true };
  }
  return m;
}

/* ---------------- background worker ---------------- */
function startWorker(db, { concurrency = 2, idleMs = 30000, log = () => {} } = {}) {
  let running = 0;
  let timer = null;
  let stopped = false;
  const busy = new Set();

  async function work(b) {
    try {
      const m = await classify(db, b);
      Books.applyClassification(db, b.id, m);
    } catch (e) {
      if (!(e instanceof UpstreamError)) log("classify error", b.id, e);
      // unreachable / rate-limited: back off and try this book again later
      Books.deferClassification(db, b.id, 10 * 60e3);
    }
  }

  function pump() {
    if (stopped) return;
    clearTimeout(timer);
    const free = concurrency - running;
    if (free > 0) {
      const batch = Books.pendingBooks(db, free + busy.size).filter((b) => !busy.has(b.id)).slice(0, free);
      for (const b of batch) {
        running++;
        busy.add(b.id);
        work(b).finally(() => {
          running--;
          busy.delete(b.id);
          pump();
        });
      }
    }
    if (running === 0) timer = setTimeout(pump, idleMs); // periodic sweep (deferred retries)
  }

  pump();
  return {
    kick: () => setImmediate(pump), // new books were added
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
    get running() {
      return running;
    },
  };
}

module.exports = { classify, resolveMeta, estimateDdc, pickDdc, canonGenres, startWorker };
