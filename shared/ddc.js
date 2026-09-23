/* Dewey Decimal helpers shared by the server and the browser:
 * cleaning catalog numbers, labels/paths from the outline, and the query syntax
 * ("8", "800", "82x", "823.8", "320.", "300-399", "none").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./dewey"));
  else root.DDC = factory(root.DEWEY);
})(typeof self !== "undefined" ? self : this, function (DEWEY) {
  "use strict";

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



  function shortMain(k) {
    return {
      0: "General works", 1: "Philosophy", 2: "Religion", 3: "Social sciences", 4: "Language",
      5: "Science", 6: "Technology", 7: "Arts", 8: "Literature", 9: "History",
    }[k];
  }


  return { cleanDdc, sectionLabel, divisionLabel, ddcLabel, ddcPath, looksLikeDdc, parseDdcQuery, ddcMatches, prefixDisplay, prefixQuery, shortMain };
});
