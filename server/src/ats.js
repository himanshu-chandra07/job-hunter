import axios from "axios";
import * as cheerio from "cheerio";
import { COMPANY_DIRECTORY, normalizeKey, lookupFintech } from "./companies.js";
import { searchLinkedInCompany } from "./linkedin.js";

const http = axios.create({
  timeout: 9000,
  headers: { "User-Agent": "job-hunter-local/1.0", Accept: "application/json" },
});

function decodeEntities(s = "") {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Generate candidate ATS slugs from a free-text company name.
export function slugCandidates(name) {
  const base = name.trim().toLowerCase();
  const noSuffix = base.replace(
    /\b(inc|inc\.|llc|ltd|ltd\.|corp|corporation|co|company|technologies|technology|labs|software|group|holdings)\b/g,
    ""
  );
  const variants = new Set();
  for (const v of [base, noSuffix]) {
    const cleaned = v.replace(/[^a-z0-9 ]/g, "").trim();
    variants.add(cleaned.replace(/\s+/g, "")); // stripe
    variants.add(cleaned.replace(/\s+/g, "-")); // stripe-inc
  }
  return [...variants].filter(Boolean);
}

// Manual ATS slug aliases where a company's board token differs from its name
// (e.g. Arcesium's Greenhouse board is "arcesiumllc", not "arcesium").
const SLUG_ALIASES = {
  arcesium: ["arcesiumllc"],
};

// ---- Provider adapters: each returns a normalized job array or [] ----

async function greenhouse(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const { data } = await http.get(url);
  if (!data?.jobs?.length) return [];
  return data.jobs.map((j) => ({
    id: `gh-${j.id}`,
    title: j.title,
    company: data?.name || slug,
    location: j.location?.name || "",
    department: j.departments?.map((d) => d.name).join(", ") || "",
    url: j.absolute_url,
    applyUrl: `https://job-boards.greenhouse.io/${slug}/jobs/${j.id}`,
    postedAt: j.updated_at || j.first_published || null,
    description: decodeEntities(j.content || ""),
    provider: "Greenhouse",
  }));
}

async function lever(slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const { data } = await http.get(url);
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.map((j) => ({
    id: `lv-${j.id}`,
    title: j.text,
    company: slug,
    location: j.categories?.location || "",
    department: j.categories?.team || j.categories?.department || "",
    url: j.hostedUrl || j.applyUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: j.descriptionPlain || j.description || "",
    provider: "Lever",
  }));
}

async function ashby(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=false`;
  const { data } = await http.get(url);
  if (!data?.jobs?.length) return [];
  return data.jobs.map((j) => ({
    id: `as-${j.id}`,
    title: j.title,
    company: data?.name || slug,
    location: j.location || (j.isRemote ? "Remote" : ""),
    department: j.department || j.team || "",
    url: j.jobUrl || j.applyUrl,
    postedAt: j.publishedAt || null,
    description: j.descriptionPlain || decodeEntities(j.descriptionHtml || ""),
    provider: "Ashby",
  }));
}

async function smartrecruiters(slug) {
  const limit = 100; // SmartRecruiters caps page size at 100
  const maxJobs = 2000;
  const fetchPage = async (offset) => {
    const url = `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${limit}&offset=${offset}`;
    const { data } = await http.get(url, { validateStatus: () => true });
    return data && typeof data === "object" ? data : null;
  };
  const first = await fetchPage(0);
  if (!first?.content?.length) return [];
  let content = [...first.content];
  const total = Math.min(Number(first.totalFound) || content.length, maxJobs);
  // Page through the rest so location/role filtering downstream has the full set
  // (large employers like ServiceNow post hundreds of roles; the India subset is
  // scattered throughout, so fetching only the first 100 hides most of them).
  for (let offset = limit; offset < total; offset += limit) {
    const page = await fetchPage(offset);
    if (!page?.content?.length) break;
    content = content.concat(page.content);
  }
  return content.map((j) => {
    const loc = j.location
      ? [j.location.city, j.location.region, j.location.country]
          .filter(Boolean)
          .join(", ")
      : "";
    return {
      id: `sr-${j.id}`,
      title: j.name,
      company: slug,
      location: loc,
      department: j.department?.label || "",
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
      detailUrl: `https://api.smartrecruiters.com/v1/companies/${slug}/postings/${j.id}`,
      postedAt: j.releasedDate || null,
      description: "", // fetched on demand for accurate YOE
      provider: "SmartRecruiters",
    };
  });
}

const PROVIDERS = [greenhouse, lever, ashby, smartrecruiters];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Workday: reachable via a verified directory or career-site discovery ----

const whttp = axios.create({
  timeout: 12000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  },
});

// Verified big-tech Workday career sites (tenant.dc.myworkdayjobs.com / site).
const WORKDAY_DIRECTORY = {
  nvidia: { tenant: "nvidia", dc: "wd5", site: "NVIDIAExternalCareerSite" },
  adobe: { tenant: "adobe", dc: "wd5", site: "external_experienced" },
  workday: { tenant: "workday", dc: "wd5", site: "Workday" },
  autodesk: { tenant: "autodesk", dc: "wd1", site: "Ext", search: "India" },
  hp: { tenant: "hp", dc: "wd5", site: "ExternalCareerSite" },
  paypal: { tenant: "paypal", dc: "wd1", site: "jobs" },
  mastercard: { tenant: "mastercard", dc: "wd1", site: "CorporateCareers" },
  comcast: { tenant: "comcast", dc: "wd5", site: "Comcast_Careers" },
  zoom: { tenant: "zoom", dc: "wd5", site: "Zoom" },
  intel: { tenant: "intel", dc: "wd1", site: "External" },
  salesforce: { tenant: "salesforce", dc: "wd12", site: "External_Career_Site" },
  vmware: { tenant: "broadcom", dc: "wd1", site: "External_Career" },
  omnissa: { tenant: "omnissa", dc: "wd501", site: "Omnissa_External_Career_Site" },
  ebay: { tenant: "ebay", dc: "wd5", site: "apply" },
  // Expedia Group runs Workday on an unusual data center (wd108), site "search".
  // India-biased so the India subset is fully covered rather than lost in the
  // global list.
  expedia: { tenant: "expedia", dc: "wd108", site: "search", search: "India" },
};

