// Applicant details used to auto-fill application forms (Greenhouse, etc.).
// No personal data lives in source: provide your real values via environment
// variables (copy .env.example to .env — which is gitignored — and fill it in).
// The defaults below are placeholders.

const env = process.env;

export const APPLICANT = {
  firstName: env.APPLICANT_FIRST_NAME || "First",
  lastName: env.APPLICANT_LAST_NAME || "Last",
  fullName:
    env.APPLICANT_FULL_NAME ||
    `${env.APPLICANT_FIRST_NAME || "First"} ${env.APPLICANT_LAST_NAME || "Last"}`,
  email: env.APPLICANT_EMAIL || "you@example.com",
  phone: env.APPLICANT_PHONE || "+10000000000",
  location: env.APPLICANT_LOCATION || "City, Country",
  linkedin: env.APPLICANT_LINKEDIN || "https://www.linkedin.com/in/your-handle",
  github: env.APPLICANT_GITHUB || "https://github.com/your-handle",
  // Google/Workday account used to sign in for "Use My Last/Previous Application":
  workdayLoginEmail: env.APPLICANT_WORKDAY_EMAIL || env.APPLICANT_EMAIL || "you@example.com",
  // Résumé attached to applications (absolute path on your machine):
  resumePath: env.APPLICANT_RESUME_PATH || "",
};

// Personal screening-answer values (kept out of source; override via env).
const CURRENT_EMPLOYER = env.APPLICANT_EMPLOYER || "";
const CURRENT_TITLE = env.APPLICANT_TITLE || "Software Engineer";
const YEARS_EXPERIENCE = env.APPLICANT_YOE || "3";
const CURRENT_CITY = env.APPLICANT_LOCATION || "City, Country";

