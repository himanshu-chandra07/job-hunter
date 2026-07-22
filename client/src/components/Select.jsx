import React, { useState, useRef, useEffect } from "react";

// A small, polished, accessible dropdown for fixed option sets (replaces bare
// native <select> for a consistent look + keyboard support across browsers).
export default function Select({ value, onChange, options, ariaLabel, className }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const current = options.find((o) => String(o.value) === String(value)) || options[0];

  useEffect(() => {
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (open && active >= 0 && listRef.current) {
      const el = listRef.current.children[active];
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  function choose(o) {
    onChange(o.value);
    setOpen(false);
    setActive(-1);
  }

  function openMenu() {
    setActive(options.findIndex((o) => String(o.value) === String(value)));
    setOpen(true);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openMenu();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && active >= 0) choose(options[active]);
      else openMenu();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={"sel" + (open ? " open" : "") + (className ? " " + className : "")} ref={rootRef}>
      <button
        type="button"
        className="sel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="sel-value">{current ? current.label : ""}</span>
        <span className="sel-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="sel-list" ref={listRef} role="listbox">
          {options.map((o, i) => {
            const cur = String(o.value) === String(value);
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={cur}
                className={"sel-opt" + (cur ? " cur" : "") + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                <span>{o.label}</span>
                {cur && <span className="sel-check" aria-hidden="true">✓</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
