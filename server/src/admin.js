// Admin authentication: scrypt password verification, stateless HMAC-signed
// session cookies, and time-limited password-reset tokens. Credentials live in
// DATA_DIR/admin.json (seeded once from env so the plaintext password is never
// stored in source or on disk in the clear).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "admin.json");

const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || "insecure-dev-secret-set-ADMIN_SESSION_SECRET";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const dk = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return `scrypt$${salt}$${dk}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, dk] = String(stored).split("$");
    if (scheme !== "scrypt" || !salt || !dk) return false;
    const calc = crypto.scryptSync(String(password), salt, 32).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(dk, "hex"), Buffer.from(calc, "hex"));
  } catch {
    return false;
  }
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function read() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    /* fall through */
  }
  return null;
}
function write(obj) {
  ensureDir();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, FILE);
}

// Load (or seed from env) the credential store.
function getStore() {
  let s = read();
  if (!s || !s.username || !s.passHash) {
    const username = (process.env.ADMIN_USER || "admin").toLowerCase();
    const passHash = process.env.ADMIN_PASS_HASH || ""; // already scrypt$salt$dk
    s = { username, passHash, updatedAt: new Date().toISOString() };
    if (passHash) write(s);
  }
  return s;
}

export function adminConfigured() {
  const s = getStore();
  return !!(s.username && s.passHash);
}

export function adminUsername() {
  return getStore().username;
}

export function getResetEmail() {
  return process.env.ADMIN_RESET_EMAIL || "admin@example.com";
}

export function verifyLogin(username, password) {
  const s = getStore();
  if (!s.username || !s.passHash) return false;
  if (String(username || "").trim().toLowerCase() !== s.username) return false;
  return verifyPassword(password, s.passHash);
}

// ---- stateless signed session ( base64url(payload).hmac ) ----
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function createSession(username) {
  return sign({ u: username, exp: Date.now() + SESSION_TTL_MS });
}

export function verifySession(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || Date.now() > p.exp) return null;
    return { username: p.u };
  } catch {
    return null;
  }
}

// ---- password reset ----
export function startReset() {
  const s = getStore();
  const token = crypto.randomBytes(24).toString("hex");
  s.resetHash = crypto.createHash("sha256").update(token).digest("hex");
  s.resetExpiry = Date.now() + RESET_TTL_MS;
  write(s);
  return { token, username: s.username, expiresInMin: RESET_TTL_MS / 60000 };
}

export function verifyReset(token) {
  const s = getStore();
  if (!s.resetHash || !s.resetExpiry || Date.now() > s.resetExpiry) return false;
  const h = crypto.createHash("sha256").update(String(token || "")).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(s.resetHash, "hex"));
  } catch {
    return false;
  }
}

export function resetPassword(token, newPassword) {
  if (!verifyReset(token)) return false;
  if (!newPassword || String(newPassword).length < 8)
    throw new Error("Password must be at least 8 characters.");
  const s = getStore();
  s.passHash = hashPassword(newPassword);
  delete s.resetHash;
  delete s.resetExpiry;
  s.updatedAt = new Date().toISOString();
  write(s);
  return true;
}
