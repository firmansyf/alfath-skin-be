import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter: nodemailer.Transporter | null = null;
let transporterReady: Promise<void>;

const initTransporter = async () => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  console.log('📧 Email config:', {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || '587',
    secure: process.env.SMTP_SECURE === 'true',
    user: smtpUser ? smtpUser.substring(0, 5) + '***' : 'NOT SET',
    pass: smtpPass ? '***SET***' : 'NOT SET',
  });

  if (smtpUser && smtpPass) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    try {
      await transporter.verify();
      console.log('✅ Email transporter ready (SMTP)');
      return;
    } catch (error: any) {
      console.error('❌ SMTP verification failed:', error.message);
      console.log('📧 Falling back to Ethereal test account...');
      transporter = null;
    }
  } else {
    console.warn('⚠️ SMTP_USER or SMTP_PASS not set');
  }

  // Fallback: Ethereal test account
  try {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('✅ Email transporter ready (Ethereal Test)');
    console.log(`📧 Test email account: ${testAccount.user}`);
  } catch (err: any) {
    console.error('❌ Ethereal fallback also failed:', err.message);
  }
};

// Initialize and store the promise so we can await it
transporterReady = initTransporter();

export const sendOTPEmail = async (email: string, otpCode: string) => {
  // Wait for transporter to be initialized
  await transporterReady;

  if (!transporter) {
    throw new Error('Email transporter is not initialized');
  }

  const mailOptions = {
    from: `"Al-fath Skin" <${process.env.SMTP_USER || 'noreply@alfathskin.com'}>`,
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
  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ OTP email sent to ${email}, messageId: ${info.messageId}`);

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`📧 OTP Email preview: ${previewUrl}`);
  }

  return info;
};

export default transporter;
