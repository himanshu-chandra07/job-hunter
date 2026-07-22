// Persistent storage for the user's tracked job applications.
// Backed by a single JSON file (server/data/applied.json) so the data survives
// server restarts and browser/localStorage clears. Written atomically.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "applied.json");

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

// Newest activity first (status change, else applied date).
function sorted(list) {
  return [...list].sort(
    (a, b) =>
      new Date(b.statusAt || b.appliedAt || 0) -
      new Date(a.statusAt || a.appliedAt || 0)
  );
}

// Normalize an incoming job into a stored applied-record.
function toRecord(job = {}, base = {}) {
  const now = new Date().toISOString();
  return {
    id: job.id ?? base.id,
    url: job.url || job.applyUrl || base.url || "",
    applyUrl: job.applyUrl || job.url || base.applyUrl || "",
    title: job.title || base.title || "",
    company: job.company || base.company || "",
    location: job.location || base.location || "",
    provider: job.provider || base.provider || "",
    appliedAt: base.appliedAt || job.appliedAt || now,
    status: job.status || base.status || "Applied",
    statusAt: base.statusAt || job.statusAt || now,
  };
}

export function listApplied() {
  return sorted(readAll());
}

// Toggle a job's tracked state: add it if absent, remove it if present.
// Returns { jobs, applied } where `applied` is the new tracked state.
export function toggleApplied(job) {
  const list = readAll();
  const i = list.findIndex((j) => j.id === job.id);
  if (i !== -1) {
    list.splice(i, 1);
    writeAll(list);
    return { jobs: sorted(list), applied: false };
  }
  list.unshift(toRecord(job));
  writeAll(list);
  return { jobs: sorted(list), applied: true };
}

export function updateApplied(id, changes = {}) {
  const list = readAll();
  const i = list.findIndex((j) => j.id === id);
  if (i === -1) return sorted(list);
  list[i] = { ...list[i], ...changes };
  return sorted(writeAll(list));
}

export function removeApplied(id) {
  return sorted(writeAll(readAll().filter((j) => j.id !== id)));
}

// Merge an incoming set of records, keeping existing ones untouched.
// Used to migrate any pre-existing localStorage entries into the backend.
export function importApplied(jobs = []) {
  const list = readAll();
  const byId = new Set(list.map((j) => j.id));
  for (const job of jobs) {
    if (!job || job.id == null || byId.has(job.id)) continue;
    list.push(toRecord(job, job));
    byId.add(job.id);
  }
  return sorted(writeAll(list));
}
