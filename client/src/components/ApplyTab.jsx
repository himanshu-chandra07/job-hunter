import React, { useState } from "react";
import { applyToJob } from "../api.js";

function parseUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (/myworkdayjobs\.com/i.test(host)) {
      const tenant = host.split(".")[0];
      const m = u.pathname.match(/\/job\/([^/]+)\/([^/]+)/i);
      let title = "";
      let location = "";
      if (m) {
        location = decodeURIComponent(m[1]).replace(/-/g, " ");
        title = decodeURIComponent(m[2]).replace(/_[A-Za-z0-9-]+$/, "").replace(/-/g, " ");
      }
      return { company: cap(tenant), title, location, provider: "Workday", supported: true };
    }
    if (/greenhouse\.io/i.test(host)) {
      const seg = u.pathname.split("/").filter(Boolean);
      return { company: cap(seg[0] || ""), title: "", location: "", provider: "Greenhouse", supported: true };
    }
    return { company: host, title: "", location: "", provider: "Other", supported: false };
  } catch {
    return { company: "", title: "", location: "", provider: "Other", supported: false };
  }
}
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

const STATE_CLASS = { running: "warn", done: "ok", attention: "warn" };

export default function ApplyTab({ queue, setQueue }) {
  const [url, setUrl] = useState("");
  const [statuses, setStatuses] = useState({});
  const [autoSubmit, setAutoSubmit] = useState(false);

  function add(raw) {
    const clean = (raw ?? url).trim();
    if (!clean) return;
    if (queue.some((j) => j.url === clean)) {
      setUrl("");
      return;
    }
    setQueue([{ url: clean, ...parseUrl(clean) }, ...queue]);
    setUrl("");
  }

  function remove(u) {
    setQueue(queue.filter((j) => j.url !== u));
  }

  async function apply(job) {
    setStatuses((s) => ({
      ...s,
      [job.url]: { state: "running", message: "Opening browser… watch for a new window." },
    }));
    try {
      const r = await applyToJob(job.applyUrl || job.url, job.provider, autoSubmit);
      const modeNote =
        r.mode === "separate-browser"
          ? " · (used a separate browser. To use your logged-in Chrome, fully close Chrome and retry)"
          : r.mode === "chrome-tab"
          ? " · (opened in your Chrome)"
          : "";
      setStatuses((s) => ({
        ...s,
        [job.url]: {
          state: r.ok ? "done" : "attention",
          stage: r.stage,
          message: (r.message || r.error || "Done.") + modeNote,
        },
      }));
    } catch (e) {
      setStatuses((s) => ({ ...s, [job.url]: { state: "attention", message: e.message } }));
    }
  }

  return (
    <div>
      <div className="notice warn" style={{ marginBottom: 14 }}>
        <strong>How auto-apply works.</strong> It opens a <strong>new tab in your Chrome</strong>
        {" "}(using your logged-in profile). <strong>If Chrome is already open, fully close it
        first</strong>. Chrome can only be controlled when (re)launched with a debug port, so I
        reopen your Chrome (with your Gmail login) and work in a new tab. If that isn’t possible
        it falls back to a separate browser where you sign in once.
        <br />
        <strong>• Workday</strong> (Adobe, NVIDIA…): clicks Apply → “Use My Previous/Last
        Application”, picks your configured Google account at the popup,
        and goes to review. <strong>Auto-submit is OFF by default</strong> (toggle below) so it
        stops for you to submit.
        <br />
        <strong>• Greenhouse</strong> (Stripe, Databricks…): <strong>no login</strong>. One-click
        prefill — it opens the application form and fills your name, email, phone, résumé
        and every screening question it can map (work authorization, degree, EEO, employer,
        LinkedIn…) from <code>applicant.js</code>, then <strong>stops at Submit</strong>.
        Review anything it flags as still needing you, then click Submit yourself.
      </div>

      <form
        className="search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="row">
          <input
            className="grow"
            placeholder="Paste a Workday or Greenhouse job URL, or click Auto-apply on a job card"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="primary" type="submit">
            Add to queue
          </button>
        </div>
        <div className="row controls">
          <label className="ctl checkbox">
            <input
              type="checkbox"
              checked={autoSubmit}
              onChange={(e) => setAutoSubmit(e.target.checked)}
            />
            <strong>Auto-submit (Workday)</strong>: actually click Submit at the end.
            Off = stop at review so you submit. <em>Irreversible, use carefully.</em>
          </label>
        </div>
      </form>

      {queue.length === 0 ? (
        <div className="empty">
          <p>
            No jobs queued yet. Paste a Workday/Greenhouse job URL above, or browse the By
            Company / This Week tabs and click <strong>Auto-apply</strong> on a Workday or
            Greenhouse role.
          </p>
        </div>
      ) : (
        <div className="grid">
          {queue.map((job) => {
            const st = statuses[job.url];
            const provider = job.provider || (job.isWorkday ? "Workday" : "Other");
            const supported =
              job.supported ?? ["Workday", "Greenhouse"].includes(provider);
            return (
              <div className="card" key={job.url}>
                <div className="card-main">
                  <div className="card-head">
                    <h3 className="job-title">{job.title || job.url}</h3>
                    <span className={`pill provider-${provider.toLowerCase()}`}>
                      {provider}
                    </span>
                  </div>
                  <div className="job-company">
                    {job.company}
                    {job.location ? <span className="dot">•</span> : null}
                    {job.location && <span className="job-loc">{job.location}</span>}
                  </div>
                  {st && (
                    <div className={`apply-status ${STATE_CLASS[st.state] || ""}`}>
                      {st.state === "running" ? "⏳ " : st.state === "done" ? "✓ " : "⚠ "}
                      {st.message}
                    </div>
                  )}
                  {!supported && (
                    <div className="apply-status warn">
                      Auto-apply supports Workday & Greenhouse. Use the Apply ↗ link for this
                      one.
                    </div>
                  )}
                  <div className="badges" style={{ marginTop: 10 }}>
                    <a className="career-link" href={job.url} target="_blank" rel="noreferrer">
                      Open posting ↗
                    </a>
                    <span className="dot">•</span>
                    <a
                      className="career-link"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        remove(job.url);
                      }}
                    >
                      Remove
                    </a>
                  </div>
                </div>
                <button
                  className="apply-btn"
                  disabled={!supported || st?.state === "running"}
                  onClick={() => apply(job)}
                >
                  {st?.state === "running" ? "Applying…" : "Auto-apply ▸"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
