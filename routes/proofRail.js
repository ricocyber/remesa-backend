const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const demoStore = new Map();
const SIGNING_KEY = process.env.PROOF_RAIL_SIGNING_KEY || 'nervesystem-proof-rail-demo-key';

const FX_RATES = {
  MEX: 17.42,
  GTM: 7.84,
  COL: 3820.25,
  PHL: 57.18,
  USA: 1,
};

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

function sha256Hex(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function signObject(payload) {
  const payloadHash = sha256Hex(payload);
  const signature = crypto
    .createHmac('sha256', SIGNING_KEY)
    .update(payloadHash)
    .digest('hex');

  return {
    payloadHash,
    signature,
    signatureAlgorithm: 'HMAC-SHA256',
    signer: 'NerveSystem Proof Rail',
  };
}

function getFxRate(country) {
  return FX_RATES[String(country || 'MEX').toUpperCase()] || 1;
}

function getTransfer(id) {
  const transfer = demoStore.get(id);

  if (!transfer) {
    const error = new Error('Transfer not found');
    error.statusCode = 404;
    throw error;
  }

  return transfer;
}

function buildStepReceipt(transferId, step, status, payload) {
  const createdAt = new Date().toISOString();
  const base = {
    transferId,
    step,
    status,
    payload,
    createdAt,
  };
  const proof = signObject(base);

  return {
    ...base,
    ...proof,
  };
}

function computeQuote(amount, country, paymentMethod) {
  const amountUsd = Number.parseFloat(amount);
  const fxRate = getFxRate(country);
  const feePercent = paymentMethod === 'stablecoin' ? 0.75 : 1.5;
  const feeUsd = Math.max(2.5, amountUsd * (feePercent / 100));
  const totalUsd = amountUsd + feeUsd;
  const amountLocal = amountUsd * fxRate;

  return {
    amountUsd: Number(amountUsd.toFixed(2)),
    feeUsd: Number(feeUsd.toFixed(2)),
    totalUsd: Number(totalUsd.toFixed(2)),
    fxRate: Number(fxRate.toFixed(4)),
    amountLocal: Number(amountLocal.toFixed(2)),
    settlementRail: paymentMethod === 'stablecoin' ? 'USDC' : 'USDPT',
  };
}

function complianceCheckPayload({ sender, receiver, amountUsd, country, simulateOfacFail, simulateAmlFlag }) {
  const senderVerified = sender?.verified !== false;
  const receiverVerified = receiver?.verified !== false;
  const amount = Number.parseFloat(amountUsd) || 0;
  const highRisk = simulateAmlFlag || amount >= 1000 || ['IRN', 'PRK', 'RUS', 'CUB'].includes(String(country || '').toUpperCase());
  const ofacPass = !simulateOfacFail;
  const amlPass = !highRisk;
  const pass = ofacPass && amlPass && senderVerified && receiverVerified;

  return {
    senderVerified,
    receiverVerified,
    ofacPass,
    amlPass,
    highRisk,
    pass,
    riskLevel: pass ? 'LOW' : highRisk ? 'ELEVATED' : 'BLOCKED',
    reasons: [
      senderVerified ? 'sender_verified' : 'sender_unverified',
      receiverVerified ? 'receiver_verified' : 'receiver_unverified',
      ofacPass ? 'ofac_clear' : 'ofac_fail',
      amlPass ? 'aml_clear' : 'aml_flagged',
    ],
  };
}

function buildReceiptPackage(transfer) {
  const receipt = {
    version: 'remesa-proof-rail-demo-v1',
    transferId: transfer.id,
    sender: transfer.sender,
    receiver: transfer.receiver,
    quote: transfer.quote,
    compliance: transfer.compliance,
    payment: transfer.payment,
    settlement: transfer.settlement,
    payout: transfer.payout,
    events: transfer.events,
    createdAt: transfer.createdAt,
    updatedAt: transfer.updatedAt,
  };

  const proof = signObject(receipt);

  return {
    ...receipt,
    ...proof,
  };
}

function toPdfTextLines(receipt) {
  return [
    'Remesa Proof Rail Receipt',
    `Transfer ID: ${receipt.transferId}`,
    `Sender: ${receipt.sender.name} (${receipt.sender.country})`,
    `Receiver: ${receipt.receiver.name} (${receipt.receiver.country})`,
    `Amount USD: $${receipt.quote.amountUsd.toFixed(2)}`,
    `Fee USD: $${receipt.quote.feeUsd.toFixed(2)} | FX: ${receipt.quote.fxRate.toFixed(4)}`,
    `Compliance: ${receipt.compliance.pass ? 'PASS' : 'FAIL'} | Risk: ${receipt.compliance.riskLevel}`,
    `Settlement: ${receipt.settlement.status} | Rail: ${receipt.settlement.rail}`,
    `Stablecoin TX: ${receipt.settlement.txHash}`,
    `Payout: ${receipt.payout.status}`,
    `Signature: ${receipt.signature}`,
    `Payload Hash: ${receipt.payloadHash}`,
    '',
    'Events:',
    ...receipt.events.map((event) => `${event.step} => ${event.status} (${event.signature.slice(0, 12)}...)`),
  ];
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdfBuffer(lines) {
  const contentParts = ['BT', '/F1 12 Tf', '50 760 Td'];

  lines.forEach((line, index) => {
    if (index > 0) {
      contentParts.push('0 -16 Td');
    }
    contentParts.push(`(${escapePdfText(line)}) Tj`);
  });

  contentParts.push('ET');
  const contentStream = contentParts.join('\n');
  const contentLength = Buffer.byteLength(contentStream);

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${contentLength} >> stream\n${contentStream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];

  const header = '%PDF-1.4\n';
  const offsets = [0];
  let cursor = Buffer.byteLength(header);
  const objectBuffers = [];

  for (const object of objects) {
    offsets.push(cursor);
    const buffer = Buffer.from(`${object}\n`, 'utf8');
    objectBuffers.push(buffer);
    cursor += buffer.length;
  }

  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([Buffer.from(header, 'utf8'), ...objectBuffers, Buffer.from(xref + trailer, 'utf8')]);
}

router.post('/quote', (req, res) => {
  const {
    amount,
    country = 'MEX',
    paymentMethod = 'card',
    senderName = 'José Garcia',
    receiverName = 'María López',
    senderCountry = 'USA',
    receiverCountry = country,
  } = req.body || {};

  const transferId = crypto.randomUUID();
  const quote = computeQuote(amount, country, paymentMethod);
  const sender = {
    name: senderName,
    country: senderCountry,
    verified: true,
  };
  const receiver = {
    name: receiverName,
    country: receiverCountry,
    verified: true,
  };

  const transfer = {
    id: transferId,
    status: 'QUOTE_CREATED',
    sender,
    receiver,
    quote,
    payment: null,
    compliance: null,
    settlement: null,
    payout: null,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  transfer.events.push(buildStepReceipt(transferId, 'quote_created', 'PASS', { quote }));
  demoStore.set(transferId, transfer);

  res.json({
    transferId,
    quote,
    proof: buildReceiptPackage(transfer),
  });
});

router.post('/compliance/check', (req, res) => {
  const {
    transferId,
    sender = {},
    receiver = {},
    amountUsd,
    country = 'MEX',
    simulateOfacFail = false,
    simulateAmlFlag = false,
  } = req.body || {};

  const compliance = complianceCheckPayload({ sender, receiver, amountUsd, country, simulateOfacFail, simulateAmlFlag });

  const id = transferId || crypto.randomUUID();
  const transfer = demoStore.get(id) || {
    id,
    status: 'DRAFT',
    sender: { ...sender, verified: sender.verified !== false },
    receiver: { ...receiver, verified: receiver.verified !== false },
    quote: null,
    payment: null,
    settlement: null,
    payout: null,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  transfer.compliance = compliance;
  transfer.status = compliance.pass ? 'COMPLIANCE_PASSED' : 'COMPLIANCE_FAILED';
  transfer.updatedAt = new Date().toISOString();
  transfer.events.push(buildStepReceipt(id, 'compliance_check', compliance.pass ? 'PASS' : 'FAIL', compliance));
  demoStore.set(id, transfer);

  res.json({ transferId: id, compliance, proof: buildReceiptPackage(transfer) });
});

router.post('/transfer/create', (req, res) => {
  const {
    transferId,
    amountUsd,
    country = 'MEX',
    paymentMethod = 'card',
    sender = {},
    receiver = {},
    simulateOfacFail = false,
    simulateAmlFlag = false,
  } = req.body || {};

  const id = transferId || crypto.randomUUID();
  const existing = demoStore.get(id) || {
    id,
    sender: { ...sender, verified: sender.verified !== false },
    receiver: { ...receiver, verified: receiver.verified !== false },
    quote: computeQuote(amountUsd, country, paymentMethod),
    compliance: null,
    payment: null,
    settlement: null,
    payout: null,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!existing.quote && amountUsd) {
    existing.quote = computeQuote(amountUsd, country, paymentMethod);
  }

  if (!existing.compliance) {
    existing.compliance = complianceCheckPayload({
      sender: existing.sender,
      receiver: existing.receiver,
      amountUsd: amountUsd || existing.quote.amountUsd,
      country,
      simulateOfacFail,
      simulateAmlFlag,
    });
  }

  existing.payment = {
    method: paymentMethod,
    status: 'SIMULATED_CAPTURED',
    paymentId: `pay_${crypto.randomUUID().slice(0, 8)}`,
    chargedUsd: existing.quote.totalUsd,
  };

  existing.status = existing.compliance.pass ? 'TRANSFER_CREATED' : 'BLOCKED';
  existing.updatedAt = new Date().toISOString();
  existing.events.push(buildStepReceipt(id, 'transfer_create', existing.compliance.pass ? 'PASS' : 'FAIL', {
    payment: existing.payment,
    compliance: existing.compliance,
    quote: existing.quote,
  }));

  demoStore.set(id, existing);

  res.json({
    transferId: id,
    transfer: existing,
    proof: buildReceiptPackage(existing),
  });
});

router.post('/settlement/simulate', (req, res) => {
  const { transferId, rail = 'USDC', payoutMethod = 'wallet', txHash } = req.body || {};
  const transfer = getTransfer(transferId);

  const fakeHash = txHash || `0x${crypto.randomBytes(16).toString('hex')}`;

  transfer.settlement = {
    rail,
    txHash: fakeHash,
    status: transfer.compliance?.pass === false ? 'REJECTED' : 'SETTLED',
    settledAt: new Date().toISOString(),
  };
  transfer.payout = {
    method: payoutMethod,
    status: transfer.settlement.status === 'SETTLED' ? 'COMPLETED' : 'BLOCKED',
  };
  transfer.status = transfer.settlement.status === 'SETTLED' ? 'PAYOUT_COMPLETED' : 'SETTLEMENT_BLOCKED';
  transfer.updatedAt = new Date().toISOString();
  transfer.events.push(buildStepReceipt(transfer.id, 'settlement_simulate', transfer.settlement.status, transfer.settlement));

  demoStore.set(transfer.id, transfer);

  res.json({
    transferId: transfer.id,
    settlement: transfer.settlement,
    payout: transfer.payout,
    proof: buildReceiptPackage(transfer),
  });
});

router.get('/transfer/:id/receipt', (req, res) => {
  const transfer = getTransfer(req.params.id);
  const receipt = buildReceiptPackage(transfer);
  const format = String(req.query.format || 'json').toLowerCase();

  if (format === 'pdf') {
    const pdfBuffer = buildPdfBuffer(toPdfTextLines(receipt));
    res.setHeader('Content-Type', 'application/pdf');
    if (req.query.download !== '0') {
      res.setHeader('Content-Disposition', `attachment; filename="remesa-proof-${receipt.transferId}.pdf"`);
    }
    return res.send(pdfBuffer);
  }

  if (req.query.download !== '0') {
    res.setHeader('Content-Disposition', `attachment; filename="remesa-proof-${receipt.transferId}.json"`);
  }

  return res.json({ receipt });
});

module.exports = router;