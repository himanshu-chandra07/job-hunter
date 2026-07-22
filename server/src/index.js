import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchCompanyJobs, enrichDescriptions } from "./ats.js";
import { searchLinkedInTitles } from "./linkedin.js";
import { fetchInstahyreJobs } from "./instahyre.js";
import { parseExperience, overlapsRange, formatExp } from "./experience.js";
import { roleMatcher } from "./classify.js";
import { matchesLocation } from "./location.js";
import { COMPANY_LIST } from "./companies.js";
import { isBlockedCompany } from "./blocklist.js";
import {
  scoreJob,
  RESUME_PROFILE,
  DEFAULT_PROFILE,
  buildProfile,
  profileFromClient,
  profileSummary,
} from "./scoring.js";
import { extractResumeText } from "./parseResume.js";
import { autoApply, getBrowserMode } from "./apply.js";
import { addFeedback, listFeedback } from "./feedback.js";
import {
  verifyLogin,
  createSession,
  verifySession,
  startReset,
  resetPassword,
  adminUsername,
  adminConfigured,
  getResetEmail,
} from "./admin.js";
import { sendMail } from "./email.js";
import { trackHit, listTraffic } from "./traffic.js";

const app = express();
const PORT = process.env.PORT || 5179;

app.use(cors());
// Resumes are uploaded as base64 inside a JSON body (binary multipart bodies
// get mangled by some ingress layers), so allow a larger JSON payload.
app.use(express.json({ limit: "12mb" }));

// --- tiny in-memory cache (TTL) so repeat searches are instant & polite ---
const cache = new Map();
const TTL = 5 * 60 * 1000;
const cacheGet = (k) => {
  const e = cache.get(k);
  if (e && Date.now() - e.t < (e.ttl ?? TTL)) return e.v;
  cache.delete(k);
  return null;
};
const cacheSet = (k, v, ttl = TTL) => cache.set(k, { v, t: Date.now(), ttl });

// Company results are cached for 30 min (job boards don't change minute-to-minute),
// and the last *successful* (non-empty) result is kept for 6h. If a fresh fetch
// comes back empty (e.g. a Workday rate-limit page), we serve the last good result
// instead of showing "nothing", so flaky upstreams don't make a company look broken.
const COMPANY_TTL = 30 * 60 * 1000;
const LASTGOOD_TTL = 6 * 60 * 60 * 1000;
const lastGood = new Map();

