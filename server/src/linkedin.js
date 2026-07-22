import axios from "axios";
import * as cheerio from "cheerio";

const GUEST_URL =
  "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";

const http = axios.create({
  timeout: 12000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml",
  },
});

function parseCards(html, searchedTitle) {
  const $ = cheerio.load(html);
  const jobs = [];
  $("li").each((_, li) => {
    const card = $(li).find(".base-card").first();
    if (!card.length) return;

    const urn = card.attr("data-entity-urn") || "";
    const id = urn.split(":").pop() || "";
    const title = $(li).find(".base-search-card__title").text().trim();
    const company = $(li)
      .find(".base-search-card__subtitle")
      .text()
      .trim();
    const location = $(li)
      .find(".job-search-card__location")
      .text()
      .trim();
    const time = $(li).find("time").attr("datetime") || null;
    let url =
      $(li).find("a.base-card__full-link").attr("href") ||
      $(li).find("a.base-search-card__title-link").attr("href") ||
      "";
    url = url.split("?")[0]; // drop tracking params

    if (!id || !title) return;
    jobs.push({
      id: `li-${id}`,
      title,
      company,
      location,
      url: url || `https://www.linkedin.com/jobs/view/${id}`,
      postedAt: time,
      provider: "LinkedIn",
      searchedTitle,
    });
  });
  return jobs;
}

// Fetch postings for a single title/keyword across N guest pages.
// tprSeconds (e.g. 604800 = past week) adds LinkedIn's time filter when > 0.
// opts.easyApply adds the Easy Apply filter (f_AL=true).
export async function searchLinkedIn(title, location = "", pages = 2, tprSeconds = 0, opts = {}) {
  const all = [];
  for (let p = 0; p < pages; p++) {
    const params = new URLSearchParams({
      keywords: title,
      location: location || "",
      start: String(p * 25),
    });
    if (tprSeconds > 0) params.set("f_TPR", `r${tprSeconds}`);
    if (opts.easyApply) params.set("f_AL", "true");
    try {
      const { data } = await http.get(`${GUEST_URL}?${params.toString()}`);
      const cards = parseCards(data, title).map((j) =>
        opts.easyApply ? { ...j, easyApply: true } : j
      );
      if (!cards.length) break;
      all.push(...cards);
    } catch (err) {
      // surface only if the very first page fails
      if (p === 0) throw err;
      break;
    }
  }
  return all;
}

// Search multiple titles, dedupe by job id.
export async function searchLinkedInTitles(titles, location = "", pages = 2, tprSeconds = 0, opts = {}) {
  const results = await Promise.allSettled(
    titles.map((t) => searchLinkedIn(t, location, pages, tprSeconds, opts))
  );
  const seen = new Set();
  const merged = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const job of r.value) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        merged.push(job);
      }
    } else {
      errors.push({ title: titles[i], error: String(r.reason?.message || r.reason) });
    }
  });
  return { jobs: merged, errors };
}

// Fetch a single company's recent postings via the guest API's company filter
// (f_C={numericCompanyId}). Used for employers (e.g. large banks) whose own
// career portals aren't machine-readable. Company name is forced to the
// canonical label so downstream grouping/blocklist behave consistently.
export async function searchLinkedInCompany(
  companyId,
  { location = "", pages = 3, companyName = "", keywords = "" } = {}
) {
  const all = [];
  for (let p = 0; p < pages; p++) {
    const params = new URLSearchParams({
      f_C: String(companyId),
      location: location || "",
      start: String(p * 25),
    });
    if (keywords) params.set("keywords", keywords);
    try {
      const res = await http.get(`${GUEST_URL}?${params.toString()}`, {
        validateStatus: () => true,
      });
      if (res.status !== 200) break;
      const cards = parseCards(res.data, "").map((j) =>
        companyName ? { ...j, company: companyName } : j
      );
      if (!cards.length) break;
      all.push(...cards);
    } catch {
      break;
    }
  }
  const seen = new Set();
  return all.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
}
