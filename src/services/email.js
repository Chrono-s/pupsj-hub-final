/**
 * Email Service — PUPSJ HUB
 * Uses Nodemailer with Gmail SMTP (or logs to console in dev/no-config mode).
 *
 * Required .env variables:
 *   EMAIL_HOST   (e.g. smtp.gmail.com)
 *   EMAIL_PORT   (e.g. 587)
 *   EMAIL_USER   (your Gmail address)
 *   EMAIL_PASS   (Gmail App Password — NOT your regular password)
 *   EMAIL_FROM   (e.g. "PUPSJ HUB <noreply@pupsj.edu.ph>")
 *   APP_URL      (e.g. http://localhost:3000)
 *
 * If EMAIL_USER / EMAIL_PASS are not set, emails are printed to console
 * (handy for local development without a mail server).
 */

const nodemailer = require('nodemailer');

const APP_URL  = process.env.APP_URL  || 'http://localhost:3000';
const FROM     = process.env.EMAIL_FROM || 'PUPSJ HUB <noreply@pupsj.edu.ph>';
const devMode  = !process.env.EMAIL_USER || !process.env.EMAIL_PASS;

let transporter;

if (devMode) {
  // Console-only "transport" for development/testing
  transporter = null;
  console.log('[Email] No EMAIL_USER/EMAIL_PASS found — email will be logged to console only.');
} else {
  transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

/**
 * Internal send helper. Falls back to console.log in devMode.
 */
async function sendMail({ to, subject, html, text }) {
  if (devMode || !transporter) {
    console.log('\n========================================');
    console.log(`[Email DEV] TO: ${to}`);
    console.log(`[Email DEV] SUBJECT: ${subject}`);
    console.log(`[Email DEV] TEXT:\n${text || html}`);
    console.log('========================================\n');
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, html, text });
}

// ─── Email Templates ───────────────────────────────────────────────────────

function baseLayout(body) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { margin:0; padding:0; background:#f5f0eb; font-family:'Segoe UI',Arial,sans-serif; }
      .wrap { max-width:560px; margin:40px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
      .hdr  { background:#800000; padding:28px 32px; text-align:center; }
      .hdr h1 { color:#fff; margin:0; font-size:22px; font-weight:800; letter-spacing:-0.5px; }
      .hdr p  { color:rgba(255,255,255,0.7); margin:4px 0 0; font-size:13px; }
      .body { padding:32px; color:#1a1a1a; line-height:1.6; }
      .body p { margin:0 0 16px; font-size:15px; }
      .btn-wrap { text-align:center; margin:28px 0; }
      .btn { display:inline-block; background:#800000; color:#fff !important; text-decoration:none;
             padding:13px 32px; border-radius:8px; font-weight:700; font-size:15px;
             letter-spacing:0.2px; }
      .fallback { font-size:12px; color:#888; word-break:break-all; margin-top:12px; }
      .ftr { background:#f5f0eb; padding:18px 32px; text-align:center; font-size:12px; color:#999; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="hdr">
        <h1>PUPSJ HUB</h1>
        <p>PUP San Juan Campus Portal</p>
      </div>
      <div class="body">${body}</div>
      <div class="ftr">
        &copy; ${new Date().getFullYear()} PUPSJ HUB — Polytechnic University of the Philippines San Juan Campus
      </div>
    </div>
  </body>
  </html>`;
}

/**
 * Send email verification email after registration.
 */
async function sendVerificationEmail(toEmail, firstName, token) {
  const link = `${APP_URL}/?verify=${token}`;
  await sendMail({
    to: toEmail,
    subject: 'Verify your PUPSJ HUB account',
    text: `Hello ${firstName},\n\nPlease verify your email by visiting:\n${link}\n\nThis link expires in 24 hours.\n\nIf you did not register, ignore this email.`,
    html: baseLayout(`
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Welcome to <strong>PUPSJ HUB</strong>! Please verify your email address to activate your account.</p>
      <div class="btn-wrap">
        <a class="btn" href="${link}">Verify Email Address</a>
      </div>
      <p class="fallback">Can't click the button? Copy and paste this link into your browser:<br>${link}</p>
      <p>This link expires in <strong>24 hours</strong>. If you did not create an account, you can safely ignore this email.</p>
    `),
  });
}

/**
 * Send password reset email.
 */
async function sendPasswordResetEmail(toEmail, firstName, token) {
  const link = `${APP_URL}/?reset=${token}`;
  await sendMail({
    to: toEmail,
    subject: 'Reset your PUPSJ HUB password',
    text: `Hello ${firstName},\n\nReset your password by visiting:\n${link}\n\nThis link expires in 1 hour.\n\nIf you did not request a reset, ignore this email.`,
    html: baseLayout(`
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>We received a request to reset your <strong>PUPSJ HUB</strong> password. Click the button below to set a new password.</p>
      <div class="btn-wrap">
        <a class="btn" href="${link}">Reset Password</a>
      </div>
      <p class="fallback">Can't click the button? Copy and paste this link into your browser:<br>${link}</p>
      <p>This link expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email.</p>
    `),
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
