"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const DDC = require("../shared/ddc");
const { normTitle, surname, bookKeys, isValidIsbn } = require("../shared/dedupe");
const ListFormat = require("../shared/listfmt");

test("Dewey: catalog numbers are cleaned", () => {
  assert.equal(DDC.cleanDdc("823/.8"), "823.8");
  assert.equal(DDC.cleanDdc("891.73/3"), "891.733");
  assert.equal(DDC.cleanDdc("320.5/32 21"), "320.532");
  assert.equal(DDC.cleanDdc("[Fic]"), null);
  assert.equal(DDC.cleanDdc("823.80"), "823.8");
});

test("Dewey: query syntax round-trips through prefixQuery", () => {
  for (const p of ["0", "00", "8", "80", "82", "800", "320", "823", "8917", "82381"])
    assert.equal(DDC.parseDdcQuery(DDC.prefixQuery(p)).p, p, p);
  assert.ok(DDC.ddcMatches("823.8", DDC.parseDdcQuery("82x")));
  assert.ok(DDC.ddcMatches("391", DDC.parseDdcQuery("300-399")));
  assert.ok(!DDC.ddcMatches("400", DDC.parseDdcQuery("300-399")));
  assert.ok(DDC.ddcMatches("", DDC.parseDdcQuery("none")));
  assert.equal(DDC.looksLikeDdc("1984"), false);
});

test("Dewey: labels and path", () => {
  assert.equal(DDC.ddcLabel("823.8"), "English fiction");
  assert.deepEqual(DDC.ddcPath("823.8").map((n) => n.code), ["800", "820", "823"]);
});

test("dedupe: editions, subtitles, series tags and name order match", () => {
  assert.equal(normTitle("The Republic (Penguin Classics)"), normTitle("Republic: A New Translation"));
  assert.equal(surname("Herbert, Frank"), surname("Frank Herbert"));
  const k1 = bookKeys({ title: "Dune (Dune, #1)", author: "Frank Herbert", isbn: "0441172717" });
  const k2 = bookKeys({ title: "Dune", author: "X", isbn: "9780441172719" });
  assert.ok(k1.some((k) => k2.includes(k)), "ISBN-10 and -13 of one edition match");
  assert.ok(isValidIsbn("9780141439518"));
  assert.ok(!isValidIsbn("9780141439519"));
});

test("Markdown: section headers never become books", () => {
  const books = ListFormat.parseList(`## Philosophy
**Ancient**
- Plato — _The Republic_ ✅
- Greek Tragedy
  - Sophocles — Oedipus Rex
- **Stoics**
- Marcus Aurelius — Meditations (Hays translation)
- Modern:
- Nietzsche — Beyond Good and Evil {100}`);
  assert.deepEqual(
    books.map((b) => [b.subcategory, b.subsubcategory, b.author, b.title]),
    [
      ["Ancient", "", "Plato", "The Republic"],
      ["Ancient", "Greek Tragedy", "Sophocles", "Oedipus Rex"],
      ["Ancient", "Stoics", "Marcus Aurelius", "Meditations"],
      ["Ancient", "Modern", "Nietzsche", "Beyond Good and Evil"],
    ]
  );
  assert.equal(books[0].read, true);
  assert.equal(books[2].note, "Hays translation");
  assert.equal(books[3].ddc, "100");
});

test("Markdown: export round-trips exactly", () => {
  const db = {
    reading: ListFormat.parseList("## A\n### sub_1\n- X — _odd\\_title_ ✅ !primary {823.8}\n- _No author_ !custom"),
    goodreads: [{ title: "Dune (Dune, #1)", author: "Frank Herbert", category: "Read", read: true, rating: 5, isbn: "9780441172719", ddc: "813.54", ddcSrc: "ol" }],
  };
  const text = ListFormat.serialize(db);
  assert.equal(ListFormat.serialize(ListFormat.parseDatabase(text)), text);
  assert.match(text, /- X — _odd\\_title_ ✅ !primary \{823\.8\}/);
});

test("Goodreads CSV", () => {
  const csv = 'Title,Author,ISBN,ISBN13,My Rating,Exclusive Shelf,Bookshelves\n"Dune (Dune, #1)",Frank Herbert,"=""0441172717""","=""9780441172719""",5,read,favorites\n';
  const [b] = ListFormat.parseGoodreadsCsv(csv);
  assert.equal(b.isbn, "9780441172719");
  assert.equal(b.category, "Read");
  assert.equal(b.subcategory, "favorites");
  assert.equal(b.rating, 5);
});
