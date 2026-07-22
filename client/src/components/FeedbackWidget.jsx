import React, { useState, useEffect } from "react";
import { submitFeedback } from "../api.js";

const CATEGORIES = ["Suggestion", "Bug", "Praise", "Other"];

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("Suggestion");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");

  // Close the modal on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setCategory("Suggestion");
    setMessage("");
    setName("");
    setContact("");
    setStatus("idle");
    setError("");
  }

  function openModal() {
    reset();
    setOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Please write your feedback before sending.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      await submitFeedback({ message, category, name, contact });
      setStatus("sent");
      setMessage("");
      setName("");
      setContact("");
      setCategory("Suggestion");
    } catch (err) {
      setError(err.message || "Could not send feedback. Please try again.");
      setStatus("error");
    }
  }

  return (
    <>
      <button
        className="feedback-fab"
        onClick={openModal}
        aria-label="Send feedback"
        title="Send feedback"
      >
        <span className="feedback-fab-icon">💬</span>
        <span className="feedback-fab-label">Feedback</span>
      </button>

      {open && (
        <div className="feedback-modal-overlay" onMouseDown={() => setOpen(false)}>
          <div
            className="feedback-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Send feedback"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="feedback-modal-head">
              <h3>Send feedback</h3>
              <button
                className="feedback-modal-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {status === "sent" ? (
              <div className="feedback-sent">
                <p>🙏 Thanks for your feedback! It has been recorded.</p>
                <div className="row">
                  <button className="primary" onClick={() => setStatus("idle")}>
                    Send more
                  </button>
                  <button className="ghost" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form className="feedback-form" onSubmit={submit}>
                <p className="feedback-intro">
                  Have a suggestion, hit a bug, or just want to say hi?
                  <strong> No sign-in needed.</strong> Name and contact are
                  optional, add a contact only if you'd like a reply.
                </p>

                <div className="row">
                  <label className="ctl">
                    Type
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="row">
                  <textarea
                    className="feedback-message"
                    rows={5}
                    maxLength={4000}
                    placeholder="Your feedback or suggestion…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="row">
                  <input
                    className="ctl-input"
                    placeholder="Your name (optional)"
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <input
                    className="ctl-input"
                    placeholder="Email or contact (optional)"
                    maxLength={200}
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  />
                </div>

                {error && <div className="notice error">{error}</div>}

                <div className="row feedback-actions">
                  <span className="feedback-count-hint">{message.length}/4000</span>
                  <div className="row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary"
                      disabled={status === "sending" || !message.trim()}
                    >
                      {status === "sending" ? "Sending…" : "Send feedback"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
