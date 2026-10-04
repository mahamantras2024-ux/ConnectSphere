// File: Builds password-reset URLs and sends reset messages through encrypted Gmail SMTP.
const nodemailer = require('nodemailer');

// Validates Gmail app-password settings and builds an encrypted transport using the authenticated sender.
function emailConfig() {
  const user = process.env.GMAIL_USER?.trim();
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
  if (!user || !password || !process.env.PUBLIC_APP_URL?.trim()) {
    throw new Error('Gmail requires GMAIL_USER, GMAIL_APP_PASSWORD and PUBLIC_APP_URL.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !/^[a-zA-Z0-9]{16}$/.test(password)) {
    throw new Error('Gmail requires a valid sender email and a 16-character Google app password.');
  }
  return { from: `Event Portal <${user}>`, transport: {
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: password },
    connectionTimeout: 10000, socketTimeout: 10000,
  } };
}

// Builds a password-reset URL with the token in its fragment and enforces production HTTPS.
function resetUrl(token) {
  const url = new URL('/external/reset-password', process.env.PUBLIC_APP_URL || 'http://localhost:5173');
  if (!['http:', 'https:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('PUBLIC_APP_URL must use HTTPS in production.');
  }
  // Fragments stay out of HTTP access logs and Referer headers.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

// Sends a one-time reset link through the configured SMTP transport and closes it.
async function sendPasswordReset(to, token) {
  const config = emailConfig();
  const transport = nodemailer.createTransport(config.transport);
  try {
    await transport.sendMail({
      from: config.from, to, subject: 'Reset your Event Portal password',
      text: `Use this link to reset your password: ${resetUrl(token)}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`,
      headers: { 'X-Entity-Ref-ID': require('crypto').randomUUID() },
    });
  } finally { transport.close(); }
}

module.exports = { emailConfig, resetUrl, sendPasswordReset };
