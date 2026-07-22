import React, { useState, useEffect, useMemo } from "react";
import { fetchToday, peekToday } from "../api.js";
import JobCard from "./JobCard.jsx";
import { CITY_FILTERS } from "../cities.js";
import Select from "./Select.jsx";

export default function TodayTab({ onQueueApply, appliedIds, onToggleApplied }) {
  const [cities, setCities] = useState([]);
  const [role, setRole] = useState("swe");
  const [includeLinkedIn, setIncludeLinkedIn] = useState(false); // default OFF
  const [includeInstahyre, setIncludeInstahyre] = useState(false); // default OFF
  // Seed from the background prefetch (warmed while on the landing page) so the
  // tab renders instantly with no loading flash when it matches the defaults.
  const [data, setData] = useState(() =>
    peekToday({ location: "India", role: "swe", includeLinkedIn: false, includeInstahyre: false })
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(opts = {}) {
    setLoading(true);
    setError("");
    try {
      const d = await fetchToday({
        location: cities.length ? cities.join(", ") : "India",
        role,
        includeLinkedIn,
        includeInstahyre,
        ...opts,
      });
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!data) load(); // already have warmed data → render instantly, skip refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updatedAgo = useMemo(() => {
    if (!data?.generatedAt) return null;
    const m = Math.floor((Date.now() - new Date(data.generatedAt)) / 60000);
    return m <= 0 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
  }, [data]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div>
      <div className="search-panel">
        <div className="row">
          <div className="latest-title">
            {role === "pm" ? "Product & program manager" : "Software-engineer"} roles <strong>posted today</strong> ({today}) across all
            company career sites · {cities.length ? cities.join(", ") : "India"}
          </div>
          <button className="primary" disabled={loading} onClick={() => load({ refresh: true })}>
            {loading ? "Scanning…" : "Refresh"}
          </button>
        </div>
        <div className="row controls">
          <label className="ctl">
            Mode
            <Select
              className="compact"
              ariaLabel="Role mode"
              value={role}
              onChange={(v) => {
                setRole(v);
                load({ role: v });
              }}
              options={[
                { value: "swe", label: "Software Engineer" },
                { value: "pm", label: "Product / Program Manager" },
                { value: "tech", label: "All tech" },
                { value: "all", label: "Everything" },
              ]}
            />
          </label>
          {CITY_FILTERS.map((c) => (
            <label key={c} className="ctl checkbox">
              <input
                type="checkbox"
                checked={cities.includes(c)}
                onChange={() => {
                  const next = cities.includes(c)
                    ? cities.filter((x) => x !== c)
                    : [...cities, c];
                  setCities(next);
                  load({ location: next.length ? next.join(", ") : "India" });
                }}
              />
              {c} only
            </label>
          ))}
          <label className="ctl checkbox">
            <input
              type="checkbox"
              checked={includeLinkedIn}
              onChange={(e) => {
                const v = e.target.checked;
                setIncludeLinkedIn(v);
                load({ includeLinkedIn: v });
              }}
            />
            LinkedIn Easy Apply only{" "}
            {data && data.includeLinkedIn ? `(${data.linkedinCount})` : ""}
          </label>
          <label className="ctl checkbox">
            <input
              type="checkbox"
              checked={includeInstahyre}
              onChange={(e) => {
                const v = e.target.checked;
                setIncludeInstahyre(v);
                load({ includeInstahyre: v });
              }}
            />
            Instahyre (easy apply){" "}
            {data && data.includeInstahyre ? `(${data.instahyreCount})` : ""}
          </label>
          {data && (
            <span className="muted-note">
              {data.companyCount} posted today · updated {updatedAgo}
            </span>
          )}
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      {loading && !data && (
        <div className="notice">
          Scanning every company career site for roles posted today… the first run can
          take up to ~90s. After that it loads instantly and refreshes in the background.
        </div>
      )}

      {data && (
        <>
          <div className="result-meta">
            {data.jobs.length} roles · company sites posted today
            {data.includeLinkedIn ? ` · ${data.linkedinCount} LinkedIn Easy Apply` : ""}
            {data.includeInstahyre ? ` · ${data.instahyreCount} Instahyre` : ""}
            {data.includeInstahyre && (
              <span className="warn-inline">
                {" "}· Instahyre roles are latest easy-apply listings (no post date)
              </span>
            )}
          </div>
          {data.jobs.length === 0 ? (
            <div className="notice">
              No {role === "pm" ? "product / program manager" : "software-engineering"} roles posted today yet
              {!includeLinkedIn && !includeInstahyre
                ? ". Turn on LinkedIn Easy Apply or Instahyre for more, or check back later."
                : ". Check back later or refresh."}
            </div>
          ) : (
            <div className="grid">
              {data.jobs.map((j) => (
                <JobCard
                  key={`${j.source}-${j.id}`}
                  job={j}
                  onQueueApply={onQueueApply}
                  appliedIds={appliedIds}
                  onToggleApplied={onToggleApplied}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