async function getCompanyJobs(name, query = "") {
  const ck = `co:${name.toLowerCase()}:${query}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  let r = null;
  try {
    r = await fetchCompanyJobs(name, { query });
  } catch {
    r = null;
  }

  if (r && r.jobs.length) {
    cacheSet(ck, r, COMPANY_TTL);
    lastGood.set(ck, { v: r, t: Date.now() });
    return r;
  }

  // empty/failed → fall back to the last good result if we have a recent one
  const lg = lastGood.get(ck);
  if (lg && Date.now() - lg.t < LASTGOOD_TTL) {
    const stale = { ...lg.v, stale: true };
    cacheSet(ck, stale, 60 * 1000);
    return stale;
  }

  const empty = r || { jobs: [], slug: null, providers: [], tried: [], careerUrl: null };
  cacheSet(ck, empty, 45 * 1000);
  return empty;
}

// When the caller is in PM mode and hasn't typed a query, bias keyword-based
// fetchers (Oracle, Cisco, Rippling, LinkedIn employers, etc.) toward product /
// program roles. In SWE mode an empty query lets those fetchers fall back to
// their own "software engineer" default; generic ATS providers ignore it and
// return everything, which the role filter then narrows.
function fetchKeyword(roleFilter, q) {
  if (q) return q;
  return roleFilter === "pm" ? "product manager" : "";
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Applied-jobs tracking is intentionally PER-BROWSER (client-side localStorage
// only). There is deliberately no server storage or API for it, so one visitor's
// applied list can never be seen or modified by another.

// --- User feedback & suggestions (no login required) ---

// POST /api/feedback { message, category?, name?, contact? } — submit feedback.
app.post("/api/feedback", (req, res) => {
  try {
    const entry = addFeedback(req.body || {});
    res.status(201).json({ ok: true, id: entry.id, createdAt: entry.createdAt });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /api/feedback — list submissions (newest first). Submitter name/contact
// are only included when a matching admin token is supplied (?token=…), so the
// public can't harvest contact details. Set FEEDBACK_ADMIN_TOKEN to enable it.
app.get("/api/feedback", (req, res) => {
  const adminToken = process.env.FEEDBACK_ADMIN_TOKEN;
  const authed = !!adminToken && req.query.token === adminToken;
  const entries = listFeedback({ includeContact: authed });
  res.json({ count: entries.length, authed, entries });
});

// POST /api/apply  { url }  — Workday auto-apply (review): opens a visible browser,
// clicks Apply -> Use My Last Application, stops at the review/Submit page.
app.post("/api/apply", async (req, res) => {
  const url = (req.body?.url || "").toString().trim();
  const provider = (req.body?.provider || "").toString();
  const autoSubmit = req.body?.autoSubmit === true;
  if (!url) return res.status(400).json({ error: "Provide a job URL." });
  try {
    // Always respond, even if the browser flow hangs: the browser stays open for
    // the user; only the HTTP request is bounded.
    const result = await Promise.race([
      autoApply(url, provider, { autoSubmit }),
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: false,
              stage: "timeout",
              message:
                "This is taking longer than expected. The browser window may still be open — check it and finish there, or try again.",
            }),
          150000
        )
      ),
    ]);
    result.mode = getBrowserMode();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, stage: "error", message: err.message });
  }
});

// GET /api/company?name=Stripe&min=3&max=10&includeUnknown=true&q=engineer&location=remote
app.get("/api/company", async (req, res) => {
  const name = (req.query.name || "").toString().trim();
  if (!name) return res.status(400).json({ error: "Provide a company name." });

  const min = Number(req.query.min ?? 3);
  const max = Number(req.query.max ?? 10);
  const includeUnknown =
    String(req.query.includeUnknown ?? "true") === "true";
  // roleFilter: "swe" (core software-engineering ICs, default) | "tech" | "all"
  const roleFilter = (req.query.roleFilter || "swe").toString().toLowerCase();
  const passesRole = roleMatcher(roleFilter);
  const q = (req.query.q || "").toString().toLowerCase().trim();
  const location = (req.query.location || "").toString().toLowerCase().trim();

  try {
    const result = await getCompanyJobs(name, fetchKeyword(roleFilter, q));

    if (!result.jobs.length) {
      const msg = result.careerUrl
        ? `Couldn't pull live postings for "${name}" automatically (its career site uses a portal we can't read yet), but you can browse it directly.`
        : `No public job board or career site found for "${name}". Tried: ${result.tried.join(", ")}. Supported: Greenhouse, Lever, Ashby, SmartRecruiters, Workday + live career-site detection.`;
      return res.json({
        company: name,
        resolved: false,
        message: msg,
        careerUrl: result.careerUrl || null,
        providers: [],
        jobs: [],
        stats: { total: 0, role: 0, matched: 0, unknown: 0 },
      });
    }

    // 1) role + blocklist + title/location filters (no YOE needed yet)
    let candidates = result.jobs.filter(
      (j) => passesRole(j) && !isBlockedCompany(j.company)
    );
    const roleCount = candidates.length;
    if (q) candidates = candidates.filter((j) => j.title.toLowerCase().includes(q));
    if (location)
      candidates = candidates.filter((j) => matchesLocation(j.location, location));

    // 2) fetch the real job descriptions (Workday/Avature/SmartRecruiters) so the
    //    years-of-experience comes from the JD instead of a title-based guess.
    await enrichDescriptions(candidates, 60);

    // 3) parse YOE from the (now real) description and apply the experience window
    let unknown = 0;
    let jobs = candidates.map((j) => {
      const exp = parseExperience(j.title, j.description);
      const ok = overlapsRange(exp, min, max);
      if (ok === null) unknown++;
      return {
        ...j,
        description: undefined,
        detailUrl: undefined,
        experience: exp ? { ...exp, label: formatExp(exp) } : null,
        match: ok,
      };
    });

    jobs = jobs.filter((j) =>
      j.match === true ? true : j.match === null ? includeUnknown : false
    );

    // matched-with-experience first, then newest
    jobs.sort((a, b) => {
      if (!!a.experience !== !!b.experience) return a.experience ? -1 : 1;
      return new Date(b.postedAt || 0) - new Date(a.postedAt || 0);
    });

    res.json({
      company: result.jobs[0]?.company || name,
      resolved: true,
      stale: result.stale || false,
      slug: result.slug,
      providers: result.providers,
      careerUrl: result.careerUrl || null,
      filters: { min, max, includeUnknown, roleFilter },
      stats: {
        total: result.jobs.length,
        role: roleCount,
        matched: jobs.filter((j) => j.match === true).length,
        unknown,
        returned: jobs.length,
      },
      jobs,
    });
  } catch (err) {
    res.status(502).json({ error: `Lookup failed: ${err.message}` });
  }
});

// GET /api/linkedin?titles=Data Engineer,ML Engineer&location=United States&pages=2
app.get("/api/linkedin", async (req, res) => {
  const titlesRaw = (req.query.titles || "").toString();
  const titles = titlesRaw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!titles.length)
    return res.status(400).json({ error: "Provide one or more job titles." });

  const location = (req.query.location || "").toString().trim();
  const pages = Math.min(Math.max(Number(req.query.pages ?? 2), 1), 4);
  const roleFilter = (req.query.roleFilter || "all").toString().toLowerCase();
  const passesRole = roleMatcher(roleFilter);

  try {
    const cacheKey = `li:${titles.join("|").toLowerCase()}:${location.toLowerCase()}:${pages}`;
    let data = cacheGet(cacheKey);
    if (!data) {
      data = await searchLinkedInTitles(titles, location, pages);
      cacheSet(cacheKey, data);
    }
    const jobs = data.jobs
      .filter((j) => !isBlockedCompany(j.company))
      .filter((j) => passesRole(j));
    res.json({
      titles,
      location: location || "Anywhere",
      count: jobs.length,
      errors: data.errors,
      jobs,
    });
  } catch (err) {
    res.status(502).json({ error: `LinkedIn search failed: ${err.message}` });
  }
});

// GET /api/companies — the seeded company → career-site directory with status.
app.get("/api/companies", (_req, res) => {
  res.json({ count: COMPANY_LIST.length, companies: COMPANY_LIST });
});

// Pull a readable job id out of an internal id / apply URL.
function displayId(job) {
  const fromUrl = (job.url || "").match(/(JR\d{4,}|R-?\d{4,}|gh_jid=\d+|\d{5,})/i);
  if (fromUrl) return fromUrl[1].replace("gh_jid=", "");
  const tail = String(job.id || "").split(/[-/]/).pop();
  return tail || job.id;
}

// Core ATS scoring shared by GET (bundled resume) and POST (uploaded resume).
async function atsScore(name, { min, max, roleFilter, location, profile }) {
  const passesRole = roleMatcher(roleFilter);
  const result = await getCompanyJobs(name, "");
  const resumeSummary = profileSummary(profile);

  if (!result.jobs.length) {
    return {
      company: name,
      resolved: false,
      resume: resumeSummary,
      careerUrl: result.careerUrl || null,
      message: result.careerUrl
        ? `Couldn't pull live postings for "${name}" right now (career site/portal unavailable). Try a Greenhouse/Ashby company (Stripe, Databricks, Figma) or Bloomberg.`
        : `No public board found for "${name}".`,
      rows: [],
    };
  }

  const candidates = result.jobs
    .filter((j) => passesRole(j))
    .filter((j) => !isBlockedCompany(j.company))
    .filter((j) => !location || matchesLocation(j.location, location));

  // fetch real descriptions so scoring (and YOE) reflects the actual JD
  await enrichDescriptions(candidates, 60);

  let rows = candidates
    .map((j) => {
      const s = scoreJob(j, profile);
      const inRange = overlapsRange(s.experience, min, max);
      return {
        id: displayId(j),
        rawId: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        url: j.url,
        provider: j.provider,
        score: s.score,
        confidence: s.confidence,
        matched: s.matched,
        missing: s.missing,
        expLabel: s.experience ? formatExp(s.experience) : "—",
        inRange,
      };
    })
    .filter((r) => r.inRange !== false);

  rows.sort((a, b) => b.score - a.score);

  return {
    company: result.jobs[0]?.company || name,
    resolved: true,
    resume: resumeSummary,
    providers: result.providers,
    careerUrl: result.careerUrl || null,
    count: rows.length,
    rows,
  };
}

