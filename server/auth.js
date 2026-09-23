"use strict";
/* Optional single-user login (LIBRARY_PASSWORD).
 * Sessions are stateless signed cookies (HMAC-SHA256). Changing the password
 * invalidates every session. Failed logins are rate-limited per client IP.
 */
const crypto = require("crypto");
const config = require("./config");
const { getMeta, setMeta } = require("./db");

const COOKIE = "lib_session";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest();

let secret = null;
function init(db) {
  if (config.sessionSecret) secret = config.sessionSecret;
  else {
    secret = getMeta(db, "session_secret");
    if (!secret) setMeta(db, "session_secret", (secret = crypto.randomBytes(32).toString("hex")));
  }
}

const enabled = () => !!config.password;
const pwTag = () => sha256("pw:" + config.password).toString("hex").slice(0, 16);
const sign = (payload) => b64u(crypto.createHmac("sha256", secret).update(payload).digest());

function makeToken() {
  const payload = b64u(JSON.stringify({ exp: Date.now() + config.sessionDays * 864e5, pw: pwTag() }));
  return payload + "." + sign(payload);
}
function validToken(tok) {
  if (!tok || !tok.includes(".")) return false;
  const [payload, sig] = tok.split(".");
  const want = sign(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    return p.exp > Date.now() && p.pw === pwTag();
  } catch (e) {
    return false;
  }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return !!req.socket.encrypted || (config.trustProxy && /^https/i.test(String(req.headers["x-forwarded-proto"] || "")));
}
function clientIp(req) {
  if (config.trustProxy && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "?";
}

function isAuthed(req) {
  return !enabled() || validToken(cookies(req)[COOKIE]);
}

function cookieHeader(req, value, maxAgeSec) {
  return [
    `${COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
    isHttps(req) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/* ---------------- login rate limiting ---------------- */
const failures = new Map(); // ip -> {count, until}
function lockedFor(ip) {
  const f = failures.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count++;
  // free attempts, then 2s, 4s, 8s … capped at 15 minutes
  if (f.count > 4) f.until = Date.now() + Math.min(2 ** (f.count - 4) * 1000, 15 * 60e3);
  failures.set(ip, f);
}

// -> {ok, status, cookie?, error?}
function login(req, password) {
  const ip = clientIp(req);
  const wait = lockedFor(ip);
  if (wait) return { ok: false, status: 429, error: `Too many attempts — try again in ${wait}s` };
  const ok = crypto.timingSafeEqual(sha256(String(password || "")), sha256(config.password));
  if (!ok) {
    recordFailure(ip);
    return { ok: false, status: 401, error: "Wrong password" };
  }
  failures.delete(ip);
  return { ok: true, status: 200, cookie: cookieHeader(req, makeToken(), config.sessionDays * 86400) };
}
function logoutCookie(req) {
  return cookieHeader(req, "", 0);
}

module.exports = { init, enabled, isAuthed, login, logoutCookie, clientIp };
