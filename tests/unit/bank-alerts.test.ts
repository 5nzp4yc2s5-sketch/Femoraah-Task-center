import { describe, expect, it } from 'vitest';
import { fromAddress, htmlToText, isNoticeNote, parseAlert, senderVerified, toPaise } from '../../src/lib/bank-alerts';

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
// The wording HDFC Bank used in November 2026 for each kind of alert (alerts@hdfcbank.bank.in). Names,
// numbers and amounts are made up.
const H_DEPOSIT_SUBJECT = '\u2757 New Deposit Alert: Check your A/c balance now!';
const H_DEPOSIT =
  'Dear Customer, You have received a credit in your HDFC Bank account. Details of the transaction: Amount received: INR 12,345.67 ' +
  'Account: XX1234 Date: 13-NOV-2026 Reference Details: NEFT Cr-ABCD0123456-ACME RETAIL PRIVATE LIMITED-OUR COMPANY PRIVATE LIMITED-ABCDH12345678901 ' +
  'Available Balance: INR 1,54,321.08 For real-time account balance, please call 1800 270 3333. Thank you for banking with HDFC Bank. Warm Regards, HDFC Bank';
const H_DEPOSIT_FT =
  'Dear Customer, You have received a credit in your HDFC Bank account. Details of the transaction: Amount received: INR 1,23456.78 ' +
  'Account: XX1234 Date: 10-NOV-2026 Reference Details: FT- CID123456-ACME RETAIL PRIVATE LIMITED Available Balance: INR 3,21,000.50 ' +
  'For real-time account balance, please call 1800 270 3333.';
const H_UPDATE_SUBJECT = 'View: Account update for your HDFC Bank A/c';
const H_NEFT_OUT =
  'Dear Customer, Thank you for banking with HDFC Bank. Rs. 120000 has been deducted from your HDFC Bank account ending in XX1234 ' +
  "for a transfer to payee Vendor A via NEFT using HDFC Bank Online Banking. Not you? Call 18002586161/SMS 'BLOCK OB' to 7308080808 from your registered mobile number. Warm Regards, HDFC Bank";
const H_RTGS_OUT =
  'Dear Customer, Thank you for banking with HDFC Bank. You have successfully initiated RTGS transaction of Rs. 250000 from your HDFC Bank A/c XX1234 ' +
  'for a transfer to payee Vendor A using HDFC Bank Online Banking. Not you? Call 18002586161.';
const H_CARD_SUBJECT = 'Rs.555.30 debited via Debit Card **5678';
const H_CARD =
  'Dear Customer, Greetings from HDFC Bank! Rs.555.30 is debited from your HDFC Bank Debit Card ending 5678 at Corner Store and Co on 10 Nov, 2026 at 08:41:41. ' +
  'For more details on this transaction, please log in to NetBanking -> Accounts. If you did not authorize this transaction, please report it immediately at: ' +
  '1. When in India (Toll free): 1800 258 6161 2. When abroad: +9122 61606160 3. Or SMS "BLOCK DEBIT CARD 5678" to 7308080808';
const H_ATM =
  'Dear Card Holder, Thank you for using your HDFC Bank Debit Card ending 5678 for ATM withdrawal for Rs 5000.00 in SAMPLE CITY at SAMPLE EAST BRANCH on 08-11-2026 12:00:00. ' +
  'After the above transaction, the total available balance on your card is Rs 41234.50. For more details on this transaction please visit Netbanking-Login here - Accounts.';
const H_REVERSAL =
  'Dear Card Member, We note that a transaction for Rs 850.00, on your HDFC Bank Debit Card ending 5678 at TRAVEL SITE INDIA PVT L on 26-10-2026 20:00:00 is reversed. ' +
  'Contact Bank if refund is not received in 7 working days.';
const H_PAYEE_ADDED =
  'Dear Customer, Thank you for banking with HDFC Bank. An addition of the payee Vendor A with Account number ending with XX9999 is done using HDFC Bank Online Banking.';
const H_FOREX_SUBJECT = 'Important: Forex Conversion Markup Fee on cross border transaction using Debit Card Transaction';
const H_FOREX =
  'Dear Customer, Thank you for choosing HDFC Bank! Recent International Transaction Alert: Your HDFC Bank Debit Card ending in XX5678 was used for an ' +
  'international purchase of INR 1234.56 on 15/10/2026 at SHOP.COM. A markup fee of 3.5% plus taxes will be charged.';
