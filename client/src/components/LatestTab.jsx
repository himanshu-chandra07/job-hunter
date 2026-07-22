import React, { useState, useEffect, useMemo } from "react";
import { fetchLatest } from "../api.js";
import JobCard from "./JobCard.jsx";
import { CITY_FILTERS } from "../cities.js";
import Select from "./Select.jsx";

export default function LatestTab({ onQueueApply, appliedIds, onToggleApplied }) {
  const [days, setDays] = useState(7);
  const [role, setRole] = useState("swe");
  const [showLinkedIn, setShowLinkedIn] = useState(true);
  const [cities, setCities] = useState([]);
  const [includeFintech, setIncludeFintech] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(opts = {}) {
    setLoading(true);
    setError("");
    try {
      const d = await fetchLatest({
        days,
        role,
        location: cities.length ? cities.join(", ") : "India",
        includeFintech,
        ...opts,
      });
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load once on first mount.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jobs = useMemo(() => {
    if (!data) return [];
    return data.jobs.filter((j) =>
      j.source === "linkedin" ? showLinkedIn : true
    );
  }, [data, showLinkedIn]);

  const updatedAgo = useMemo(() => {
    if (!data?.generatedAt) return null;
    const m = Math.floor((Date.now() - new Date(data.generatedAt)) / 60000);
    return m <= 0 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
  }, [data]);

  return (
    <div>
      <div className="search-panel">
        <div className="row">
          <div className="latest-title">
            Fresh {role === "pm" ? "product & program manager" : role === "tech" ? "tech" : role === "all" ? "" : "software-engineer"} roles
            {role === "pm" ? " (PM / TPM / Product Owner)" : role === "swe" ? " (SWE / SDE / MTS / Computer Scientist)" : ""}
            {" "}posted in the last{" "}
            <Select
              className="compact"
              ariaLabel="Time window"
              value={days}
              onChange={(v) => {
                setDays(v);
                load({ days: v });
              }}
              options={[
                { value: 3, label: "3 days" },
                { value: 7, label: "7 days" },
                { value: 14, label: "14 days" },
                { value: 30, label: "30 days" },
              ]}
            />{" "}
            across all live companies · {cities.length ? cities.join(", ") : "India"}
          </div>
          <button
            className="primary"
            disabled={loading}
            onClick={() => load({ refresh: true })}
          >
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
              checked={showLinkedIn}
              onChange={(e) => setShowLinkedIn(e.target.checked)}
            />
            Show LinkedIn jobs{" "}
            {data ? `(${data.linkedinCount})` : ""}
          </label>
          <label className="ctl checkbox">
            <input
              type="checkbox"
              checked={includeFintech}
              onChange={(e) => {
                const v = e.target.checked;
                setIncludeFintech(v);
                load({ includeFintech: v });
              }}
            />
            Include fintech (Goldman, Morgan Stanley, JPMorgan, Fidelity){" "}
            {data && data.includeFintech ? `(${data.fintechCount})` : ""}
          </label>
          {data && (
            <span className="muted-note">
              {data.companyCount} from company sites · updated {updatedAgo}
            </span>
          )}
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      {loading && !data && (
        <div className="notice">
          Scanning every company + LinkedIn for {role === "pm" ? "product / program manager" : "software-engineering"} roles posted this week…
          first run can take up to ~90s, then it's cached for 30 minutes.
        </div>
      )}

      {data && (
        <>
          <div className="result-meta">
            {jobs.length} roles shown · sorted newest first
            {data.linkedinError && showLinkedIn ? (
              <span className="warn-inline">
                {" "}
                · LinkedIn unavailable right now
              </span>
            ) : null}
          </div>
          {jobs.length === 0 ? (
            <div className="notice">
              No matching roles posted in the last {days} days. Try a wider
              window (14 to 30 days) or refresh.
            </div>
          ) : (
            <div className="grid">
              {jobs.map((j) => (
                <JobCard key={`${j.source}-${j.id}`} job={j} onQueueApply={onQueueApply} appliedIds={appliedIds} onToggleApplied={onToggleApplied} />
              ))}
            </div>
          )}
        </>
      )}

      {!data && !loading && !error && (
        <div className="empty">
          <p>Loading this week's {role === "pm" ? "product / program manager" : "software-engineering"} roles…</p>
        </div>
      )}
    </div>
  );
}
