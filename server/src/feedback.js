// Persistent storage for user-submitted feedback & suggestions.
// Backed by a single JSON file (DATA_DIR/feedback.json) so submissions survive
// server restarts. No login is required to submit; entries are append-only and
// written atomically.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "feedback.json");

export const CATEGORIES = ["Suggestion", "Bug", "Praise", "Other"];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  ensureDir();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE); // atomic replace
  return list;
}

const clean = (v, max) => String(v ?? "").trim().slice(0, max);

// Append a feedback entry. Throws if the message is empty. Returns the record.
export function addFeedback(input = {}) {
  const message = clean(input.message, 4000);
  if (!message) throw new Error("Message is required.");
  let category = clean(input.category, 40);
  if (!CATEGORIES.includes(category)) category = "Suggestion";
  const entry = {
    id: `fb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    category,
    message,
    name: clean(input.name, 120),
    contact: clean(input.contact, 200),
    createdAt: new Date().toISOString(),
  };
  const list = readAll();
  list.push(entry);
  writeAll(list);
  return entry;
}

// Newest first. When includeContact is false the name/contact fields are
// stripped, so the list can be exposed without leaking submitters' details.
export function listFeedback({ includeContact = false } = {}) {
  const list = [...readAll()].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  if (includeContact) return list;
  return list.map(({ name, contact, ...rest }) => rest);
}
