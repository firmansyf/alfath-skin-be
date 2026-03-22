import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const html = (otpCode: string) => `
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
`;

// HTTP API — used on Railway (SMTP ports are blocked there)
const sendViaBrevoAPI = async (email: string, otpCode: string): Promise<void> => {
  const apiKey = process.env.SMTP_PASS!;
  const sender = process.env.SMTP_FROM || process.env.SMTP_USER;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Alfath Skin', email: sender },
      to: [{ email }],
      subject: 'Kode Verifikasi OTP - Al-fath Skin',
      htmlContent: html(otpCode),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as { messageId?: string };
  console.log(`✅ OTP email sent to ${email} via Brevo API, messageId: ${data.messageId}`);
};

// SMTP — used locally
const sendViaSMTP = async (email: string, otpCode: string): Promise<void> => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    throw new Error('SMTP_USER or SMTP_PASS environment variable is not set');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: smtpUser, pass: smtpPass },
    tls: { rejectUnauthorized: false },
  });

  const info = await transporter.sendMail({
    from: `"Alfath Skin" <${process.env.SMTP_FROM || smtpUser}>`,
    to: email,
    subject: 'Kode Verifikasi OTP - Al-fath Skin',
    html: html(otpCode),
  });

  console.log(`✅ OTP email sent to ${email} via SMTP, messageId: ${info.messageId}`);
};

export const sendOTPEmail = async (email: string, otpCode: string): Promise<void> => {
  console.log(`📧 Sending OTP to ${email}...`);

  if (process.env.NODE_ENV === 'production') {
    await sendViaBrevoAPI(email, otpCode);
  } else {
    await sendViaSMTP(email, otpCode);
  }
};
