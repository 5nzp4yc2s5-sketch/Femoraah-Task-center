// Reads the facts out of a bank's transaction alert email: money in or out, the amount, the
// account's last 4 digits, the reference number, who it was paid to or received from, and the
// available balance when the email states it. Pure functions, so they can be tested without Gmail.
//
// Nothing here is stored except what parseAlert returns; the email text itself is thrown away.

export interface ParsedAlert {
  /** True when the email gave at least an amount with its direction, or a balance. */
  readable: boolean;
  direction: 'in' | 'out' | null;
  amount_paise: number | null;
  last4: string;
  reference_no: string;
  counterparty: string;
  balance_paise: number | null;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'", ndash: '-', mdash: '-', rupee: '₹' };

/** Plain text from an HTML email body: tags removed, line breaks kept, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function tidy(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** "1,23,456.78" → 12345678 paise. */
export function toPaise(num: string): number | null {
  const clean = num.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [r, p = ''] = clean.split('.');
  const paise = Number(r) * 100 + Number((p + '00').slice(0, 2));
  return Number.isSafeInteger(paise) ? paise : null;
}

const CUR = String.raw`(?:rs\.?|inr|₹)`;
const NUM = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const MONEY = String.raw`${CUR}\s*(?:${CUR}\s*)?${NUM}`;

const OUT_WORDS = String.raw`debited|spent|withdrawn|deducted|paid|sent|transferred`;
const IN_WORDS = String.raw`credited|received|deposited|refunded|reversed`;

function directionOf(word: string): 'in' | 'out' {
  return new RegExp(`^(?:${IN_WORDS})$`, 'i').test(word) ? 'in' : 'out';
}

/** Finds "Rs.500.00 has been debited" or "credited with INR 2,000". Balances are skipped. */
function findAmount(text: string): { direction: 'in' | 'out'; amount: number } | null {
  const candidates: { index: number; direction: 'in' | 'out'; amount: number }[] = [];
  const amountFirst = new RegExp(`${MONEY}(?:(?![.!?\\n])[\\s\\S]){0,60}?\\b(${OUT_WORDS}|${IN_WORDS})\\b`, 'gi');
  const wordFirst = new RegExp(`\\b(${OUT_WORDS}|${IN_WORDS})\\b(?:(?![.!?\\n])[\\s\\S]){0,40}?${MONEY}`, 'gi');
  for (const m of text.matchAll(amountFirst)) {
    if (isBalance(text, m.index)) continue;
    const amount = toPaise(m[1]);
    if (amount && amount > 0) candidates.push({ index: m.index, direction: directionOf(m[2]), amount });
  }
  for (const m of text.matchAll(wordFirst)) {
    const moneyAt = m.index + m[0].search(new RegExp(CUR, 'i'));
    if (isBalance(text, moneyAt)) continue;
    const amount = toPaise(m[2]);
    if (amount && amount > 0) candidates.push({ index: m.index, direction: directionOf(m[1]), amount });
  }
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0] ? { direction: candidates[0].direction, amount: candidates[0].amount } : null;
}

const BAL = String.raw`\b(?:avl\.?|avbl\.?|available|closing|clear)\s*(?:bal\b\.?|balance\b)`;

function isBalance(text: string, moneyIndex: number): boolean {
  return new RegExp(`${BAL}[^0-9]{0,40}$`, 'i').test(text.slice(Math.max(0, moneyIndex - 60), moneyIndex));
}

function findBalance(text: string): number | null {
  const m = text.match(new RegExp(`${BAL}[\\s\\S]{0,80}?${CUR}\\s*(?:${CUR}\\s*)?(-)?\\s*${NUM}`, 'i'))
    ?? text.match(new RegExp(`${BAL}\\s*(?:is|:|-)?\\s*(-)?\\s*${NUM}\\b`, 'i'));
  if (!m) return null;
  const paise = toPaise(m[2]);
  return paise === null ? null : m[1] ? -paise : paise;
}

