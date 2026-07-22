import React, { useState, useEffect, useMemo, useCallback } from "react";
import CompanyTab from "./components/CompanyTab.jsx";
import LinkedInTab from "./components/LinkedInTab.jsx";
import CompaniesTab from "./components/CompaniesTab.jsx";
import LatestTab from "./components/LatestTab.jsx";
import TodayTab from "./components/TodayTab.jsx";
import AtsTab from "./components/AtsTab.jsx";
import ApplyTab from "./components/ApplyTab.jsx";
import AppliedTab from "./components/AppliedTab.jsx";
import FeedbackWidget from "./components/FeedbackWidget.jsx";
import { prefetchToday, IS_LOCAL } from "./api.js";

function makeAppliedEntry(job) {
  const now = new Date().toISOString();
  return {
    id: job.id,
    url: job.url,
    applyUrl: job.applyUrl,
    title: job.title,
    company: job.company,
    location: job.location,
    provider: job.provider,
    appliedAt: now,
    status: "Applied",
    statusAt: now,
  };
}

export default function App() {
  const [tab, setTab] = useState("company");
  const [picked, setPicked] = useState(null);
  const [applyQueue, setApplyQueue] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("applyQueue") || "[]");
    } catch {
      return [];
    }
  });
  const [applied, setApplied] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("appliedJobs") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("applyQueue", JSON.stringify(applyQueue));
  }, [applyQueue]);

  // Record one anonymous visit (for the private traffic dashboard).
  useEffect(() => {
    fetch("/api/track", { method: "POST" }).catch(() => {});
  }, []);
  // Users most often head to the Today tab. Keep the initial load fast by warming
  // its data in the background only once the landing page is idle, then render it
  // instantly when they open the tab (its fetch dedupes with this prefetch).
  useEffect(() => {
    const warm = () => prefetchToday();
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 1500);
    return () => clearTimeout(id);
  }, []);
  // Applied tracking is PER-BROWSER only: it lives in this browser's
  // localStorage and is never sent to the server, so no other visitor can see
  // or change your applied list.
  useEffect(() => {
    localStorage.setItem("appliedJobs", JSON.stringify(applied));
  }, [applied]);

  const appliedIds = useMemo(() => new Set(applied.map((j) => j.id)), [applied]);

  // Mutations update local state only (persisted to localStorage by the effect
  // above). Callbacks are stable so memoized job cards don't re-render on
  // unrelated state changes.
  const toggleApplied = useCallback((job) => {
    setApplied((list) =>
      list.some((j) => j.id === job.id)
        ? list.filter((j) => j.id !== job.id)
        : [makeAppliedEntry(job), ...list]
    );
  }, []);

  const updateApplied = useCallback((id, changes) => {
    setApplied((list) => list.map((j) => (j.id === id ? { ...j, ...changes } : j)));
  }, []);

  const removeApplied = useCallback((id) => {
    setApplied((list) => list.filter((j) => j.id !== id));
  }, []);

  const openCompany = useCallback((name) => {
    setPicked({ name, ts: Date.now() });
    setTab("company");
  }, []);

  const queueApply = useCallback((job) => {
    setApplyQueue((q) => {
      if (q.some((j) => j.url === job.url)) return q;
      const provider = job.provider || "";
      return [
        {
          url: job.url,
          applyUrl: job.applyUrl || job.url,
          title: job.title,
          company: job.company,
          location: job.location,
          provider,
          supported: ["workday", "greenhouse"].includes(provider.toLowerCase()),
        },
        ...q,
      ];
    });
    setTab("apply");
  }, []);

  const tabs = [
    ["company", "By Company"],
    ["today", "Today"],
    ["latest", "This Week"],
    ["companies", "Companies"],
    ["ats", "ATS Match"],
    ...(IS_LOCAL
      ? [["apply", `Apply${applyQueue.length ? ` (${applyQueue.length})` : ""}`]]
      : []),
    ["applied", `Applied${applied.length ? ` (${applied.length})` : ""}`],
    ["linkedin", "By LinkedIn Title"],
  ];

  const cardProps = { appliedIds, onToggleApplied: toggleApplied };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">⛯</span>
          <div>
            <h1>Job Hunter</h1>
            <p className="sub">Local dashboard · live openings, one click to apply</p>
          </div>
        </div>
        <nav className="tabs">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "tab active" : "tab"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {tab === "company" && (
          <CompanyTab picked={picked} onQueueApply={queueApply} {...cardProps} />
        )}
        {tab === "today" && <TodayTab onQueueApply={queueApply} {...cardProps} />}
        {tab === "latest" && <LatestTab onQueueApply={queueApply} {...cardProps} />}
        {tab === "companies" && <CompaniesTab onOpen={openCompany} />}
        {tab === "ats" && <AtsTab />}
        {IS_LOCAL && tab === "apply" && <ApplyTab queue={applyQueue} setQueue={setApplyQueue} />}
        {tab === "applied" && (
          <AppliedTab applied={applied} onUpdate={updateApplied} onRemove={removeApplied} />
        )}
        {tab === "linkedin" && <LinkedInTab onQueueApply={queueApply} {...cardProps} />}
      </main>

      <footer className="footer">
        Data from public company job boards & LinkedIn guest search · for
        personal use.
      </footer>

      <FeedbackWidget />
    </div>
  );
}
