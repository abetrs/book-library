"use strict";
/* End-to-end API tests against a mock upstream (no network needed). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { startMockUpstream, useMock } = require("./mock-upstream");

let up, server, base, db, worker, config;

test.before(async () => {
  up = await startMockUpstream();
  useMock(up.url);
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "library-test-"));
  process.env.LIBRARY_IMPORT = "";
  config = require("../server/config");
  const DB = require("../server/db");
  const Auth = require("../server/auth");
  db = DB.open(config.dbFile);
  Auth.init(db);
  worker = require("../server/classify").startWorker(db, { concurrency: 3, idleMs: 200 });
  const app = require("../server/app").createApp({ db, worker, log: { error() {} } });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  worker.stop();
  await new Promise((r) => server.close(r));
  db.close();
  await up.close();
});

async function call(method, p, body, headers = {}) {
  const h = { ...headers };
  if (method !== "GET") h["X-Library"] = "1";
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, headers: r.headers, body: ct.includes("json") ? await r.json() : await r.arrayBuffer() };
}
async function waitClassified(ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await call("GET", "/api/status");
    if (s.body.pending === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("classification did not finish");
}
const byTitle = async (t) => (await call("GET", "/api/books")).body.books.find((b) => b.title === t);

test("import de-duplicates within the upload", async () => {
  const r = await call("POST", "/api/import", {
    list: "reading",
    format: "markdown",
    text: "## Philosophy\n- Plato — _The Republic_ ✅\n- plato — Republic (Penguin Classics)\n- Marcus Aurelius — Meditations\n\n## Fiction\n- Fyodor Dostoevsky — Crime and Punishment\n- Herman Melville — Moby-Dick\n- Nana — _Grandma's Recipes_ !custom",
  });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.added, r.body.dup], [5, 1]);
});

test("books are classified in the background", async () => {
  await waitClassified();
  assert.deepEqual([(await byTitle("The Republic")).ddc, (await byTitle("The Republic")).ddcSrc], ["321.07", "ol"]);
  assert.deepEqual([(await byTitle("Crime and Punishment")).ddc, (await byTitle("Crime and Punishment")).ddcSrc], ["891.73", "est"]);
  assert.equal((await byTitle("Meditations")).ddc, "188");
  assert.equal((await byTitle("Moby-Dick")).ddc, "813.3");
  assert.deepEqual((await byTitle("Grandma's Recipes")).ddcSrc, "est"); // custom: estimated, never searched
});

test("full listing is cacheable by revision (304) and deltas carry only changes", async () => {
  const full = await call("GET", "/api/books");
  const etag = full.headers.get("etag");
  assert.ok(etag);
  const again = await fetch(base + "/api/books", { headers: { "If-None-Match": etag } });
  assert.equal(again.status, 304);
  const delta = await call("GET", `/api/books?since=${full.body.rev}`);
  assert.deepEqual([delta.body.books.length, delta.body.deleted.length, delta.body.full], [0, 0, false]);
});

test("adding a duplicate merges instead of adding", async () => {
  const r = await call("POST", "/api/books", { list: "reading", title: "Republic: A New Translation", author: "Plato", rating: 4 });
  assert.equal(r.body.duplicate, true);
  assert.equal(r.body.book.rating, 4);
  const n = (await call("GET", "/api/books")).body.books.filter((b) => b.list === "reading").length;
  assert.equal(n, 5);
});

test("your Dewey number wins; clearing it re-classifies", async () => {
  const b = await byTitle("Moby-Dick");
  let r = await call("PATCH", `/api/books/${b.id}`, { ddc: "813.39" });
  assert.deepEqual([r.body.book.ddc, r.body.book.ddcSrc], ["813.39", "manual"]);
  r = await call("PATCH", `/api/books/${b.id}`, { ddc: null });
  assert.equal(r.body.book.classified, false);
  await waitClassified();
  assert.deepEqual([(await byTitle("Moby-Dick")).ddc, (await byTitle("Moby-Dick")).ddcSrc], ["813.3", "ol"]);
  assert.equal((await call("PATCH", `/api/books/${b.id}`, { ddc: "nope" })).status, 400);
});

test("covers are fetched once, stored, and served immutable", async () => {
  const b = await byTitle("The Republic");
  const coverPath = "/b/id/101-M.jpg"; // what the mock serves for this book
  const r1 = await fetch(`${base}/covers/${b.cover}.jpg`);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get("content-type"), "image/png");
  assert.match(r1.headers.get("cache-control"), /immutable/);
  await r1.arrayBuffer();
  const r2 = await fetch(`${base}/covers/${b.cover}.jpg`);
  await r2.arrayBuffer();
  assert.equal(up.hits[coverPath], 1, "downloaded exactly once (prefetch or first view), then served from disk");
  const r3 = await fetch(`${base}/covers/${b.cover}.jpg`, { headers: { "If-None-Match": r2.headers.get("etag") } });
  assert.equal(r3.status, 304);
  const custom = await byTitle("Grandma's Recipes");
  assert.equal((await fetch(`${base}/covers/${custom.cover}.jpg`)).status, 404);
  assert.equal((await fetch(`${base}/covers/zzz.jpg`)).status, 404);
});

test("image proxy only fetches allowlisted hosts", async () => {
  assert.equal((await fetch(`${base}/img?u=${encodeURIComponent("http://169.254.169.254/latest")}`)).status, 400);
  const ok = await fetch(`${base}/img?u=${encodeURIComponent(up.url + "/b/id/105-M.jpg")}`);
  assert.equal(ok.status, 200);
});

test("ISBN lookup fills title/author and is cached", async () => {
  const r = await call("GET", "/api/lookup/isbn/978-0-441-17271-9");
  assert.deepEqual([r.body.result.title, r.body.result.author], ["Dune", "Frank Herbert"]);
  const hits = up.hits.total;
  await call("GET", "/api/lookup/isbn/9780441172719");
  assert.equal(up.hits.total, hits, "second lookup served from cache");
  assert.equal((await call("GET", "/api/lookup/isbn/9780441172718")).status, 400);
});

test("search suggests real books for typos", async () => {
  const r = await call("GET", "/api/lookup/search?title=Crime+and+Punishmnt&author=Dostoyevski");
  assert.equal(r.body.results[0].title, "Crime and Punishment");
});

test("summaries come from the catalog and are cached", async () => {
  const b = await byTitle("Crime and Punishment");
  const r = await call("GET", `/api/books/${b.id}/summary`);
  assert.match(r.body.summary, /Saint Petersburg/);
});

test("writes need JSON and the X-Library header", async () => {
  const noHeader = await fetch(base + "/api/books", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(noHeader.status, 403);
  const form = await fetch(base + "/api/books", { method: "POST", headers: { "X-Library": "1", "Content-Type": "application/x-www-form-urlencoded" }, body: "title=x" });
  assert.equal(form.status, 415);
  assert.equal((await call("POST", "/api/books", { list: "reading", title: "" })).status, 400);
});

test("Goodreads CSV import", async () => {
  const csv = 'Title,Author,ISBN,ISBN13,My Rating,Exclusive Shelf,Bookshelves\n"Dune (Dune, #1)",Frank Herbert,"=""0441172717""","=""9780441172719""",5,read,\n"Dune",Frank Herbert,,"=""9780441172719""",0,to-read,\n';
  const r = await call("POST", "/api/import", { list: "goodreads", format: "csv", text: csv });
  assert.deepEqual([r.body.added, r.body.dup], [1, 1]);
  await waitClassified();
  const dune = (await call("GET", "/api/books")).body.books.find((b) => b.list === "goodreads");
  assert.deepEqual([dune.ddc, dune.ddcSrc, dune.rating], ["813.54", "ol", 5]);
});

test("export is a restorable Markdown backup", async () => {
  const r = await fetch(base + "/api/export");
  assert.match(r.headers.get("content-disposition"), /attachment/);
  const text = await r.text();
  assert.match(text, /# Reading List[\s\S]*Plato — _The Republic_ \(Penguin Classics\) ✅ ★4 \{321\.07 catalog\}/);
  assert.match(text, /# Goodreads[\s\S]*Frank Herbert — _Dune \(Dune, #1\)_/);
});

test("clear requires the exact phrase for the current count", async () => {
  const bad = await call("POST", "/api/clear", { scope: "reading", confirm: "delete 99 books" });
  assert.equal(bad.status, 400);
  const rev = (await call("GET", "/api/books")).body.rev;
  const ok = await call("POST", "/api/clear", { scope: "reading", confirm: "delete 5 books" });
  assert.equal(ok.body.deleted, 5);
  const delta = await call("GET", `/api/books?since=${rev}`);
  assert.equal(delta.body.deleted.length, 5);
  assert.equal((await call("GET", "/api/books")).body.books.length, 1); // Goodreads untouched
});

test("static assets: hashed URLs are immutable and pre-compressed", async () => {
  const html = await (await fetch(base + "/")).text();
  const m = html.match(/src="(\/app\.js\?v=[0-9a-f]+)"/);
  assert.ok(m, "index.html references hashed app.js");
  const r = await fetch(base + m[1], { headers: { "Accept-Encoding": "br" } });
  assert.match(r.headers.get("cache-control"), /immutable/);
  assert.equal(r.headers.get("content-encoding"), "br");
  const plain = await fetch(base + "/app.js");
  assert.equal(plain.headers.get("cache-control"), "no-cache");
  const again = await fetch(base + "/app.js", { headers: { "If-None-Match": plain.headers.get("etag") } });
  assert.equal(again.status, 304);
  assert.match(await (await fetch(base + "/sw.js")).text(), /const VERSION = "[0-9a-f]{12}"/);
  assert.equal((await fetch(base + "/shared/ddc.js")).status, 200);
  assert.match((await fetch(base + "/")).headers.get("content-security-policy"), /script-src 'self'/);
});

test("password login protects the API", async () => {
  config.password = "hunter2";
  try {
    assert.equal((await call("GET", "/api/books")).status, 401);
    assert.equal((await fetch(base + "/")).status, 200); // the shell (login screen) loads
    const wrong = await call("POST", "/api/login", { password: "nope" });
    assert.equal(wrong.status, 401);
    const right = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Library": "1" },
      body: JSON.stringify({ password: "hunter2" }),
    });
    assert.equal(right.status, 200);
    const cookie = right.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const authed = await call("GET", "/api/books", undefined, { Cookie: cookie.split(";")[0] });
    assert.equal(authed.status, 200);
    const forged = cookie.split(";")[0].replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    assert.equal((await call("GET", "/api/books", undefined, { Cookie: forged })).status, 401);
  } finally {
    config.password = "";
  }
});