async function workday({ tenant, dc, site, search }, label, query = "") {
  const base = `https://${tenant}.${dc}.myworkdayjobs.com`;
  const apiUrl = `${base}/wday/cxs/${tenant}/${site}/jobs`;
  const limit = 20; // Workday caps CXS page size at 20
  const maxJobs = 300;
  // Some tenants (e.g. Visa) return a huge global list; `search` lets a directory
  // entry bias the query (e.g. to "India") so the India subset is fully covered.
  const body = (offset) => ({ appliedFacets: {}, limit, offset, searchText: search || query });

  // Workday rate-limits bursts with a 200-OK "currently unavailable" HTML page.
  // Detect non-JSON, back off, and retry; give up gracefully (caller shows the
  // career-site link) rather than returning garbage.
  const post = async (offset, tries = 2) => {
    for (let i = 0; i < tries; i++) {
      const r = await whttp.post(apiUrl, body(offset), { validateStatus: () => true });
      const d = r.data;
      if (d && typeof d === "object" && Array.isArray(d.jobPostings)) return d;
      if (i < tries - 1) await sleep(700 + i * 600);
    }
    return null;
  };

  const first = await post(0, 3);
  if (!first) return []; // throttled/unavailable
  const total = first.total || 0;
  let posts = first.jobPostings || [];

  const pages = Math.min(
    Math.ceil(maxJobs / limit),
    Math.max(1, Math.ceil(total / limit))
  );
  const offsets = [];
  for (let p = 1; p < pages; p++) offsets.push(p * limit);
  const batchSize = 4;
  for (let i = 0; i < offsets.length; i += batchSize) {
    const batch = offsets.slice(i, i + batchSize);
    const res = await Promise.allSettled(batch.map((o) => post(o, 1)));
    for (const r of res) {
      if (r.status === "fulfilled" && r.value) posts = posts.concat(r.value.jobPostings || []);
    }
    if (i + batchSize < offsets.length) await sleep(250);
  }

  return posts.map((j) => {
    const path = j.externalPath || "";
    return {
      id: `wd-${tenant}-${path || j.bulletFields?.[0] || j.title}`,
      title: j.title,
      company: label || tenant,
      location: j.locationsText || "",
      department: "",
      url: `${base}/en-US/${site}${path}`,
      detailUrl: `${base}/wday/cxs/${tenant}/${site}${path}`,
      postedAt: null,
      postedText: j.postedOn || "",
      description: "",
      provider: "Workday",
    };
  });
}

// ---- Avature (e.g. Bloomberg: bloomberg.avature.net) ----

const avhttp = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

// TalentBrew/Radancy career boards (e.g. Target India) serve their job search as
// an XHR JSON endpoint; mimic a browser XHR so we get JSON, not the page shell.
const thttp = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "application/json, text/javascript, text/html, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  },
});

const AVATURE_DIRECTORY = {
  bloomberg: { sub: "bloomberg" },
};

function parseAvature(html, sub, label) {
  const $ = cheerio.load(html);
  const out = [];
  $("h3.article__header__text__title a.link").each((_, a) => {
    const $a = $(a);
    const title = $a.text().trim();
    const url = $a.attr("href") || "";
    if (!title || !url) return;
    const id = url.split("/").pop();
    const card = $a.closest(".article, article, li");
    const location = card
      .find(".list-item-location")
      .first()
      .text()
      .trim()
      .replace(/\s+/g, " ");
    out.push({
      id: `av-${sub}-${id}`,
      title,
      company: label || sub,
      location,
      department: "",
      url,
      postedAt: null,
      description: "",
      provider: "Avature",
    });
  });
  return out;
}

async function avature({ sub }, label) {
  const base = `https://${sub}.avature.net`;
  const pageUrl = (offset) => `${base}/careers/SearchJobs/?jobOffset=${offset}`;
  const maxJobs = 450;

  const first = await avhttp.get(pageUrl(0));
  let jobs = parseAvature(first.data, sub, label);
  const pageSize = jobs.length || 12;
  const m = String(first.data).match(/([\d,]+)\s*results/i);
  const total = m ? Number(m[1].replace(/,/g, "")) : jobs.length;

  const pages = Math.min(
    Math.ceil(maxJobs / pageSize),
    Math.max(1, Math.ceil(total / pageSize))
  );
  const offsets = [];
  for (let p = 1; p < pages; p++) offsets.push(p * pageSize);
  for (let i = 0; i < offsets.length; i += 10) {
    const batch = offsets.slice(i, i + 10);
    const res = await Promise.allSettled(batch.map((o) => avhttp.get(pageUrl(o))));
    for (const r of res) {
      if (r.status === "fulfilled") jobs = jobs.concat(parseAvature(r.value.data, sub, label));
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Apple (jobs.apple.com — server-rendered listing + jobDetails JSON API) ----
// Apple has no public ATS slug; its career site renders results server-side and
// loads each posting's description from /api/v1/jobDetails/{id}. We parse the
// listing for titles/ids/locations and (on demand) fetch the JD for real YOE.

const aphttp = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/json",
  },
});

// India is the app's default focus; Apple's location facet for India is "india-INDC".
const APPLE_LOCATION = "india-INDC";

