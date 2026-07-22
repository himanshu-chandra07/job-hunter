import { RESUME } from "./resume.js";
import { parseExperience, overlapsRange } from "./experience.js";

// Canonical skill -> matcher. Kept to unambiguous, multi-char tokens to avoid noise.
const SKILLS = {
  Java: /\bjava\b/i,
  Python: /\bpython\b/i,
  "C++": /\bc\+\+/i,
  "C#": /\bc#|\.net\b/i,
  Go: /\bgolang\b/i,
  JavaScript: /\bjavascript\b/i,
  TypeScript: /\btypescript\b/i,
  React: /\breact(?:\.js)?\b/i,
  Angular: /\bangular\b/i,
  "Node.js": /\bnode\.?js\b/i,
  Django: /\bdjango\b/i,
  "Spring Boot": /\bspring\b/i,
  "REST API": /\brest(?:ful)?\b|\bapis?\b/i,
  GraphQL: /\bgraphql\b/i,
  Microservices: /\bmicro[\s-]?services?\b/i,
  "Distributed Systems": /\bdistributed\b/i,
  Kubernetes: /\b(kubernetes|k8s)\b/i,
  Docker: /\bdocker\b/i,
  Terraform: /\bterraform\b/i,
  AWS: /\baws\b|amazon web services/i,
  Azure: /\bazure\b/i,
  GCP: /\b(gcp|google cloud)\b/i,
  Kafka: /\bkafka\b/i,
  Spark: /\bspark\b/i,
  SQL: /\bsql\b/i,
  MySQL: /\bmysql\b/i,
  PostgreSQL: /\bpostgre/i,
  NoSQL: /\bnosql\b/i,
  MongoDB: /\bmongo/i,
  Redis: /\bredis\b/i,
  "CI/CD": /\bci\/?cd\b|jenkins|continuous (integration|delivery|deployment)/i,
  Git: /\bgit\b/i,
  Linux: /\blinux\b/i,
  "Machine Learning": /\b(machine learning|\bml\b|deep learning)\b/i,
  NLP: /\b(nlp|natural language)\b/i,
  Security: /\b(security|appsec|infosec)\b/i,
  "System Design": /\bsystem design\b/i,
  Algorithms: /\b(algorithms?|data structures)\b/i,
  Scala: /\bscala\b/i,
  Rust: /\brust\b/i,
  Kotlin: /\bkotlin\b/i,
  Splunk: /\bsplunk\b/i,
  Observability: /\bobservability\b/i,
};

export function extractSkills(text = "") {
  const found = new Set();
  for (const [name, re] of Object.entries(SKILLS)) {
    if (re.test(text)) found.add(name);
  }
  return found;
}

// Parse a rough years-of-experience figure from free-form resume text.
// Returns a number, or null when nothing explicit is stated.
export function parseResumeYears(text = "") {
  const t = text.toLowerCase();
  let best = null;
  const patterns = [
    /(\d{1,2}(?:\.\d)?)\s*\+?\s*years?(?:\s+of)?\s+(?:professional\s+|industry\s+|software\s+|relevant\s+|overall\s+|total\s+)?experience/g,
    /experience\s*(?:of|:)?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*years?/g,
    /(\d{1,2}(?:\.\d)?)\s*\+?\s*yrs?\b/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(t))) {
      const n = parseFloat(m[1]);
      if (!isNaN(n) && n >= 0 && n <= 50) best = Math.max(best ?? 0, n);
    }
  }
  return best;
}

// Common software-engineering titles used to align a job title with the resume.
const TITLE_VOCAB = [
  "software engineer", "software development engineer", "sde", "backend engineer",
  "back end engineer", "frontend engineer", "front end engineer", "full stack",
  "fullstack", "member of technical staff", "computer scientist", "platform engineer",
  "security engineer", "distributed systems", "data engineer", "machine learning engineer",
  "ml engineer", "site reliability", "sre", "devops", "mobile engineer", "cloud engineer",
];

const BASE_TITLES = ["software engineer", "engineer", "developer"];

export function deriveTargetTitles(text = "") {
  const t = text.toLowerCase();
  const found = TITLE_VOCAB.filter((k) => t.includes(k));
  return [...new Set([...found, ...BASE_TITLES])];
}

