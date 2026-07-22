// Minimal email sender used for the admin password-reset flow. Uses nodemailer
// with SMTP credentials from the environment (e.g. a Gmail account + App
// Password). If SMTP isn't configured, sendMail throws so the caller can fall
// back to showing the reset link directly to the operator.

import nodemailer from "nodemailer";

let transporter; // undefined = not yet built; null = unavailable

function getTransport() {
  if (transporter !== undefined) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    transporter = null;
    return null;
  }
  const host = process.env.SMTP_HOST;
  if (host) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  } else {
    // default to Gmail's service when only user/pass are given
    transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  }
  return transporter;
}

export function emailConfigured() {
  return !!getTransport();
}

export async function sendMail({ to, subject, html, text }) {
  const t = getTransport();
  if (!t) throw new Error("Email is not configured on the server.");
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await t.sendMail({ from, to, subject, html, text });
}
