import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../config/database';
import { sendOTPEmail } from '../config/email';

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone } = req.body;

    // Validasi input
    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        message: 'Nama, email, password, dan nomor telepon wajib diisi'
      });
    }

    // Validasi nomor telepon
    if (!phone || phone.toString().trim().length < 10) {
      return res.status(400).json({
        message: 'Nomor telepon tidak valid (minimal 10 digit)'
      });
    }

    // Check apakah email sudah terdaftar
    const existingUser = await query(
      'SELECT id, is_verified FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      // If user exists but not verified, allow re-registration (update data)
      if (!existingUser.rows[0].is_verified) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await query(
          `UPDATE users SET name = $1, password = $2, phone = $3 WHERE email = $4`,
          [name, hashedPassword, phone, email]
        );

        // Generate and send OTP
        const otpCode = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        await query(
          'UPDATE otp_verifications SET is_used = TRUE WHERE email = $1 AND is_used = FALSE',
          [email]
        );
        await query(
          `INSERT INTO otp_verifications (email, otp_code, expires_at) VALUES ($1, $2, $3)`,
          [email, otpCode, expiresAt]
        );

        // Send OTP email
        console.log(`📧 OTP Code for ${email}: ${otpCode}`);
        try {
          await sendOTPEmail(email, otpCode);
          console.log(`✅ OTP email sent successfully to ${email}`);
        } catch (emailErr: any) {
          console.error(`❌ Failed to send OTP email to ${email}:`, emailErr.message);
          return res.status(500).json({
            message: 'Gagal mengirim email OTP. Silakan coba lagi nanti.',
          });
        }

        return res.status(201).json({
          message: 'Kode OTP telah dikirim ke email Anda',
          data: { email, requiresVerification: true },
        });
      }

      return res.status(400).json({
        message: 'Email sudah terdaftar'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user baru (unverified)
    await query(
      `INSERT INTO users (name, email, password, phone, role, is_verified)
       VALUES ($1, $2, $3, $4, 'customer', FALSE)`,
      [name, email, hashedPassword, phone]
    );

    // Generate and send OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await query(
      `INSERT INTO otp_verifications (email, otp_code, expires_at) VALUES ($1, $2, $3)`,
      [email, otpCode, expiresAt]
    );

    // Send OTP email
    console.log(`📧 OTP Code for ${email}: ${otpCode}`);
    try {
      await sendOTPEmail(email, otpCode);
      console.log(`✅ OTP email sent successfully to ${email}`);
    } catch (emailErr: any) {
      console.error(`❌ Failed to send OTP email to ${email}:`, emailErr.message);
      return res.status(500).json({
        message: 'Gagal mengirim email OTP. Silakan coba lagi nanti.',
      });
    }

    res.status(201).json({
      message: 'Kode OTP telah dikirim ke email Anda',
      data: { email, requiresVerification: true },
    });
  } catch (error: any) {
    console.error('Register error:', error.message, error.stack);
    res.status(500).json({
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    console.log('\n========== LOGIN DEBUG START ==========');
    console.log('🔍 Login attempt:', { email, password });
    console.log('🔍 Password length:', password?.length);
    console.log('🔍 Password type:', typeof password);

    // Validasi input
    if (!email || !password) {
      console.log('❌ Validation failed: missing email or password');
      return res.status(400).json({ 
        message: 'Email dan password wajib diisi' 
      });
    }

    console.log('✅ Validation passed');
    console.log('🔍 Querying database for user...');

    // Cari user berdasarkan email
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    console.log('✅ Database query completed');
    console.log('🔍 Rows returned:', result.rows.length);

    if (result.rows.length === 0) {
      console.log('❌ User not found in database');
      return res.status(401).json({
        message: 'Email atau password salah'
      });
    }

    const user = result.rows[0];

    // Check if email is verified
    if (!user.is_verified) {
      console.log('❌ User email not verified');
      return res.status(403).json({
        message: 'Email belum diverifikasi. Silakan verifikasi email Anda terlebih dahulu.',
        code: 'EMAIL_NOT_VERIFIED',
        data: { email: user.email, requiresVerification: true },
      });
    }
    console.log('✅ User found:');
    console.log('   - ID:', user.id);
    console.log('   - Email:', user.email);
    console.log('   - Role:', user.role);
    console.log('   - Has password:', !!user.password);
    console.log('   - Password hash length:', user.password?.length);
    console.log('   - Password hash prefix:', user.password?.substring(0, 29) + '...');

    console.log('\n🔐 Starting password verification...');
    console.log('   - Input password:', password);
    console.log('   - Stored hash:', user.password);

    // Verifikasi password
    try {
      const isValidPassword = await bcrypt.compare(password, user.password);
      console.log('✅ bcrypt.compare completed');
      console.log('🔐 Password valid:', isValidPassword);

      if (!isValidPassword) {
        console.log('❌ Password does NOT match!');
        console.log('   Input:', password);
        console.log('   Expected hash:', user.password);
        console.log('========== LOGIN DEBUG END (FAILED) ==========\n');
        return res.status(401).json({ 
          message: 'Email atau password salah' 
        });
      }

      console.log('✅ Password matches! Proceeding to token generation...');
    } catch (bcryptError) {
      console.error('💥 bcrypt.compare ERROR:', bcryptError);
      throw bcryptError;
    }

    // Generate JWT token
    console.log('🔑 Generating JWT token...');
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' } as jwt.SignOptions
    );

    console.log('✅ Token generated successfully');
    console.log('✅✅✅ LOGIN SUCCESSFUL! ✅✅✅');
    console.log('========== LOGIN DEBUG END (SUCCESS) ==========\n');

    res.json({
      message: 'Login berhasil',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
        },
        token,
      },
    });
  } catch (error) {
    console.error('💥💥💥 LOGIN ERROR:', error);
    console.log('========== LOGIN DEBUG END (ERROR) ==========\n');
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};

export const getProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    const result = await query(
      'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    res.json({
      message: 'Data profile berhasil diambil',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
};