// POST /api/resume/parse  { filename, mimetype, dataBase64 }
// Parses an uploaded resume (sent base64-encoded in JSON) in-memory and returns
// a scoring profile. The file is never written to disk or kept after the request.
app.post("/api/resume/parse", async (req, res) => {
  try {
    const { filename = "", mimetype = "", dataBase64 } = req.body || {};
    if (!dataBase64 || typeof dataBase64 !== "string") {
      return res.status(400).json({ error: "Attach a resume file (PDF, DOCX, or TXT)." });
    }
    const buffer = Buffer.from(dataBase64, "base64");
    if (!buffer.length) {
      return res.status(400).json({ error: "The uploaded file is empty." });
    }
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "That file is too large (max 8 MB)." });
    }
    const text = await extractResumeText(buffer, filename, mimetype);
    if (!text || text.trim().length < 30) {
      return res.status(422).json({
        error:
          "Couldn't read enough text from that file. If it's a scanned/image PDF, upload a text-based PDF or DOCX, or paste your resume as a .txt.",
      });
    }
    const profile = buildProfile(text, { name: "Your resume" });
    const summary = profileSummary(profile);
    res.json({
      ok: true,
      // include targetTitles so the client can echo the full profile back
      profile: { ...summary, targetTitles: profile.targetTitles },
      skillsCount: summary.skills.length,
      warning:
        summary.skills.length === 0
          ? "No known skills were detected — scores will rely on title and experience only."
          : undefined,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "Could not parse the resume." });
  }
});

