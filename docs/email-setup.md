<!-- File: Explains Gmail app-password setup, private sender settings, shared reset-link URLs, and delivery verification. -->
# Gmail email setup

ConnectSphere sends password-reset emails through Gmail SMTP using Nodemailer.
No custom domain, Mailpit process, Docker container, or Resend account is required.
Supabase remains the database; application authentication/reset-token logic is unchanged.

## Configure the sender

1. Use the project Gmail account and enable **Two-Step Verification** in its Google
   Account security settings.
2. Open [Google App Passwords](https://myaccount.google.com/apppasswords), create an
   app password named ConnectSphere, and copy the generated 16-character value.
   Use this app password, not the normal Gmail sign-in password. Some school/work
   accounts, security-key-only setups, and Advanced Protection accounts do not
   offer app passwords.
3. Add these settings to your private `backend/.env` or the shared backend host's
   environment. Never paste credentials into chat, commit them, or put them in a
   frontend `VITE_` setting.

```dotenv
GMAIL_USER=your-project-account@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password
PUBLIC_APP_URL=http://localhost:5173
```

Replace the placeholders with the actual Gmail address and app password. The
backend accepts Google's space-grouped app password and removes its whitespace.
The From address is derived from the authenticated account as `Event Portal
<your-project-account@gmail.com>`; no separate sender verification is needed.

For team-wide links, set `PUBLIC_APP_URL` to your shared deployed frontend's HTTPS
URL. Localhost works only on the computer where that frontend is running.
`CORS_ORIGIN` independently controls allowed frontend origins.

Restart the backend after changing settings. Missing/blank configuration or an
invalid app-password shape makes reset requests return HTTP 503 before querying
accounts. Gmail ultimately validates the actual credential during SMTP authentication.

## Test delivery

Register an Event Organiser or Attendee account in ConnectSphere using an inbox
you can check, then request its password-reset link. The recipient does not have
to be the Gmail sender account. Check the recipient's inbox/spam and the sender's
Sent folder. Password-reset emails are not sent to nonexistent or internal staff
accounts; the API intentionally returns a generic response for account privacy.

If email sending fails, the backend logs a safe error code and clears that reset
token. The generic success response alone does not prove delivery. Confirm that
the running backend was restarted with the new configuration and that the app
password has not been revoked. Changing the Google account's normal password can
revoke its app passwords, so generate a fresh one afterward when needed.

## Implementation and limits

The backend connects to `smtp.gmail.com:465` with TLS and the Gmail address/app
password. Reset-token hashes, 15-minute expiry, single-use consumption, URL fragments,
and session-version invalidation retain their existing behavior.

This setup is for development and small team testing. Gmail applies sending limits
and may block automated sign-ins; revisit a transactional service for production.
Automated tests mock SMTP and do not send email. The configured encrypted SMTP connection and sender authentication have passed a live check. Inbox delivery remains unverified
until a real reset request is checked in the recipient inbox.

References: [Google app passwords](https://support.google.com/accounts/answer/185833)
and [Nodemailer Gmail setup](https://nodemailer.com/usage/using-gmail/).