function parseAppleList(html, label) {
  const $ = cheerio.load(html);
  const out = [];
  $(".job-title.job-list-item").each((_, el) => {
    const $el = $(el);
    const a = $el.find("a.link-inline").first();
    const href = a.attr("href") || "";
    const title = a.text().trim();
    const m = href.match(/\/details\/([^/]+)\//);
    if (!title || !m) return;
    const detailId = m[1];
    const dateText = $el.find(".job-posted-date").first().text().trim();
    const d = dateText ? new Date(dateText) : null;
    // Location lives in .job-title-location as either a city span or a
    // "Various Locations…" label; strip the screen-reader "Location" prefix.
    const locEl = $el.find(".job-title-location").first().clone();
    locEl.find(".a11y").remove();
    const location = locEl.text().trim().replace(/\s+/g, " ");
    out.push({
      id: `apple-${detailId}`,
      title,
      company: label || "Apple",
      location,
      department: $el.find(".team-name").first().text().trim(),
      url: `https://jobs.apple.com${href}`,
      applyUrl: `https://jobs.apple.com${href}`,
      detailApi: `https://jobs.apple.com/api/v1/jobDetails/${detailId}?locale=en-in`,
      postedAt: d && !isNaN(d) ? d.toISOString() : null,
      postedText: dateText,
      description: "",
      provider: "Apple",
    });
  });
  return out;
}

async function apple(label, query = "") {
  const maxPages = 15; // ~300 newest jobs (matches the Workday cap)
  const fetchPage = async (p) => {
    const params = new URLSearchParams({
      location: APPLE_LOCATION,
      page: String(p),
      sort: "newest",
    });
    if (query) params.set("search", query);
    try {
      const r = await aphttp.get(
        `https://jobs.apple.com/en-in/search?${params.toString()}`,
        { validateStatus: () => true }
      );
      return typeof r.data === "string" ? parseAppleList(r.data, label) : [];
    } catch {
      return [];
    }
  };

  // Page 1 first to learn whether there's more than one page, then fetch the
  // rest in small parallel batches (stop once a page comes back under-full).
  let jobs = await fetchPage(1);
  if (jobs.length === 20) {
    const batchSize = 5;
    let done = false;
    for (let start = 2; start <= maxPages && !done; start += batchSize) {
      const pages = [];
      for (let p = start; p < start + batchSize && p <= maxPages; p++) pages.push(p);
      const results = await Promise.all(pages.map(fetchPage));
      for (const rows of results) {
        jobs = jobs.concat(rows);
        if (rows.length < 20) done = true;
      }
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Google: official careers site (server-rendered) ----
// Google exposes no public ATS slug; its careers results page is server-rendered
// at https://www.google.com/about/careers/applications/jobs/results, so we parse
// the listing for ids/titles/locations. India-scoped, like Apple.

const GOOGLE_BASE = "https://www.google.com/about/careers/applications/";
const GOOGLE_RESULTS = `${GOOGLE_BASE}jobs/results/`;

function parseGoogleList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href^="jobs/results/"]').each((_, el) => {
    const href = ($(el).attr("href") || "").split("?")[0];
    const m = href.match(/^jobs\/results\/(\d+)-/);
    if (!m) return;
    const id = m[1];
    const $a = $(el);
    const card = $a.closest("li");
    const title =
      card.find("h3").first().text().trim() ||
      ($a.attr("aria-label") || "").replace(/^Learn more about\s+/i, "").trim();
    if (!title) return;
    // Locations render as spans like "placeBengaluru, Karnataka, India" (the
    // "place" is a material-icon ligature); multi-location roles repeat them in
    // both a combined span and individual ones, so split on ";" and dedupe.
    const locs = new Set();
    card.find("span").each((__, s) => {
      const raw = $(s).text().trim().replace(/^place/, "");
      raw.split(";").forEach((part) => {
        const t = part.trim();
        if (t && t.includes(",") && t.length < 60 && !t.startsWith("+")) locs.add(t);
      });
    });
    out.push({
      id: `google-${id}`,
      title,
      company: "Google",
      location: [...locs].join("; "),
      department: "",
      url: GOOGLE_BASE + href,
      applyUrl: GOOGLE_BASE + href,
      postedAt: null,
      description: "",
      provider: "Google",
    });
  });
  return out;
}

