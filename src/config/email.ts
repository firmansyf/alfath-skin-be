import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Singleton transporter — created once, reused for all sends
let transporter: nodemailer.Transporter | null = null;

const getTransporter = (): nodemailer.Transporter => {
  if (transporter) return transporter;

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    throw new Error('SMTP_USER or SMTP_PASS environment variable is not set');
  }

  console.log('📧 Initializing SMTP transporter:', {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || '587',
    user: smtpUser.substring(0, 5) + '***',
  });

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    pool: true,           // keep connection alive
    maxConnections: 3,
    socketTimeout: 10000, // 10s timeout
  });

  return transporter;
};

export const sendOTPEmail = async (email: string, otpCode: string): Promise<void> => {
  const t = getTransporter();

  const mailOptions = {
    from: process.env.SMTP_FROM || `"Alfath Skin" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Kode Verifikasi OTP - Al-fath Skin',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #db2777; font-size: 24px; margin: 0;">Alfath Skin</h1>
        </div>
        <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; text-align: center;">
          <h2 style="color: #111827; font-size: 18px; margin: 0 0 8px;">Verifikasi Email Anda</h2>
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">
            Masukkan kode OTP berikut untuk menyelesaikan registrasi:
          </p>
          <div style="background: #fdf2f8; border: 2px dashed #db2777; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #db2777;">${otpCode}</span>
          </div>
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            Kode ini berlaku selama <strong>5 menit</strong>.<br/>
            Jangan bagikan kode ini kepada siapapun.
          </p>
        </div>
        <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 24px;">
          Jika Anda tidak mendaftar di Alfath Skin, abaikan email ini.
        </p>
      </div>
    `,
  };

  console.log(`📧 Sending OTP to ${email}...`);
  const info = await t.sendMail(mailOptions);
  console.log(`✅ OTP email sent to ${email}, messageId: ${info.messageId}`);
};