function findLast4(text: string): string {
  const masked = text.match(/\b(?:a\/c|acct|account|ac|card)\b[^\n]{0,40}?(?:^|[^A-Za-z])[xX*•]+\s?(\d{4})\b/i);
  if (masked) return masked[1];
  const named = text.match(/\b(?:a\/c|acct|account|card)\s*(?:no\.?|number|ending(?:\s+(?:with|in))?)\s*[:\-]?\s*(\d{4})\b/i);
  return named ? named[1] : '';
}

function findReference(text: string): string {
  const patterns = [
    /\bupi\s*(?:transaction\s*)?(?:reference|ref)\.?\s*(?:number|no\.?|id)?\s*(?:is|:|-)?\s*([0-9]{8,20})\b/i,
    /\butr\s*(?:no\.?|number)?\s*(?:is|:|-)?\s*([A-Za-z0-9]{8,30})\b/i,
    /\b(?:ref(?:erence)?\.?)\s*(?:no\.?|number|id)?\s*(?:is|:|-)?\s*((?=[A-Za-z]*\d)[A-Za-z0-9]{6,30})\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].toUpperCase();
  }
  return '';
}

function clean(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/[\s,.;:-]+$/, '').trim().slice(0, 120);
}

function findCounterparty(text: string): string {
  const vpa = text.match(/\b(?:to|by|from)\s+vpa\s+([A-Za-z0-9._-]+@[A-Za-z0-9.]+)(?:\s+([A-Za-z0-9][A-Za-z0-9 .&'()-]{1,60}?))?\s+on\b/i);
  if (vpa) return clean(vpa[2] && !/^on$/i.test(vpa[2]) ? vpa[2] : vpa[1]);
  const at = text.match(/\b(?:spent|used)\b[^\n]{0,80}?\bat\s+([A-Za-z0-9][A-Za-z0-9 .&'*-]{1,60}?)\s+on\b/i);
  if (at) return clean(at[1]);
  const by = text.match(
    /\b(?:credited|debited|received|transferred|paid)\b[^\n]{0,120}?\b(?:by|from|to)\s+(?!your\b|the\b|a\/c\b|account\b|ac\b|vpa\b)([A-Za-z0-9][A-Za-z0-9 .&'-]{2,60}?)(?=\s+(?:on|via|ref|with|info|upi|neft|imps|rtgs|towards|for)\b|[.,;\n]|$)/i,
  );
  if (by) return clean(by[1]);
  const info = text.match(/\binfo\s*[:\-]\s*([^\n.]{3,80})/i);
  return info ? clean(info[1]) : '';
}

/** Reads one alert. `body` may be plain text or HTML. */
export function parseAlert(subject: string, body: string): ParsedAlert {
  const raw = /<[a-z][\s\S]*>/i.test(body) ? htmlToText(body) : body;
  const text = tidy(`${subject}\n${raw}`).slice(0, 6000);
  const found = findAmount(text);
  // On a credit card the "available balance" is the unused limit, not money in the bank.
  const balance = /\bcredit\s*card\b/i.test(text) ? null : findBalance(text);
  return {
    readable: Boolean(found) || balance !== null,
    direction: found?.direction ?? null,
    amount_paise: found?.amount ?? null,
    last4: findLast4(text),
    reference_no: findReference(text),
    counterparty: found ? findCounterparty(text) : '',
    balance_paise: balance,
  };
}

/** True when Gmail's own check says the email really came from the sender's domain. */
export function senderVerified(authResults: string[], fromAddress: string): boolean {
  const domain = fromAddress.split('@')[1]?.toLowerCase().replace(/[>\s]/g, '');
  if (!domain) return false;
  const esc = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return authResults.some((r) =>
    new RegExp(`dmarc=pass[^;]*header\\.from=${esc}\\b`, 'i').test(r) || new RegExp(`dkim=pass[^;]*header\\.(?:i|d)=@?(?:[a-z0-9-]+\\.)*${esc}\\b`, 'i').test(r),
  );
}

/** The bare address from a From header: "HDFC Bank InstaAlerts <alerts@hdfcbank.net>" → alerts@hdfcbank.net. */
export function fromAddress(header: string): string {
  const m = header.match(/<([^>]+)>/) ?? header.match(/([^\s<>"]+@[^\s<>"]+)/);
  return (m ? m[1] : '').trim().toLowerCase();
}
