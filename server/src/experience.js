// Parse years-of-experience requirements from job text (title + description).
// Returns { min, max, source, raw } or null when nothing usable is found.

const stripHtml = (s = "") =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// One unified scan handles "N", "N-M", "N+", and qualifier prefixes (at least /
// minimum / up to …) in a single pass, so a range like "6 to 10 years" is
// consumed whole and its "10 years" tail is never re-read as a separate
// open-ended requirement (which previously inflated the max to Infinity).
const YEARS_RE =
  /(at\s+least\s+|minimum(?:\s+of)?\s+|min\.?\s+|more\s+than\s+|over\s+|up\s+to\s+|under\s+|less\s+than\s+|no\s+less\s+than\s+)?(\d{1,2})(?:\s*(?:-|–|—|to|through)\s*(\d{1,2}))?\s*(\+|plus\b)?\s*(?:years?|yrs?)\b/gi;

function rangeFrom(pre, lo, hiRaw) {
  if (hiRaw != null) return [lo, Number(hiRaw)]; // explicit range wins
  if (/up\s+to|under|less\s+than/i.test(pre || "")) return [0, lo];
  return [lo, Infinity]; // "N+", "at least N", "over N", or plain "N years"
}

// Classify a year mention by its surrounding text:
//  - "total" → an overall experience requirement ("8+ years of experience")
//  - "skill" → tied to a specific skill/activity ("3+ years with Kafka")
//  - "none"  → no experience/skill context (prose noise, e.g. "in the last 5 years")
function classifyYears(before, after) {
  const b = before.toLowerCase();
  const a = after.toLowerCase();
  if (/\bexperience\s*(?:of|:|=|-|–|—)?\s*$/.test(b)) return "total";
  // "N years [of] [x] experience with|in|on|of <skill>" → skill-specific
  if (/^\s*(?:of\s+)?(?:[a-z-]+\s+){0,2}experience\s+(?:with|in|on|of|using|building|developing|working|as)\s+\S/.test(a))
    return "skill";
  // "N years [of] [professional/industry/relevant/software/…] experience" → total.
  // Gated to real experience qualifiers so "leadership experience" or "cloud
  // experience" are treated as skill-specific, not overall experience.
  if (/^\s*(?:of\s+)?(?:(?:professional|industry|relevant|overall|total|combined|cumulative|work(?:ing)?|hands[-\s]?on|software|engineering|technical|prior|proven|demonstrated|practical|full[-\s]?time|it)\s+){0,3}(?:experience|expertise)\b/.test(a))
    return "total";
  // "N years overall / in total / cumulative" → overall requirement even without the word "experience"
  if (/^\s*(?:overall|in\s+total|total|cumulative|combined)\b/.test(a)) return "total";
  // "N years of|with|in|leading|managing <skill/activity>" → skill-specific
  if (/^\s*(?:of|with|in|on|using|building|developing|programming|writing|leading|managing|as)\s+\S/.test(a))
    return "skill";
  return "none";
}

const SENIORITY = [
  { re: /\b(intern|internship)\b/i, range: [0, 1] },
  { re: /\b(new\s*grad|entry[-\s]?level|early\s*career)\b/i, range: [0, 2] },
  // "staff" only as a level (Staff Engineer), not "Member of Technical Staff"
  { re: /\b(principal|distinguished|fellow)\b|\bstaff\s+(?:engineer|software|developer|scientist|architect)/i, range: [8, Infinity] },
  { re: /\b(director|head\s+of|vp|vice\s+president)\b/i, range: [10, Infinity] },
  { re: /\b(senior|sr\.?|lead)\b/i, range: [5, Infinity] },
  { re: /\b(manager|mgr)\b/i, range: [5, Infinity] },
  { re: /\b(mid[-\s]?level|mid[-\s]?senior)\b/i, range: [3, 6] },
  { re: /\b(junior|jr\.?|associate)\b/i, range: [0, 3] },
];

export function parseExperience(title = "", description = "") {
  const text = stripHtml(`${title}. ${description}`);
  const totals = [];
  const skills = [];
  const samples = [];

  YEARS_RE.lastIndex = 0;
  let m;
  while ((m = YEARS_RE.exec(text)) !== null) {
    const lo = Number(m[2]);
    if (!(lo >= 0 && lo <= 50)) continue;
    const explicit = m[3] != null || m[4] != null || !!m[1]; // range, "+", or qualifier word
    const start = m.index;
    const before = text.slice(Math.max(0, start - 28), start);
    const after = text.slice(start + m[0].length, start + m[0].length + 55);

    let kind = classifyYears(before, after);
    if (kind === "none") {
      if (!explicit) continue; // bare "5 years" with no context → prose noise, skip
      kind = "skill"; // explicit "N+ years <noun>" with no experience cue → treat as skill
    }
    const range = rangeFrom(m[1], lo, m[3]);
    (kind === "total" ? totals : skills).push(range);
    if (samples.length < 3) samples.push(m[0].trim());
  }

  // Prefer the overall/total requirement. Skill-specific mentions only drive the
  // estimate when no total is stated — and then the *highest* skill floor is used,
  // since meeting the toughest skill requirement implies at least that much overall.
  const chosen = totals.length ? totals : skills;
  if (chosen.length) {
    const los = chosen.map((r) => r[0]);
    const his = chosen.map((r) => r[1]);
    return {
      min: totals.length ? Math.min(...los) : Math.max(...los),
      max: Math.max(...his),
      source: totals.length ? "text" : "skill",
      raw: samples.join("; "),
    };
  }

  // Fallback: infer from seniority keywords in the TITLE only. We deliberately
  // do not scan the description body here — a stray "work with principal
  // engineers" would otherwise inflate the estimate.
  const hay = ` ${title.toLowerCase()} `;
  for (const { re, range } of SENIORITY) {
    if (re.test(hay)) {
      return { min: range[0], max: range[1], source: "seniority", raw: re.source };
    }
  }

  return null;
}

// Does a job's experience overlap the user's desired [lo, hi] window?
export function overlapsRange(exp, lo, hi) {
  if (!exp) return null; // unknown
  return exp.min <= hi && exp.max >= lo;
}

export function formatExp(exp) {
  if (!exp) return "Not specified";
  const max = exp.max === Infinity ? "+" : `–${exp.max}`;
  if (exp.max === Infinity) return `${exp.min}+ yrs`;
  if (exp.min === 0) return `≤${exp.max} yrs`;
  return `${exp.min}${max} yrs`;
}
