// Classify whether a job is a software-engineering / technical role.
// Title-driven (precise), with department as a secondary positive signal,
// and a deny list that removes business/non-technical roles.

const ALLOW = new RegExp(
  [
    "software",
    "engineer(?:ing)?",
    "developer",
    "development",
    "programmer",
    "\\bcoder\\b",
    "\\bsde\\b",
    "\\bswe\\b",
    "\\bsdet\\b",
    "full[\\s-]?stack",
    "front[\\s-]?end",
    "back[\\s-]?end",
    "web\\s*dev",
    "architect",
    "devops",
    "devsecops",
    "\\bsre\\b",
    "site\\s+reliability",
    "infrastructure",
    "\\binfra\\b",
    "embedded",
    "firmware",
    "hardware",
    "\\basic\\b",
    "\\bfpga\\b",
    "silicon",
    "robotics",
    "data\\s+engineer",
    "data\\s+scien(?:ce|tist)",
    "data\\s+analyst",
    "computer\\s+scientist",
    "\\bscientist\\b",
    "research\\s+engineer",
    "member\\s+of\\s+technical\\s+staff",
    "technical\\s+staff",
    "\\bmts\\b",
    "\\bsmts\\b",
    "\\bpmts\\b",
    "analytics",
    "machine\\s+learning",
    "deep\\s+learning",
    "computer\\s+vision",
    "\\bnlp\\b",
    "\\bml\\b",
    "\\bai\\b",
    "\\bllm\\b",
    "artificial\\s+intelligence",
    "cloud",
    "kubernetes",
    "security\\s+engineer",
    "application\\s+security",
    "appsec",
    "cryptograph",
    "\\bqa\\b",
    "quality\\s+engineer",
    "test\\s+engineer",
    "automation\\s+engineer",
    "database",
    "\\bdba\\b",
    "network\\s+engineer",
    "sysadmin",
    "system[s]?\\s+admin",
    "\\bios\\b",
    "android",
    "mobile\\s+(?:engineer|developer)",
    "game\\s+(?:dev|engineer|programmer)",
    "graphics\\s+engineer",
    "compiler",
    "kernel",
    "distributed\\s+systems",
    "technical\\s+lead",
    "tech\\s+lead",
    "\\bcto\\b",
    "solutions?\\s+architect",
    "cloud\\s+architect",
    "data\\s+architect",
    "integration\\s+engineer",
    "information\\s+technology",
    "\\bit\\s+(?:engineer|administrator|admin|specialist)",
  ].join("|"),
  "i"
);

const DENY = new RegExp(
  [
    "\\bsales\\b",
    "sales\\s+engineer",
    "account\\s+executive",
    "account\\s+manager",
    "account\\s+director",
    "business\\s+development",
    "biz\\s?dev",
    "\\bbdr\\b",
    "\\bsdr\\b",
    "recruit(?:er|ing|ment)?",
    "sourcer",
    "talent\\s+acquisition",
    "marketing",
    "\\bseo\\b",
    "content\\s+(?:writer|strategist|manager|designer)",
    "copywriter",
    "social\\s+media",
    "communications?",
    "public\\s+relations",
    "brand",
    "partnerships?",
    "procurement",
    "payroll",
    "benefits",
    "facilities",
    "finance",
    "financial",
    "accounting",
    "accountant",
    "controller",
    "treasury",
    "bookkeep",
    "\\baudit\\b",
    "\\btax\\b",
    "legal",
    "counsel",
    "paralegal",
    "attorney",
    "compliance",
    "human\\s+resources",
    "people\\s+(?:ops|operations|partner)",
    "\\bhr\\b",
    "office\\s+manager",
    "executive\\s+assistant",
    "administrative",
    "receptionist",
    "customer\\s+success",
    "customer\\s+support",
    "customer\\s+experience",
    "customer\\s+service",
    "go[\\s-]?to[\\s-]?market",
    "\\bgtm\\b",
    "solutions?\\s+consultant",
    "pre[\\s-]?sales",
    "product\\s+marketing",
  ].join("|"),
  "i"
);

