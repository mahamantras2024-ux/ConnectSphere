const nodemailer = require('nodemailer');

function emailConfig() {
  const provider = process.env.MAIL_PROVIDER || 'mailpit';
  if (provider === 'resend') {
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM || !process.env.PUBLIC_APP_URL) {
      throw new Error('Resend requires RESEND_API_KEY, MAIL_FROM and PUBLIC_APP_URL.');
    }
    return { from: process.env.MAIL_FROM, transport: {
      host: 'smtp.resend.com', port: 465, secure: true,
      auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
      connectionTimeout: 10000, socketTimeout: 10000,
    } };
  }
  if (provider !== 'mailpit' || process.env.NODE_ENV === 'production') {
    throw new Error('Configure Resend for production email delivery.');
  }
  return { from: 'Event Portal <notifications@example.test>', transport: {
    host: process.env.MAILPIT_HOST || '127.0.0.1',
    port: Number(process.env.MAILPIT_PORT || 1025), secure: false,
    connectionTimeout: 5000, socketTimeout: 5000,
  } };
}

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