async function google(label, query = "") {
  const q = (query || "software engineer").trim();
  const maxPages = 8; // ~160 newest matches
  const fetchPage = async (p) => {
    const params = new URLSearchParams({ q, location: "India", page: String(p) });
    try {
      const r = await aphttp.get(`${GOOGLE_RESULTS}?${params.toString()}`, {
        validateStatus: () => true,
      });
      return typeof r.data === "string" ? parseGoogleList(r.data) : [];
    } catch {
      return [];
    }
  };

  let jobs = await fetchPage(1);
  if (jobs.length >= 18) {
    const batchSize = 4;
    let done = false;
    for (let start = 2; start <= maxPages && !done; start += batchSize) {
      const pages = [];
      for (let p = start; p < start + batchSize && p <= maxPages; p++) pages.push(p);
      const results = await Promise.all(pages.map(fetchPage));
      for (const rows of results) {
        if (!rows.length) done = true;
        jobs = jobs.concat(rows);
      }
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Microsoft: the careers platform is Eightfold "PCSX", which gates its job
// search API ("Not authorized for PCSX") and renders no server-side job cards,
// so we pull live Microsoft openings from LinkedIn's company-filtered search
// (the same approach used for the fintech employers). India-scoped.
const MICROSOFT_LINKEDIN_ID = 1035;

async function microsoft(label, query = "") {
  try {
    return await searchLinkedInCompany(MICROSOFT_LINKEDIN_ID, {
      location: "India",
      pages: 4,
      companyName: "Microsoft",
      keywords: (query || "").trim(),
    });
  } catch {
    return [];
  }
}

// ---- Other big employers whose own career portals are gated and render no
// server-side jobs (Meta = GraphQL, Shopify = Cloudflare). Pull their India
// openings from LinkedIn's company-filtered guest search, the same approach
// used for Microsoft and fintech. (Cisco and Rippling use their own career-site
// APIs instead, in the PRIORITY block.) ----
const LINKEDIN_EMPLOYERS = [
  { slug: "meta", id: 10667, name: "Meta", aliases: ["facebook", "metaplatforms"] },
  { slug: "shopify", id: 784652, name: "Shopify" },
];

function lookupLinkedInEmployer(slugs) {
  return (
    LINKEDIN_EMPLOYERS.find(
      (e) => slugs.includes(e.slug) || (e.aliases || []).some((a) => slugs.includes(a))
    ) || null
  );
}

async function linkedinEmployer(emp, query = "") {
  const keywords = (query || "").trim() || "software engineer";
  try {
    return await searchLinkedInCompany(emp.id, {
      location: "India",
      pages: 4,
      companyName: emp.name,
      keywords,
    });
  } catch {
    return [];
  }
}

// ---- Amazon (amazon.jobs public search JSON; includes JD + qualifications) ----
async function amazon(label, query = "") {
  const q = (query || "software engineer").trim();
  const pageSize = 100;
  const maxJobs = 300;
  const fetchPage = async (offset) => {
    const params = new URLSearchParams({
      base_query: q,
      country: "IND",
      result_limit: String(pageSize),
      offset: String(offset),
      sort: "recent",
    });
    try {
      const r = await aphttp.get(`https://www.amazon.jobs/en/search.json?${params.toString()}`, {
        headers: { Accept: "application/json" },
        validateStatus: () => true,
      });
      const jobs = r.data?.jobs || [];
      return jobs
        .filter((j) => j && j.title)
        .map((j) => ({
          id: `amazon-${j.id_icims || j.id}`,
          title: j.title,
          company: "Amazon",
          location:
            j.normalized_location ||
            j.location ||
            [j.city, j.state, j.country_code].filter(Boolean).join(", "),
          department: j.business_category || "",
          url: j.job_path ? `https://www.amazon.jobs${j.job_path}` : "",
          applyUrl: j.job_path ? `https://www.amazon.jobs${j.job_path}` : "",
          postedAt: j.posted_date || null,
          description: decodeEntities(
            [j.description, j.basic_qualifications, j.preferred_qualifications]
              .filter(Boolean)
              .join("\n\n")
          ),
          provider: "Amazon",
        }));
    } catch {
      return [];
    }
  };
  let jobs = await fetchPage(0);
  if (jobs.length >= pageSize) {
    for (let off = pageSize; off < maxJobs; off += pageSize) {
      const rows = await fetchPage(off);
      jobs = jobs.concat(rows);
      if (rows.length < pageSize) break;
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Atlassian (public careers listings endpoint; iCIMS-backed apply links) ----
async function atlassian(label, query = "") {
  try {
    const r = await aphttp.get("https://www.atlassian.com/endpoint/careers/listings", {
      headers: { Accept: "application/json" },
      validateStatus: () => true,
    });
    const list = Array.isArray(r.data) ? r.data : r.data?.listings || [];
    return list
      .filter((j) => j && j.title)
      .map((j) => {
        const locs = Array.isArray(j.locations)
          ? j.locations
          : j.location
          ? [j.location]
          : [];
        const url = j.portalJobPost?.portalUrl || j.applyUrl || "";
        return {
          id: `atlassian-${j.id}`,
          title: j.title,
          company: "Atlassian",
          location: [...new Set(locs)].join("; "),
          department: j.category || "",
          url,
          applyUrl: url,
          postedAt: j.portalJobPost?.updatedDate || null,
          description: decodeEntities(j.overview || ""),
          provider: "Atlassian",
        };
      });
  } catch {
    return [];
  }
}

// ---- Netflix (Eightfold careers API at explore.jobs.netflix.net) ----
function parseNetflixPositions(d) {
  const positions = d?.positions || [];
  return positions
    .filter((p) => p && p.name && p.id)
    .map((p) => {
      const locs = Array.isArray(p.locations) ? p.locations : [];
      const location = [p.location, ...locs]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join("; ");
      const t = p.t_create ? new Date(p.t_create * 1000) : null;
      const url = p.canonicalPositionUrl || `https://explore.jobs.netflix.net/careers/job/${p.id}`;
      return {
        id: `netflix-${p.id}`,
        title: p.name,
        company: "Netflix",
        location,
        department: p.department || "",
        url,
        applyUrl: url,
        postedAt: t && !isNaN(t) ? t.toISOString() : null,
        description: decodeEntities(p.job_description || ""),
        provider: "Netflix",
      };
    });
}

async function netflix(label, query = "") {
  const q = (query || "software engineer").trim();
  const num = 50;
  const maxJobs = 200;
  const fetchPage = async (start) => {
    const params = new URLSearchParams({
      domain: "netflix.com",
      query: q,
      start: String(start),
      num: String(num),
      sort_by: "relevance",
    });
    try {
      const r = await aphttp.get(
        `https://explore.jobs.netflix.net/api/apply/v2/jobs?${params.toString()}`,
        { headers: { Accept: "application/json" }, validateStatus: () => true }
      );
      return r.data && typeof r.data === "object" ? parseNetflixPositions(r.data) : [];
    } catch {
      return [];
    }
  };
  let jobs = await fetchPage(0);
  if (jobs.length >= num) {
    for (let s = num; s < maxJobs; s += num) {
      const rows = await fetchPage(s);
      jobs = jobs.concat(rows);
      if (rows.length < num) break;
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Qualcomm (Eightfold "PCSX" search at careers.qualcomm.com) ----
// The /api/apply/v2/jobs endpoint is gated ("Not authorized for PCSX"); the
// public search the site itself uses is /api/pcsx/search (page size capped at 10).
function parseQualcommPositions(d) {
  const positions = d?.data?.positions || d?.positions || [];
  return positions
    .filter((p) => p && p.name && p.id)
    .map((p) => {
      const locs = Array.isArray(p.locations) ? p.locations : [];
      const location = locs
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join("; ");
      const ts = p.postedTs || p.creationTs;
      const t = ts ? new Date(ts * 1000) : null;
      const url = p.positionUrl
        ? `https://careers.qualcomm.com${p.positionUrl}`
        : `https://careers.qualcomm.com/careers?pid=${p.id}`;
      return {
        id: `qualcomm-${p.id}`,
        title: p.name,
        company: "Qualcomm",
        location,
        department: p.department || "",
        url,
        applyUrl: url,
        postedAt: t && !isNaN(t) ? t.toISOString() : null,
        description: "",
        provider: "Qualcomm",
      };
    });
}

async function qualcomm(label, query = "") {
  const q = (query || "software engineer").trim();
  const num = 10; // PCSX caps the page size at 10
  const maxJobs = 200;
  const fetchPage = async (start) => {
    const params = new URLSearchParams({
      domain: "qualcomm.com",
      query: q,
      location: "India",
      start: String(start),
      num: String(num),
      sort_by: "timestamp",
    });
    try {
      const r = await aphttp.get(
        `https://careers.qualcomm.com/api/pcsx/search?${params.toString()}`,
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: "https://careers.qualcomm.com/careers",
          },
          validateStatus: () => true,
        }
      );
      return r.data && typeof r.data === "object" ? parseQualcommPositions(r.data) : [];
    } catch {
      return [];
    }
  };
  let jobs = await fetchPage(0);
  if (jobs.length >= num) {
    for (let s = num; s < maxJobs; s += num) {
      const rows = await fetchPage(s);
      if (!rows.length) break;
      jobs = jobs.concat(rows);
      if (rows.length < num) break;
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Oracle (Oracle Recruiting Cloud REST API) ----
function parseOraclePositions(items) {
  return (items || [])
    .filter((q) => q && q.Title && q.Id)
    .map((q) => {
      const secs = Array.isArray(q.secondaryLocations)
        ? q.secondaryLocations.map((l) => l.Name).filter(Boolean)
        : [];
      const location = [q.PrimaryLocation, ...secs]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join("; ");
      const t = q.PostedDate ? new Date(q.PostedDate) : null;
      const url = `https://careers.oracle.com/en/sites/jobsearch/job/${q.Id}`;
      return {
        id: `oracle-${q.Id}`,
        title: q.Title,
        company: "Oracle",
        location,
        department: q.JobFamily || q.Department || "",
        url,
        applyUrl: url,
        postedAt: t && !isNaN(t) ? t.toISOString() : null,
        description: decodeEntities(q.ShortDescriptionStr || ""),
        provider: "Oracle",
      };
    });
}

async function oracle(label, query = "") {
  const q = (query || "software engineer").trim();
  const host = "eeho.fa.us2.oraclecloud.com", site = "CX_45001";
  const limit = 100, maxJobs = 300;
  const fetchPage = async (offset) => {
    const fin = `findReqs;siteNumber=${site},keyword=${q},location=India,sortBy=POSTING_DATES_DESC`;
    const u = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&limit=${limit}&offset=${offset}&finder=${encodeURIComponent(fin)}`;
    try {
      const r = await aphttp.get(u, { headers: { Accept: "application/json", Referer: "https://careers.oracle.com/" }, validateStatus: () => true });
      let d = r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch { return []; } }
      return parseOraclePositions(d?.items?.[0]?.requisitionList);
    } catch { return []; }
  };
  let jobs = await fetchPage(0);
  if (jobs.length >= limit) {
    for (let o = limit; o < maxJobs; o += limit) {
      const rows = await fetchPage(o);
      if (!rows.length) break;
      jobs = jobs.concat(rows);
      if (rows.length < limit) break;
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Uber (own careers API) ----
function parseUberPositions(results) {
  return (results || [])
    .filter((j) => j && j.title && j.id)
    .map((j) => {
      const locs = (j.allLocations || []).map((l) =>
        [l.city, l.region, l.countryName].filter(Boolean).join(", ")
      );
      const t = j.creationDate ? new Date(j.creationDate) : null;
      const url = `https://www.uber.com/careers/list/${j.id}/`;
      return {
        id: `uber-${j.id}`,
        title: j.title,
        company: "Uber",
        location: locs.filter((v, i, a) => a.indexOf(v) === i).join("; "),
        department: j.department || "",
        url,
        applyUrl: url,
        postedAt: t && !isNaN(t) ? t.toISOString() : null,
        description: decodeEntities(j.description || ""),
        provider: "Uber",
      };
    });
}

async function uber(label, query = "") {
  const q = (query || "software engineer").trim();
  const all = [];
  for (let page = 0; page < 4; page++) {
    try {
      const r = await aphttp.post(
        "https://www.uber.com/api/loadSearchJobsResults?localeCode=en",
        { params: { query: q, page }, limit: 50 },
        { headers: { "Content-Type": "application/json", "x-csrf-token": "x", Accept: "application/json" }, validateStatus: () => true }
      );
      const rows = parseUberPositions(r.data?.data?.results);
      if (!rows.length) break;
      all.push(...rows);
      if (rows.length < 50) break;
    } catch { break; }
  }
  const seen = new Set();
  return all.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Cisco (Phenom careers site: the refineSearch widget API, India-scoped) ----
function parseCiscoJobs(jobs) {
  return (jobs || [])
    .filter((j) => j && j.title && j.jobSeqNo)
    .map((j) => {
      const location =
        j.cityStateCountry ||
        j.cityState ||
        [j.city, j.state, j.country].filter(Boolean).join(", ");
      const t = j.postedDate || j.dateCreated;
      const d = t ? new Date(t) : null;
      const url = `https://careers.cisco.com/global/en/job/${j.jobSeqNo}`;
      return {
        id: `cisco-${j.jobId || j.jobSeqNo}`,
        title: j.title,
        company: "Cisco",
        location,
        department: j.department || j.category || "",
        url,
        applyUrl: j.applyUrl || url,
        postedAt: d && !isNaN(d) ? d.toISOString() : null,
        description: decodeEntities(j.descriptionTeaser || ""),
        provider: "Cisco",
      };
    });
}

// Phenom requires a CSRF token + session cookie from the page before its
// widget API will answer; fetch them once per search.
async function ciscoSession() {
  const r = await aphttp.get("https://careers.cisco.com/global/en/search-results", {
    headers: { Accept: "text/html" },
    validateStatus: () => true,
  });
  const cookie = (r.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  const m = String(r.data || "").match(/csrf[^"]*"\s*:\s*"([a-f0-9]{12,})"|"([a-f0-9]{16,})"/);
  return { cookie, csrf: m ? m[1] || m[2] : null };
}

async function cisco(label, query = "") {
  const q = (query || "software engineer").trim();
  const size = 10, maxJobs = 100;
  let sess;
  try { sess = await ciscoSession(); } catch { return []; }
  if (!sess.cookie) return [];
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Referer: "https://careers.cisco.com/global/en/search-results",
    Cookie: sess.cookie,
  };
  if (sess.csrf) headers["x-csrf-token"] = sess.csrf;
  const fetchPage = async (from) => {
    const body = {
      ddoKey: "refineSearch", keywords: q, from, size, location: "India", global: true,
      all_fields: ["category", "country", "state", "city", "type", "RemoteType"],
      refNum: "CISCISGLOBAL", pageName: "search-results", siteType: "external",
      lang: "en_global", deviceType: "desktop", jobs: true, counts: true,
    };
    try {
      const r = await aphttp.post("https://careers.cisco.com/widgets", body, {
        headers, validateStatus: () => true,
      });
      return parseCiscoJobs(r.data?.refineSearch?.data?.jobs || r.data?.data?.jobs);
    } catch { return []; }
  };
  let jobs = await fetchPage(0);
  if (jobs.length >= size) {
    for (let f = size; f < maxJobs; f += size) {
      const rows = await fetchPage(f);
      if (!rows.length) break;
      jobs = jobs.concat(rows);
      if (rows.length < size) break;
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Rippling (careers site is powered by an Algolia index) ----
// The app id + search-only API key below are the public ones the site ships to
// the browser (not secrets).
function parseRipplingHits(hits) {
  return (hits || [])
    .filter((h) => h && h.name && h.jobId)
    .map((h) => {
      const url = h.url || `https://ats.rippling.com/rippling/jobs/${h.jobId}`;
      return {
        id: `rippling-${h.jobId}`,
        title: String(h.name).trim(),
        company: "Rippling",
        location: (h.locationNames || []).filter(Boolean).join("; "),
        department: h.departmentName || h.department?.name || "",
        url,
        applyUrl: url,
        postedAt: null,
        description: "",
        provider: "Rippling",
      };
    });
}

async function rippling(label, query = "") {
  const q = (query || "software engineer").trim();
  const ALGOLIA =
    "https://6fnax3tbef-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=416caa4690f002ff6fe4a2097623640b&x-algolia-application-id=6FNAX3TBEF";
  const all = [];
  for (let page = 0; page < 3; page++) {
    try {
      const r = await aphttp.post(
        ALGOLIA,
        { requests: [{ indexName: "careers_en-US_production", query: q, hitsPerPage: 100, page }] },
        { headers: { "Content-Type": "text/plain" }, validateStatus: () => true }
      );
      const res = r.data?.results?.[0];
      const rows = parseRipplingHits(res?.hits);
      all.push(...rows);
      if (!rows.length || page + 1 >= (res?.nbPages || 1)) break;
    } catch { break; }
  }
  const seen = new Set();
  return all.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}

// ---- Career-site discovery: fetch the company's own site, detect its ATS ----
const dhttp = axios.create({
  timeout: 7000,
  maxRedirects: 5,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml",
  },
});

function careerUrlCandidates(company) {
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!slug) return [];
  return [
    `https://www.${slug}.com/careers`,
    `https://${slug}.com/careers`,
    `https://careers.${slug}.com`,
    `https://www.${slug}.com/jobs`,
    `https://jobs.${slug}.com`,
    `https://www.${slug}.io/careers`,
  ];
}

// Detect an embedded ATS slug (or Workday coords) from career-page HTML/URL.
export function detectAts(html = "", finalUrl = "") {
  const hay = `${finalUrl} ${html}`;
  let m;
  if (
    (m = hay.match(
      /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_]+)/i
    ))
  )
    return { provider: "greenhouse", label: "Greenhouse", slug: m[1] };
  if ((m = hay.match(/jobs\.lever\.co\/([a-z0-9-]+)/i)))
    return { provider: "lever", label: "Lever", slug: m[1] };
  if (
    (m = hay.match(
      /(?:jobs|api)\.ashbyhq\.com\/(?:posting-api\/job-board\/)?([a-z0-9-]+)/i
    ))
  )
    return { provider: "ashby", label: "Ashby", slug: m[1] };
  if (
    (m = hay.match(
      /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:wday\/cxs\/[^/]+\/)?(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i
    ))
  )
    return {
      provider: "workday",
      label: "Workday",
      coords: { tenant: m[1], dc: m[2], site: m[3] },
    };
  if ((m = hay.match(/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9-]+)/i)))
    return { provider: "smartrecruiters", label: "SmartRecruiters", slug: m[1] };
  return null;
}

export async function discoverCareerSite(company, knownUrl) {
  const urls = careerUrlCandidates(company);
  if (knownUrl) urls.unshift(knownUrl);
  const results = await Promise.allSettled(urls.map((u) => dhttp.get(u)));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") continue;
    const finalUrl = r.value.request?.res?.responseUrl || urls[i];
    const det = detectAts(String(r.value.data || ""), finalUrl);
    if (det) return { ...det, careerUrl: finalUrl };
  }
  return null;
}

async function fetchByDetection(det, company, query = "") {
  switch (det.provider) {
    case "greenhouse":
      return greenhouse(det.slug);
    case "lever":
      return lever(det.slug);
    case "ashby":
      return ashby(det.slug);
    case "smartrecruiters":
      return smartrecruiters(det.slug);
    case "workday":
      return workday(det.coords, company, query);
    default:
      return [];
  }
}

// ---- On-demand job-description fetching (for accurate years-of-experience) ----
// Greenhouse/Lever/Ashby already include descriptions; Workday/Avature/
// SmartRecruiters only return titles in their list APIs, so we fetch each
// posting's detail page to read the real experience requirement.

const descCache = new Map(); // job.id -> { v, t }
const DESC_TTL = 6 * 60 * 60 * 1000;
const DESCRIPTIONLESS = new Set(["Workday", "Avature", "SmartRecruiters", "Apple", "Target"]);

async function fetchDescription(job) {
  if (job.description) return job.description;
  const c = descCache.get(job.id);
  if (c && Date.now() - c.t < DESC_TTL) return c.v;

  let desc = "";
  try {
    if (job.provider === "Workday" && job.detailUrl) {
      const { data } = await whttp.get(job.detailUrl, { validateStatus: () => true });
      if (data && typeof data === "object") desc = data.jobPostingInfo?.jobDescription || "";
    } else if (job.provider === "Apple" && job.detailApi) {
      const { data } = await aphttp.get(job.detailApi, {
        headers: { Accept: "application/json" },
        validateStatus: () => true,
      });
      const d = (data && data.res) || {};
      desc = [
        d.jobSummary,
        d.description,
        d.minimumQualifications,
        d.preferredQualifications,
        d.responsibilities,
      ]
        .filter(Boolean)
        .join(" \n ");
    } else if (job.provider === "Avature" && job.url) {
      const { data } = await avhttp.get(job.url, { validateStatus: () => true });
      const $ = cheerio.load(String(data || ""));
      desc = ($("main").text() || $(".article").text() || "").trim();
    } else if (job.provider === "SmartRecruiters" && job.detailUrl) {
      const { data } = await http.get(job.detailUrl, { validateStatus: () => true });
      const sections = data?.jobAd?.sections || {};
      desc = Object.values(sections)
        .map((s) => (s && s.text) || "")
        .join(" ");
    } else if (job.provider === "Target" && job.detailUrl) {
      // Target India job pages embed a JSON-LD JobPosting with the full
      // description and datePosted; parse it for accurate YOE + posted date.
      const { data } = await thttp.get(job.detailUrl, { validateStatus: () => true });
      const $ = cheerio.load(String(data || ""));
      let jp = null;
      $('script[type="application/ld+json"]').each((_, s) => {
        if (jp) return;
        try {
          const parsed = JSON.parse($(s).contents().text() || "null");
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          jp = arr.find((x) => x && x["@type"] === "JobPosting") || null;
        } catch {
          /* ignore malformed blocks */
        }
      });
      if (jp) {
        desc = jp.description || "";
        if (!job.postedAt && jp.datePosted) {
          const p = String(jp.datePosted).split("-").map(Number);
          if (p.length === 3 && p.every((n) => !isNaN(n))) {
            const dt = new Date(p[0], p[1] - 1, p[2]);
            if (!isNaN(dt)) job.postedAt = dt.toISOString();
          }
        }
      }
      if (!desc) desc = ($("main").text() || "").trim();
    }
  } catch {
    /* ignore */
  }

  desc = decodeEntities(String(desc))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  descCache.set(job.id, { v: desc, t: Date.now() });
  return desc;
}

// Fetch + attach real descriptions for the given jobs (gentle, capped, cached).
// Mutates job.description in place so the company cache keeps the enriched text.
export async function enrichDescriptions(jobs, cap = 60) {
  const need = jobs
    .filter((j) => !j.description && DESCRIPTIONLESS.has(j.provider))
    .slice(0, cap);
  const batchSize = 4;
  for (let i = 0; i < need.length; i += batchSize) {
    const batch = need.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (j) => {
        j.description = await fetchDescription(j);
      })
    );
    if (i + batchSize < need.length) await sleep(150);
  }
  return jobs;
}

// Try each slug candidate against all providers in parallel; fall back to the
// Workday directory and then to live career-site discovery.
// ---- D. E. Shaw (India): custom Next.js careers site. Jobs are embedded in
// __NEXT_DATA__.props.pageProps.regularJobs; all roles are India-based
// (Hyderabad / Bengaluru / Gurugram). Parsed directly since there's no ATS. ----
async function deshaw() {
  const url = "https://www.deshawindia.com/careers/work-with-us";
  const { data: html } = await dhttp.get(url, { timeout: 15000 });
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").first().html();
  if (!raw) return [];
  let regular;
  try {
    regular = JSON.parse(raw)?.props?.pageProps?.regularJobs;
  } catch {
    return [];
  }
  if (!Array.isArray(regular)) return [];
  return regular
    .map((j) => {
      const d = j.data || {};
      const title = j.displayName || d.displayName || "";
      if (!title) return null;
      const locations = (d.jobMetadata?.jobLocations || [])
        .map((l) => l && l.name)
        .filter(Boolean);
      const slug = (d.jobUrl || "").toLowerCase();
      const jobUrl = slug
        ? `https://www.deshawindia.com/careers/${slug}`
        : "https://www.deshawindia.com/careers/work-with-us";
      return {
        id: `desh-${d.id || j.id}`,
        title,
        company: "DE Shaw",
        location: locations.join(", ") || "India",
        department: j.category || "",
        url: jobUrl,
        applyUrl: jobUrl,
        postedAt: null,
        description: "",
        provider: "DE Shaw",
      };
    })
    .filter(Boolean);
}

// ---- Tesco (careers.tesco.com): Avature portal on a custom domain, heavy on UK
// retail roles. We bias the semantic search toward software roles to surface the
// Tesco Bengaluru technology jobs. The result cards expose a closing date but no
// posted date, so postedAt is left null (like other custom-portal sources). ----
function parseTesco(html) {
  const $ = cheerio.load(html);
  const out = [];
  $("h3.article__header__text__title a.link").each((_, a) => {
    const $a = $(a);
    const title = $a.text().trim();
    const href = $a.attr("href") || "";
    if (!title || !/JobDetail/i.test(href)) return;
    const url = href.startsWith("http") ? href : `https://careers.tesco.com${href}`;
    const card = $a.closest("article, .article");
    const location = card.find(".list-item-location").first().text().trim().replace(/\s+/g, " ");
    const entity = card.find(".list-item-legalEntity").first().text().trim();
    const id = url.split("/").pop();
    out.push({
      id: `tesco-${id}`,
      title,
      company: "Tesco",
      location: location || (/india/i.test(entity) ? "India" : ""),
      department: entity || "",
      url,
      applyUrl: `https://careers.tesco.com/en_GB/careers/RedirectApply?jobId=${id}`,
      postedAt: null,
      description: "",
      provider: "Tesco",
    });
  });
  return out;
}

async function tesco(company, query = "") {
  const kw = (query && query.trim()) || "software engineer";
  const enc = encodeURIComponent(kw);
  const searchUrl = (o) =>
    `https://careers.tesco.com/en_GB/careers/SearchJobs/?semanticSearch=${enc}&jobOffset=${o}`;
  const pages = await Promise.allSettled(
    [0, 10, 20, 30, 40, 50, 60, 70].map((o) => avhttp.get(searchUrl(o)))
  );
  const out = [];
  const seen = new Set();
  for (const p of pages) {
    if (p.status !== "fulfilled") continue;
    for (const r of parseTesco(p.value.data)) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

// ---- Target — "Target in India" (TII) careers board (indiajobs.target.com).
// A TalentBrew/Radancy site (org 1118) whose roles are all India-based
// (Bengaluru). Its /search-jobs/results endpoint returns the rendered job cards
// as JSON (`results`); each card's detail page carries a JSON-LD JobPosting
// (full description + datePosted) that fetchDescription() reads on demand, so
// YOE and ATS scoring use the real job text (as with Workday/Avature). ----
function parseTargetCards(html) {
  const $ = cheerio.load(html || "");
  const out = [];
  $("#search-results-list li a[data-job-id]").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const title = $a.find("h2").first().text().trim();
    if (!title || !href) return;
    const facets = {};
    $a.find("span.sr-facet").each((__, s) => {
      const label = $(s).find("b").text().replace(/:/g, "").trim().toLowerCase();
      const val = $(s).clone().children("b").remove().end().text().trim();
      if (label) facets[label] = val;
    });
    // href: /job/<city>/<slug>/<n>/<jobId>
    const parts = href.split("/").filter(Boolean);
    const citySlug = parts[1] || "";
    const city = citySlug
      ? citySlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "";
    const url = href.startsWith("http") ? href : `https://indiajobs.target.com${href}`;
    out.push({
      id: `tgt-${$a.attr("data-job-id") || facets["job id"] || parts[parts.length - 1]}`,
      title,
      company: "Target",
      location: city ? `${city}, India` : "India",
      department: facets["job family"] || "",
      url,
      applyUrl: url,
      detailUrl: url,
      postedAt: null,
      description: "",
      provider: "Target",
    });
  });
  return out;
}

async function target(company, query = "") {
  const base = "https://indiajobs.target.com";
  const rpp = 100; // small board (~86 roles) — one page usually covers it
  const kw = (query && query.trim()) || "";
  const url = (page) =>
    `${base}/search-jobs/results?ActiveFacetID=0&CurrentPage=${page}&RecordsPerPage=${rpp}` +
    `&Distance=50&RadiusUnitType=0&Keywords=${encodeURIComponent(kw)}&Location=&ShowRadius=False` +
    `&IsPagination=True&CustomFacetName=&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results` +
    `&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5`;

  const get = async (page) => {
    const r = await thttp.get(url(page), { validateStatus: () => true });
    let d = r.data;
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch {
        /* non-JSON (e.g. a throttle page) — fall through */
      }
    }
    return d && typeof d === "object" ? String(d.results || "") : String(d || "");
  };

  const firstHtml = await get(1);
  const out = parseTargetCards(firstHtml);
  const totalPages =
    Number(cheerio.load(firstHtml)("#search-results").attr("data-total-pages")) || 1;
  const maxPages = Math.min(totalPages, 3);
  if (maxPages > 1) {
    const rest = await Promise.allSettled(
      Array.from({ length: maxPages - 1 }, (_, i) => get(i + 2))
    );
    for (const r of rest) {
      if (r.status === "fulfilled") out.push(...parseTargetCards(r.value));
    }
  }
  const seen = new Set();
  return out.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}

export async function fetchCompanyJobs(company, opts = {}) {
  const { searchCareerSite = true, query = "" } = opts;
  const slugs = slugCandidates(company);
  const aliasSlugs = slugs.flatMap((s) => SLUG_ALIASES[s] || []);
  if (aliasSlugs.length) slugs.push(...aliasSlugs);
  const tried = [];
  let jobs = [];
  const providers = [];
  let matchedSlug = null;

  // Known official career site (from the seeded company directory).
  const known =
    COMPANY_DIRECTORY[normalizeKey(company)] ||
    slugs.map((s) => COMPANY_DIRECTORY[s]).find(Boolean) ||
    null;
  let careerUrl = known?.careerUrl || null;

  // 0) Fintech employers (Goldman, Morgan Stanley, JPMorgan, Fidelity) have no
  // readable ATS, so pull their openings from LinkedIn's company-filtered search
  // and return early (skip the slow ATS/Workday/discovery probing below).
  const fin = lookupFintech(company);
  if (fin) {
    let finJobs = [];
    try {
      finJobs = await searchLinkedInCompany(fin.companyId, {
        location: "India",
        pages: 3,
        companyName: fin.name,
      });
    } catch {
      /* ignore */
    }
    return {
      jobs: finJobs,
      slug: normalizeKey(fin.name),
      providers: finJobs.length ? ["LinkedIn"] : [],
      tried: [normalizeKey(fin.name)],
      careerUrl: fin.careerUrl,
    };
  }

  // 0b) Big employers with their own authoritative job API that would otherwise
  // be mis-claimed by a weaker generic match (e.g. Uber surfaces 1 role on
  // SmartRecruiters but 90+ on its own site). Run these before slug probing.
  const PRIORITY = [
    ["oracle", oracle, "Oracle"],
    ["uber", uber, "Uber"],
    ["cisco", cisco, "Cisco"],
    ["rippling", rippling, "Rippling"],
    ["deshaw", deshaw, "DE Shaw"],
    ["tesco", tesco, "Tesco"],
    ["target", target, "Target"],
    // Netskope's real board is Greenhouse (140+ roles); pin to it so the abandoned
    // SmartRecruiters "netskope" board (junk test posts) can't mis-claim it.
    ["netskope", () => greenhouse("netskope"), "Greenhouse"],
    // Visa runs on Workday (visa.wd5). Bias the search to India for full coverage,
    // and prioritize it so the near-empty SmartRecruiters "visa" board (2 roles)
    // doesn't mis-claim it first.
    [
      "visa",
      (c, q) => workday({ tenant: "visa", dc: "wd5", site: "Visa", search: "India" }, "Visa", q),
      "Workday",
    ],
  ];
  for (const [slug, fn, name] of PRIORITY) {
    if (slugs.includes(slug)) {
      try {
        const rows = await fn(company, query);
        if (rows.length) {
          return {
            jobs: rows,
            slug,
            providers: [name],
            tried: [slug],
            careerUrl: known?.careerUrl || careerUrl,
          };
        }
      } catch {
        /* fall through to normal probing */
      }
    }
  }

  // 1) direct slug-based ATS providers
  for (const slug of slugs) {
    const results = await Promise.allSettled(PROVIDERS.map((p) => p(slug)));
    const found = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.length) {
        found.push(...r.value);
        if (!providers.includes(PROVIDERS[i].name)) providers.push(PROVIDERS[i].name);
      }
    });
    tried.push(slug);
    if (found.length) {
      jobs = found;
      matchedSlug = slug;
      break;
    }
  }

  // 2) Workday directory (covers many large employers' career sites)
  if (!jobs.length) {
    for (const slug of slugs) {
      const coords = WORKDAY_DIRECTORY[slug];
      if (!coords) continue;
      try {
        const wd = await workday(coords, company, query);
        if (wd.length) {
          jobs = wd;
          matchedSlug = slug;
          providers.push("Workday");
        }
      } catch {
        /* ignore */
      }
      break;
    }
  }

  // 2b) Avature directory (e.g. Bloomberg)
  if (!jobs.length) {
    for (const slug of slugs) {
      const av = AVATURE_DIRECTORY[slug];
      if (!av) continue;
      try {
        const a = await avature(av, company);
        if (a.length) {
          jobs = a;
          matchedSlug = slug;
          providers.push("Avature");
        }
      } catch {
        /* ignore */
      }
      break;
    }
  }

  // 2c) Apple (custom server-rendered career site + jobDetails API)
  if (!jobs.length && slugs.includes("apple")) {
    try {
      const ap = await apple(company, query);
      if (ap.length) {
        jobs = ap;
        matchedSlug = "apple";
        providers.push("Apple");
      }
    } catch {
      /* ignore */
    }
  }

  // 2d) Google (custom server-rendered careers site)
  if (!jobs.length && slugs.includes("google")) {
    try {
      const g = await google(company, query);
      if (g.length) {
        jobs = g;
        matchedSlug = "google";
        providers.push("Google");
      }
    } catch {
      /* ignore */
    }
  }

  // 2e) Microsoft (custom careers search API)
  if (!jobs.length && slugs.includes("microsoft")) {
    try {
      const ms = await microsoft(company, query);
      if (ms.length) {
        jobs = ms;
        matchedSlug = "microsoft";
        providers.push("Microsoft");
      }
    } catch {
      /* ignore */
    }
  }

  // 2f) Other big employers with their own public job APIs
  const BIG = [
    ["amazon", amazon, "Amazon"],
    ["atlassian", atlassian, "Atlassian"],
    ["netflix", netflix, "Netflix"],
    ["qualcomm", qualcomm, "Qualcomm"],
  ];
  for (const [slug, fn, name] of BIG) {
    if (!jobs.length && slugs.includes(slug)) {
      try {
        const rows = await fn(company, query);
        if (rows.length) {
          jobs = rows;
          matchedSlug = slug;
          providers.push(name);
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 2g) Gated big employers served via LinkedIn company search (Cisco, Meta,
  // Rippling, Shopify). These never match a generic ATS, so this is their source.
  if (!jobs.length) {
    const emp = lookupLinkedInEmployer(slugs);
    if (emp) {
      try {
        const rows = await linkedinEmployer(emp, query);
        if (rows.length) {
          jobs = rows;
          matchedSlug = emp.slug;
          providers.push("LinkedIn");
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 3) live career-site discovery (when name-based lookups found nothing)
  if (!jobs.length && searchCareerSite) {
    try {
      const det = await discoverCareerSite(company, known?.careerUrl);
      if (det) {
        careerUrl = det.careerUrl || careerUrl;
        const more = await fetchByDetection(det, company, query);
        if (more.length) {
          jobs = more;
          providers.push(`${det.label} (career site)`);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // dedupe by id
  const seen = new Set();
  const deduped = [];
  for (const j of jobs) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    deduped.push(j);
  }

  return { jobs: deduped, slug: matchedSlug, providers, tried, careerUrl };
}
