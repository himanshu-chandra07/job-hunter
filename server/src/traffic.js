// Visitor traffic capture with IP-based geolocation, aggregated by city and
// persisted to DATA_DIR/traffic.json (the Azure Files share in production).
// A client beacon (POST /api/track) records one hit per page load; the caller's
// IP (from X-Forwarded-For behind the Container Apps ingress) is resolved to a
// city via a free geo-IP service and the per-city counter is incremented.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "traffic.json");

const geo = axios.create({
  timeout: 8000,
  headers: { "User-Agent": "job-hunter-traffic/1.0", Accept: "application/json" },
});

// key (`city|region|country`) -> aggregate record
const cities = new Map();
// ip -> resolved key | "skip" | "pending"
const ipCache = new Map();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
      for (const c of data.cities || []) if (c && c.key) cities.set(c.key, c);
    }
  } catch {
    /* start empty */
  }
}
load();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          { cities: [...cities.values()], updatedAt: new Date().toISOString() },
          null,
          2
        )
      );
      fs.renameSync(tmp, FILE);
    } catch {
      /* ignore disk errors */
    }
  }, 3000);
}

function clientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  let ip = xff || req.socket?.remoteAddress || "";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

function isPrivate(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^(fe80:|f[cd])/i.test(ip)) return true;
  return false;
}

async function geolocate(ip) {
  try {
    const r = await geo.get(`https://ipwho.is/${ip}`, { validateStatus: () => true });
    const d = r.data;
    if (d && d.success && d.latitude != null) {
      return {
        city: d.city || "",
        region: d.region || "",
        country: d.country || "",
        countryCode: d.country_code || "",
        lat: Number(d.latitude),
        lon: Number(d.longitude),
      };
    }
  } catch {
    /* try fallback */
  }
  try {
    const r = await geo.get(`https://get.geojs.io/v1/ip/geo/${ip}.json`, {
      validateStatus: () => true,
    });
    const d = r.data;
    if (d && d.latitude != null) {
      return {
        city: d.city || "",
        region: d.region || "",
        country: d.country || "",
        countryCode: (d.country_code || "").toUpperCase(),
        lat: Number(d.latitude),
        lon: Number(d.longitude),
      };
    }
  } catch {
    /* give up */
  }
  return null;
}

function bump(key, g) {
  let c = cities.get(key);
  if (!c) {
    if (!g) return;
    c = {
      key,
      city: g.city || "Unknown",
      region: g.region || "",
      country: g.country || "",
      countryCode: g.countryCode || "",
      lat: g.lat,
      lon: g.lon,
      count: 0,
      lastSeen: null,
    };
    cities.set(key, c);
  }
  c.count += 1;
  c.lastSeen = new Date().toISOString();
  scheduleSave();
}

// Record one visit. Non-blocking: geolocation runs in the background.
export function trackHit(req) {
  const ip = clientIp(req);
  if (isPrivate(ip)) return;
  const cached = ipCache.get(ip);
  if (cached === "pending" || cached === "skip") return;
  if (cached) {
    bump(cached);
    return;
  }
  ipCache.set(ip, "pending");
  geolocate(ip)
    .then((g) => {
      if (!g || g.lat == null || isNaN(g.lat)) {
        ipCache.set(ip, "skip");
        return;
      }
      const key = `${g.city}|${g.region}|${g.country}`;
      ipCache.set(ip, key);
      bump(key, g);
    })
    .catch(() => ipCache.set(ip, "skip"));
}

// Aggregated distribution (newest-count first), with India broken out.
export function listTraffic() {
  const all = [...cities.values()].sort((a, b) => b.count - a.count);
  const total = all.reduce((s, c) => s + c.count, 0);
  const india = all.filter(
    (c) => c.countryCode === "IN" || /india/i.test(c.country || "")
  );
  const indiaTotal = india.reduce((s, c) => s + c.count, 0);
  return {
    total,
    indiaTotal,
    cityCount: all.length,
    cities: all,
    updatedAt: new Date().toISOString(),
  };
}