// Answers used to auto-complete common *required* questions on Greenhouse (and
// similar) application forms. Edit these to match you. Anything a form marks
// required that we can't answer here will pause auto-submit so you can fill it.
export const ANSWERS = {
  // Free-text questions: [label regex, value]. First match wins.
  textOverrides: [
    [/preferred (first |last )?name|preferred name/i, APPLICANT.firstName],
    [/current or previous employer|current employer|present employer|most recent employer/i, CURRENT_EMPLOYER],
    [/current or previous (job )?title|present title|current title|most recent (job )?title/i, CURRENT_TITLE],
    [/most recent school|which (university|college|school)|name of (your )?(university|college|school)/i, ""],
    [/city and state|what city|where do you (currently )?(reside|live)|current (city|location)/i, CURRENT_CITY],
    [/years? of (professional |relevant |total )?experience/i, YEARS_EXPERIENCE],
    [/how did you hear|\breferr(al|ed)|\bsource\b/i, "Recruiter"],
    [/linked\s?in/i, APPLICANT.linkedin],
    [/git\s?hub/i, APPLICANT.github],
    [/portfolio|personal website|website/i, APPLICANT.github],
    [/notice period/i, "2 months"],
    [/full name|legal name/i, APPLICANT.fullName],
  ],

  // Single/multi-select questions: [label regex, option regex]. First match wins,
  // so more specific rules come first. Answers are chosen to maximise hireability
  // for an India-based candidate who needs no visa sponsorship.
  selectAnswers: [
    // "How did you hear about us?" -> Recruiter (matches Roku's "Recruiter/Sourcer").
    [/how did you hear|hear about (us|this|the (role|company|position|opening))|referr(al|ed)|how.*did.*hear/i, /recruiter/i],
    // "Authorized to work WITHOUT sponsorship?" -> Yes (must beat the sponsorship rule).
    [/(authoriz|eligible|legally|right to work|permitted|able to work).*(without|not requir\w*|no).*(sponsor|visa|support)/i, /^\s*yes\b/i],
    // Do you need / require visa sponsorship? -> No.
    [/require.*(sponsor|visa|work authorization|work permit)|need.*(sponsor|visa|work permit)|will you (now or in the future )?(require|need)|visa sponsor|sponsor(ship)?( now| in the future)?|immigration (support|sponsor)|\bsponsor(ship)?\b/i, /^\s*no\b/i],
    // Legally authorized / right to work -> Yes.
    [/authoriz(ed|ation)\s+to\s+(?:lawfully\s+|legally\s+|currently\s+)?work|legally (authorized|entitled|permitted)|right to work|eligible to work|permitted to work|work authorization|valid work (permit|authorization|visa)|(provide|furnish|proof of).*(work|employment) (authorization|eligibility)/i, /^\s*yes\b/i],
    // Country of residence / work -> India.
    [/countr(y|ies).*(reside|residence|located|live|work|working|anticipate|based)|current country|where.*(reside|based|located|live)/i, /^\s*india\b/i],
    // Blood relatives / relatives in government or at the company / PEP -> No.
    [/blood relative|relative(s)?\b.*(employ|work|govern|public|official|company|firm|organi[sz]ation|regulator|competitor|agency)|family member(s)?\b.*(employ|work|govern|public|official|company|agency)|related to (any|anyone|an? (employee|official|govern|public))|govern(ment)? official|public official|politically exposed|\bpep\b/i, /^\s*no\b/i],
    // Age 18+ -> Yes.
    [/18 (years )?(of age )?or older|at least 18|are you (at least )?18|legal working age|of legal (working )?age/i, /^\s*yes\b/i],
    // Willing to relocate -> Yes.
    [/relocat/i, /^\s*yes\b/i],
    // Onsite / hybrid / in-office / commute -> Yes.
    [/work (from|in|at|out of) (the |an |our )?(office|onsite|on-site|in-person|hq|location)|on-?site|in-office|in the office|hybrid|report to (the|an|our) office|commut(e|ing)|come (in(to)? )?(the )?office|willing to work in/i, /^\s*yes\b/i],
    // Remote -> Yes.
    [/work(ing)? remotely|remote(ly)?/i, /^\s*yes\b/i],
    // Willing to travel -> Yes.
    [/willing to travel|able to travel|comfortable.*travel|travel (up to|requirement|as needed|is required)/i, /^\s*yes\b/i],
    // Background / reference check consent -> Yes.
    [/consent.*(background|reference|check|screen)|background check|reference check|willing to (undergo|complete|consent).*(background|screen|check)/i, /^\s*yes\b/i],
    // Criminal record / conviction -> No.
    [/convicted|criminal (record|history|conviction|background)|felony|been arrested|pled guilty|any convictions/i, /^\s*no\b/i],
    // Non-compete / conflict / restrictive covenant -> No.
    [/non[- ]?compete|conflict of interest|restrictive covenant|bound by (any )?(agreement|contract)|garden leave|non-?solicit/i, /^\s*no\b/i],
    // Previously employed by / worked here (any capacity) -> No.
    [/(ever )?(been )?employed by|ever worked (for|at)|previously.*(employ|work)|formerly.*employ|current employee|currently (or |and )?(have you )?(ever )?(employ|work)|worked (for|at) .*(before|previously|in the past|this company|any capacity)/i, /^\s*no\b/i],
    // Consent / agree / acknowledge / privacy / terms / NDA / opt-in -> always give consent.
    [/\bconsent\b|do you (agree|consent)|i (agree|consent|acknowledge|confirm|accept)|agree to (the )?(terms|privacy|conditions|processing|use)|terms (and|&) conditions|privacy (notice|policy|statement)|acknowledge?ment?|opt.?in|data (processing|protection)|non-?disclosure|\bnda\b|confidentiality|e-?signature|electronic signature|i understand/i, /^(?!.*\b(do not|don'?t|cannot|decline|disagree|refuse|opt.?out|withdraw|not consent|not agree)\b).*(\byes\b|consent|i agree|agree to|acknowledge|i accept|accept the|i have read|i confirm|read and|opt.?in|i understand)/i],
    // Highest degree -> Bachelor.
    [/most recent degree|highest (level of )?(education|degree)|degree.*(obtain|completed|held)|level of education|education level/i, /bachelor/i],
    // Gender: set APPLICANT_GENDER (e.g. "male"/"female") to auto-answer; else decline.
    [/gender|what is your sex|\bsex\b/i, env.APPLICANT_GENDER ? new RegExp(`^\\s*${env.APPLICANT_GENDER}\\b`, "i") : /decline|prefer not|not to say|not to disclose/i],
    // Veteran status -> not a protected veteran.
    [/veteran/i, /not a (protected )?veteran|^\s*no\b/i],
    // Disability -> No.
    [/disabilit/i, /no,? i (do not|don).?t|don.?t have a disability|^\s*no\b/i],
    // Race / ethnicity (sensitive) -> decline.
    [/race|ethnic|hispanic|latino|self-?identif/i, /decline|prefer not|don.?t wish|do not wish/i],
  ],
};