// POST /api/ats  { name, location?, min?, max?, roleFilter?, profile }
// Scores a company's roles against an UPLOADED resume profile.
app.post("/api/ats", async (req, res) => {
  const name = (req.body?.name || "").toString().trim();
  if (!name) return res.status(400).json({ error: "Provide a company name." });
  if (!req.body?.profile) {
    return res.status(400).json({ error: "Upload your resume first." });
  }
  const profile = profileFromClient(req.body.profile);
  const min = Number(req.body.min ?? 3);
  const max = Number(req.body.max ?? 10);
  const roleFilter = (req.body.roleFilter || "swe").toString().toLowerCase();
  const location =
    req.body.location === undefined
      ? "india"
      : req.body.location.toString().toLowerCase().trim();
  try {
    res.json(await atsScore(name, { min, max, roleFilter, location, profile }));
  } catch (err) {
    res.status(502).json({ error: `ATS scoring failed: ${err.message}` });
  }
});

// GET /api/ats?name=Stripe&location=india&min=3&max=10&roleFilter=swe
// Back-compat: scores against the bundled resume profile.
app.get("/api/ats", async (req, res) => {
  const name = (req.query.name || "").toString().trim();
  if (!name) return res.status(400).json({ error: "Provide a company name." });

  const min = Number(req.query.min ?? 3);
  const max = Number(req.query.max ?? 10);
  const roleFilter = (req.query.roleFilter || "swe").toString().toLowerCase();
  const location =
    req.query.location === undefined
      ? "india"
      : req.query.location.toString().toLowerCase().trim();

  try {
    res.json(
      await atsScore(name, {
        min,
        max,
        roleFilter,
        location,
        profile: DEFAULT_PROFILE,
      })
    );
  } catch (err) {
    res.status(502).json({ error: `ATS scoring failed: ${err.message}` });
  }
});

