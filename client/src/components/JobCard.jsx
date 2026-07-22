import React from "react";
import { IS_LOCAL } from "../api.js";

function timeAgo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const m = Math.floor(days / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

// Derive a clean job ID from the internal id. ATS adapters store ids as
// "<provider>-<realId>"; Workday/Avature are compound ("prefix-tenant-realId").
function jobId(job) {
  const raw = String(job.id || "");
  if (/^(wd|av)-/.test(raw)) return raw.split("-").pop() || raw;
  return raw.replace(/^[a-z]+-/, "") || raw;
}

function JobCard({ job, onQueueApply, appliedIds, onToggleApplied }) {
  const posted = timeAgo(job.postedAt);
  const jid = jobId(job);
  const isApplied = appliedIds ? appliedIds.has(job.id) : false;
  return (
    <div className="card">
      <div className="card-main">
        <div className="card-head">
          <h3 className="job-title">{job.title}</h3>
          <span className={`pill provider-${job.provider?.toLowerCase()}`}>
            {job.provider}
          </span>
        </div>
        <div className="job-company">
          {job.company}
          {job.location ? <span className="dot">•</span> : null}
          {job.location && <span className="job-loc">{job.location}</span>}
        </div>
        <div className="badges">
          {job.easyApply && (
            <span className="badge easy-apply" title="Quick one-click / Easy Apply">
              ⚡ Easy Apply
            </span>
          )}
          {job.experience && (
            <span
              className={`badge exp ${job.match ? "exp-match" : ""}`}
              title={
                job.experience.source === "seniority"
                  ? "Estimated from the job title. The description doesn't state a number"
                  : `From the job description: “${job.experience.raw}”`
              }
            >
              {job.experience.label}
              {job.experience.source === "seniority" ? " (est. from title)" : ""}
            </span>
          )}
          {job.experience == null && (
            <span className="badge exp-unknown" title="No experience requirement stated in the job description">
              YOE not specified
            </span>
          )}
          {job.department && <span className="badge">{job.department}</span>}
          {job.searchedTitle && (
            <span className="badge match-term">“{job.searchedTitle}”</span>
          )}
          {posted ? (
            <span className="badge muted">{posted}</span>
          ) : job.postedText ? (
            <span className="badge muted">{job.postedText}</span>
          ) : null}
          {jid ? (
            <span className="badge job-id" title={`Job ID: ${jid}`}>
              ID {jid}
            </span>
          ) : null}
        </div>
        {onToggleApplied && (
          <label className={`applied-check ${isApplied ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={isApplied}
              onChange={() => onToggleApplied(job)}
            />
            {isApplied ? "✓ Applied (tracked)" : "Mark as applied"}
          </label>
        )}
      </div>
      <div className="card-actions">
        <a className="apply-btn" href={job.url} target="_blank" rel="noreferrer">
          Apply ↗
        </a>
        {IS_LOCAL && onQueueApply && ["Workday", "Greenhouse"].includes(job.provider) && (
          <button
            className="apply-btn ghost"
            title="Queue for assisted auto-apply (fills the form / Use My Last Application; you submit)"
            onClick={() => onQueueApply(job)}
          >
            Auto-apply
          </button>
        )}
      </div>
    </div>
  );
}

const isApplied = (p) => (p.appliedIds ? p.appliedIds.has(p.job.id) : false);

// Memoized so toggling one job's applied state only re-renders that card, not
// the whole list (which can be hundreds of cards).
export default React.memo(
  JobCard,
  (prev, next) =>
    prev.job === next.job &&
    prev.onQueueApply === next.onQueueApply &&
    prev.onToggleApplied === next.onToggleApplied &&
    isApplied(prev) === isApplied(next)
);
