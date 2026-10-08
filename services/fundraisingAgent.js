// ╔═══════════════════════════════════════════════════════════╗
// ║           AI FUNDRAISING AGENT - Claude-powered           ║
// ║   Drafts investor outreach emails via Anthropic API       ║
// ╚═══════════════════════════════════════════════════════════╝

const https = require('https');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

const REMESA_CONTEXT = `
RemesaFácil is a blockchain-powered remittance startup helping Latinos in the USA send money to Mexico and Latin America.

Key metrics & differentiators:
- Transfer fees: 1.5% (vs. Western Union 5–8%)
- Speed: minutes via Stellar blockchain + USDC (vs. 3–5 days traditional)
- No middlemen: USD → USDC (Stellar) → MXN direct to Mexican bank accounts
- Stack: Stripe (USD on-ramp), Stellar/USDC (blockchain rail), Bitso (MXN off-ramp), Circle (payouts)
- Market: $63B USD/year remittance corridor (US→Mexico alone)
- Target customers: 40M+ Latino immigrants in the USA

We are raising a pre-seed round to fund:
1. Money transmitter license (MTL) filing
2. Mobile app development (iOS + Android)
3. Marketing & user acquisition in top 5 Latino markets (LA, Houston, Chicago, Miami, NYC)
`.trim();

function callClaude(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const url = new URL(ANTHROPIC_API_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.content[0].text);
        } catch (e) {
          reject(new Error('Failed to parse Claude response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Draft a personalized cold outreach email for an investor.
 */
async function draftColdEmail(investor) {
  const system = `You are a fundraising AI agent for RemesaFácil, a fintech startup.
Your job is to write concise, personalized cold emails to VCs and angels.
Rules:
- 150–200 words max
- Lead with something specific to the investor (focus area, portfolio company)
- Mention the traction/metrics hook in one line
- Single clear CTA: 30-min call
- No fluff, no buzzwords
- Return ONLY a JSON object with keys: subject (string), body (string)`;

  const focusStr = investor.focusAreas?.join(', ') || 'fintech';
  const stageStr = investor.stage || 'pre-seed';

  const userMsg = `Draft a cold email for this investor:
Name: ${investor.name}
Firm: ${investor.firm || 'Independent'}
Focus: ${focusStr}
Stage: ${stageStr}
Notes: ${investor.notes || 'none'}

Context about RemesaFácil:
${REMESA_CONTEXT}`;

  const raw = await callClaude([{ role: 'user', content: userMsg }], system);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

/**
 * Draft a follow-up email for an investor who hasn't replied.
 */
async function draftFollowUp(investor, previousSubject, daysSince) {
  const system = `You are a fundraising AI agent for RemesaFácil.
Write a short, non-desperate follow-up email to an investor who hasn't replied.
Rules:
- Under 80 words
- Add ONE new piece of value (a metric, a milestone, a relevant news hook)
- Keep the same subject line with "Re:" prefix
- Return ONLY a JSON object with keys: subject (string), body (string)`;

  const userMsg = `Follow-up for investor: ${investor.name} at ${investor.firm || 'independent'}
Original subject: ${previousSubject}
Days since last email: ${daysSince}
Investor focus: ${investor.focusAreas?.join(', ') || 'fintech'}

RemesaFácil context:
${REMESA_CONTEXT}`;

  const raw = await callClaude([{ role: 'user', content: userMsg }], system);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

/**
 * Draft a meeting-request email after a positive reply.
 */
async function draftMeetingRequest(investor) {
  const system = `You are a fundraising AI agent for RemesaFácil.
Write a brief meeting-request email to confirm interest and book a call.
Rules:
- Under 100 words
- Suggest 2–3 specific time slots (use placeholder [SLOT_1], [SLOT_2], [SLOT_3])
- Attach a Calendly link placeholder: [CALENDLY_LINK]
- Return ONLY a JSON object with keys: subject (string), body (string)`;

  const userMsg = `Investor: ${investor.name}, ${investor.firm || 'independent'}
They have shown interest in RemesaFácil. Request a 30-min call.`;

  const raw = await callClaude([{ role: 'user', content: userMsg }], system);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

/**
 * Score investor fit for Remesa (0–100) with a rationale.
 */
async function scoreInvestorFit(investor) {
  const system = `You are a startup fundraising strategist.
Score how well this investor fits RemesaFácil (0–100) based on focus, stage, and check size.
Return ONLY a JSON object: { score: number, rationale: string (1–2 sentences) }`;

  const userMsg = `Investor: ${investor.name}, ${investor.firm || 'independent'}
Focus: ${investor.focusAreas?.join(', ') || 'unknown'}
Stage: ${investor.stage || 'unknown'}
Check size: $${investor.checkSizeMin || 0}K – $${investor.checkSizeMax || 0}K

Startup: ${REMESA_CONTEXT}`;

  const raw = await callClaude([{ role: 'user', content: userMsg }], system);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

module.exports = {
  draftColdEmail,
  draftFollowUp,
  draftMeetingRequest,
  scoreInvestorFit,
};
