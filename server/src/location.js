// Location matching with country/city awareness.
// Workday and others often label a role by city ("Noida", "Bangalore") rather
// than country, so filtering by "india" must also match its major cities.

const INDIA_TERMS = [
  "india",
  "bharat",
  "bangalore",
  "bengaluru",
  "noida",
  "gurgaon",
  "gurugram",
  "hyderabad",
  "pune",
  "chennai",
  "mumbai",
  "new delhi",
  "delhi",
  "kolkata",
  "ahmedabad",
  "jaipur",
  "indore",
  "kochi",
  "cochin",
  "trivandrum",
  "thiruvananthapuram",
  "mohali",
  "chandigarh",
  "nagpur",
  "coimbatore",
  "visakhapatnam",
  "vizag",
  "mysore",
  "mysuru",
  "gandhinagar",
  "kanpur",
  "lucknow",
];

const BANGALORE_TERMS = ["bangalore", "bengaluru", "bengaluru rural", "bangaluru"];
const HYDERABAD_TERMS = ["hyderabad", "secunderabad", "hitech city", "hi-tech city", "hitec city"];
const PUNE_TERMS = ["pune", "pimpri", "chinchwad", "hinjewadi", "hinjawadi"];

const ALIASES = {
  india: INDIA_TERMS,
  in: INDIA_TERMS,
  bharat: INDIA_TERMS,
  bangalore: BANGALORE_TERMS,
  bengaluru: BANGALORE_TERMS,
  blr: BANGALORE_TERMS,
  hyderabad: HYDERABAD_TERMS,
  hyd: HYDERABAD_TERMS,
  pune: PUNE_TERMS,
  pnq: PUNE_TERMS,
};

export function matchesLocation(jobLocation, query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return true;
  const l = (jobLocation || "").toLowerCase();
  // Comma-separated query (e.g. "bangalore, pune") matches if ANY city matches.
  if (q.includes(",")) {
    return q
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((sub) => matchesLocation(jobLocation, sub));
  }
  const terms = ALIASES[q];
  // Whole-word match for known country/city terms so a term can't match inside a
  // larger word — e.g. "india" must match "Bengaluru, India" but NOT "Indiana".
  if (terms) return terms.some((t) => hasWord(l, t));
  return l.includes(q);
}

// True if `term` appears as a whole word in `haystack` (bounded by string
// start/end or a non-alphanumeric char), so "india" ≠ "indiana", "us" ≠ "houston".
function hasWord(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
}
