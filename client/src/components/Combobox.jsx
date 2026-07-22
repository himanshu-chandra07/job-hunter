import React, { useState, useRef, useEffect, useMemo } from "react";

// Accessible, searchable combobox (type to filter, arrow keys to navigate,
// Enter to pick, Esc to close, click-outside to dismiss). Allows free text too,
// so any company name can be entered — a big step up from a native <datalist>.
export default function Combobox({
  value,
  onChange,
  onPick,
  onEnter,
  options,
  placeholder,
  disabled,
  maxItems = 60,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const query = (value || "").toLowerCase().trim();
  const filtered = useMemo(() => {
    const list = !query
      ? options
      : options.filter((o) => o.value.toLowerCase().includes(query));
    return list.slice(0, maxItems);
  }, [options, query, maxItems]);

  useEffect(() => {
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => setActive(-1), [query]);

  useEffect(() => {
    if (open && active >= 0 && listRef.current) {
      const el = listRef.current.children[active];
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  function choose(opt) {
    onChange(opt.value);
    setOpen(false);
    setActive(-1);
    onPick && onPick(opt);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && filtered[active]) choose(filtered[active]);
      else {
        setOpen(false);
        onEnter && onEnter();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function renderLabel(label) {
    if (!query) return label;
    const idx = label.toLowerCase().indexOf(query);
    if (idx < 0) return label;
    return (
      <>
        {label.slice(0, idx)}
        <mark>{label.slice(idx, idx + query.length)}</mark>
        {label.slice(idx + query.length)}
      </>
    );
  }

  return (
    <div className="combo grow" ref={rootRef}>
      <input
        className="combo-input"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck="false"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <span className={"combo-caret" + (open ? " up" : "")} aria-hidden="true">▾</span>
      {open && filtered.length > 0 && (
        <ul className="combo-list" ref={listRef} role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              className={"combo-opt" + (i === active ? " active" : "")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
            >
              <span className="combo-opt-label">{renderLabel(o.label)}</span>
              {o.hint && (
                <span className={"combo-opt-hint" + (o.live ? " live" : "")}>
                  {o.hint}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
