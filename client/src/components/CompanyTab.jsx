import React, { useState, useEffect, useMemo } from "react";
import { fetchCompany } from "../api.js";
import JobCard from "./JobCard.jsx";
import { CITY_FILTERS } from "../cities.js";
import Combobox from "./Combobox.jsx";
import Select from "./Select.jsx";
import { useCompanies } from "../useCompanies.js";

export default function CompanyTab({ picked, onQueueApply, appliedIds, onToggleApplied }) {
  const [name, setName] = useState("");
  const [min, setMin] = useState(3);
  const [max, setMax] = useState(10);
  const [includeUnknown, setIncludeUnknown] = useState(true);
  const [roleFilter, setRoleFilter] = useState("swe");
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("India");
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const { companies } = useCompanies();

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        value: c.name,
        label: c.name,
        hint: c.live ? `${c.provider} · ~${c.jobs}` : "career link",
        live: c.live,
      })),
    [companies]
  );

  async function runSearch(searchName, overrides = {}) {
    const target = (searchName ?? name).trim();
    if (!target) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchCompany({
        name: target,
        min,
        max,
        includeUnknown,
        roleFilter,
        q,
        location: cities.length ? cities.join(", ") : location,
        ...overrides,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function search(e) {
    e?.preventDefault();
    runSearch(name);
  }

  // When a company is picked from the Companies tab, load it here.
  useEffect(() => {
    if (picked?.name) {
      setName(picked.name);
      runSearch(picked.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.ts]);

  return (
    <div>
      <form className="search-panel" onSubmit={search}>
        <div className="row">
          <Combobox
            value={name}
            onChange={setName}
            onPick={(o) => runSearch(o.value)}
            onEnter={() => runSearch(name)}
            options={companyOptions}
            placeholder="Pick or type a company (e.g. Adobe, Stripe, Nvidia)…"
          />
          <button className="primary" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                Searching…
              </>
            ) : (
              "Find jobs"
            )}
          </button>
        </div>
        <div className="row controls">
          <label className="ctl">
            Experience
            <span className="range">
              <input
                type="number"
                min="0"
                max="50"
                value={min}
                onChange={(e) => setMin(Number(e.target.value))}
              />
              <span>to</span>
              <input
                type="number"
                min="0"
                max="50"
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
              />
              yrs
            </span>
          </label>
          <input
            className="ctl-input"
            placeholder="Filter title (e.g. engineer)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <input
            className="ctl-input"
            placeholder="Location contains…"
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
            Roles
            <Select
              ariaLabel="Role filter"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: "swe", label: "Software Engineer (core)" },
                { value: "pm", label: "Product / Program Manager" },
                { value: "tech", label: "All tech roles" },
                { value: "all", label: "Everything" },
              ]}
            />
          </label>
          <label className="ctl checkbox">
            <input
              type="checkbox"
              checked={includeUnknown}
              onChange={(e) => setIncludeUnknown(e.target.checked)}
            />
            Include jobs without stated experience
          </label>
        </div>
      </form>

      {error && <div className="notice error">{error}</div>}

      {result && !result.resolved && (
        <div className="notice warn">
          {result.message}
          {result.careerUrl && (
            <>
              {" "}
              <a
                className="career-link"
                href={result.careerUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open {result.company || "career"} site ↗
              </a>
            </>
          )}
        </div>
      )}

      {result && result.resolved && (
        <>
          <div className="result-meta">
            <strong>{result.company}</strong> · matched on{" "}
            <code>{result.slug || "career site"}</code> via{" "}
            {result.providers.join(", ")} · {result.stats.returned} shown (
            {result.stats.total} open, {result.stats.role} matching roles,{" "}
            {result.stats.matched} in range)
            {result.stale && (
              <span className="warn-inline"> · showing recent cached results</span>
            )}
            {result.careerUrl && (
              <>
                {" · "}
                <a
                  className="career-link"
                  href={result.careerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  career site ↗
                </a>
              </>
            )}
          </div>
          {result.jobs.length === 0 ? (
            <div className="notice">
              No matching roles in the {min} to {max} yr range. Widen the range,
              switch Roles to "All tech" or "Everything", or enable "include jobs
              without stated experience".
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
            Pick a company from the dropdown (or type any name) to pull its live
            openings from public job boards and its own career site, filtered to
            core software-engineering roles in your experience range. Default
            location is India.
          </p>
        </div>
      )}
    </div>
  );
}
