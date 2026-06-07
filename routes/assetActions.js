const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const actions = new Map();
const SIGNING_KEY = process.env.ASSET_ACTION_SIGNING_KEY || process.env.PROOF_RAIL_SIGNING_KEY || 'nervesystem-asset-action-demo-key';

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function signPayload(payload) {
  const payloadHash = crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
  const signature = crypto.createHmac('sha256', SIGNING_KEY).update(payloadHash).digest('hex');

  return {
    payloadHash,
    signature,
    signatureAlgorithm: 'HMAC-SHA256',
    signer: 'NerveSystem Asset Action API',
  };
}

function ensureAction(id) {
  const action = actions.get(id);
  if (!action) {
    const err = new Error('Asset action not found');
    err.statusCode = 404;
    throw err;
  }
  return action;
}

function addAuditEvent(action, stage, status, data) {
  const base = {
    actionId: action.id,
    stage,
    status,
    data,
    at: new Date().toISOString(),
  };

  const proof = signPayload(base);
  const event = { ...base, ...proof };
  action.auditTrail.push(event);
  action.updatedAt = event.at;
  return event;
}

function evaluateRules(action, simulation = {}) {
  const senderVerified = action.request.sender?.verified !== false;
  const receiverVerified = action.request.receiver?.verified !== false;
  const ofacPass = !simulation.simulateOfacFail;
  const amlFlag = !!simulation.simulateAmlFlag || Number(action.request.amountUsd || 0) >= 10000;
  const amlPass = !amlFlag;
  const pass = senderVerified && receiverVerified && ofacPass && amlPass;

  return {
    senderVerified,
    receiverVerified,
    ofacPass,
    amlPass,
    pass,
    riskLevel: pass ? 'LOW' : ofacPass ? 'ELEVATED' : 'BLOCKED',
    reasons: [
      senderVerified ? 'sender_verified' : 'sender_unverified',
      receiverVerified ? 'receiver_verified' : 'receiver_unverified',
      ofacPass ? 'ofac_clear' : 'ofac_fail',
      amlPass ? 'aml_clear' : 'aml_flagged',
    ],
  };
}

function buildActionReceipt(action) {
  const body = {
    actionId: action.id,
    actionType: action.actionType,
    status: action.status,
    request: action.request,
    ruleCheck: action.ruleCheck,
    decisionRecord: action.decisionRecord,
    settlement: action.settlement,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };

  return {
    ...body,
    ...signPayload(body),
  };
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdfBuffer(lines) {
  const content = ['BT', '/F1 11 Tf', '45 760 Td'];

  lines.forEach((line, idx) => {
    if (idx > 0) {
      content.push('0 -14 Td');
    }
    content.push(`(${escapePdfText(line)}) Tj`);
  });

  content.push('ET');
  const stream = content.join('\n');
  const streamLen = Buffer.byteLength(stream);

  const objs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${streamLen} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];

  const header = '%PDF-1.4\n';
  let cursor = Buffer.byteLength(header);
  const offsets = [0];
  const buffers = [];

  objs.forEach((obj) => {
    offsets.push(cursor);
    const b = Buffer.from(`${obj}\n`, 'utf8');
    buffers.push(b);
    cursor += b.length;
  });

  const xrefOffset = cursor;
  let xref = `xref\n0 ${objs.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  const trailer = `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([Buffer.from(header, 'utf8'), ...buffers, Buffer.from(xref + trailer, 'utf8')]);
}

function toAuditLines(action, receipt) {
  return [
    'NerveSystem Asset Action Audit Trail',
    `Action ID: ${action.id}`,
    `Type: ${action.actionType}`,
    `Status: ${action.status}`,
    `Amount USD: ${action.request.amountUsd}`,
    `Route: ${action.request.origin || 'USA'} -> ${action.request.destination || 'MEX'}`,
    `Rule Check: ${action.ruleCheck ? (action.ruleCheck.pass ? 'PASS' : 'FAIL') : 'PENDING'}`,
    `Settlement: ${action.settlement ? action.settlement.status : 'PENDING'}`,
    `Receipt Signature: ${receipt.signature}`,
    `Receipt Hash: ${receipt.payloadHash}`,
    '',
    'Events:',
    ...action.auditTrail.map((event) => `${event.stage} | ${event.status} | ${event.at}`),
  ];
}

