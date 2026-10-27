const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, hasPerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'BILLING'];

function canUseTables(user) {
  return hasPerm(user, 'pos') || hasPerm(user, 'kitchen') || hasPerm(user, 'settings') || hasPerm(user, 'team');
}

const tableSchema = z.object({
  number: z.string().trim().min(1).max(20),
  name: z.string().trim().max(80).optional().nullable().or(z.literal('')),
  section: z.string().trim().max(40).optional().nullable().or(z.literal('')),
  seats: z.number().int().min(1).max(100).default(4),
  status: z.enum(STATUSES).optional(),
  note: z.string().trim().max(200).optional().nullable().or(z.literal('')),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// GET /api/tables
router.get('/', async (req, res) => {
  if (!canUseTables(req.user)) {
    return res.status(403).json({ error: 'No access to tables', code: 'PERMISSION_DENIED' });
  }
  const includeInactive = req.query.all === '1';
  const tables = await prisma.diningTable.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
  });
  res.json(tables);
});

// POST /api/tables
router.post('/', async (req, res) => {
  if (!canUseTables(req.user)) {
    return res.status(403).json({ error: 'No access to tables', code: 'PERMISSION_DENIED' });
  }
  const parsed = tableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const d = parsed.data;
  try {
    const row = await prisma.diningTable.create({
      data: {
        number: d.number,
        name: d.name || null,
        section: d.section || null,
        seats: d.seats,
        status: d.status || 'AVAILABLE',
        note: d.note || null,
        active: d.active !== false,
        sortOrder: d.sortOrder ?? 0,
        openedAt: d.status && d.status !== 'AVAILABLE' ? new Date() : null,
      },
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: `Table number "${d.number}" already exists` });
    }
    throw err;
  }
});

// PATCH /api/tables/:id
router.patch('/:id', async (req, res) => {
  if (!canUseTables(req.user)) {
    return res.status(403).json({ error: 'No access to tables', code: 'PERMISSION_DENIED' });
  }
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const parsed = tableSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const d = parsed.data;
  const data = {};
  if (d.number != null) data.number = d.number;
  if (d.name !== undefined) data.name = d.name || null;
  if (d.section !== undefined) data.section = d.section || null;
  if (d.seats != null) data.seats = d.seats;
  if (d.note !== undefined) data.note = d.note || null;
  if (d.active != null) data.active = d.active;
  if (d.sortOrder != null) data.sortOrder = d.sortOrder;
  if (d.status != null) {
    data.status = d.status;
    if (d.status === 'AVAILABLE') data.openedAt = null;
    else if (d.status === 'OCCUPIED' || d.status === 'RESERVED') {
      const cur = await prisma.diningTable.findUnique({ where: { id } });
      if (cur && !cur.openedAt) data.openedAt = new Date();
    }
  }
  try {
    const row = await prisma.diningTable.update({ where: { id }, data });
    res.json(row);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Table not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Table number already exists' });
    throw err;
  }
});

// POST /api/tables/:id/status  { status }
router.post('/:id/status', async (req, res) => {
  if (!canUseTables(req.user)) {
    return res.status(403).json({ error: 'No access to tables', code: 'PERMISSION_DENIED' });
  }
  const id = parseInt(req.params.id, 10);
  const status = String(req.body?.status || '').toUpperCase();
  if (!id || !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  try {
    const cur = await prisma.diningTable.findUnique({ where: { id } });
    if (!cur) return res.status(404).json({ error: 'Table not found' });
    const row = await prisma.diningTable.update({
      where: { id },
      data: {
        status,
        openedAt: status === 'AVAILABLE' ? null : cur.openedAt || new Date(),
        note: req.body?.note !== undefined ? (req.body.note || null) : undefined,
      },
    });
    res.json(row);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Table not found' });
    throw err;
  }
});

// DELETE /api/tables/:id  (soft: active=false)
router.delete('/:id', async (req, res) => {
  if (!canUseTables(req.user)) {
    return res.status(403).json({ error: 'No access to tables', code: 'PERMISSION_DENIED' });
  }
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const row = await prisma.diningTable.update({ where: { id }, data: { active: false, status: 'AVAILABLE', openedAt: null } });
    res.json(row);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Table not found' });
    throw err;
  }
});

// POST /api/tables/seed — create a quick floor plan (1–N)
router.post('/seed', async (req, res) => {
  if (!canUseTables(req.user)) {
    return res.status(403).json({ error: 'No access to tables', code: 'PERMISSION_DENIED' });
  }
  const count = Math.min(50, Math.max(1, parseInt(String(req.body?.count || '12'), 10) || 12));
  const section = (req.body?.section || 'Main').toString().slice(0, 40);
  const seats = Math.min(20, Math.max(1, parseInt(String(req.body?.seats || '4'), 10) || 4));
  const created = [];
  for (let i = 1; i <= count; i++) {
    const number = String(i);
    try {
      const row = await prisma.diningTable.create({
        data: { number, section, seats, sortOrder: i, status: 'AVAILABLE' },
      });
      created.push(row);
    } catch (err) {
      if (err.code === 'P2002') continue;
      throw err;
    }
  }
  res.status(201).json({ created: created.length, tables: created });
});

module.exports = router;
