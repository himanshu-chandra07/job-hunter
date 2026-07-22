import React, { useState, useEffect, useRef, useMemo } from "react";
import { fetchAts, parseResume } from "../api.js";
import { CITY_FILTERS } from "../cities.js";
import Combobox from "./Combobox.jsx";
import { useCompanies } from "../useCompanies.js";

function scoreClass(s) {
  if (s >= 80) return "score score--high";
  if (s >= 60) return "score score--mid";
  return "score score--low";
}

const LS_KEY = "atsResumeProfile";

export default function AtsTab() {
  const [name, setName] = useState("Stripe");
  const [location, setLocation] = useState("India");
  const [cities, setCities] = useState([]);
  const { companies } = useCompanies();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        value: c.name,
        label: c.name,
        hint: c.live ? c.provider : "career link",
        live: c.live,
      })),
    [companies]
  );

  // Uploaded resume profile (persisted locally so it survives tab switches).
  const [profile, setProfile] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parseWarning, setParseWarning] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (profile) localStorage.setItem(LS_KEY, JSON.stringify(profile));
    else localStorage.removeItem(LS_KEY);
  }, [profile]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setParseError("");
    setParseWarning("");
    setData(null);
    setError("");
    try {
      const res = await parseResume(file);
      setProfile({ ...res.profile, fileName: file.name });
      if (res.warning) setParseWarning(res.warning);
    } catch (err) {
      setParseError(err.message);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clearResume() {
    setProfile(null);
    setData(null);
    setParseError("");
    setParseWarning("");
  }

  async function run(e) {
    e?.preventDefault();
    if (!profile) {
      setError("Upload your resume first.");
      return;
    }
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const d = await fetchAts({
        name: name.trim(),
        location: cities.length ? cities.join(", ") : location,
        profile,
      });
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Step 1: upload a resume */}
      <div className="search-panel resume-panel">
        {!profile ? (
          <div className="resume-upload">
            <div>
              <strong>Score your resume</strong>
              <p className="muted-note">
                Upload your resume (PDF, DOCX, or TXT) to score it against a
                company's open roles. No sign-in needed.
              </p>
            </div>
            <label className={parsing ? "file-btn disabled" : "file-btn"}>
              {parsing ? "Reading…" : "Upload resume"}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={onFile}
                disabled={parsing}
                hidden
              />
            </label>
          </div>
        ) : (
          <div className="resume-loaded">
            <div className="resume-loaded-head">
              <span className="badge ok">Resume ready</span>
              {profile.fileName && (
                <span className="muted-note">{profile.fileName}</span>
              )}
              <span className="muted-note">
                ·{" "}
                {profile.yearsDetected
                  ? `${profile.years} yrs experience`
                  : "experience not detected"}{" "}
                · {profile.skills.length} skills
              </span>
              <button type="button" className="ghost sm" onClick={clearResume}>
                Replace
              </button>
            </div>
            {profile.skills.length > 0 && (
              <div className="skill-chips">
                {profile.skills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {parseError && (
          <div className="notice error" style={{ marginTop: 12 }}>
            {parseError}
          </div>
        )}
        {parseWarning && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            {parseWarning}
          </div>
        )}
      </div>

      {/* Step 2: pick a company */}
      <form className="search-panel" onSubmit={run}>
        <div className="row">
          <Combobox
            value={name}
            onChange={setName}
            onEnter={() => profile && run()}
            options={companyOptions}
            disabled={!profile}
            placeholder="Company to score your resume against (e.g. Stripe, Databricks, Bloomberg)"
          />
          <input
            className="ctl-input"
            style={{ maxWidth: 160 }}
            placeholder="Location"
            value={cities.length ? cities.join(", ") : location}
            disabled={cities.length > 0 || !profile}
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
                disabled={!profile}
              />
              {c} only
            </label>
          ))}
          <button className="primary" disabled={loading || !profile}>
            {loading ? "Scoring…" : "Score my resume"}
          </button>
        </div>
        {!profile && (
          <div className="row controls">
            <span className="muted-note">
              Upload a resume above to enable scoring.
            </span>
          </div>
        )}
      </form>

      {error && <div className="notice error">{error}</div>}

      {data && !data.resolved && (
        <div className="notice warn">
          {data.message}
          {data.careerUrl && (
            <>
              {" "}
              <a
                className="career-link"
                href={data.careerUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open career site ↗
              </a>
            </>
          )}
        </div>
      )}

      {data && data.resolved && (
        <>
          <div className="result-meta">
            {data.count} roles at <strong>{data.company}</strong> scored against
            your resume · sorted by ATS match
          </div>
          {data.rows.length === 0 ? (
            <div className="notice">No matching roles to score.</div>
          ) : (
            <div className="table-wrap">
              <table className="ats-table">
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>Job ID</th>
                    <th>Title</th>
                    <th>Location</th>
                    <th>Exp</th>
                    <th>Matched / Missing skills</th>
                    <th>Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.rawId}>
                      <td>
                        <span className={scoreClass(r.score)}>{r.score}</span>
                        {r.confidence === "low" && (
                          <span
                            className="conf"
                            title="Title-only source, lower confidence"
                          >
                            ~
                          </span>
                        )}
                      </td>
                      <td className="mono">{r.id}</td>
                      <td className="ttl">
                        {r.title}
                        <span className="prov">{r.provider}</span>
                      </td>
                      <td className="loc">{r.location || "-"}</td>
                      <td>{r.expLabel}</td>
                      <td className="skills">
                        {r.matched.length > 0 && (
                          <span className="ok">{r.matched.join(", ")}</span>
                        )}
                        {r.missing.length > 0 && (
                          <span className="miss">
                            {r.matched.length ? " · " : ""}
                            missing: {r.missing.join(", ")}
                          </span>
                        )}
                        {r.matched.length === 0 && r.missing.length === 0 && "-"}
                      </td>
                      <td>
                        <a
                          className="apply-btn sm"
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Apply ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!data && !loading && !error && profile && (
        <div className="empty">
          <p>
            Pick a company to score every open software-engineering role against
            your uploaded resume. Greenhouse/Ashby/Lever companies (Stripe,
            Databricks, Figma, OpenAI…) give the richest, description-based
            scores. Default location is India.
          </p>
        </div>
      )}
    </div>
  );
}
