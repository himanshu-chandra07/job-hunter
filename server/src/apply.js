// Assisted auto-apply automation.
//  - Workday: opens a VISIBLE, persistent browser, clicks Apply ->
//    "Use My Last / Previous Application", handles the sign-in popup by selecting
//    the configured account, advances to review, and (optionally) Submits.
//  - Greenhouse: no login. One-click PREFILL — opens the application form and
//    fills first/last name, email, phone, country, résumé and every screening
//    question it can map (from the public schema + ANSWERS), then STOPS at the
//    Submit button for you to review and submit. Auto-submit stays OFF.
// Auto-submit is OFF unless the caller passes autoSubmit:true.

import path from "path";
import fs from "fs";
import axios from "axios";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { APPLICANT, ANSWERS } from "./applicant.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, "..", ".browser-profile");
const CDP_PORT = 9222;

let context = null;
let launching = null;
let BROWSER_MODE = null; // "chrome-tab" (your real Chrome) | "separate-browser"

export function getBrowserMode() {
  return BROWSER_MODE;
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromeExe() {
  const c = [
    `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  return c.find((p) => p && fs.existsSync(p));
}

async function connectCdp(chromium) {
  try {
    return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 4000 });
  } catch {
    return null;
  }
}

async function getContext() {
  if (context) return context;
  if (launching) return launching;
  launching = (async () => {
    const { chromium } = await import("playwright");

    // Test hook: a plain headless browser (skips CDP / real-Chrome attach) so the
    // fill logic can be exercised without a visible window or a real submission.
    if (process.env.APPLY_HEADLESS === "1") {
      const b = await chromium.launch({ headless: true });
      const ctx = await b.newContext();
      BROWSER_MODE = "headless-test";
      context = ctx;
      launching = null;
      return ctx;
    }

    // 1) Attach to an already-running, debug-enabled Chrome (a new tab opens here).
    let browser = await connectCdp(chromium);

    // 2) Otherwise launch the user's REAL Chrome (their profile / Gmail login) with
    //    the debug port, then attach. Requires their normal Chrome to be closed.
    if (!browser) {
      const exe = findChromeExe();
      const userData = path.join(process.env["LOCALAPPDATA"] || "", "Google", "Chrome", "User Data");
      if (exe) {
        try {
          spawn(
            exe,
            [
              `--remote-debugging-port=${CDP_PORT}`,
              `--user-data-dir=${userData}`,
              "--restore-last-session",
              "--no-first-run",
              "--no-default-browser-check",
            ],
            { detached: true, stdio: "ignore" }
          ).unref();
        } catch {
          /* ignore */
        }
        for (let i = 0; i < 14 && !browser; i++) {
          await sleepMs(800);
          browser = await connectCdp(chromium);
        }
      }
    }

    if (browser) {
      const ctx = browser.contexts()[0] || (await browser.newContext());
      ctx.__cdp = true;
      browser.on("disconnected", () => {
        context = null;
      });
      BROWSER_MODE = "chrome-tab";
      context = ctx;
      launching = null;
      return ctx;
    }

    // 3) Fallback: a separate, dedicated browser profile (sign in once there).
    const base = { headless: false, viewport: null, args: ["--start-maximized"] };
    const tries = [{ channel: "chrome" }, { channel: "msedge" }, {}];
    let ctx = null;
    let lastErr;
    for (const t of tries) {
      try {
        ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...base, ...t });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!ctx)
      throw new Error("Could not attach to Chrome or launch a browser. " + (lastErr?.message || ""));
    ctx.on("close", () => {
      context = null;
    });
    BROWSER_MODE = "separate-browser";
    context = ctx;
    launching = null;
    return ctx;
  })();
  return launching;
}

async function isSignIn(page) {
  if (/login|sign[-_]?in|authn|okta|microsoftonline|accounts\.google/i.test(page.url())) return true;
  return (
    (await page
      .locator('input[type="password"], [data-automation-id="password"]')
      .count()
      .catch(() => 0)) > 0
  );
}

// Pick the configured account in a Google chooser / sign-in surface (a page or popup).
// Never types a password — returns "needs-password" if it reaches that step.
async function pickGoogleAccount(p, email) {
  await p.waitForLoadState("domcontentloaded").catch(() => {});
  await p.waitForTimeout(1500);
  // 1) account chooser tile
  for (const sel of [
    `[data-identifier="${email}"]`,
    `[data-email="${email}"]`,
    `div[role="link"]:has-text("${email}")`,
    `li:has-text("${email}")`,
  ]) {
    const tile = p.locator(sel).first();
    if (await tile.count().catch(() => 0)) {
      await tile.click().catch(() => {});
      await p.waitForTimeout(2200);
      return "selected";
    }
  }
  // 2) email entry form
  const emailInput = p.locator('input[type="email"]').first();
  if (await emailInput.count().catch(() => 0)) {
    await emailInput.fill(email).catch(() => {});
    await p
      .locator('#identifierNext button, #identifierNext, button:has-text("Next")')
      .first()
      .click()
      .catch(() => {});
    await p.waitForTimeout(2000);
    return "needs-password";
  }
  return "none";
}

// Make sure we're signed in; handles "Sign in with Google" + inline forms.
async function ensureSignedIn(page, ctx, email) {
  if (!(await isSignIn(page))) return { signed: true };

  const googleBtn = page
    .locator(
      'button:has-text("Sign in with Google"), a:has-text("Sign in with Google"), ' +
        '[data-automation-id*="ocialMedia"] button, [aria-label*="Google"]'
    )
    .first();
  if (await googleBtn.count().catch(() => 0)) {
    const popupP = ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await googleBtn.click().catch(() => {});
    const popup = await popupP;
    const res = await pickGoogleAccount(popup || page, email);
    if (res === "needs-password") return { needsPassword: true };
    await page.waitForTimeout(2500);
    return { signed: true };
  }

  // inline form — fill the email/username, but never the password
  const emailField = page
    .locator('input[type="email"], [data-automation-id="email"], [data-automation-id="userName"], input[name="username"]')
    .first();
  if (await emailField.count().catch(() => 0)) {
    await emailField.fill(email).catch(() => {});
  }
  return { needsPassword: true };
}

// Step through the wizard to the review/Submit page. Submits only if autoSubmit.
async function advanceToReview(page, autoSubmit) {
  for (let step = 0; step < 9; step++) {
    await page.waitForTimeout(1300);
    const submit = page
      .locator(
        '[data-automation-id="bottom-navigation-next-button"]:has-text("Submit"), ' +
          '[data-automation-id="pageFooterNextButton"]:has-text("Submit"), button:has-text("Submit")'
      )
      .first();
    if (await submit.count().catch(() => 0)) {
      if (autoSubmit) {
        await submit.scrollIntoViewIfNeeded().catch(() => {});
        await submit.click({ timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(2500);
        // a confirmation dialog sometimes needs an extra confirm
        const confirm = page.locator('button:has-text("Submit"), button:has-text("OK"), button:has-text("Confirm")').first();
        if (await confirm.count().catch(() => 0)) await confirm.click().catch(() => {});
        await page.waitForTimeout(1500);
        return { ok: true, stage: "submitted", message: "Submitted! Verify the confirmation in the browser." };
      }
      return { ok: true, stage: "at-review",
        message: "Reached the review / Submit page. Switch to the browser, check it, and click Submit yourself (or enable Auto-submit)." };
    }
    const next = page
      .locator(
        '[data-automation-id="bottom-navigation-next-button"], [data-automation-id="pageFooterNextButton"], ' +
          'button:has-text("Save and Continue"), button:has-text("Continue"), button:has-text("Next")'
      )
      .first();
    if (!(await next.count().catch(() => 0))) {
      return { ok: true, stage: "stopped",
        message: "Your application is loaded and open in the browser. Please review the remaining pages and submit." };
    }
    await next.click({ timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1600);
    const errs = await page
      .locator('[data-automation-id="errorMessage"], [data-automation-id="validationBanner"], [class*="error"]')
      .count()
      .catch(() => 0);
    if (errs) {
      return { ok: true, stage: "needs-input",
        message: "Some required fields still need you (e.g. screening / EEO questions). Finish those in the browser, then Submit." };
    }
  }
  return { ok: true, stage: "stopped-max",
    message: "Stepped through several pages — the application is open for you to review and submit." };
}

async function applyToWorkday(url, autoSubmit) {
  const email = APPLICANT.workdayLoginEmail;
  const needPw = () => ({ ok: false, stage: "login-password",
    message: `Finish signing in as ${email} in the open browser (password / 2FA), then click Auto-apply again. Tip: signing into Google once in this browser means it just picks the account next time.` });
  try {
    const ctx = await getContext();
    const page = await ctx.newPage();
    await page.bringToFront().catch(() => {});
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    const applySel =
      '[data-automation-id="adventureButton"], [data-automation-id="applyButton"], ' +
      'a[role="button"]:has-text("Apply"), button:has-text("Apply"), a:has-text("Apply")';
    await page.waitForSelector(applySel, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(700);
    const applyBtn = page.locator(applySel).first();
    if (!(await applyBtn.count().catch(() => 0))) {
      const s = await ensureSignedIn(page, ctx, email);
      if (s.needsPassword) return needPw();
      return { ok: false, stage: "apply-not-found",
        message: "The Apply button didn't appear (the page may be slow/rate-limited). It's open in the browser — try manually." };
    }
    await applyBtn.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2200);

    // Workday usually requires sign-in before the application options appear.
    if (await isSignIn(page)) {
      const s = await ensureSignedIn(page, ctx, email);
      if (s.needsPassword) return needPw();
      await page.waitForTimeout(2000);
    }

    const usePrevSel =
      '[data-automation-id="useMyLastApplication"], [data-automation-id="autofillWithLastApplication"], ' +
      'button:has-text("Use My Previous Application"), a:has-text("Use My Previous Application"), ' +
      'button:has-text("Use My Last Application"), a:has-text("Use My Last Application"), ' +
      '[role="button"]:has-text("Use My Previous Application"), [role="button"]:has-text("Use My Last Application")';
    await page.waitForTimeout(800);
    let usePrev = page.locator(usePrevSel).first();
    if (!(await usePrev.count().catch(() => 0))) {
      if (await isSignIn(page)) {
        const s = await ensureSignedIn(page, ctx, email);
        if (s.needsPassword) return needPw();
        await page.waitForTimeout(2000);
        usePrev = page.locator(usePrevSel).first();
      }
    }
    if (!(await usePrev.count().catch(() => 0))) {
      return { ok: false, stage: "no-last-application",
        message: "\u201cUse My Previous/Last Application\u201d isn\u2019t offered here — you may need to apply manually on this company once first. The page is open for you." };
    }

    // Clicking it may open a Google sign-in popup.
    const popupP = ctx.waitForEvent("page", { timeout: 6000 }).catch(() => null);
    await usePrev.click({ timeout: 15000 }).catch(() => {});
    const popup = await popupP;
    if (popup && /google|accounts\.google|signin/i.test(popup.url())) {
      const res = await pickGoogleAccount(popup, email);
      if (res === "needs-password") return needPw();
      await page.waitForTimeout(2500);
    } else if (await isSignIn(page)) {
      const s = await ensureSignedIn(page, ctx, email);
      if (s.needsPassword) return needPw();
    }
    await page.waitForTimeout(2200);

    return await advanceToReview(page, autoSubmit);
  } catch (err) {
    return { ok: false, stage: "error", message: String(err?.message || err) };
  }
}

// --------------------------------------------------------------- Greenhouse

// Parse the board token + numeric job id out of a Greenhouse URL.
function parseGreenhouse(url = "") {
  const m = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (m && !/embed/i.test(m[1])) return { token: m[1], id: m[2] };
  let id = null;
  let token = null;
  const t = url.match(/[?&]token=(\d+)/i); // embedded form: token param == job id
  if (t) id = t[1];
  const j = url.match(/\/jobs\/(\d+)/i);
  if (!id && j) id = j[1];
  const b = url.match(/greenhouse\.io\/([^/?#]+)/i);
  if (b && !/embed|boards-api/i.test(b[1])) token = b[1];
  return id ? { token, id } : null;
}

// Fetch the public application schema (required flags + field names/types).
async function fetchGreenhouseQuestions(token, id) {
  if (!token || !id) return null;
  try {
    const r = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}?questions=true`,
      { timeout: 12000, validateStatus: () => true }
    );
    if (r.status === 200 && Array.isArray(r.data?.questions)) return r.data.questions;
  } catch {
    /* ignore — we still fill whatever is on the page */
  }
  return null;
}

