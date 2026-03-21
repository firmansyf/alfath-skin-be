import { Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../config/database';
import { sendOTPEmail } from '../config/email';

// Generate 6-digit OTP
const generateOTP = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

// OTP expires in 5 minutes
const OTP_EXPIRY_MINUTES = 5;

export const sendOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email wajib diisi' });
    }

    // Check if user exists and is not yet verified
    const userResult = await query(
      'SELECT id, is_verified FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Email tidak ditemukan' });
    }

    if (userResult.rows[0].is_verified) {
      return res.status(400).json({ message: 'Email sudah terverifikasi' });
    }

    // Rate limit: check if OTP was sent recently (within 1 minute)
    const recentOTP = await query(
      `SELECT id FROM otp_verifications
       WHERE email = $1 AND created_at > NOW() - INTERVAL '1 minute' AND is_used = FALSE`,
      [email]
    );

    if (recentOTP.rows.length > 0) {
      return res.status(429).json({
        message: 'Mohon tunggu 1 menit sebelum mengirim ulang OTP'
      });
    }

    // Invalidate previous OTPs for this email
    await query(
      'UPDATE otp_verifications SET is_used = TRUE WHERE email = $1 AND is_used = FALSE',
      [email]
    );

    // Generate and store new OTP
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO otp_verifications (email, otp_code, expires_at)
       VALUES ($1, $2, $3)`,
      [email, otpCode, expiresAt]
    );

    // Respond immediately, send email in background
    res.json({
      message: 'Kode OTP telah dikirim ke email Anda',
    });

    console.log(`📧 OTP Code for ${email}: ${otpCode}`);
    sendOTPEmail(email, otpCode).catch((emailErr: any) => {
      console.error(`❌ Failed to send OTP email to ${email}:`, emailErr.message);
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ message: 'Gagal mengirim OTP' });
  }
};

export const verifyOTP = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email dan kode OTP wajib diisi' });
    }

    // Find valid OTP
    const otpResult = await query(
      `SELECT id FROM otp_verifications
       WHERE email = $1 AND otp_code = $2 AND is_used = FALSE AND expires_at > NOW()`,
      [email, otp]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        message: 'Kode OTP tidak valid atau sudah kedaluwarsa'
      });
    }

    // Mark OTP as used
    await query(
      'UPDATE otp_verifications SET is_used = TRUE WHERE id = $1',
      [otpResult.rows[0].id]
    );

    // Mark user as verified
    await query(
      'UPDATE users SET is_verified = TRUE WHERE email = $1',
      [email]
    );

    res.json({
      message: 'Email berhasil diverifikasi',
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Gagal memverifikasi OTP' });
  }
};