// --- "This week" aggregate: core-SWE roles posted recently across all companies ---

const latestCache = new Map();
const LATEST_TTL = 30 * 60 * 1000; // expensive: cache for 30 min

// How many days ago was a job posted? Uses ISO postedAt or Workday's
// relative "postedText" ("Posted Today / 3 Days Ago / 30+ Days Ago"). null = unknown.
function postedDaysAgo(job) {
  if (job.postedAt) {
    const d = new Date(job.postedAt);
    if (!isNaN(d)) return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  const txt = (job.postedText || "").toLowerCase();
  if (txt) {
    if (txt.includes("today")) return 0;
    if (txt.includes("yesterday")) return 1;
    const m = txt.match(/(\d+)\s*\+?\s*day/);
    if (m) return Number(m[1]);
    if (txt.includes("hour") || txt.includes("minute")) return 0;
  }
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const res = await Promise.allSettled(batch.map(fn));
    res.forEach((r) => {
      if (r.status === "fulfilled" && r.value) out.push(r.value);
    });
  }
  return out;
}

// GET /api/latest?days=7&min=3&max=10&location=india&includeLinkedIn=true&pages=1
app.get("/api/latest", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 60);
  const min = Number(req.query.min ?? 3);
  const max = Number(req.query.max ?? 10);
  const location = (req.query.location || "india").toString().toLowerCase().trim();
  const includeLinkedIn = String(req.query.includeLinkedIn ?? "true") === "true";
  const includeFintech = String(req.query.includeFintech ?? "false") === "true";
  const pages = Math.min(Math.max(Number(req.query.pages ?? 1), 1), 3);
  const role = (req.query.role || "swe").toString().toLowerCase();
  const passesRole = roleMatcher(role);

  const cacheKey = `latest:${role}:${days}:${min}:${max}:${location}:${includeLinkedIn}:${includeFintech}:${pages}`;
  if (String(req.query.refresh) !== "true") {
    const hit = latestCache.get(cacheKey);
    if (hit && Date.now() - hit.t < LATEST_TTL) return res.json(hit.v);
  }

  const enrich = (j, source) => {
    const exp = parseExperience(j.title, j.description || "");
    return {
      ...j,
      description: undefined,
      source,
      daysAgo: postedDaysAgo(j),
      experience: exp ? { ...exp, label: formatExp(exp) } : null,
      match: overlapsRange(exp, min, max),
    };
  };
  const recentInRange = (j) =>
    j.daysAgo !== null && j.daysAgo <= days && j.match !== false;

  try {
    // 1) Company jobs across the live directory (cached per company).
    //    Fintech firms (Goldman, Morgan Stanley, JPMorgan, Fidelity) are only
    //    scanned when the caller opts in via includeFintech.
    const liveCompanies = COMPANY_LIST.filter(
      (c) => c.live && (includeFintech || c.sector !== "fintech")
    );
    const perCompany = await mapLimit(liveCompanies, 4, async (c) => {
      try {
        const r = await getCompanyJobs(c.name, fetchKeyword(role, ""));
        const jobs = r.jobs
          .filter((j) => passesRole(j))
          .filter((j) => !isBlockedCompany(j.company))
          .map((j) => ({ ...enrich(j, "company"), sector: c.sector || null }))
          .filter(recentInRange)
          .filter((j) => !location || matchesLocation(j.location, location));
        return { jobs };
      } catch {
        return { jobs: [] };
      }
    });
    const companyJobs = perCompany.flatMap((x) => x.jobs);
    // collapse near-duplicate postings (same company/title/location)
    const seenKey = new Set();
    const dedupedCompany = companyJobs.filter((j) => {
      const k = `${j.company}|${j.title}|${j.location}`.toLowerCase();
      if (seenKey.has(k)) return false;
      seenKey.add(k);
      return true;
    });

    // 2) LinkedIn jobs (past-week filter), optional.
    let linkedinJobs = [];
    let linkedinError = null;
    if (includeLinkedIn) {
      try {
        const titles = [
          "Software Engineer",
          "Software Development Engineer",
          "Member of Technical Staff",
          "Computer Scientist",
        ];
        const loc = location === "india" ? "India" : location;
        const data = await searchLinkedInTitles(titles, loc, pages, 7 * 86400);
        linkedinJobs = data.jobs
          .filter((j) => !isBlockedCompany(j.company))
          .filter((j) => passesRole(j))
          .map((j) => enrich(j, "linkedin"))
          .filter((j) => j.daysAgo === null || j.daysAgo <= days);
      } catch (e) {
        linkedinError = e.message;
      }
    }

    const byDate = (a, b) => (a.daysAgo ?? 99) - (b.daysAgo ?? 99);
    dedupedCompany.sort(byDate);
    linkedinJobs.sort(byDate);

    const payload = {
      days,
      location: location || "anywhere",
      scanned: liveCompanies.length,
      companyCount: dedupedCompany.length,
      linkedinCount: linkedinJobs.length,
      fintechCount: dedupedCompany.filter((j) => j.sector === "fintech").length,
      includeFintech,
      linkedinError,
      generatedAt: new Date().toISOString(),
      jobs: [...dedupedCompany, ...linkedinJobs],
    };
    latestCache.set(cacheKey, { v: payload, t: Date.now() });
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: `Latest jobs failed: ${err.message}` });
  }
});

