import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { generateTokens, verifyRefreshToken } from '../lib/jwt.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { jobQueue } from '../services/jobQueue.js';
import { emailService } from '../services/emailService.js';
import { smsService } from '../services/smsService.js';
import { logger } from '../lib/logger.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiters
const emailVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification emails sent', code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 }
});

// Helper: Password strength check
function isStrongPassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
}

// Helper: Generate subdomain
function generateSubdomain(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 15);
  const randomStr = crypto.randomBytes(2).toString('hex');
  return `${base}-${randomStr}`.substring(0, 20);
}

/**
 * Security Note: CSRF Protection
 * In a production environment, if tokens are stored in cookies, CSRF protection is required.
 * Since we are returning tokens in the JSON response and expecting them in the Authorization header,
 * we are immune to CSRF attacks by default.
 */

// 1. Register
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Missing required fields', error: 'Missing required fields', code: 'MISSING_FIELDS', statusCode: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format', error: 'Invalid email format', code: 'INVALID_EMAIL', statusCode: 400 });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters with uppercase, lowercase, and numbers', error: 'Weak password', code: 'WEAK_PASSWORD', statusCode: 400 });
    }

    const db = getDb();

    // Check if email exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(409).json({ message: 'Email already in use', error: 'Email already in use', code: 'EMAIL_EXISTS', statusCode: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const subdomain = generateSubdomain(name);
    const inboundEmail = `${subdomain}@mail.stoneaio.com`;

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
    const verifyExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const insertResult = db.prepare(`
      INSERT INTO users (email, password_hash, name, subdomain, inbound_email, verify_email_token, verify_email_expires)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id, email, name, subdomain, inbound_email, plan, container_status
    `).get(email, passwordHash, name, subdomain, inboundEmail, verifyTokenHash, verifyExpires) as any;

    const user = insertResult;

    // Fire async job
    jobQueue.enqueue('provision_container', { userId: user.id, subdomain });

    // Issue tokens
    const { accessToken, refreshToken } = generateTokens({ id: user.id, email: user.email, plan: user.plan });

    // Store refresh token
    db.prepare('INSERT INTO tokens (user_id, type, token) VALUES (?, ?, ?)')
      .run(user.id, 'refresh', refreshToken);

    // Send welcome email (fire-and-forget — don't block registration)
    emailService.sendWelcomeEmail(user.email, user.name).catch(e => logger.warn('Welcome email failed:', e));
    emailService.sendEmailVerification(user.email, verifyToken).catch(e => logger.warn('Verification email failed:', e));

    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

// 2. Login
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing email or password', error: 'Missing email or password', code: 'MISSING_CREDENTIALS', statusCode: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password', error: 'Invalid email or password', code: 'INVALID_CREDENTIALS', statusCode: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password', error: 'Invalid email or password', code: 'INVALID_CREDENTIALS', statusCode: 401 });
    }

    const { accessToken, refreshToken } = generateTokens({ id: user.id, email: user.email, plan: user.plan });

    // Create session / store refresh token
    db.prepare('INSERT INTO tokens (user_id, type, token) VALUES (?, ?, ?)')
      .run(user.id, 'refresh', refreshToken);

    // Create session record
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
      .run(user.id, sessionToken, expiresAt);

    // Remove sensitive fields from response
    delete user.password_hash;
    delete user.reset_password_token;
    delete user.reset_password_expires;
    delete user.verify_email_token;
    delete user.verify_email_expires;
    delete user.verify_phone_code;
    delete user.verify_phone_expires;

    res.json({ user, accessToken, refreshToken, sessionToken });
  } catch (err) {
    next(err);
  }
});

// 3. Refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token', code: 'MISSING_TOKEN', statusCode: 400 });
    }

    const db = getDb();
    const tokenRecord = db.prepare('SELECT * FROM tokens WHERE token = ? AND type = ?').get(refreshToken, 'refresh') as any;

    if (!tokenRecord) {
      return res.status(401).json({ error: 'Invalid or revoked refresh token', code: 'INVALID_TOKEN', statusCode: 401 });
    }

    try {
      const decoded = verifyRefreshToken(refreshToken) as any;
      const user = db.prepare('SELECT id, email, plan FROM users WHERE id = ?').get(decoded.id) as any;

      if (!user) {
        return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND', statusCode: 401 });
      }

      const tokens = generateTokens({ id: user.id, email: user.email, plan: user.plan });

      // Rotate refresh token
      db.prepare('DELETE FROM tokens WHERE token = ?').run(refreshToken);
      db.prepare('INSERT INTO tokens (user_id, type, token) VALUES (?, ?, ?)')
        .run(user.id, 'refresh', tokens.refreshToken);

      res.json(tokens);
    } catch (err) {
      // Token expired or invalid
      db.prepare('DELETE FROM tokens WHERE token = ?').run(refreshToken);
      return res.status(401).json({ error: 'Refresh token expired', code: 'TOKEN_EXPIRED', statusCode: 401 });
    }
  } catch (err) {
    next(err);
  }
});

