const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const {
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  requirePasswordConfirm,
  verifyPassword,
  PERMISSIONS,
  ROLE_DEFAULTS,
} = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  permissions: u.permissions ? u.permissions.split(',').filter(Boolean) : [],
  maxDiscountPercent: u.maxDiscountPercent,
});

// GET /api/auth/status — used by the frontend to decide onboarding vs login vs app
router.get('/status', async (req, res) => {
  const adminCount = await prisma.user.count();
  res.json({ onboarded: adminCount > 0 });
});

// POST /api/auth/register — only allowed once, during onboarding Step 1 (creates the admin)
router.post('/register', async (req, res) => {
  const existing = await prisma.user.count();
  if (existing > 0) {
    return res.status(403).json({ error: 'An admin account already exists' });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { name, email, password } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, password: passwordHash, role: 'admin' },
  });

  const token = issueToken(user);
  setSessionCookie(res, token);
  res.status(201).json(publicUser(user));
});

router.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const genericError = { error: 'Invalid email or password' };
  // Always run a hash comparison to keep response timing uniform whether or
  // not the account exists, and never reveal which of the two was wrong.
  const hash = user?.password || '$2a$12$0000000000000000000000000000000000000000000000000000';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !user.active || !ok) return res.status(401).json(genericError);

  const token = issueToken(user);
  setSessionCookie(res, token);
  res.json(publicUser(user));
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(publicUser(user));
});

// POST /api/auth/change-password — any logged-in user changes their own password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
router.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const ok = await verifyPassword(req.user.id, parsed.data.currentPassword);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: req.user.id }, data: { password: passwordHash } });
  res.status(204).end();
});

// --- Staff user management (admin only) ------------------------------------

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(users.map(publicUser));
});

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'franchisor']).default('cashier'),
  // Accept any strings then filter — avoids 400 when UI sends a slightly stale perm list
  permissions: z.array(z.string()).optional(),
  maxDiscountPercent: z.preprocess(
    (v) => (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? null : v),
    z.number().min(0).max(100).nullable().optional()
  ),
  confirmPassword: z.string().optional(),
});
router.post('/users', requireAuth, requireAdmin, requirePasswordConfirm, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const field = Object.entries(flat.fieldErrors || {}).map(([k, v]) => `${k}: ${(v || []).join(', ')}`).join('; ');
    return res.status(400).json({ error: field || 'Invalid input', details: flat });
  }
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) return res.status(409).json({ error: 'A user with that email already exists' });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const role = parsed.data.role || 'cashier';
  const rawPerms = parsed.data.permissions && parsed.data.permissions.length
    ? parsed.data.permissions.filter((p) => PERMISSIONS.includes(p))
    : null;
  const perms = rawPerms && rawPerms.length ? rawPerms : (ROLE_DEFAULTS[role] || ROLE_DEFAULTS.cashier);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      password: passwordHash,
      role,
      permissions: role === 'admin' || role === 'manager' ? '' : perms.join(','),
      maxDiscountPercent: parsed.data.maxDiscountPercent ?? null,
    },
  });
  res.status(201).json(publicUser(user));
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'franchisor']).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});
router.put('/users/:id', requireAuth, requireAdmin, requirePasswordConfirm, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Guard against locking yourself out or removing the last admin.
  if (target.role === 'admin' && ((parsed.data.role && parsed.data.role !== 'admin') || parsed.data.active === false)) {
    const adminCount = await prisma.user.count({ where: { role: 'admin', active: true } });
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot demote or disable the last active admin' });
    }
  }

  const data = { ...parsed.data };
  if (data.password) data.password = await bcrypt.hash(data.password, 12);
  if (data.permissions) data.permissions = data.permissions.join(',');

  const updated = await prisma.user.update({ where: { id }, data });
  res.json(publicUser(updated));
});

module.exports = router;