const GH_STANDARD = new Set([
  "first_name", "last_name", "email", "phone",
  "resume", "resume_text", "cover_letter", "cover_letter_text",
]);

// Pure: turn the Greenhouse schema into a fill plan for the custom questions.
export function planGreenhouseAnswers(questions = []) {
  const plan = [];
  for (const q of questions) {
    const f = (q.fields || [])[0];
    if (!f) continue;
    const base = String(f.name).replace(/\[\]$/, "");
    if (GH_STANDARD.has(base)) continue; // handled separately
    let action = { kind: "unknown" };
    if (f.type === "input_text" || f.type === "textarea") {
      const ov = ANSWERS.textOverrides.find(([re]) => re.test(q.label));
      action = ov && ov[1] ? { kind: "text", value: ov[1] } : { kind: "text", value: "" };
    } else if (/select/i.test(f.type)) {
      const sa = ANSWERS.selectAnswers.find(([re]) => re.test(q.label));
      if (sa) action = { kind: "select", optionRe: sa[1] };
    }
    plan.push({ name: f.name, base, type: f.type, required: !!q.required, label: q.label, action });
  }
  return plan;
}

function labelRegex(label = "") {
  const head = label.slice(0, 28).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(head, "i");
}

async function ghFillText(scope, item, value) {
  for (const sel of [`#${item.base}`, `[name="${item.name}"]`, `[name="${item.base}"]`]) {
    const el = scope.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      await el.fill(value).catch(() => {});
      return true;
    }
  }
  try {
    const el = scope.getByLabel(labelRegex(item.label)).first();
    if (await el.count().catch(() => 0)) {
      await el.fill(value).catch(() => {});
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

// Derive a literal search string from an option regex so we can type-to-filter
// react-select menus (e.g. /^\s*yes/ -> "yes", /india/ -> "india"). Lookarounds
// are stripped so complex option regexes still yield a usable keyword.
function regexToType(re) {
  return re.source
    .replace(/\(\?[:!=][^)]*\)/g, "")
    .replace(/\\s\*|\\s\+|\^|\$|\\b|\.\*/g, "")
    .split("|")[0]
    .replace(/[\\()[\]{}?+*.]/g, "")
    .trim();
}

async function ghSelect(scope, item, optionRe) {
  // 1) native <select>
  for (const sel of [`select#${item.base}`, `select[name="${item.name}"]`, `select[name="${item.base}"]`]) {
    const el = scope.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      const opts = await el.locator("option").allTextContents().catch(() => []);
      const match = opts.find((o) => optionRe.test(o.trim()));
      if (match) {
        await el.selectOption({ label: match }).catch(() => {});
        return true;
      }
      return false;
    }
  }
  // 2) react-select combobox: the search input carries id = the field name.
  const input = scope.locator(`#${item.base}`).first();
  if (!(await input.count().catch(() => 0))) return false;
  const readVal = async () =>
    (await input
      .evaluate(
        (el) =>
          el.closest('[class*="select__control"]')?.querySelector('[class*="single-value"]')?.textContent?.trim() || ""
      )
      .catch(() => "")) || "";
  const opts = scope.locator('[class*="select__option"], [id*="react-select"][id*="option"]');
  const roleOpts = scope.locator('[role="option"]');
  const getOpts = async () =>
    (await opts.count().catch(() => 0)) ? opts : roleOpts;
  const clickBestMatch = async () => {
    const list = await getOpts();
    const n = Math.min(await list.count().catch(() => 0), 120);
    let bestIdx = -1, bestLen = Infinity;
    for (let i = 0; i < n; i++) {
      const txt = ((await list.nth(i).textContent().catch(() => "")) || "").trim();
      // shortest match so /india/ -> "India", not "British Indian Ocean Territory"
      if (txt && optionRe.test(txt) && txt.length < bestLen) {
        bestLen = txt.length;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      await list.nth(bestIdx).click().catch(() => {});
      await sleepMs(150);
      return true;
    }
    return false;
  };
  const openAndPick = async (typeStr) => {
    try {
      await input.scrollIntoViewIfNeeded().catch(() => {});
      await input.evaluate((el) => el.closest('[class*="select__control"]')?.click()).catch(() => {});
      await sleepMs(120);
      await input.click({ force: true }).catch(() => {});
      if (typeStr) await input.type(typeStr, { delay: 30 }).catch(() => {});
      await sleepMs(typeStr ? 450 : 250);
      if (await clickBestMatch()) return true;
      if (typeStr) await input.press("Enter").catch(() => {}); // accept top filtered option
      await sleepMs(120);
      return !!(await readVal());
    } catch {
      return false;
    }
  };
  // (a) open without typing — handles short lists incl. single-option consent
  //     selects whose only option is a full sentence.
  if (await openAndPick("")) return true;
  if (await readVal()) return true;
  // (b) retry with a typed filter — needed for long lists (e.g. country).
  const typeStr = regexToType(optionRe);
  if (typeStr && (await openAndPick(typeStr))) return true;
  if (await readVal()) return true;
  await input.press("Escape").catch(() => {});
  return false;
}

// intl-tel-input phone: type the full international number first so it auto-detects
// the country (India / +91), then re-enter just the 10-digit national number so the
// field shows 10 digits with the country code kept separate on the flag. Plain tel
// fields keep the full +91 number so it stays valid.
async function ghFillPhone(scope) {
  const digits = String(APPLICANT.phone).replace(/\D/g, "");
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : "91";
  const phone = scope
    .locator('#phone, input[type="tel"], input[name="job_application[phone]"]')
    .first();
  if (!(await phone.count().catch(() => 0))) return false;
  try {
    await phone.scrollIntoViewIfNeeded().catch(() => {});
    await phone.click().catch(() => {});
    await phone.fill(`+${cc}${national}`).catch(() => {});
    await sleepMs(400);
    const hasIti = await scope
      .locator('.iti__country-container, .iti__selected-country, .iti__selected-flag, .iti__flag-container')
      .count()
      .catch(() => 0);
    if (hasIti) {
      await phone.fill("").catch(() => {});
      await sleepMs(120);
      await phone.fill(national).catch(() => {});
    }
    // Close any open intl-tel-input country dropdown so its options don't leak
    // into later react-select fields.
    await phone.press("Escape").catch(() => {});
    await phone.evaluate((el) => el.blur()).catch(() => {});
    await sleepMs(120);
  } catch {
    await phone.fill(national).catch(() => {});
  }
  return true;
}

async function applyToGreenhouse(url, autoSubmit = false) {
  try {
    const gh = parseGreenhouse(url);
    const questions = gh ? await fetchGreenhouseQuestions(gh.token, gh.id) : null;

    const ctx = await getContext();
    const page = await ctx.newPage();
    await page.bringToFront().catch(() => {});
    // Company wrapper pages (e.g. stripe.com) can hide the form behind an
    // "Apply" click or a custom DOM. The canonical embedded application form
    // renders every field immediately, so navigate straight to it when we can
    // parse the board slug + job id; otherwise use the URL we were given.
    const embedUrl =
      gh?.token && gh?.id
        ? `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(gh.token)}&token=${gh.id}`
        : null;
    await page.goto(embedUrl || url, { waitUntil: "domcontentloaded", timeout: 45000 });

    const FIELD_SEL =
      '#first_name, input[autocomplete="given-name"], input[name="job_application[first_name]"]';

    const findFormScope = async (timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await page.locator(FIELD_SEL).count().catch(() => 0)) return page;
        for (const f of page.frames()) {
          if (/greenhouse/i.test(f.url()) && (await f.locator(FIELD_SEL).count().catch(() => 0)))
            return f;
        }
        await page.waitForTimeout(700);
      }
      return null;
    };

    let scope = await findFormScope(20000);
    if (!scope) {
      const applyLink = page
        .locator('a:has-text("Apply"), button:has-text("Apply"), #apply_button, a[href*="#app"]')
        .first();
      if (await applyLink.count().catch(() => 0)) {
        await applyLink.click().catch(() => {});
        await page.waitForTimeout(2000);
        scope = await findFormScope(12000);
      }
    }
    if (!scope) {
      return { ok: false, stage: "greenhouse-no-form",
        message: "Couldn\u2019t find the Greenhouse application fields on this page (it may use a custom flow or be slow to load). The page is open for you to apply manually." };
    }

    const filled = [];
    const fill = async (selectors, labelRe, value, label) => {
      for (const sel of selectors) {
        const el = scope.locator(sel).first();
        if (await el.count().catch(() => 0)) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.fill(value).catch(() => {});
          filled.push(label);
          return true;
        }
      }
      try {
        const el = scope.getByLabel(labelRe).first();
        if (await el.count().catch(() => 0)) {
          await el.fill(value).catch(() => {});
          filled.push(label);
          return true;
        }
      } catch {
        /* ignore */
      }
      return false;
    };

    // 1) standard fields
    await fill(['#first_name', 'input[autocomplete="given-name"]', 'input[name="job_application[first_name]"]'], /first name/i, APPLICANT.firstName, "First name");
    await fill(['#last_name', 'input[autocomplete="family-name"]', 'input[name="job_application[last_name]"]'], /last name/i, APPLICANT.lastName, "Last name");
    await fill(['#email', 'input[type="email"]', 'input[autocomplete="email"]', 'input[name="job_application[email]"]'], /email/i, APPLICANT.email, "Email");
    if (await ghFillPhone(scope)) filled.push("Phone");

    // 2) résumé
    let resumeNote = "";
    if (fs.existsSync(APPLICANT.resumePath)) {
      const fileInput = scope.locator('#resume[type="file"], input[type="file"]').first();
      if (await fileInput.count().catch(() => 0)) {
        await fileInput.setInputFiles(APPLICANT.resumePath).catch(() => {});
        filled.push("Résumé");
        await page.waitForTimeout(1800);
      } else {
        resumeNote = " (couldn\u2019t find the résumé upload field)";
      }
    } else {
      resumeNote = " (résumé file not found — check the path in applicant.js)";
    }

    // 2b) standard EEO / demographic selects (react-select comboboxes not in the
    // questions schema). Gender is determined from the applicant's name/résumé;
    // veteran/disability pick the favourable answer; ethnicity is declined. These
    // aren't used in hiring decisions and are easy to change at review.
    const stdSelects = [
      { base: "gender", name: "gender", label: "Gender", re: /^\s*male\b|^\s*man\b/i },
      { base: "hispanic_ethnicity", name: "hispanic_ethnicity", label: "Ethnicity", re: /decline|prefer not|don.?t wish|not hispanic/i },
      { base: "veteran_status", name: "veteran_status", label: "Veteran status", re: /not a (protected )?veteran|^\s*no\b/i },
      { base: "disability_status", name: "disability_status", label: "Disability status", re: /no,? i (do not|don).?t|don.?t have a disability|^\s*no\b/i },
    ];
    for (const s of stdSelects) {
      if (await ghSelect(scope, s, s.re)) filled.push(s.label);
    }

    // 2c) consent checkboxes — always give consent (privacy/terms/acknowledge/
    // opt-in), but never tick a negative "do not / opt-out / decline" box.
    try {
      const boxes = scope.locator('input[type="checkbox"]');
      const cnt = Math.min(await boxes.count().catch(() => 0), 25);
      for (let i = 0; i < cnt; i++) {
        const box = boxes.nth(i);
        if (await box.isChecked().catch(() => false)) continue;
        const txt = (
          (await box
            .evaluate((el) => {
              let t = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent || "" : "";
              t += " " + (el.closest("label")?.textContent || "");
              t += " " + (el.closest("div,li,fieldset,section")?.textContent || "").slice(0, 300);
              return t;
            })
            .catch(() => "")) || ""
        ).toLowerCase();
        if (!txt.trim()) continue;
        const positive = /consent|i agree|agree to|acknowledge|privacy (notice|policy|statement)|\bterms\b|authoriz|i confirm|read and (understood|agree)|opt.?in|permission/.test(txt);
        const negative = /do not|don.?t |opt.?out|decline|unsubscribe|withdraw|i disagree|not (consent|agree)/.test(txt);
        if (positive && !negative) {
          await box.check().catch(() => box.click({ force: true }).catch(() => {}));
          if (await box.isChecked().catch(() => false)) filled.push("Consent");
        }
      }
    } catch {
      /* ignore */
    }

    if (filled.length === 0) {
      return { ok: false, stage: "greenhouse-no-form",
        message: "Couldn\u2019t find the Greenhouse application fields on this page (it may use a custom flow). The page is open for you to apply manually." };
    }

    // 3) custom questions, driven by the public schema when available
    const plan = planGreenhouseAnswers(questions || []);
    const unanswered = [];
    for (const item of plan) {
      let done = false;
      if (item.action.kind === "text" && item.action.value) {
        done = await ghFillText(scope, item, item.action.value);
        if (done) filled.push(item.label.slice(0, 40));
      } else if (item.action.kind === "select") {
        done = await ghSelect(scope, item, item.action.optionRe);
        if (done) filled.push(item.label.slice(0, 40));
      }
      if (!done && item.required) unanswered.push(item.label);
    }

    await scope.locator(FIELD_SEL).first().scrollIntoViewIfNeeded().catch(() => {});

    // 4) submit — only when asked, and only if nothing required is left blank
    if (autoSubmit) {
      if (unanswered.length) {
        return { ok: false, stage: "greenhouse-needs-input",
          message: `Filled ${filled.length} field(s), but couldn\u2019t auto-answer ${unanswered.length} required question(s): ${unanswered.slice(0, 4).join("; ")}${unanswered.length > 4 ? "…" : ""}. Answer them in the open browser then Submit, or add them to ANSWERS in applicant.js.` };
      }
      const submitBtn = scope
        .locator('button[type="submit"], #submit_app, button:has-text("Submit application"), button:has-text("Submit Application"), input[type="submit"]')
        .first();
      if (!(await submitBtn.count().catch(() => 0))) {
        return { ok: true, stage: "greenhouse-filled",
          message: `Filled ${filled.length} field(s)${resumeNote}, but couldn\u2019t find the Submit button. Review and submit in the browser.` };
      }
      await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
      await submitBtn.click().catch(() => {});
      await page.waitForTimeout(3500);

      const confirmed =
        /confirmation|thank|submitted|received|success/i.test(page.url()) ||
        (await scope
          .locator('text=/thank you|application (has been )?(submitted|received)|we.?ve received|successfully/i')
          .count()
          .catch(() => 0)) > 0;
      if (confirmed) {
        return { ok: true, stage: "submitted",
          message: `Submitted your application to this Greenhouse role (${filled.length} field(s) filled). The confirmation is open in the browser.` };
      }
      const invalid = await scope
        .locator('[aria-invalid="true"], .field-error, .error, [class*="error"]')
        .count()
        .catch(() => 0);
      return { ok: false, stage: "greenhouse-validation",
        message: `Clicked Submit but the form still flags ${invalid || "some"} field(s) (a question we couldn\u2019t map, or a CAPTCHA). It\u2019s open in the browser — finish and Submit.` };
    }

    return { ok: true, stage: "greenhouse-filled",
      message: `Prefilled ${filled.length} field(s): ${filled.slice(0, 6).join(", ")}${filled.length > 6 ? "…" : ""}${resumeNote}.${unanswered.length ? ` ${unanswered.length} question(s) still need you (${unanswered.slice(0, 3).join("; ")}${unanswered.length > 3 ? "…" : ""}).` : ""} Review in the open browser and click Submit — I did NOT submit anything.` };
  } catch (err) {
    return { ok: false, stage: "error", message: String(err?.message || err) };
  }
}

// ------------------------------------------------------------------- router
export async function autoApply(url, provider = "", opts = {}) {
  const p = String(provider).toLowerCase();
  if (/myworkdayjobs\.com/i.test(url) || p === "workday") return applyToWorkday(url, !!opts.autoSubmit);
  if (p === "greenhouse" || /greenhouse\.io/i.test(url)) return applyToGreenhouse(url);
  return {
    ok: false,
    stage: "unsupported",
    message:
      "Auto-apply currently supports Workday and Greenhouse roles. For others, use the Apply \u2197 link.",
  };
}
