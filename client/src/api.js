// True only when the app is served locally (dev / localhost). Assisted
// auto-apply drives a visible browser on the server, so it's a local-only
// feature and its UI is hidden on the deployed site.
export const IS_LOCAL =
  typeof window !== "undefined" &&
  (Boolean(import.meta.env?.DEV) ||
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname));

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Short-lived client cache so the Today tab can be warmed (prefetched) while the
// user is on the landing page: the prefetch and the tab's own first fetch share
// one request, and the resolved payload is kept so navigating to the tab renders
// instantly with no loading flash. Entries live ~5 min.
const todayPrefetch = new Map();
const TODAY_PREFETCH_TTL = 5 * 60 * 1000;

export function submitFeedback({ message, category, name, contact }) {
  return fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, category, name, contact }),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  });
}

export async function applyToJob(url, provider, autoSubmit) {
  let r;
  try {
    r = await fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, provider, autoSubmit: !!autoSubmit }),
    });
  } catch (e) {
    return {
      ok: false,
      stage: "error",
      message: `Couldn't reach the local apply service (${e.message}). Is the dev server running?`,
    };
  }
  // Parse defensively: a slow/interrupted browser flow can yield an empty body,
  // which would otherwise throw "Unexpected end of JSON input".
  const text = await r.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (data && typeof data === "object") {
    return {
      ok: !!data.ok,
      stage: data.stage,
      mode: data.mode,
      message: data.message || data.error || (r.ok ? "Done." : `Request failed (${r.status}).`),
    };
  }
  return {
    ok: false,
    stage: "error",
    message: `The apply step didn't return a result (status ${r.status}). The browser window may still be open — check it and finish there, or try again.`,
  };
}

export function fetchCompany({ name, min, max, includeUnknown, roleFilter, q, location }) {
  const params = new URLSearchParams({
    name,
    min: String(min),
    max: String(max),
    includeUnknown: String(includeUnknown),
    roleFilter: roleFilter || "swe",
  });
  if (q) params.set("q", q);
  if (location) params.set("location", location);
  return getJSON(`/api/company?${params.toString()}`);
}

export function fetchLinkedIn({ titles, location, pages, roleFilter }) {
  const params = new URLSearchParams({
    titles,
    pages: String(pages),
    roleFilter: roleFilter || "all",
  });
  if (location) params.set("location", location);
  return getJSON(`/api/linkedin?${params.toString()}`);
}

export function fetchCompanies() {
  return getJSON(`/api/companies`);
}

export function fetchLatest({ days = 7, location = "India", pages = 1, refresh = false, includeFintech = false, role = "swe" } = {}) {
  const params = new URLSearchParams({
    days: String(days),
    pages: String(pages),
    includeLinkedIn: "true",
    includeFintech: String(includeFintech),
    role: role || "swe",
  });
  if (location) params.set("location", location);
  if (refresh) params.set("refresh", "true");
  return getJSON(`/api/latest?${params.toString()}`);
}

// Build the /api/today request path for a set of options. Used as the prefetch
// cache key so a background prefetch and the tab's own fetch dedupe to one call.
function todayPath({ location = "India", includeLinkedIn = false, includeInstahyre = false, role = "swe" } = {}) {
  const params = new URLSearchParams({
    includeLinkedIn: String(includeLinkedIn),
    includeInstahyre: String(includeInstahyre),
    role: role || "swe",
  });
  if (location) params.set("location", location);
  return `/api/today?${params.toString()}`;
}

export function fetchToday(opts = {}) {
  const base = todayPath(opts);
  if (opts.refresh) {
    // Force a fresh scan; keep the warmed copy in sync so later opens are instant.
    const entry = { t: Date.now(), value: undefined };
    entry.promise = getJSON(`${base}&refresh=true`)
      .then((v) => ((entry.value = v), v))
      .catch((err) => {
        todayPrefetch.delete(base);
        throw err;
      });
    todayPrefetch.set(base, entry);
    return entry.promise;
  }
  const hit = todayPrefetch.get(base);
  if (hit && Date.now() - hit.t < TODAY_PREFETCH_TTL) return hit.promise;
  const entry = { t: Date.now(), value: undefined };
  entry.promise = getJSON(base)
    .then((v) => ((entry.value = v), v))
    .catch((err) => {
      todayPrefetch.delete(base); // don't cache failures
      throw err;
    });
  todayPrefetch.set(base, entry);
  return entry.promise;
}

// Synchronously return the warmed Today payload if it's already resolved and
// fresh, so the tab can render instantly with no loading flash. Else null.
export function peekToday(opts = {}) {
  const hit = todayPrefetch.get(todayPath(opts));
  if (hit && hit.value !== undefined && Date.now() - hit.t < TODAY_PREFETCH_TTL) {
    return hit.value;
  }
  return null;
}

// Warm the default Today view in the background. Best-effort: errors are
// swallowed here (the tab surfaces them properly if the user opens it).
export function prefetchToday(opts = {}) {
  try {
    return fetchToday(opts).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export async function parseResume(file) {
  const dataBase64 = await fileToBase64(file);
  const r = await fetch("/api/resume/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimetype: file.type, dataBase64 }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Upload failed (${r.status})`);
  return data;
}

export function fetchAts({ name, location = "India", min = 3, max = 10, roleFilter = "swe", profile }) {
  return fetch("/api/ats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, location, min, max, roleFilter, profile }),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  });
}
