"use strict";
/* A stand-in for Open Library, its cover service, Google Books and Wikipedia,
 * so tests run offline and can count how often each upstream is hit.
 *   const up = await startMockUpstream();  // up.url, up.hits, up.close()
 */
const http = require("http");
const zlib = require("zlib");

// A real (noisy, so > 1 KB) PNG so browsers can actually draw it.
function png(w, h, seed) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let x = seed * 2654435761;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let i = 0; i < w; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      const o = y * (w * 3 + 1) + 1 + i * 3;
      raw[o] = 60 + ((seed * 53) % 150) + (x & 15);
      raw[o + 1] = 70 + ((seed * 97) % 120) + ((x >> 8) & 15);
      raw[o + 2] = 90 + ((seed * 31) % 100) + ((x >> 16) & 15);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const WORKS = {
  republic: { title: "The Republic", author: "Plato", ddc: ["321.07", "321/.07"], subject: ["Political science", "Philosophy, Ancient", "Utopias"], cover_i: 101, language: ["eng", "grc"] },
  crime: { title: "Crime and Punishment", author: "Fyodor Dostoevsky", subject: ["Russian fiction", "Fiction", "Psychological fiction"], cover_i: 102, language: ["eng", "rus"], desc: "A poor ex-student in Saint Petersburg commits a murder and wrestles with the consequences." },
  moby: { title: "Moby-Dick", author: "Herman Melville", ddc: ["813.3", "813/.3"], subject: ["Whaling", "Fiction", "Sea stories"], cover_i: 103 },
  meditations: { title: "Meditations", author: "Marcus Aurelius", ddc: ["188"], subject: ["Stoics", "Ethics"], cover_i: 104 },
  pride: { title: "Pride and Prejudice", author: "Jane Austen", ddc: ["823.7", "823/.7"], subject: ["Fiction", "English fiction", "Courtship"], cover_i: 105, isbn: "9780141439518" },
};
const EDITIONS = {
  "9780441172719": { title: "Dune", author: "Frank Herbert", dewey_decimal_class: ["813/.54"], works: [{ key: "/works/OL1W" }], languages: [{ key: "/languages/eng" }] },
  "9780141439518": { title: "Pride and Prejudice", author: "Jane Austen", dewey_decimal_class: ["823/.7"], works: [{ key: "/works/OL2W" }] },
};
const WORK_JSON = {
  "/works/OL1W.json": { subjects: ["Science fiction", "Fiction", "Dune (Imaginary place)"], description: "Paul Atreides on the desert planet Arrakis." },
  "/works/OL2W.json": { subjects: ["Fiction", "English fiction"], description: { value: "Elizabeth Bennet and Mr Darcy." } },
};

function findWork(text) {
  const t = String(text || "").toLowerCase();
  if (/republic/.test(t)) return WORKS.republic;
  if (/crime and punishment/.test(t)) return WORKS.crime;
  if (/moby/.test(t)) return WORKS.moby;
  if (/meditations/.test(t)) return WORKS.meditations;
  if (/pride/.test(t)) return WORKS.pride;
  return null;
}

function startMockUpstream() {
  const hits = {};
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const bucket = p.startsWith("/b/") ? "covers" : p.split("/").slice(0, 2).join("/");
    hits[bucket] = (hits[bucket] || 0) + 1;
    hits.total = (hits.total || 0) + 1;
    hits[p] = (hits[p] || 0) + 1;
    const json = (o, s = 200) => {
      res.writeHead(s, { "Content-Type": "application/json" });
      res.end(JSON.stringify(o));
    };
    const q = url.searchParams;

    // ---- Open Library ----
    if (p === "/search.json") {
      const qq = q.get("q") || "";
      const m = qq.match(/^isbn:(\S+)/);
      if (m) {
        const ed = EDITIONS[m[1]];
        return json({ docs: ed ? [{ title: ed.title, author_name: [ed.author], first_publish_year: 1965, cover_i: 200 }] : [] });
      }
      const w = findWork(q.get("title") || qq);
      if (/typo-only-google/.test(qq + (q.get("title") || ""))) return json({ docs: [] });
      if (!w) return json({ docs: [] });
      return json({ docs: [{ key: "/works/OLX" + w.cover_i + "W", title: w.title, author_name: [w.author], first_publish_year: 1850, cover_i: w.cover_i, ddc: w.ddc, subject: w.subject, language: w.language, isbn: w.isbn ? [w.isbn] : [] }] });
    }
    let m = p.match(/^\/isbn\/([0-9X]+)\.json$/);
    if (m) return EDITIONS[m[1]] ? json(EDITIONS[m[1]]) : json({ error: "notfound" }, 404);
    if (WORK_JSON[p]) return json(WORK_JSON[p]);
    m = p.match(/^\/works\/OLX(\d+)W\.json$/);
    if (m) {
      const w = Object.values(WORKS).find((x) => String(x.cover_i) === m[1]);
      return w ? json({ subjects: w.subject, description: w.desc || "" }) : json({}, 404);
    }
    // ---- covers ----
    m = p.match(/^\/b\/(id|isbn)\/([0-9X]+)-M\.jpg$/);
    if (m) {
      const known = m[1] === "id" ? Number(m[2]) >= 100 : !!EDITIONS[m[2]];
      if (!known) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(png(120, 180, Number(m[2].slice(-3))));
    }
    // ---- Google Books ----
    if (p === "/volumes") {
      const qq = q.get("q") || "";
      if (/dostoyevski|punishmnt/i.test(qq))
        return json({ items: [
          { volumeInfo: { title: "Crime and Punishment", authors: ["Fyodor Dostoyevsky"], publishedDate: "2003", industryIdentifiers: [{ type: "ISBN_13", identifier: "9780143058144" }] } },
          { volumeInfo: { title: "The Brothers Karamazov", authors: ["Fyodor Dostoyevsky"], publishedDate: "2002" } },
        ] });
      return json({ items: [] });
    }
    // ---- Wikipedia ----
    if (p === "/w/api.php") return json({ query: { search: [] } });
    json({ error: "unknown" }, 404);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, hits, close: () => new Promise((r) => server.close(r)) });
    })
  );
}

// Point the app at the mock (call before requiring server modules).
function useMock(url) {
  process.env.OPENLIBRARY_URL = url;
  process.env.COVERS_URL = url;
  process.env.GOOGLE_BOOKS_URL = url;
  process.env.WIKIPEDIA_URL = url;
}

module.exports = { startMockUpstream, useMock, png };

// `node test/mock-upstream.js` runs it standalone (for manual/browser testing).
if (require.main === module)
  startMockUpstream().then((up) => console.log(`mock upstream on ${up.url}`));