router.post('/asset-actions/request', (req, res) => {
  try {
    const {
      actionType = 'stablecoin_remittance',
      amountUsd = 100,
      origin = 'Oklahoma',
      destination = 'Mexico',
      paymentMethod = 'stablecoin',
      sender = { name: 'Alex Rivera', verified: true },
      receiver = { name: 'Maria Lopez', verified: true },
    } = req.body || {};

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const action = {
      id,
      actionType,
      status: 'REQUESTED',
      request: {
        amountUsd: Number(amountUsd),
        origin,
        destination,
        paymentMethod,
        sender,
        receiver,
      },
      ruleCheck: null,
      decisionRecord: null,
      settlement: null,
      auditTrail: [],
      createdAt: now,
      updatedAt: now,
    };

    addAuditEvent(action, 'request_move', 'RECORDED', { actionType, amountUsd, origin, destination });
    actions.set(id, action);

    res.status(201).json({
      actionId: id,
      action,
      next: `/api/asset-actions/${id}/check-rules`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/asset-actions/:id/check-rules', (req, res) => {
  try {
    const action = ensureAction(req.params.id);
    const result = evaluateRules(action, req.body || {});
    action.ruleCheck = result;
    action.status = result.pass ? 'RULES_PASSED' : 'RULES_FAILED';
    addAuditEvent(action, 'check_rules', result.pass ? 'PASS' : 'FAIL', result);

    res.json({ actionId: action.id, ruleCheck: result, actionStatus: action.status });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/asset-actions/:id/sign-receipt', (req, res) => {
  try {
    const action = ensureAction(req.params.id);

    if (!action.ruleCheck) {
      return res.status(400).json({ error: 'Run check-rules before sign-receipt' });
    }

    const decision = {
      decision: action.ruleCheck.pass ? 'APPROVE' : 'BLOCK',
      rationale: action.ruleCheck.reasons,
      signedAt: new Date().toISOString(),
    };
    const signature = signPayload({ actionId: action.id, decision, request: action.request, ruleCheck: action.ruleCheck });

    action.decisionRecord = {
      ...decision,
      ...signature,
    };
    action.status = action.ruleCheck.pass ? 'RECEIPT_SIGNED' : 'BLOCKED';
    addAuditEvent(action, 'sign_receipt', action.status, action.decisionRecord);

    res.json({ actionId: action.id, decisionRecord: action.decisionRecord, actionStatus: action.status });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/asset-actions/:id/verify-settlement', (req, res) => {
  try {
    const action = ensureAction(req.params.id);

    if (!action.decisionRecord) {
      return res.status(400).json({ error: 'Run sign-receipt before verify-settlement' });
    }

    const settlementRef = req.body?.settlementRef || `sim_${crypto.randomBytes(8).toString('hex')}`;
    const simulated = req.body?.simulated !== false;
    const settlementOk = action.status !== 'BLOCKED';

    action.settlement = {
      simulated,
      settlementRef,
      status: settlementOk ? 'CONFIRMED' : 'BLOCKED',
      payoutStatus: settlementOk ? 'COMPLETED' : 'NOT_EXECUTED',
      verifiedAt: new Date().toISOString(),
    };
    action.status = settlementOk ? 'SETTLEMENT_VERIFIED' : 'SETTLEMENT_BLOCKED';
    addAuditEvent(action, 'verify_settlement', action.settlement.status, action.settlement);

    res.json({ actionId: action.id, settlement: action.settlement, actionStatus: action.status });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/asset-actions/:id/audit-trail', (req, res) => {
  try {
    const action = ensureAction(req.params.id);
    const receipt = buildActionReceipt(action);
    const format = String(req.query.format || 'json').toLowerCase();

    if (format === 'pdf') {
      const pdf = buildPdfBuffer(toAuditLines(action, receipt));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="asset-action-${action.id}.pdf"`);
      return res.send(pdf);
    }

    return res.json({
      actionId: action.id,
      status: action.status,
      receipt,
      auditTrail: action.auditTrail,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;