// ╔═══════════════════════════════════════════════════════════╗
// ║           FUNDRAISING ROUTES - Investor CRM + AI Agent    ║
// ╚═══════════════════════════════════════════════════════════╝

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const agent = require('../services/fundraisingAgent');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────
// INVESTOR CRUD
// ─────────────────────────────────────────────────────────────

// GET /api/fundraising/investors
// List all investors, optionally filtered by CRM stage
router.get('/investors', async (req, res, next) => {
  try {
    const { stage, search } = req.query;
    const where = {};
    if (stage) where.stage_crm = stage;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { firm: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const investors = await prisma.investor.findMany({
      where,
      include: {
        outreaches: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ investors, count: investors.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/fundraising/investors
// Add a new investor to the CRM
router.post('/investors', async (req, res, next) => {
  try {
    const {
      name, firm, email, linkedinUrl,
      focusAreas, checkSizeMin, checkSizeMax, stage, notes,
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    const investor = await prisma.investor.create({
      data: {
        name, firm, email, linkedinUrl,
        focusAreas: focusAreas || [],
        checkSizeMin, checkSizeMax,
        stage, notes,
      },
    });

    res.status(201).json({ investor });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Investor with this email already exists' });
    }
    next(err);
  }
});

// GET /api/fundraising/investors/:id
router.get('/investors/:id', async (req, res, next) => {
  try {
    const investor = await prisma.investor.findUnique({
      where: { id: req.params.id },
      include: { outreaches: { orderBy: { createdAt: 'desc' } } },
    });
    if (!investor) return res.status(404).json({ error: 'Investor not found' });
    res.json({ investor });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/fundraising/investors/:id
// Update investor info or move them through the CRM pipeline
router.patch('/investors/:id', async (req, res, next) => {
  try {
    const {
      name, firm, email, linkedinUrl,
      focusAreas, checkSizeMin, checkSizeMax,
      stage, notes, stage_crm,
    } = req.body;

    const investor = await prisma.investor.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(firm !== undefined && { firm }),
        ...(email && { email }),
        ...(linkedinUrl !== undefined && { linkedinUrl }),
        ...(focusAreas && { focusAreas }),
        ...(checkSizeMin !== undefined && { checkSizeMin }),
        ...(checkSizeMax !== undefined && { checkSizeMax }),
        ...(stage !== undefined && { stage }),
        ...(notes !== undefined && { notes }),
        ...(stage_crm && { stage_crm }),
      },
    });

    res.json({ investor });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Investor not found' });
    next(err);
  }
});

// DELETE /api/fundraising/investors/:id
router.delete('/investors/:id', async (req, res, next) => {
  try {
    await prisma.investorOutreach.deleteMany({ where: { investorId: req.params.id } });
    await prisma.investor.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Investor not found' });
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// AI AGENT — DRAFT EMAILS
// ─────────────────────────────────────────────────────────────

// POST /api/fundraising/investors/:id/draft
// AI drafts a personalized email (cold, follow-up, or meeting-request)
router.post('/investors/:id/draft', async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const investor = await prisma.investor.findUnique({
      where: { id: req.params.id },
      include: { outreaches: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!investor) return res.status(404).json({ error: 'Investor not found' });

    const { type = 'COLD' } = req.body;
    let draft;

    if (type === 'COLD') {
      draft = await agent.draftColdEmail(investor);
    } else if (type === 'FOLLOW_UP') {
      const lastOutreach = investor.outreaches[0];
      if (!lastOutreach) {
        return res.status(400).json({ error: 'No previous outreach found; send a cold email first' });
      }
      const daysSince = Math.floor(
        (Date.now() - new Date(lastOutreach.sentAt || lastOutreach.createdAt)) / 86400000
      );
      draft = await agent.draftFollowUp(investor, lastOutreach.subject, daysSince);
    } else if (type === 'MEETING_REQUEST') {
      draft = await agent.draftMeetingRequest(investor);
    } else {
      return res.status(400).json({ error: 'type must be COLD, FOLLOW_UP, or MEETING_REQUEST' });
    }

    // Save draft to DB
    const outreach = await prisma.investorOutreach.create({
      data: {
        investorId: investor.id,
        type,
        subject: draft.subject,
        body: draft.body,
        aiGenerated: true,
        status: 'DRAFT',
      },
    });

    res.status(201).json({ outreach });
  } catch (err) {
    next(err);
  }
});

// POST /api/fundraising/investors/:id/score
// AI scores how well this investor fits Remesa (0–100)
router.post('/investors/:id/score', async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const investor = await prisma.investor.findUnique({ where: { id: req.params.id } });
    if (!investor) return res.status(404).json({ error: 'Investor not found' });

    const result = await agent.scoreInvestorFit(investor);
    res.json({ investorId: investor.id, ...result });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// OUTREACH MANAGEMENT
// ─────────────────────────────────────────────────────────────

// GET /api/fundraising/outreaches
// List all outreach emails with optional status filter
router.get('/outreaches', async (req, res, next) => {
  try {
    const { status, investorId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (investorId) where.investorId = investorId;

    const outreaches = await prisma.investorOutreach.findMany({
      where,
      include: { investor: { select: { name: true, firm: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ outreaches, count: outreaches.length });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/fundraising/outreaches/:id
// Update outreach (edit draft body, mark as sent/opened/replied)
router.patch('/outreaches/:id', async (req, res, next) => {
  try {
    const { subject, body, status, sentAt, openedAt, repliedAt } = req.body;

    const outreach = await prisma.investorOutreach.update({
      where: { id: req.params.id },
      data: {
        ...(subject && { subject }),
        ...(body && { body }),
        ...(status && { status }),
        ...(sentAt !== undefined && { sentAt: sentAt ? new Date(sentAt) : null }),
        ...(openedAt !== undefined && { openedAt: openedAt ? new Date(openedAt) : null }),
        ...(repliedAt !== undefined && { repliedAt: repliedAt ? new Date(repliedAt) : null }),
      },
    });

    // Auto-advance investor CRM stage when email is sent
    if (status === 'SENT') {
      const inv = await prisma.investor.findUnique({ where: { id: outreach.investorId } });
      if (inv && inv.stage_crm === 'PROSPECT') {
        await prisma.investor.update({
          where: { id: inv.id },
          data: { stage_crm: 'CONTACTED' },
        });
      }
    }
    if (status === 'REPLIED') {
      await prisma.investor.update({
        where: { id: outreach.investorId },
        data: { stage_crm: 'RESPONDED' },
      });
    }

    res.json({ outreach });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Outreach not found' });
    next(err);
  }
});

// DELETE /api/fundraising/outreaches/:id
router.delete('/outreaches/:id', async (req, res, next) => {
  try {
    await prisma.investorOutreach.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Outreach not found' });
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// PIPELINE DASHBOARD
// ─────────────────────────────────────────────────────────────

// GET /api/fundraising/pipeline
// Returns counts by CRM stage — a Kanban summary
router.get('/pipeline', async (req, res, next) => {
  try {
    const stages = [
      'PROSPECT', 'CONTACTED', 'RESPONDED', 'MEETING',
      'DUE_DILIGENCE', 'COMMITTED', 'PASSED', 'INVESTED',
    ];

    const counts = await Promise.all(
      stages.map(async (s) => {
        const count = await prisma.investor.count({ where: { stage_crm: s } });
        return { stage: s, count };
      })
    );

    const totalOutreaches = await prisma.investorOutreach.count();
    const sentOutreaches = await prisma.investorOutreach.count({ where: { status: 'SENT' } });
    const repliedOutreaches = await prisma.investorOutreach.count({ where: { status: 'REPLIED' } });

    res.json({
      pipeline: counts,
      outreachStats: {
        total: totalOutreaches,
        sent: sentOutreaches,
        replied: repliedOutreaches,
        replyRate: sentOutreaches > 0
          ? `${((repliedOutreaches / sentOutreaches) * 100).toFixed(1)}%`
          : '0%',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
