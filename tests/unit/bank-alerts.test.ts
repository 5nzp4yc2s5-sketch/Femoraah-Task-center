import { describe, expect, it } from 'vitest';
import { fromAddress, htmlToText, parseAlert, senderVerified, toPaise } from '../../src/lib/bank-alerts';

// These alert texts follow the usual wording of HDFC Bank's InstaAlerts. They are written for the
// test, with made-up names, numbers and amounts; they are not copies of real emails.
const UPI_DEBIT =
  'Dear Customer, Rs.2500.00 has been debited from account **1234 to VPA vendorb@okhdfcbank VENDOR B PACKAGING on 05-11-26. ' +
  'Your UPI transaction reference number is 530912345678. If you did not authorize this transaction, please report it immediately ' +
  'by calling 18002586161 Or SMS BLOCK UPI to 7308080808. Warm Regards, HDFC Bank';
const UPI_CREDIT =
  'Dear Customer, Rs. 15000.00 is successfully credited to your account **1234 by VPA abc.traders@okaxis ABC TRADERS on 06-11-26. ' +
  'Your UPI transaction reference number is 531012345678. Thank you for banking with us. Warm Regards, HDFC Bank';
const NEFT_CREDIT =
  'Dear Customer, INR 2,00,000.00 credited to your A/c No XX1234 on 06-11-2026 through NEFT with UTR AXISCN0123456789 by ' +
  'MYNTRA DESIGNS PVT LTD, INFO: SETTLEMENT NOV. Available bal: INR 15,00,000.00 (as on 06-11-2026 10:15:00)';
const NEFT_DEBIT =
  'Dear Customer, Rs.4,00,000.00 has been debited from your HDFC Bank A/c XX1234 on 07-11-26 towards NEFT to VENDOR A FABRICS. ' +
  'Ref No. N311260123456789. Avl Bal Rs.11,00,000.00';
const CARD_SPEND =
  'Rs.1,250.00 spent on HDFC Bank Credit Card ending 5678 at AMAZON PAY INDIA on 2026-11-07:12:30:45. Avl bal: Rs.98,750.00. Not you? Call 18002586161';
const BALANCE_ONLY = 'Dear Customer, the available balance in your A/c XX1234 as on 08-NOV-26 is INR 12,34,567.89. Warm Regards, HDFC Bank';
const PROMO = 'Get a pre-approved personal loan of up to Rs. 10,00,000 instantly. Apply now on NetBanking.';

describe('toPaise', () => {
  it('reads Indian and plain amounts', () => {
    expect(toPaise('1,23,456.78')).toBe(12345678);
    expect(toPaise('2500')).toBe(250000);
    expect(toPaise('2500.5')).toBe(250050);
    expect(toPaise('12.345')).toBeNull();
  });
});

describe('parseAlert', () => {
  it('reads a UPI payment out', () => {
    expect(parseAlert('You have done a UPI txn. Check details!', UPI_DEBIT)).toEqual({
      readable: true, direction: 'out', amount_paise: 250000, last4: '1234', reference_no: '530912345678',
      counterparty: 'VENDOR B PACKAGING', balance_paise: null,
    });
  });

  it('reads a UPI receipt', () => {
    const a = parseAlert('', UPI_CREDIT);
    expect(a).toMatchObject({ direction: 'in', amount_paise: 1500000, last4: '1234', reference_no: '531012345678', counterparty: 'ABC TRADERS' });
  });

  it('reads an NEFT receipt with its UTR and the available balance', () => {
    const a = parseAlert('Account update', NEFT_CREDIT);
    expect(a).toMatchObject({
      direction: 'in', amount_paise: 20000000, last4: '1234', reference_no: 'AXISCN0123456789', counterparty: 'MYNTRA DESIGNS PVT LTD',
      balance_paise: 150000000,
    });
  });

  it('reads an NEFT payment and does not take the balance for the amount', () => {
    const a = parseAlert('', NEFT_DEBIT);
    expect(a).toMatchObject({ direction: 'out', amount_paise: 40000000, last4: '1234', reference_no: 'N311260123456789', counterparty: 'VENDOR A FABRICS', balance_paise: 110000000 });
  });

  it('reads a card spend but never takes a card limit as a bank balance', () => {
    const a = parseAlert('', CARD_SPEND);
    expect(a).toMatchObject({ direction: 'out', amount_paise: 125000, last4: '5678', counterparty: 'AMAZON PAY INDIA', balance_paise: null });
  });

  it('reads a balance-only alert', () => {
    expect(parseAlert('', BALANCE_ONLY)).toMatchObject({ readable: true, direction: null, amount_paise: null, last4: '1234', balance_paise: 123456789 });
  });

  it('does not invent a transaction from an offer', () => {
    expect(parseAlert('Special offer', PROMO)).toMatchObject({ readable: false, direction: null, amount_paise: null, balance_paise: null });
  });

  it('reads the same alert sent as HTML', () => {
    const html = `<html><head><style>p{color:red}</style></head><body><table><tr><td>Dear Customer,<br>Rs.2500.00 has been debited from account&nbsp;**1234 to VPA vendorb@okhdfcbank VENDOR B PACKAGING on 05-11-26.</td></tr><tr><td><p>Your UPI transaction reference number is 530912345678.</p></td></tr></table></body></html>`;
    expect(htmlToText(html)).toContain('account **1234');
    expect(parseAlert('', html)).toMatchObject({ direction: 'out', amount_paise: 250000, last4: '1234', reference_no: '530912345678', counterparty: 'VENDOR B PACKAGING' });
  });
});

describe('sender checks', () => {
  it('takes the address out of a From header', () => {
    expect(fromAddress('HDFC Bank InstaAlerts <alerts@hdfcbank.net>')).toBe('alerts@hdfcbank.net');
    expect(fromAddress('alerts@hdfcbank.bank.in')).toBe('alerts@hdfcbank.bank.in');
  });

  it('trusts only emails Gmail verified as coming from that domain', () => {
    const pass = 'mx.google.com; dkim=pass header.i=@hdfcbank.net header.s=sel1 header.b=abc; spf=pass smtp.mailfrom=alerts@hdfcbank.net; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=hdfcbank.net';
    const spoof = 'mx.google.com; dkim=none; spf=softfail smtp.mailfrom=alerts@hdfcbank.net; dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=hdfcbank.net';
    expect(senderVerified([pass], 'alerts@hdfcbank.net')).toBe(true);
    expect(senderVerified([spoof], 'alerts@hdfcbank.net')).toBe(false);
    expect(senderVerified([pass], 'alerts@hdfcbank.bank.in')).toBe(false);
    expect(senderVerified([], 'alerts@hdfcbank.net')).toBe(false);
  });
});