// 4. Logout
router.post('/logout', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { refreshToken, sessionToken } = req.body;
    const db = getDb();

    if (refreshToken) {
      db.prepare('DELETE FROM tokens WHERE token = ? AND user_id = ?').run(refreshToken, req.user.id);
    }

    if (sessionToken) {
      db.prepare('DELETE FROM sessions WHERE token = ? AND user_id = ?').run(sessionToken, req.user.id);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 5. Get Me
router.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, email, name, avatar_url, bio, rules, timezone, phone_number, sms_enabled, email_verified, subdomain, inbound_email, plan, container_status, container_port, is_admin, default_model, default_skill_id, created_at, updated_at FROM users WHERE id = ?').get(req.user.id) as any;

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND', statusCode: 404 });
    }

    // Mock usage stats
    const stats = {
      messages_sent: 150,
      agents_running: 2,
      storage_used_mb: 45.5
    };

    res.json({ ...user, stats });
  } catch (err) {
    next(err);
  }
});

// 6. Update Me
router.patch('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const allowedFields = ['name', 'bio', 'rules', 'timezone', 'phone_number', 'avatar_url', 'default_model', 'default_skill_id'];
    const updates: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update', code: 'NO_UPDATES', statusCode: 400 });
    }

    updates.push('updated_at = unixepoch()');
    values.push(req.user.id);

    const db = getDb();
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ? RETURNING id, email, name, avatar_url, bio, rules, timezone, phone_number, sms_enabled, email_verified, subdomain, inbound_email, plan, container_status, container_port, is_admin, default_model, default_skill_id, created_at, updated_at`;

    const updatedUser = db.prepare(query).get(...values);

    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
});

// 7. Forgot Password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required', code: 'MISSING_EMAIL', statusCode: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any;

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetExpires = Date.now() + 60 * 60 * 1000; // 1 hour

      db.prepare('UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?')
        .run(resetTokenHash, resetExpires, user.id);

      await emailService.sendPasswordReset(email, resetToken);
    }

    // Always return 200 to prevent email enumeration
    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

// 8. Reset Password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password required', code: 'MISSING_FIELDS', statusCode: 400 });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain uppercase, lowercase, and numbers', code: 'WEAK_PASSWORD', statusCode: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDb();

    const user = db.prepare('SELECT id, reset_password_expires FROM users WHERE reset_password_token = ?').get(tokenHash) as any;

    if (!user || user.reset_password_expires < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired reset token', code: 'INVALID_TOKEN', statusCode: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?')
        .run(passwordHash, user.id);

      // Revoke all sessions and refresh tokens
      db.prepare('DELETE FROM tokens WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    })();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 9. Verify Email
router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token required', code: 'MISSING_TOKEN', statusCode: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDb();

    const user = db.prepare('SELECT id, verify_email_expires FROM users WHERE verify_email_token = ?').get(tokenHash) as any;

    if (!user || user.verify_email_expires < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired verification token', code: 'INVALID_TOKEN', statusCode: 400 });
    }

    db.prepare('UPDATE users SET email_verified = 1, verify_email_token = NULL, verify_email_expires = NULL WHERE id = ?')
      .run(user.id);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 10. Send Verify Email
router.post('/send-verify-email', requireAuth, emailVerifyLimiter, async (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(req.user.id) as any;

    if (user.email_verified) {
      return res.status(400).json({ error: 'Email already verified', code: 'ALREADY_VERIFIED', statusCode: 400 });
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
    const verifyExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    db.prepare('UPDATE users SET verify_email_token = ?, verify_email_expires = ? WHERE id = ?')
      .run(verifyTokenHash, verifyExpires, req.user.id);

    await emailService.sendEmailVerification(user.email, verifyToken);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 11. Verify Phone
router.post('/verify-phone', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required', code: 'MISSING_PHONE', statusCode: 400 });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const codeExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    const db = getDb();
    db.prepare('UPDATE users SET verify_phone_code = ?, verify_phone_expires = ?, phone_number = ? WHERE id = ?')
      .run(codeHash, codeExpires, phoneNumber, req.user.id);

    await smsService.sendVerificationCode(phoneNumber, code);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 12. Confirm Phone
router.post('/confirm-phone', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code required', code: 'MISSING_CODE', statusCode: 400 });
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const db = getDb();

    const user = db.prepare('SELECT id, verify_phone_expires FROM users WHERE id = ? AND verify_phone_code = ?').get(req.user.id, codeHash) as any;

    if (!user || user.verify_phone_expires < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired code', code: 'INVALID_CODE', statusCode: 400 });
    }

    db.prepare('UPDATE users SET sms_enabled = 1, verify_phone_code = NULL, verify_phone_expires = NULL WHERE id = ?')
      .run(req.user.id);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
