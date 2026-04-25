import * as dns from 'dns';
import { promisify } from 'util';
import * as validator from 'validator';
import * as mailchecker from 'mailchecker';
import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';

const resolveMx = promisify(dns.resolveMx);
const phoneUtil = PhoneNumberUtil.getInstance();

export interface EmailValidationResult {
  isValid: boolean;
  reasons: string[];
  isDisposable: boolean;
  isGeneric: boolean;
  hasMx: boolean;
  score: number;
}

export interface PhoneValidationResult {
  isValid: boolean;
  reasons: string[];
  isFake: boolean;
  countryCode: string | null;
  formatted: string | null;
  score: number;
}

export class ValidationEngine {
  private static genericPrefixes = ['info', 'support', 'admin', 'contact', 'sales', 'help', 'hello', 'mail', 'office', 'enquiry'];

  static async validateEmail(email: string, existingEmails: string[] = []): Promise<EmailValidationResult> {
    const reasons: string[] = [];
    let score = 100;

    // 1. Regex validation
    if (!validator.isEmail(email)) {
      return { isValid: false, reasons: ['Invalid format'], isDisposable: false, isGeneric: false, hasMx: false, score: 0 };
    }

    // 2. Duplicate detection
    if (existingEmails.includes(email.toLowerCase())) {
      reasons.push('Duplicate email');
      score -= 30;
    }

    // 3. Disposable email detection
    const isDisposable = !mailchecker.isValid(email);
    if (isDisposable) {
      reasons.push('Disposable email provider');
      score -= 50;
    }

    // 4. Generic email detection
    const prefix = email.split('@')[0].toLowerCase();
    const isGeneric = this.genericPrefixes.includes(prefix);
    if (isGeneric) {
      reasons.push('Generic/Departmental email');
      score -= 20;
    }

    // 5. MX record & Domain existence
    const domain = email.split('@')[1];
    let hasMx = false;
    try {
      const mxRecords = await resolveMx(domain);
      hasMx = mxRecords && mxRecords.length > 0;
      if (!hasMx) {
        reasons.push('No MX records found');
        score -= 40;
      }
    } catch (error) {
      reasons.push('Domain does not exist or has no mail server');
      score -= 60;
      hasMx = false;
    }

    // 6. Domain Reputation (Basic check: check if it's a common public domain)
    const publicDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
    if (publicDomains.includes(domain.toLowerCase())) {
      // These are high reputation but often generic for business use
      score -= 5; 
    }

    return {
      isValid: score > 40 && hasMx,
      reasons,
      isDisposable,
      isGeneric,
      hasMx,
      score: Math.max(0, score)
    };
  }

  static validatePhone(phone: string, countryHint: string = 'US', existingPhones: string[] = []): PhoneValidationResult {
    const reasons: string[] = [];
    let score = 100;
    let isFake = false;
    let formatted = null;
    let countryCode = null;

    // 1. Clean number
    const cleaned = phone.replace(/\D/g, '');

    // 2. Fake number detection
    const fakePatterns = [
      /^0+$/,
      /^1+$/,
      /^2+$/,
      /^3+$/,
      /^4+$/,
      /^5+$/,
      /^6+$/,
      /^7+$/,
      /^8+$/,
      /^9+$/,
      /123456789/,
      /012345678/
    ];

    if (fakePatterns.some(p => p.test(cleaned)) || cleaned.length < 7) {
      isFake = true;
      reasons.push('Fake or suspicious number pattern');
      score -= 80;
    }

    // 3. Duplicate detection
    if (existingPhones.includes(cleaned)) {
      reasons.push('Duplicate phone number');
      score -= 30;
    }

    // 4. Libphonenumber integration
    try {
      const number = phoneUtil.parseAndKeepRawInput(phone, countryHint);
      const isValid = phoneUtil.isValidNumber(number);
      
      if (!isValid) {
        reasons.push('Invalid according to international standards');
        score -= 50;
      } else {
        formatted = phoneUtil.format(number, PhoneNumberFormat.E164);
        countryCode = phoneUtil.getRegionCodeForNumber(number);
        
        // WhatsApp Business detection is hard without API, but we can look for certain patterns or just mark as "Potentially Mobile"
        const type = phoneUtil.getNumberType(number);
        if (type === 1) { // MOBILE
          // Often business numbers are mobile in many countries
        }
      }
    } catch (e) {
      reasons.push('Malformed phone number');
      score -= 70;
    }

    return {
      isValid: score > 40 && !isFake,
      reasons,
      isFake,
      countryCode,
      formatted: formatted || phone,
      score: Math.max(0, score)
    };
  }
}
