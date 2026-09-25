/* Book identity, shared by the server (merging imports) and the browser (shelf sort). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Dedupe = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

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


  return { fold, normTitle, surname, isbnKey, bookKeys, isValidIsbn };
});
