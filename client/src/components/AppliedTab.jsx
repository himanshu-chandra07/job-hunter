import React, { useMemo } from "react";

const STAGES = [
  "Applied",
  "Application viewed",
  "OA / Assessment",
  "Recruiter screen",
  "Technical interview",
  "Onsite / Final",
  "Offer",
  "Rejected",
  "Withdrawn",
];

// Map each stage to a status-badge color class.
const STAGE_CLASS = {
  Applied: "s-applied",
  "Application viewed": "s-viewed",
  "OA / Assessment": "s-assessment",
  "Recruiter screen": "s-screen",
  "Technical interview": "s-interview",
  "Onsite / Final": "s-onsite",
  Offer: "s-offer",
  Rejected: "s-rejected",
  Withdrawn: "s-withdrawn",
};

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AppliedTab({ applied, onUpdate, onRemove }) {
  // Group applications by company, newest activity first.
  const groups = useMemo(() => {
    const map = new Map();
    for (const job of applied) {
      const key = job.company || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(job);
    }
    const arr = [...map.entries()].map(([company, jobs]) => {
      const sorted = [...jobs].sort(
        (a, b) =>
          new Date(b.statusAt || b.appliedAt) - new Date(a.statusAt || a.appliedAt)
      );
      const last = sorted[0];
      return { company, jobs: sorted, lastActivity: last.statusAt || last.appliedAt };
    });
    arr.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    return arr;
  }, [applied]);

  // Headline counts across all applications.
  const stats = useMemo(() => {
    const active = applied.filter(
      (j) => !["Rejected", "Withdrawn"].includes(j.status)
    ).length;
    const offers = applied.filter((j) => j.status === "Offer").length;
    return { total: applied.length, active, offers, companies: groups.length };
  }, [applied, groups]);

  if (!applied.length) {
    return (
      <section className="panel">
        <h2>Applied</h2>
        <p className="hint">
          No applications tracked yet. On the <strong>By Company</strong>,{" "}
          <strong>This Week</strong> or <strong>LinkedIn</strong> tabs, tick{" "}
          <em>Mark as applied</em> on any job card. It will show up here, grouped by
          company, where you can track its stage.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="applied-head">
        <h2>Applied</h2>
        <div className="applied-stats">
          <span className="badge">{stats.total} total</span>
          <span className="badge ok">{stats.active} active</span>
          {stats.offers > 0 && (
            <span className="badge" style={{ background: "#1c7c3c", color: "#fff" }}>
              {stats.offers} offer{stats.offers > 1 ? "s" : ""}
            </span>
          )}
          <span className="badge muted">{stats.companies} companies</span>
        </div>
      </div>

      <div className="applied-groups">
        {groups.map(({ company, jobs }) => (
          <details className="applied-group" key={company} open>
            <summary className="applied-bar">
              <span className="applied-co">{company}</span>
              <span className="applied-count">{jobs.length}</span>
              <span className="applied-last">
                last activity {fmtDate(jobs[0].statusAt || jobs[0].appliedAt)}
              </span>
            </summary>

            <div className="applied-list">
              {jobs.map((j) => (
                <div className="applied-row" key={j.id}>
                  <div className="applied-row-main">
                    <a
                      className="applied-title"
                      href={j.applyUrl || j.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {j.title} ↗
                    </a>
                    <div className="applied-meta">
                      {j.location && <span>{j.location}</span>}
                      {j.provider && <span>· {j.provider}</span>}
                      <span>· applied {fmtDate(j.appliedAt)}</span>
                      {j.statusAt && j.statusAt !== j.appliedAt && (
                        <span>· updated {fmtDate(j.statusAt)}</span>
                      )}
                    </div>
                  </div>

                  <div className="applied-row-actions">
                    <span
                      className={`status-badge ${STAGE_CLASS[j.status] || "s-applied"}`}
                    >
                      {j.status}
                    </span>
                    <select
                      className="status-select"
                      value={j.status}
                      onChange={(e) =>
                        onUpdate(j.id, {
                          status: e.target.value,
                          statusAt: new Date().toISOString(),
                        })
                      }
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      className="link-btn danger"
                      title="Remove from tracker"
                      onClick={() => onRemove(j.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
