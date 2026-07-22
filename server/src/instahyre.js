// Instahyre (instahyre.com) — Indian tech job platform with one-click ("easy")
// apply. Its public job_search API exposes title/company/location/skills/apply-URL
// but NO post date and no working recency sort, so we approximate "newest" by
// sorting on the sequential job id (descending). Every Instahyre apply is easy-apply.

import axios from "axios";

const http = axios.create({
  timeout: 12000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Accept: "application/json",
    Referer: "https://www.instahyre.com/search-jobs/",
  },
});

// Instahyre job-function ids for software / engineering roles. The API allows a
// maximum of 3 job functions per request, so these are queried in batches.
const SWE_FUNCTION_GROUPS = [
  [10, 1, 3], // Backend, Full-Stack, Frontend
  [8, 9, 60], // DevOps/Cloud, Data Science/ML, Mobile
  [44, 17, 76], // Embedded, Big Data/ETL, Other Software Dev
];
const PAGE = 35; // Instahyre returns 35 per page regardless of limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(o) {
  return {
    id: `ih-${o.id}`,
    title: o.title || "",
    company: o.employer?.company_name || "",
    location: (o.locations || "").replace(/,(?=\S)/g, ", "),
    url: o.public_url,
    applyUrl: o.public_url,
    postedAt: null,
    postedText: "",
    description: Array.isArray(o.keywords) ? o.keywords.join(", ") : "",
    provider: "Instahyre",
    easyApply: true,
    _ihId: o.id,
  };
}

async function fetchGroup(fnIds, pages) {
  const fnParams = fnIds.map((id) => `job_functions=${id}`).join("&");
  const out = [];
  for (let p = 0; p < pages; p++) {
    const url = `https://www.instahyre.com/api/v1/job_search?${fnParams}&offset=${p * PAGE}`;
    try {
      const { data, status } = await http.get(url, { validateStatus: () => true });
      if (status !== 200 || !data?.objects?.length) break;
      out.push(...data.objects.map(normalize));
      if (data.objects.length < PAGE) break;
    } catch {
      break;
    }
    await sleep(150);
  }
  return out;
}

export async function fetchInstahyreJobs({ pages = 2 } = {}) {
  const groups = await Promise.all(
    SWE_FUNCTION_GROUPS.map((g) => fetchGroup(g, pages))
  );
  const seen = new Set();
  const dedup = groups.flat().filter((j) => (seen.has(j.id) ? false : seen.add(j.id)));
  dedup.sort((a, b) => b._ihId - a._ihId); // newest-ish first
  return dedup.map(({ _ihId, ...j }) => j);
}