const H_DECLINED_SUBJECT = 'Payment Unsuccessful - Online usage disabled on your HDFC Bank Debit Card ending with 5678';
const H_DECLINED =
  "Dear Customer, Greetings from HDFC Bank! Here is an important update for you. We'd like to inform you that a transaction using your HDFC Bank Debit Card " +
  'ending with 5678 could not be completed. Transaction amount: Rs. 1,499.00 at SHOP.COM.';
const H_CARD_SETTINGS =
  'Dear Customer, Thank you for Banking with us. This is to inform you have modified Card usage settings for Debit Card ending with 5678 on ' +
  '2026-10-15T14:48:18 05:30 via Online Banking. To modify the same, please log in to NetBanking or MobileBanking App. Regards, HDFC Bank';
const PROMO = 'Get a pre-approved personal loan of up to Rs. 10,00,000 instantly. Apply now on NetBanking.';

describe('HDFC Bank alerts as sent in November 2026', () => {
  it('marks failed payments, forex fee notices and new payees as notices that need nothing doing', () => {
    for (const [subject, body] of [[H_DECLINED_SUBJECT, H_DECLINED], [H_FOREX_SUBJECT, H_FOREX], [H_UPDATE_SUBJECT, H_PAYEE_ADDED], [H_UPDATE_SUBJECT, H_CARD_SETTINGS]]) {
      expect(isNoticeNote(parseAlert(subject, body).note)).toBe(true);
    }
    expect(parseAlert(H_UPDATE_SUBJECT, H_CARD_SETTINGS)).toMatchObject({ readable: false, amount_paise: null, last4: '5678', note: 'Debit card settings were changed; no money moved' });
    expect(isNoticeNote(parseAlert(H_CARD_SUBJECT, H_CARD).note)).toBe(false);
    expect(isNoticeNote('The app could not read the amount from this email')).toBe(false);
    expect(isNoticeNote('')).toBe(false);
  });
  it('reads a deposit with the payer, the UTR and the balance', () => {
    expect(parseAlert(H_DEPOSIT_SUBJECT, H_DEPOSIT)).toEqual({
      readable: true, direction: 'in', amount_paise: 1234567, last4: '1234', reference_no: 'ABCDH12345678901',
      counterparty: 'ACME RETAIL PRIVATE LIMITED', balance_paise: 15432108,
    });
  });

  it('reads a fund transfer deposit but does not take the customer number as its reference', () => {
    const r = parseAlert(H_DEPOSIT_SUBJECT, H_DEPOSIT_FT);
    expect(r).toMatchObject({ direction: 'in', amount_paise: 12345678, last4: '1234', reference_no: '', balance_paise: 32100050 });
  });

  it('reads an online banking transfer out with the payee', () => {
    expect(parseAlert(H_UPDATE_SUBJECT, H_NEFT_OUT)).toEqual({
      readable: true, direction: 'out', amount_paise: 12000000, last4: '1234', reference_no: '', counterparty: 'Vendor A', balance_paise: null,
    });
  });

  it('reads an RTGS transfer that was started', () => {
    expect(parseAlert(H_UPDATE_SUBJECT, H_RTGS_OUT)).toMatchObject({ readable: true, direction: 'out', amount_paise: 25000000, last4: '1234', counterparty: 'Vendor A' });
  });

  it('reads a debit card payment with the shop and the card digits', () => {
    expect(parseAlert(H_CARD_SUBJECT, H_CARD)).toEqual({
      readable: true, direction: 'out', amount_paise: 55530, last4: '5678', reference_no: '', counterparty: 'Corner Store and Co', balance_paise: null,
    });
  });

  it('reads an ATM withdrawal and the balance after it', () => {
    expect(parseAlert(H_UPDATE_SUBJECT, H_ATM)).toEqual({
      readable: true, direction: 'out', amount_paise: 500000, last4: '5678', reference_no: '', counterparty: 'ATM SAMPLE EAST BRANCH', balance_paise: 4123450,
    });
  });

  it('reads a reversed card payment as money in', () => {
    expect(parseAlert(H_UPDATE_SUBJECT, H_REVERSAL)).toMatchObject({ readable: true, direction: 'in', amount_paise: 85000, last4: '5678', counterparty: 'TRAVEL SITE INDIA PVT L' });
  });

  it('records nothing for a new payee, a forex fee notice or a payment that failed', () => {
    for (const [subject, body] of [[H_UPDATE_SUBJECT, H_PAYEE_ADDED], [H_FOREX_SUBJECT, H_FOREX], [H_DECLINED_SUBJECT, H_DECLINED]]) {
      const r = parseAlert(subject, body);
      expect(r).toMatchObject({ readable: false, direction: null, amount_paise: null, balance_paise: null });
      expect(r.note).toBeTruthy();
    }
  });
});

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
