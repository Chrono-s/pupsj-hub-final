/**
 * Email Service - PUPSJ HUB
 * Uses Nodemailer with Gmail SMTP, or logs emails locally in development.
 */

const nodemailer = require('nodemailer');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
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

async function sendMail({ to, subject, html, text }) {
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

  try {
    const info = await transporter.sendMail({ from: FROM, to, subject, html, text });
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
        &copy; ${new Date().getFullYear()} PUPSJ HUB - Polytechnic University of the Philippines San Juan Campus
      </div>
    </div>
  </body>
  </html>`;
}

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