// --- "Today": roles posted today, plus optional easy-apply sources ---

const todayCache = new Map();
const todayInflight = new Map(); // cacheKey -> in-flight build promise (dedupes concurrent scans)
// Roles "posted today" are stable through the day, so cache for 60 min. Paired
// with the stale-while-revalidate logic below, the page effectively never blocks
// after the first successful scan: a cached payload is served instantly while a
// fresh scan runs in the background.
const TODAY_TTL = 60 * 60 * 1000;
const TODAY_CONCURRENCY = 8; // scan more company sites in parallel for a faster cold start

// Build the full "Today" payload (the expensive multi-site scan). Kept free of
// req/res so it can run in the foreground (cold cache) or the background (SWR).
async function buildTodayPayload({ role, min, max, location, includeLinkedIn, includeInstahyre }) {
  const passesRole = roleMatcher(role);
  const enrich = (j, source, extra = {}) => {
    const exp = parseExperience(j.title, j.description || "");
    return {
      ...j,
      description: undefined,
      source,
      daysAgo: postedDaysAgo(j),
      experience: exp ? { ...exp, label: formatExp(exp) } : null,
      match: overlapsRange(exp, min, max),
      ...extra,
    };
  };
  const postedToday = (j) => j.daysAgo === 0 && j.match !== false;

  // 1) Company-site roles posted today (exclude fintech; that's a This-Week toggle).
  const liveCompanies = COMPANY_LIST.filter((c) => c.live && c.sector !== "fintech");
  const perCompany = await mapLimit(liveCompanies, TODAY_CONCURRENCY, async (c) => {
    try {
      const r = await getCompanyJobs(c.name, fetchKeyword(role, ""));
      const jobs = r.jobs
        .filter((j) => passesRole(j))
        .filter((j) => !isBlockedCompany(j.company))
        .map((j) => enrich(j, "company"))
        .filter(postedToday)
        .filter((j) => !location || matchesLocation(j.location, location));
      return jobs;
    } catch {
      return [];
    }
  });
  const seenKey = new Set();
  const companyJobs = perCompany.flat().filter((j) => {
    const k = `${j.company}|${j.title}|${j.location}`.toLowerCase();
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });

  // 2) LinkedIn Easy Apply roles from the last 24h (opt-in).
  let linkedinJobs = [];
  let linkedinError = null;
  if (includeLinkedIn) {
    try {
      const titles = [
        "Software Engineer",
        "Software Development Engineer",
        "Backend Engineer",
        "Full Stack Engineer",
      ];
      const loc = location === "india" ? "India" : location;
      const data = await searchLinkedInTitles(titles, loc, 1, 86400, { easyApply: true });
      linkedinJobs = data.jobs
        .filter((j) => !isBlockedCompany(j.company))
        .filter((j) => passesRole(j))
        .map((j) => enrich(j, "linkedin", { easyApply: true }))
        .filter((j) => j.daysAgo === null || j.daysAgo <= 1)
        .filter((j) => !location || matchesLocation(j.location, location));
    } catch (e) {
      linkedinError = e.message;
    }
  }

  // 3) Instahyre easy-apply roles (opt-in). No post date is exposed, so these are
  //    the latest active listings (id-desc), not strictly "today".
  let instahyreJobs = [];
  let instahyreError = null;
  if (includeInstahyre) {
    try {
      const raw = await fetchInstahyreJobs({ pages: 3 });
      instahyreJobs = raw
        .filter((j) => !isBlockedCompany(j.company))
        .filter((j) => passesRole(j))
        .map((j) => enrich(j, "instahyre", { easyApply: true, undated: true }))
        .filter((j) => j.match !== false)
        .filter((j) => !location || matchesLocation(j.location, location));
    } catch (e) {
      instahyreError = e.message;
    }
  }

  companyJobs.sort((a, b) => (a.daysAgo ?? 9) - (b.daysAgo ?? 9));
  return {
    location: location || "anywhere",
    scanned: liveCompanies.length,
    companyCount: companyJobs.length,
    linkedinCount: linkedinJobs.length,
    instahyreCount: instahyreJobs.length,
    includeLinkedIn,
    includeInstahyre,
    linkedinError,
    instahyreError,
    generatedAt: new Date().toISOString(),
    jobs: [...companyJobs, ...linkedinJobs, ...instahyreJobs],
  };
}