// Build a scoring profile from arbitrary resume text.
export function buildProfile(text = "", opts = {}) {
  const skills = extractSkills(text);
  const years =
    opts.years != null ? Number(opts.years) : parseResumeYears(text);
  const clean = years == null || isNaN(years) ? null : years;
  return {
    name: opts.name || "Your resume",
    headline: opts.headline || "",
    years: clean,
    yearsDetected: clean != null,
    skills, // Set
    skillList: [...skills],
    targetTitles: opts.targetTitles?.length
      ? [...new Set([...opts.targetTitles, ...BASE_TITLES])]
      : deriveTargetTitles(text),
  };
}

// Rebuild a profile from the (untrusted) object the client echoes back. Skills
// are filtered to the known vocabulary and years/titles are coerced/clamped.
export function profileFromClient(p = {}) {
  const known = new Set(Object.keys(SKILLS));
  const skillList = Array.isArray(p.skills)
    ? [...new Set(p.skills.filter((s) => known.has(s)))]
    : [];
  let years = p.years == null || p.years === "" ? null : Number(p.years);
  if (years != null && (isNaN(years) || years < 0 || years > 50)) years = null;
  const targetTitles = Array.isArray(p.targetTitles)
    ? p.targetTitles.map((s) => String(s).toLowerCase()).slice(0, 60)
    : [];
  return {
    name: typeof p.name === "string" && p.name ? p.name.slice(0, 120) : "Your resume",
    headline: typeof p.headline === "string" ? p.headline.slice(0, 160) : "",
    years,
    yearsDetected: years != null,
    skills: new Set(skillList),
    skillList,
    targetTitles: targetTitles.length
      ? [...new Set([...targetTitles, ...BASE_TITLES])]
      : [...BASE_TITLES],
  };
}

// A client-safe summary of a profile (no Set).
export function profileSummary(profile) {
  return {
    name: profile.name,
    headline: profile.headline || "",
    years: profile.years ?? null,
    yearsDetected: !!profile.yearsDetected,
    skills: profile.skillList || [...(profile.skills || [])],
  };
}

function titleAlignment(title = "", targetTitles = BASE_TITLES) {
  const t = title.toLowerCase();
  if (targetTitles.some((k) => k && t.includes(k))) return 1;
  if (/\bengineer\b|\bdeveloper\b/.test(t)) return 0.75;
  return 0.4;
}

function expFit(exp, years) {
  if (!exp) return 0.75; // job YOE unknown
  if (years == null) return 0.75; // resume YOE unknown → neutral
  if (exp.min <= years) return 1; // qualified
  if (exp.min <= years + 2) return 0.7;
  if (exp.min <= years + 4) return 0.45;
  return 0.3;
}

// Default profile from the bundled resume — used only by the legacy GET route.
export const DEFAULT_PROFILE = buildProfile(RESUME.text, {
  name: RESUME.name,
  headline: RESUME.headline,
  years: RESUME.years,
  targetTitles: RESUME.targetTitles,
});

// Score one job (0-100) against a resume profile, with matched/missing skills.
export function scoreJob(job, profile = DEFAULT_PROFILE) {
  const resumeSkills =
    profile.skills instanceof Set
      ? profile.skills
      : new Set(profile.skillList || profile.skills || []);
  const targetTitles = profile.targetTitles || BASE_TITLES;

  const text = `${job.title}. ${job.description || ""}`;
  const jobSkills = extractSkills(text);
  const matched = [...jobSkills].filter((s) => resumeSkills.has(s));
  const missing = [...jobSkills].filter((s) => !resumeSkills.has(s));
  const exp = parseExperience(job.title, job.description || "");

  const tAlign = titleAlignment(job.title, targetTitles);
  const eFit = expFit(exp, profile.years);
  const hasDesc = jobSkills.size >= 4;

  // coverage = share of the job's listed skills you have;
  // breadth   = absolute count of your skills the job wants (caps at 6) so a
  //             rich, well-matched JD can't be beaten by a 2-keyword one.
  const coverage = jobSkills.size
    ? matched.length / jobSkills.size
    : tAlign >= 1
    ? 0.5
    : 0.3;
  const breadth = Math.min(matched.length / 6, 1);

  const base = 0.42 * coverage + 0.3 * breadth + 0.16 * tAlign + 0.12 * eFit;

  return {
    score: Math.max(0, Math.min(100, Math.round(base * 100))),
    confidence: hasDesc ? "high" : "low",
    matched: matched.slice(0, 8),
    missing: missing.slice(0, 8),
    experience: exp,
  };
}

// Back-compat: summary of the bundled resume profile.
export const RESUME_PROFILE = profileSummary(DEFAULT_PROFILE);
