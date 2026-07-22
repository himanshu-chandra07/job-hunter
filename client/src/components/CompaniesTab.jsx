import React, { useState, useMemo } from "react";
import { useCompanies } from "../useCompanies.js";

export default function CompaniesTab({ onOpen }) {
  const { companies, loading, error } = useCompanies();
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("all"); // all | live | greenhouse | link

  const isGreenhouse = (c) => (c.provider || "").toLowerCase() === "greenhouse";

  const filtered = useMemo(() => {
    const f = filter.toLowerCase().trim();
    return companies.filter((c) => {
      if (status === "live" && !c.live) return false;
      if (status === "link" && c.live) return false;
      if (status === "greenhouse" && !isGreenhouse(c)) return false;
      if (f && !c.name.toLowerCase().includes(f)) return false;
      return true;
    });
  }, [companies, filter, status]);

  const liveCount = companies.filter((c) => c.live).length;
  const greenhouseCount = companies.filter(isGreenhouse).length;

  return (
    <div>
      <div className="search-panel">
        <div className="row">
          <input
            className="grow"
            placeholder="Filter companies…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="seg">
            {[
              ["all", "All"],
              ["live", "Live jobs"],
              ["greenhouse", "Greenhouse · easy apply"],
              ["link", "Link only"],
            ].map(([s, label]) => (
              <button
                key={s}
                type="button"
                className={status === s ? "seg-btn active" : "seg-btn"}
                onClick={() => setStatus(s)}
                title={
                  s === "greenhouse"
                    ? "Companies on Greenhouse — quick apply, no login required"
                    : undefined
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="row controls">
          <span>
            {companies.length} companies · {liveCount} with live jobs ·{" "}
            {greenhouseCount} on Greenhouse (easy apply) · click a card to load
            its roles in the By Company tab
          </span>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      {loading ? (
        <div className="notice">Loading companies…</div>
      ) : (
        <div className="company-grid">
          {filtered.map((c) => (
            <div
              key={c.name}
              className={c.live ? "company-card" : "company-card dim"}
              onClick={() => c.live && onOpen(c.name)}
              role={c.live ? "button" : undefined}
            >
              <div className="company-head">
                <span className="company-name">{c.name}</span>
                {c.sector === "fintech" && (
                  <span className="pill sector-fintech">Fintech</span>
                )}
                {c.live ? (
                  <span className={`pill provider-${(c.provider || "").toLowerCase()}`}>
                    {c.provider}
                  </span>
                ) : (
                  <span className="pill">link only</span>
                )}
                {isGreenhouse(c) && (
                  <span className="badge easy-apply" title="On Greenhouse — quick apply, no login">
                    ⚡ Easy apply
                  </span>
                )}
              </div>
              <div className="company-sub">
                {c.live ? `~${c.jobs} open roles` : "Proprietary portal"}
              </div>
              <div className="company-actions">
                {c.live ? (
                  <button
                    className="apply-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(c.name);
                    }}
                  >
                    View jobs →
                  </button>
                ) : (
                  <span className="muted-note">browse directly</span>
                )}
                <a
                  className="career-link"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Career site ↗
                </a>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="notice">No companies match that filter.</div>
          )}
        </div>
      )}
    </div>
  );
}