// Deduped build: parallel callers (and background refreshes) share one scan
// instead of stampeding every company site at once. Caches the result and
// throws on failure.
function getOrBuildToday(cacheKey, params) {
  if (todayInflight.has(cacheKey)) return todayInflight.get(cacheKey);
  const p = (async () => {
    try {
      const payload = await buildTodayPayload(params);
      todayCache.set(cacheKey, { v: payload, t: Date.now() });
      return payload;
    } finally {
      if (todayInflight.get(cacheKey) === p) todayInflight.delete(cacheKey);
    }
  })();
  todayInflight.set(cacheKey, p);
  return p;
}

// Proactively warm the default Today view (role=swe, India, no opt-ins) so the
// first request after a cold start is instant. This is the tab users open most.
function warmDefaultToday() {
  const params = {
    role: "swe",
    min: 3,
    max: 10,
    location: "india",
    includeLinkedIn: false,
    includeInstahyre: false,
  };
  const cacheKey = `today:${params.role}:${params.min}:${params.max}:${params.location}:${params.includeLinkedIn}:${params.includeInstahyre}`;
  return getOrBuildToday(cacheKey, params).catch(() => {});
}

// GET /api/today?min=3&max=10&location=india&includeLinkedIn=false&includeInstahyre=false
// Company-site roles posted TODAY (always), plus — only when toggled on —
// LinkedIn *Easy Apply* roles from the last 24h and Instahyre's easy-apply roles.
// Stale-while-revalidate: a cached payload is returned immediately and, once past
// TODAY_TTL, refreshed in the background so the next load is fresh.
app.get("/api/today", async (req, res) => {
  const min = Number(req.query.min ?? 3);
  const max = Number(req.query.max ?? 10);
  const location = (req.query.location || "india").toString().toLowerCase().trim();
  const includeLinkedIn = String(req.query.includeLinkedIn ?? "false") === "true";
  const includeInstahyre = String(req.query.includeInstahyre ?? "false") === "true";
  const role = (req.query.role || "swe").toString().toLowerCase();
  const params = { role, min, max, location, includeLinkedIn, includeInstahyre };

  const cacheKey = `today:${role}:${min}:${max}:${location}:${includeLinkedIn}:${includeInstahyre}`;
  const forceRefresh = String(req.query.refresh) === "true";
  const hit = todayCache.get(cacheKey);

  // Serve any cached payload instantly (unless a refresh is forced). When it's
  // past its TTL, kick a single background rebuild and return the stale copy.
  if (hit && !forceRefresh) {
    const age = Date.now() - hit.t;
    if (age >= TODAY_TTL) getOrBuildToday(cacheKey, params).catch(() => {});
    return res.json(age >= TODAY_TTL ? { ...hit.v, stale: true } : hit.v);
  }

  // Cold cache or forced refresh: build now (deduped across callers).
  try {
    const payload = await getOrBuildToday(cacheKey, params);
    res.json(payload);
  } catch (err) {
    if (hit) return res.json({ ...hit.v, stale: true }); // fall back to stale on failure
    res.status(502).json({ error: `Today's jobs failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------------------
// Visitor traffic beacon + private admin portal (/adminpage)
// ----------------------------------------------------------------------------

// POST /api/track — record one visit (geolocated by IP). Fire-and-forget.
app.post("/api/track", (req, res) => {
  try {
    trackHit(req);
  } catch {
    /* never block a page load */
  }
  res.status(204).end();
});

const ADMIN_COOKIE = "jh_admin";
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || "";
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSession(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`
  );
}
function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}
const currentAdmin = (req) => verifySession(parseCookies(req)[ADMIN_COOKIE]);
function requireAdmin(req, res, next) {
  if (!currentAdmin(req)) return res.status(401).json({ error: "Not authenticated." });
  next();
}

// Serve the admin SPA (before the client SPA fallback below). Not linked anywhere.
const adminDir = path.dirname(fileURLToPath(import.meta.url));
let adminHtml = "";
try {
  adminHtml = fs.readFileSync(path.join(adminDir, "admin-page.html"), "utf8");
} catch {
  /* page missing — routes still respond */
}
app.get(["/adminpage", "/adminpage/"], (_req, res) => res.type("html").send(adminHtml));

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!adminConfigured()) return res.status(503).json({ error: "Admin is not configured yet." });
  if (!verifyLogin(username, password))
    return res.status(401).json({ error: "Invalid username or password." });
  setSession(res, createSession(String(username).toLowerCase()));
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const s = currentAdmin(req);
  res.json({ authed: !!s, username: s ? s.username : null });
});