const ENG_DEPT = /engineering|software|infrastructure|platform|\bdata\b|security|technology|developer|machine\s+learning|\bai\b/i;

export function isTechRole(title = "", department = "") {
  const t = title.toLowerCase().replace(/[_/\\]+/g, " ");
  if (DENY.test(t)) return false;
  // Non-software "engineer" roles (tax/ERP/IT-ops/other disciplines), unless the
  // title is explicitly a software engineer/developer role.
  if (NON_SWE_DOMAIN.test(t) && !CORE_TITLE.test(t)) return false;
  if (ALLOW.test(t)) return true;
  // Secondary signal: clearly-engineering department + title not denied.
  if (department && ENG_DEPT.test(department)) return true;
  return false;
}

// ---- Core software-engineering IC filter ----
// Strict: only individual-contributor software-engineering roles.
// Excludes test/QA-in-test, management, and hardware/silicon disciplines.

const MGMT =
  /\b(manager|mgr|director|vp|vice\s+president|head\s+of|chief|president|people\s+lead|engineering\s+lead|team\s+lead)\b/i;

const TEST =
  /\b(sdet|in\s+test|test\s+engineer|software\s+engineer\s+in\s+test|\bqa\b|quality\s+assurance|quality\s+engineer|test\s+automation|automation\s+in\s+test|test\s+lead)\b/i;

const HARDWARE =
  /\b(hardware|physical\s+design|\bdft\b|analog|mixed[\s-]?signal|\brf\b|\basic\b|\bvlsi\b|\bpcb\b|\brtl\b|\bfpga\b|\bsoc\b|validation|post[\s-]?silicon|pre[\s-]?silicon|layout|circuit|silicon|semiconductor|mechanical|electrical|\bee\b|civil|chemical|optical|photonics|manufacturing|industrial|biomedical|design\s+verification|hardware\s+verification|board\s+design|signal\s+integrity|thermal|antenna|wireless\s+hardware)\b/i;

// Engineer titles that are not core software engineering.
const NON_SWE =
  /\b(solutions?\s+engineer|sales\s+engineer|field\s+engineer|customer\s+engineer|support\s+engineer|deployment\s+engineer|implementation\s+engineer|facilities|process\s+engineer|forward\s+deployed)\b/i;

// Non-software business / enterprise-application / IT-ops / other-discipline
// "engineer" roles. These carry the word "engineer" but aren't software
// engineering (e.g. "Vertex Tax System Engineer", "SAP Engineer", "Desktop
// Support Engineer"). An explicit "Software Engineer/Developer" title (CORE_TITLE)
// still wins, so "Software Engineer, Tax Platform" is kept.
const NON_SWE_DOMAIN = new RegExp(
  [
    "\\btax\\b", "vertex", "payroll", "billing\\s+system",
    "\\berp\\b", "\\bsap\\b", "s/?4\\s?hana", "\\babap\\b",
    "servicenow", "service\\s?now", "netsuite", "peoplesoft", "dynamics\\s*365",
    "oracle\\s+(?:ebs|apps|applications|financials|e-business|hcm|fusion|scm|epm)",
    "sharepoint", "\\bsccm\\b", "informatica", "mulesoft", "\\bguidewire\\b",
    "salesforce\\s+(?:admin|administrator|consultant|analyst|functional)",
    "workday\\s+(?:hcm|integration|consultant|payroll|analyst|functional|adaptive)",
    "supply\\s+chain", "warehouse", "logistics", "procurement", "\\bcrm\\b",
    "telecom", "telephony", "voip", "desktop\\s+(?:support|engineer)",
    "help\\s?desk", "service\\s+desk", "deskside", "field\\s+service",
    "data\\s+cent(?:er|re)",
    "building", "\\bhvac\\b", "biomedical", "clinical", "petroleum", "mining",
    "drilling", "geotechnical", "structural", "environmental\\s+engineer",
    "safety\\s+engineer", "quality\\s+control", "plant\\s+engineer",
    "maintenance\\s+engineer", "\\bcad\\b", "piping", "welding", "\\bhse\\b",
  ].join("|"),
  "i"
);

