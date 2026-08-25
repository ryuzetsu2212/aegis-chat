const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Test SMTP connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('[Email] SMTP Connection Error:', error.message);
  } else {
    console.log('✓ [Email] SMTP connection ready');
  }
});

function generateOTP() {
  // F-03 fix: CSPRNG — Math.random() predictable
  return crypto.randomInt(100000, 1000000).toString();
}

async function sendOTPEmail(email, otp) {
  // Defense-in-depth CRLF/format guard — alamat tujuan berasal dari input user
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    console.warn('[Email] Rejected invalid recipient address');
    return false;
  }
  const mailOptions = {
    from: `"${process.env.APP_NAME || 'AegisChat'}" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Email Verification - OTP Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #ededed; padding: 40px; border: 1px solid #2a2a2a;">
        <h2 style="color: #00EA66; margin-bottom: 20px;">Email Verification</h2>
        <p style="font-size: 16px; margin-bottom: 20px;">Your OTP code for ${process.env.APP_NAME || 'AegisChat'} registration:</p>
        <div style="background: #121212; padding: 20px; text-align: center; border: 1px solid #2a2a2a; margin-bottom: 20px;">
          <span style="font-size: 32px; font-weight: bold; color: #00EA66; letter-spacing: 8px;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #b0b5c5;">This code will expire in 10 minutes.</p>
        <p style="font-size: 14px; color: #b0b5c5; margin-top: 30px;">If you didn't request this, please ignore this email.</p>
      </div>
    `
  };

  try {
    console.log('[Email] Attempting to send OTP to:', email);
    await transporter.sendMail(mailOptions);
    console.log('[Email] OTP sent successfully to:', email);
    return true;
  } catch (error) {
    console.error('[Email] Error sending OTP:', error.message);
    console.error('[Email] Full error:', error);
    return false;
  }
}

module.exports = { generateOTP, sendOTPEmail };