// Email a one-time reset link to the registered owner address.
app.post("/api/admin/forgot", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const generic = {
    ok: true,
    message: "If that account exists, a reset link has been emailed to the owner.",
  };
  if (username && username === adminUsername()) {
    try {
      const { token, expiresInMin } = startReset();
      const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
        .toString()
        .split(",")[0];
      const link = `${proto}://${req.headers.host}/adminpage?reset=${token}`;
      await sendMail({
        to: getResetEmail(),
        subject: "Job Hunter admin — password reset",
        text: `Reset your Job Hunter admin password (valid ${expiresInMin} minutes): ${link}`,
        html: `<p>A password reset was requested for the <b>Job Hunter</b> admin portal.</p>
<p><a href="${link}">Click here to set a new password</a> (valid for ${expiresInMin} minutes).</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
      });
    } catch {
      return res
        .status(503)
        .json({ error: "Couldn't send the reset email (email isn't configured on the server)." });
    }
  }
  res.json(generic);
});

app.post("/api/admin/reset", (req, res) => {
  const { token, password } = req.body || {};
  try {
    if (!resetPassword(token, password))
      return res.status(400).json({ error: "Invalid or expired reset link." });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Gated admin data
app.get("/api/admin/traffic", requireAdmin, (_req, res) => res.json(listTraffic()));
app.get("/api/admin/feedback", requireAdmin, (_req, res) => {
  const entries = listFeedback({ includeContact: true });
  res.json({ count: entries.length, entries });
});

// In production (e.g. on Azure) serve the built React client from the same
// service so the whole app runs on one port. In local dev the client is served
// by Vite on :5173 (which proxies /api here), so this is a no-op unless built.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API GET returns index.html so client routing works.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[job-hunter] API listening on http://localhost:${PORT}`);
  // Warm the most-used tab a few seconds after boot so it doesn't compete with
  // the initial page load on a cold start; the scan then runs in the background.
  const t = setTimeout(() => warmDefaultToday(), 4000);
  if (t.unref) t.unref();
});
