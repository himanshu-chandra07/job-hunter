import { useState, useEffect } from "react";
import { fetchCompanies } from "./api.js";

// Module-level cache so the seeded company directory is fetched once and shared
// across every tab (By Company, ATS Match, Companies) instead of 3 separate
// requests — instant on tab switches.
let cache = null;
let inflight = null;

export function useCompanies() {
  const [companies, setCompanies] = useState(cache || []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    if (cache) {
      setCompanies(cache);
      setLoading(false);
      return;
    }
    if (!inflight) {
      inflight = fetchCompanies().then((d) => {
        cache = d.companies || [];
        return cache;
      });
    }
    inflight
      .then((c) => {
        if (alive) {
          setCompanies(c);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setLoading(false);
        }
        inflight = null; // allow a retry on next mount
      });
    return () => {
      alive = false;
    };
  }, []);

  return { companies, loading, error };
}