// Explicit core software-engineer titles (any level).
const CORE_TITLE =
  /\b(software\s+engineer|software\s+developer|software\s+development\s+engineer|\bsde\b|member\s+of\s+technical\s+staff|\b[sp]?mts\b|computer\s+scientist|programmer\s+analyst|programmer)\b/i;

// Software-domain keyword that, with engineer/developer, denotes a SWE role.
const SWE_DOMAIN =
  /\b(software|backend|back[\s-]?end|frontend|front[\s-]?end|full[\s-]?stack|fullstack|web|mobile|ios|android|api|platform|infrastructure|distributed|systems?|cloud|services?|applications?|machine\s+learning|deep\s+learning|\bml\b|\bai\b|data|devops|\bsre\b|site\s+reliability|reliability|security|appsec|blockchain|search|developer\s+(?:experience|productivity)|compiler|kernel|embedded|firmware|graphics|gameplay|game)\b/i;

const ENGINEER_WORD = /\b(engineer|engineering|developer|development)\b/i;

export function isCoreSweRole(title = "") {
  const t = title.toLowerCase().replace(/[_/\\]+/g, " ");
  if (MGMT.test(t)) return false;
  if (TEST.test(t)) return false;
  if (HARDWARE.test(t)) return false;
  if (NON_SWE.test(t)) return false;
  if (CORE_TITLE.test(t)) return true; // explicit "software engineer" wins
  if (NON_SWE_DOMAIN.test(t)) return false; // tax/ERP/IT-ops/other-discipline "engineer"
  if (ENGINEER_WORD.test(t) && SWE_DOMAIN.test(t)) return true;
  return false;
}

// ---- Product / Program Manager (PM) filter ----
// Curates product managers, program managers, TPMs and product owners (the
// MBA / non-engineering track). Excludes engineering/people-management and all
// software-engineering roles, so "PM mode" shows no SDE jobs.
const PM_TITLE =
  /\b(product\s+manager|product\s+management|product\s+owner|product\s+lead|group\s+product\s+manager|associate\s+product\s+manager|technical\s+product\s+manager|principal\s+product\s+manager|senior\s+product\s+manager|(?:director|head|vp|chief)\s*(?:of|,)?\s*product|program\s+manager|technical\s+program\s+manager|program\s+management|program\s+lead|\btpm\b|\bapm\b)\b/i;

// "Manager" titles that are NOT product/program management.
const NON_PM =
  /\b(engineering\s+manager|software\s+engineering\s+manager|development\s+manager|sales\s+manager|account\s+manager|marketing\s+manager|product\s+marketing|people\s+manager|community\s+manager|project\s+manager|delivery\s+manager|customer\s+success\s+manager|category\s+manager|brand\s+manager|channel\s+manager|partner(?:ships?)?\s+manager|store\s+manager|operations\s+manager|office\s+manager|general\s+manager|finance\s+manager|hr\s+manager|hiring\s+manager)\b/i;

export function isPmRole(title = "") {
  const t = title.toLowerCase().replace(/[_/\\]+/g, " ");
  if (NON_PM.test(t)) return false;
  return PM_TITLE.test(t);
}

export function roleMatcher(roleFilter = "swe") {
  if (roleFilter === "all") return () => true;
  if (roleFilter === "tech") return (j) => isTechRole(j.title, j.department);
  if (roleFilter === "pm") return (j) => isPmRole(j.title);
  return (j) => isCoreSweRole(j.title);
}
