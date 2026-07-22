import React, { useState } from "react";
import { fetchLinkedIn } from "../api.js";
import JobCard from "./JobCard.jsx";
import { CITY_FILTERS } from "../cities.js";
import Select from "./Select.jsx";

export default function LinkedInTab({ onQueueApply, appliedIds, onToggleApplied }) {
  const [titles, setTitles] = useState("");
  const [location, setLocation] = useState("India");
  const [cities, setCities] = useState([]);
  const [pages, setPages] = useState(2);
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function search(e) {
    e?.preventDefault();
    if (!titles.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchLinkedIn({
        titles,
        location: cities.length ? cities.join(", ") : location,
        pages,
        roleFilter,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form className="search-panel" onSubmit={search}>
        <div className="row">
          <input
            className="grow"
            placeholder="Job titles, comma separated (e.g. Data Engineer, ML Engineer, Backend Engineer)"
            value={titles}
            onChange={(e) => setTitles(e.target.value)}
          />
          <button className="primary" disabled={loading}>
            {loading ? "Searching…" : "Search LinkedIn"}
          </button>
        </div>
        <div className="row controls">
          <input
            className="ctl-input"
            placeholder="Location (e.g. United States, Remote, Bengaluru)"
            value={cities.length ? cities.join(", ") : location}
            disabled={cities.length > 0}
            onChange={(e) => setLocation(e.target.value)}
          />
          {CITY_FILTERS.map((c) => (
            <label key={c} className="ctl checkbox">
              <input
                type="checkbox"
                checked={cities.includes(c)}
                onChange={() =>
                  setCities((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                  )
                }
              />
              {c} only
            </label>
          ))}
          <label className="ctl">
            Depth
            <Select
              ariaLabel="Search depth"
              value={pages}
              onChange={setPages}
              options={[
                { value: 1, label: "1 page / title" },
                { value: 2, label: "2 pages / title" },
                { value: 3, label: "3 pages / title" },
                { value: 4, label: "4 pages / title" },
              ]}
            />
          </label>
          <label className="ctl">
            Roles
            <Select
              ariaLabel="Role filter"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: "all", label: "All matching titles" },
                { value: "swe", label: "Software Engineer (core)" },
                { value: "pm", label: "Product / Program Manager" },
                { value: "tech", label: "All tech roles" },
              ]}
            />
          </label>
        </div>
      </form>

      {error && <div className="notice error">{error}</div>}

      {result && (
        <>
          <div className="result-meta">
            {result.count} postings for{" "}
            <strong>{result.titles.join(", ")}</strong> · {result.location}
            {result.errors?.length ? (
              <span className="warn-inline">
                {" "}
                · {result.errors.length} title(s) failed
              </span>
            ) : null}
          </div>
          {result.jobs.length === 0 ? (
            <div className="notice">
              No postings returned. LinkedIn rate-limits guest searches, so try
              again in a moment, reduce depth, or change the location.
            </div>
          ) : (
            <div className="grid">
              {result.jobs.map((j) => (
                <JobCard key={j.id} job={j} onQueueApply={onQueueApply} appliedIds={appliedIds} onToggleApplied={onToggleApplied} />
              ))}
            </div>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <div className="empty">
          <p>
            List the job titles you're after. We'll pull matching live postings
            from LinkedIn's public search and give you a direct apply link for
            each.
          </p>
        </div>
      )}
    </div>
  );
}
