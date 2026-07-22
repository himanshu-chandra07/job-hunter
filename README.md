# Job Hunter — Local Dashboard

A fast, local job-hunting dashboard. **React (Vite)** front end + **Node/Express** back end.
No API keys, no database, no signup — everything runs on your machine.

## Tabs

### 1. By Company
Pick a company from the **searchable dropdown** (all 55 seeded employers) or type any
name (e.g. `Stripe`, `Nvidia`, `Razorpay`). It pulls that company's **live open roles**,
applies a **role filter** (default **Software Engineer (core)**), and narrows to your
**experience window** (default **3–10 years**). Each card's **Apply ↗** opens the real
posting on the company's own portal.

- **Where it looks** (auto-detected from the name):
  1. Public ATS boards: **Greenhouse, Lever, Ashby, SmartRecruiters**
  2. **Workday** career sites (verified directory — Nvidia, Adobe, Salesforce, Intel,
     VMware, Omnissa, PayPal, Mastercard, HP, Autodesk, Comcast, Zoom…)
  3. **Avature** boards (e.g. **Bloomberg** → `bloomberg.avature.net`)
  4. **Custom big-company sources**: **Apple** and **Google** (their own
     server-rendered careers sites, with real job IDs + apply links), **Amazon**
     (amazon.jobs API, with full job descriptions), **Atlassian** (public careers
     listings), **Netflix** (Eightfold API), and **Microsoft** (its careers
     platform gates its API, so live openings come from LinkedIn's company search).
     **Target** resolves to **Target in India**'s own board
     (`indiajobs.target.com`, TalentBrew/Radancy) — all roles are Bengaluru-based,
     with full descriptions + posted dates read from each posting's JSON-LD.
  5. **Live career-site discovery** — if the name isn't on a known board, it fetches the
     company's own `careers` / `jobs` page, detects the embedded ATS, and pulls from it
     (this is how e.g. **Razorpay** and **Mistral AI** resolve).
- **Role filter** (dropdown):
  - **Software Engineer (core)** *(default)* — only IC software-engineering roles:
    Software Engineer (all levels), Member of Technical Staff / SMTS, Computer Scientist,
    backend/frontend/full-stack/mobile/ML/SRE engineers. **Excludes** SDET / "in test",
    managers/directors, and hardware/silicon roles (RTL, physical design, analog…).
  - **All tech roles** — broader (data/IT/security/etc.).
  - **Everything** — no role filter.
- **Default location is India** (Bengaluru/Noida/Hyderabad/etc. all match "India"), with
  **"Bangalore only" / "Pune only" / "Hyderabad only"** checkboxes on every job tab. Tick one
  or more to narrow to those cities (they're OR'd; Bangalore also matches *Bengaluru*,
  Hyderabad matches *Secunderabad*, Pune matches *Hinjewadi*). Change or clear the location
  box for anywhere.
- Experience is read from the **actual job description**: for Greenhouse/Ashby/Lever the
  description is already included; for **Workday/Avature/SmartRecruiters** the JD is
  fetched on demand (cached 6h) so the years-of-experience is parsed from the real text
  (`5+ years`, `3–5 years`, `at least 4 years`) rather than guessed. If the JD states no
  number, the card shows **"YOE not specified"**; only when nothing is stated is a
  title-based estimate shown, clearly labelled **"(est. from title)"**. First search per
  company takes a few seconds while descriptions are fetched, then it's cached.
- Roles with no stated experience are shown by default and can be toggled off.
- Extra filters: title keyword (also drives Workday's own search), location.

### 2. Companies
A company-wise grid of all 55 seeded employers with a **filter box** and an
**All / Live jobs / Link-only** toggle. Each card shows the resolved ATS and approximate
open-role count. Click a **live** card (or **View jobs →**) to load it in the By Company
tab; every card also has a direct **Career site ↗** link. Most return live jobs;
**Google** (its careers site), **Apple**, and **Microsoft** (via LinkedIn) now resolve too,
leaving only a few proprietary portals (e.g. Amazon) as link-only.

### 3. By LinkedIn Title
List the job titles you care about (comma separated, e.g.
`Data Engineer, ML Engineer, Backend Engineer`). It queries **LinkedIn's public guest
job search** and returns matching live postings with a direct **Apply ↗** link each.
Optional role filter (default: all matching titles). Default location is India.

### 4. This Week
A one-click **weekly digest**: scans **all live companies** for **core software-engineer
roles** (SWE / SDE / MTS / Computer Scientist) **posted in the last 7 days** (selectable
3 / 7 / 14 / 30), India by default, newest first. **LinkedIn results are included with a
show/hide toggle.** This is an expensive scan, so the first run takes ~1 minute and is
then **cached for 30 minutes** (use Refresh to force a rebuild).

### 5. ATS Match
**Upload your résumé** (PDF, DOCX, or TXT) and it scores every open
software-engineering role at a company against it. The file is parsed
**in-memory** to detect your skills and years of experience (it's never stored),
then each role is shown as a table: **ATS score · Job ID · Title · Location ·
Experience · matched/missing skills · Apply ↗**, sorted by best match. Scores
blend skill-keyword overlap, skill breadth, title alignment, and experience fit.
Greenhouse/Ashby/Lever companies (Stripe, Databricks, Figma, OpenAI…) have full job
descriptions so they score with **high confidence**; title-only sources (Workday, Avature,
LinkedIn) are flagged low-confidence (`~`). Your parsed résumé stays in the
browser (localStorage) so it persists across tabs until you replace it.
*Heuristic, not a real ATS — use it to compare roles and spot missing keywords.*

### 6. Apply (assisted auto-apply)
Queue Workday or Greenhouse roles (click **Auto-apply** on a job card, or paste a URL) and
apply with one click via a **visible browser** (Playwright). It **always stops before
Submit so you review and submit yourself** — it never submits for you.
- **Greenhouse** (Stripe, Databricks, Figma…): **no login** — fills your name, email and
  phone and attaches your résumé from `server/src/applicant.js`.
- **Workday** (Adobe, NVIDIA, Intel…): clicks **Apply → "Use My Last Application"** and
  advances to the review page. You must **sign in to each Workday tenant once** (they're
  separate; the login is then remembered in a local browser profile). "Use My Last
  Application" only appears if you've applied on that company before.

Requires Playwright (`npm install playwright`) and a local Edge/Chrome (auto-detected).
Your contact details and résumé path live in `server/src/applicant.js` — edit them there.

### Feedback
A floating **Feedback** button pinned to the **bottom-right** of every screen.
Click it to open a small dialog where anyone can leave a suggestion, bug
report, or note — **no login or sign-up required**. Pick a type
(Suggestion / Bug / Praise / Other), write a message, and optionally add a name
and contact. Submissions are stored server-side in `DATA_DIR/feedback.json`
(written atomically). Submitter name/contact are only returned by the read API
when a matching `FEEDBACK_ADMIN_TOKEN` is supplied, so the public listing can't
harvest contact details.

## Quick start

```bash
cd job-hunter
npm install      # installs both client and server (npm workspaces)
npm run dev      # starts API (:5179) and UI (:5173) together
```

Then open **http://localhost:5173**.

> First `npm install` pulls all dependencies. After that, `npm run dev` is the only
> command you need.

## How it works

```
client/   React + Vite UI (port 5173, proxies /api → backend)
  src/components/CompanyTab    company search + role/experience/location filters
  src/components/CompaniesTab  company-wise directory grid
  src/components/LinkedInTab   LinkedIn title search
server/   Express API (port 5179)
  src/ats.js          company name → ATS / Workday / career-site discovery → jobs
  src/classify.js     role filters: isCoreSweRole (SWE IC) + isTechRole
  src/companies.js    seeded 55-company career-site directory + status
  src/blocklist.js    excludes IT-services/consulting/staffing firms
  src/resume.js       résumé profile (skills, years, target titles)
  src/scoring.js      ATS-style résumé↔job match scoring
  src/location.js     India-aware location matching (cities → country)
  src/experience.js   parses years-of-experience from job text
  src/linkedin.js     LinkedIn guest search + HTML parsing (cheerio)
  src/index.js        routes + 5-min in-memory cache
```

### API endpoints
- `GET /api/company?name=Adobe&min=3&max=10&roleFilter=swe&q=&location=india` — `roleFilter` is `swe` (default) | `tech` | `all`
- `GET /api/latest?days=7&location=india&includeLinkedIn=true&pages=1` — weekly core-SWE digest across all companies + LinkedIn (cached 30 min; `refresh=true` to rebuild)
- `GET /api/ats?name=Stripe&location=india&min=3&max=10&roleFilter=swe` — résumé-match scores (bundled résumé; back-compat)
- `POST /api/resume/parse` (multipart `resume`) — parse an uploaded résumé (PDF/DOCX/TXT) in-memory → `{ profile }`
- `POST /api/ats` `{ name, location?, min?, max?, roleFilter?, profile }` — score a company's roles against an uploaded résumé profile
- `GET /api/companies` — seeded directory with resolved provider + status
- `POST /api/apply` `{ url, provider }` — assisted auto-apply (Workday "Use My Last Application" / Greenhouse form-fill); opens a visible browser and stops before Submit
- `GET /api/linkedin?titles=Data Engineer,ML Engineer&location=India&pages=2&roleFilter=all`
- `POST /api/feedback` `{ message, category?, name?, contact? }` — submit feedback/suggestion (no login)
- `GET /api/feedback` — list submissions (newest first); pass `?token=FEEDBACK_ADMIN_TOKEN` to include submitter name/contact
- `GET /api/health`

## Notes & limitations
- **Company coverage** depends on which ATS a company uses. Greenhouse/Lever/Ashby/
  SmartRecruiters/Workday + live career-site detection cover a large share of tech
  employers. If a name isn't found, the UI shows which slugs were tried — try the brand
  name without suffixes (e.g. `Ramp` not `Ramp Inc`).
- **Career-site discovery** reads the company's static `careers`/`jobs` page. Sites that
  render entirely in JavaScript (some large SPAs) won't expose their ATS and may not
  resolve — those big employers are instead covered by the Workday directory.
- **LinkedIn** rate-limits its public guest endpoint. If a search returns nothing,
  wait a few seconds, lower the page depth, or change the location. This is intended for
  light personal use only.
- Results are cached for 5 minutes so repeat searches are instant.

## Scripts
| Command | What it does |
| --- | --- |
| `npm run dev` | Run UI + API together (recommended) |
| `npm run dev:server` | API only (`:5179`) |
| `npm run dev:client` | UI only (`:5173`) |
| `npm run build` | Production build of the UI into `client/dist` |
