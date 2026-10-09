/**
 * Email Service - PUPSJ HUB
 * Uses Nodemailer with Gmail SMTP, or logs emails locally in development.
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const FROM = process.env.EMAIL_FROM || 'PUPSJ HUB <noreply@pupsj.edu.ph>';
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587', 10);
const EMAIL_USER = (process.env.EMAIL_USER || '').trim();
const EMAIL_PASS = (process.env.EMAIL_PASS || '').trim();
const NODE_ENV = process.env.NODE_ENV || 'development';
const hasSmtpCredentials = Boolean(EMAIL_USER && EMAIL_PASS);
const devMode = !hasSmtpCredentials && NODE_ENV !== 'production';

let transporter = null;

if (devMode) {
  console.log('[Email] No EMAIL_USER/EMAIL_PASS found - email will be logged to console only.');
} else if (!hasSmtpCredentials) {
  console.error('[Email] SMTP is not configured. Set EMAIL_USER and EMAIL_PASS to send real emails.');
} else {
  console.log(`[Email] Configuring SMTP: ${EMAIL_HOST}:${EMAIL_PORT} (User: ${EMAIL_USER})`);
  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  transporter.verify((error) => {
    if (error) {
      console.error('[Email] SMTP Connection Error:', error.message);
      if (error.message.includes('Invalid login') || error.message.includes('Username and Password not accepted')) {
        console.error('[Email] TIP: If using Gmail, you must use an App Password, not your regular password.');
      }
    } else {
      console.log('[Email] SMTP server is ready to take our messages');
    }
  });
}

async function sendMail({ to, subject, html, text, headers = {} }) {
  if (devMode) {
    console.log('\n========================================');
    console.log(`[Email DEV] TO: ${to}`);
    console.log(`[Email DEV] SUBJECT: ${subject}`);
    console.log(`[Email DEV] TEXT:\n${text || html}`);
    console.log('========================================\n');
    return { success: true, mode: 'dev' };
  }

  if (!transporter) {
    throw new Error('Email delivery is not configured. Set EMAIL_USER and EMAIL_PASS in the environment.');
  }

  // Explicitly disable link wrapping/tracking proxy headers used by Brevo (Sendinblue) and other relays
  const defaultHeaders = {
    'X-Mailin-Track': '0',
    'X-Sib-Track': '0',
    'X-Mailin-Tag': 'transactional',
    'X-Auto-Response-Suppress': 'All',
  };

  try {
    const info = await transporter.sendMail({
      from: FROM,
      to,
      subject,
      html,
      text,
      headers: { ...defaultHeaders, ...headers }
    });
    console.log(`[Email] Sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[Email] Error sending to ${to}:`, error.message);
    throw error;
  }
}

function baseLayout(body) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { margin:0; padding:0; background:#f5f0eb; font-family:'Segoe UI',Arial,sans-serif; -webkit-font-smoothing:antialiased; }
      .wrap { max-width:560px; margin:40px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
      .hdr  { background:#800000; padding:28px 32px; text-align:center; }
      .hdr h1 { color:#fff; margin:0; font-size:22px; font-weight:800; letter-spacing:-0.5px; }
      .hdr p  { color:rgba(255,255,255,0.75); margin:4px 0 0; font-size:13px; }
      .body { padding:32px; color:#1a1a1a; line-height:1.6; }
      .body p { margin:0 0 16px; font-size:15px; }
      .btn-wrap { text-align:center; margin:28px 0; }
      .btn { display:inline-block; background:#800000; color:#ffffff !important; text-decoration:none;
             padding:13px 32px; border-radius:8px; font-weight:700; font-size:15px;
             letter-spacing:0.2px; }
      .code-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin:20px 0; text-align:center; }
      .code-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin-bottom:8px; }
      .code-val { font-family:Consolas,Monaco,'Courier New',monospace; font-size:15px; font-weight:700; color:#800000; word-break:break-all; background:#ffffff; border:1px dashed #cbd5e1; border-radius:6px; padding:8px 12px; display:inline-block; }
      .fallback { font-size:12px; color:#888; word-break:break-all; margin-top:16px; }
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
        &copy; ${new Date().getFullYear()} PUPSJ HUB - Polytechnic University of the Philippines San Juan Campus
      </div>
    </div>
  </body>
  </html>`;
}

async function sendVerificationEmail(toEmail, firstName, token) {
  const cleanToken = encodeURIComponent(String(token).trim());
  const link = `${APP_URL}/?verify=${cleanToken}&email=${encodeURIComponent(toEmail)}`;
  await sendMail({
    to: toEmail,
    subject: `Your PUPSJ HUB Verification Code is ${token}`,
    text: `Hello ${firstName},\n\nWelcome to PUPSJ HUB!\n\nYour 6-digit verification code is: ${token}\n\nEnter this code in PUPSJ HUB to activate your account.\n\nAlternatively, click or paste this link into your browser:\n${link}\n\nThis verification code expires in 24 hours.\n\nIf you did not register for an account, please ignore this email.`,
    html: baseLayout(`
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Welcome to <strong>PUPSJ HUB</strong>! Use the 6-digit verification code below to activate your account and access campus services:</p>
      
      <div style="background:#fff5f5; border:2px dashed #800000; border-radius:12px; padding:24px 16px; margin:24px 0; text-align:center;">
        <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1.5px; color:#800000; margin-bottom:8px;">Your 6-Digit Verification Code</div>
        <div style="font-family:Consolas, Monaco, 'Courier New', monospace; font-size:36px; font-weight:900; letter-spacing:10px; color:#800000; padding:6px 0;">${token}</div>
        <div style="font-size:13px; color:#64748b; margin-top:8px;">Enter this code on the PUPSJ HUB verification screen.</div>
      </div>

      <div class="btn-wrap">
        <a class="btn" href="${link}" target="_blank" rel="noopener noreferrer">Verify Account Online</a>
      </div>

      <p class="fallback">
        Can't click the button? Copy and paste this link into your browser:<br>
        <a href="${link}" style="color:#800000; word-break:break-all;">${link}</a>
      </p>
      <p style="font-size:12px; color:#64748b; margin-top:20px;">This code expires in <strong>24 hours</strong>. If you did not create an account, you can safely ignore this email.</p>
    `),
  });
}

async function sendPasswordResetEmail(toEmail, firstName, token) {
  const cleanToken = encodeURIComponent(String(token).trim());
  const link = `${APP_URL}/?reset=${cleanToken}`;
  await sendMail({
    to: toEmail,
    subject: 'Reset your PUPSJ HUB password',
    text: `Hello ${firstName},\n\nWe received a request to reset your PUPSJ HUB password.\n\nReset Link:\n${link}\n\nPassword Reset Token:\n${token}\n\nThis link expires in 1 hour.\n\nIf you did not request a password reset, please ignore this email.`,
    html: baseLayout(`
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>We received a request to reset your <strong>PUPSJ HUB</strong> password. Click the button below to set a new password.</p>
      <div class="btn-wrap">
        <a class="btn" href="${link}" target="_blank" rel="noopener noreferrer">Reset Password</a>
      </div>
      <div class="code-box">
        <div class="code-title">Password Reset Token</div>
        <div class="code-val">${token}</div>
      </div>
      <p class="fallback">
        Can't click the button? Copy and paste this link into your browser:<br>
        <a href="${link}" style="color:#800000; word-break:break-all;">${link}</a>
      </p>
      <p style="font-size:12px; color:#64748b; margin-top:20px;">This link expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email.</p>
    `),
  });
}

async function sendWelcomeAdminEmail(toEmail, firstName, password) {
  await sendMail({
    to: toEmail,
    subject: 'Welcome to PUPSJ HUB - Admin Account Created',
    text: `Hello ${firstName},\n\nYour admin account for PUPSJ HUB has been created successfully!\n\nHere are your login credentials:\nEmail: ${toEmail}\nPassword: ${password}\n\nYou can log in directly at: ${APP_URL}\n\nPlease keep your credentials secure.`,
    html: baseLayout(`
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Welcome to <strong>PUPSJ HUB</strong>! A standard <strong>Admin</strong> account has been created for you by the Super Admin.</p>
      <p>Here are your secure credentials to log in:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #fafafa; border: 1px solid #eaeaea;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eaeaea; font-weight: bold; width: 120px;">Email:</td>
          <td style="padding: 12px; border-bottom: 1px solid #eaeaea;">${toEmail}</td>
        </tr>
        <tr>
          <td style="padding: 12px; font-weight: bold;">Password:</td>
          <td style="padding: 12px; font-family: monospace; font-size: 16px; font-weight: bold; color: #880808;">${password}</td>
        </tr>
      </table>
      <div class="btn-wrap">
        <a class="btn" href="${APP_URL}">Log In Now</a>
      </div>
      <p>Please make sure to change your password in your Profile once logged in to keep your account secure.</p>
    `),
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeAdminEmail };
