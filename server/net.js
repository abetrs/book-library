"use strict";
/* Outbound HTTP for scraping: timeouts, a descriptive User-Agent, and per-host
 * concurrency + pacing so bulk imports don't hammer Open Library.
 */
const config = require("./config");

const UA = `book-library/2.0 (self-hosted personal library${config.contact ? "; " + config.contact : ""})`;

const hosts = new Map(); // host -> { active, queue, last }
const LIMITS = { default: { concurrent: 3, gapMs: 150 } };

function slot(host) {
  let h = hosts.get(host);
  if (!h) hosts.set(host, (h = { active: 0, queue: [], last: 0 }));
  return h;
}

function acquire(host) {
  const h = slot(host);
  const lim = LIMITS[host] || LIMITS.default;
  return new Promise((resolve) => {
    const tryRun = () => {
      if (h.active >= lim.concurrent) return h.queue.push(tryRun);
      const wait = h.last + lim.gapMs - Date.now();
      if (wait > 0) return setTimeout(tryRun, wait);
      h.active++;
      h.last = Date.now();
      resolve(() => {
        h.active--;
        const next = h.queue.shift();
        if (next) next();
      });
    };
    tryRun();
  });
}

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// fetch with a per-host slot and a timeout. Resolves to the Response (any status);
// rejects only when the host couldn't be reached.
async function request(url, { timeout = 12000, headers = {}, ...opts } = {}) {
  const host = new URL(url).host;
  const release = await acquire(host);
  try {
    return await fetch(url, {
      ...opts,
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });
  } catch (e) {
    throw new UpstreamError(`${host}: ${e.name === "TimeoutError" ? "timed out" : e.message}`);
  } finally {
    release();
  }
}

// JSON or null for 404; throws UpstreamError on network failure / 5xx / 429 so
// callers can tell "not found" from "couldn't ask".
async function getJson(url, opts) {
  const r = await request(url, opts);
  if (r.status === 404) return null;
  if (!r.ok) throw new UpstreamError(`${new URL(url).host}: HTTP ${r.status}`, r.status);
  return r.json();
}

module.exports = { request, getJson, UpstreamError, UA };
