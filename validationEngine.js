const dns = require('dns');
const { promisify } = require('util');
const validator = require('validator');
const mailchecker = require('mailchecker');
const { PhoneNumberUtil, PhoneNumberFormat } = require('google-libphonenumber');

const resolveMx = promisify(dns.resolveMx);
const phoneUtil = PhoneNumberUtil.getInstance();

class ValidationEngine {
  static genericPrefixes = ['info', 'support', 'admin', 'contact', 'sales', 'help', 'hello', 'mail', 'office', 'enquiry'];

  static async validateEmail(email, existingEmails = []) {
    const reasons = [];
    let score = 100;

    if (!validator.isEmail(email)) {
      return { isValid: false, reasons: ['Invalid format'], isDisposable: false, isGeneric: false, hasMx: false, score: 0 };
    }

    if (existingEmails.includes(email.toLowerCase())) {
      reasons.push('Duplicate email');
      score -= 30;
    }

    const isDisposable = !mailchecker.isValid(email);
    if (isDisposable) {
      reasons.push('Disposable email provider');
      score -= 50;
    }

    const prefix = email.split('@')[0].toLowerCase();
    const isGeneric = this.genericPrefixes.includes(prefix);
    if (isGeneric) {
      reasons.push('Generic/Departmental email');
      score -= 20;
    }

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

    const publicDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
    if (publicDomains.includes(domain.toLowerCase())) {
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

  static validatePhone(phone, countryHint = 'US', existingPhones = []) {
    const reasons = [];
    let score = 100;
    let isFake = false;
    let formatted = null;
    let countryCode = null;

    const cleaned = phone.replace(/\D/g, '');
    const fakePatterns = [
      /^0+$/, /^1+$/, /^2+$/, /^3+$/, /^4+$/, /^5+$/, /^6+$/, /^7+$/, /^8+$/, /^9+$/,
      /123456789/, /012345678/
    ];

    if (fakePatterns.some(p => p.test(cleaned)) || cleaned.length < 7) {
      isFake = true;
      reasons.push('Fake or suspicious number pattern');
      score -= 80;
    }

    if (existingPhones.includes(cleaned)) {
      reasons.push('Duplicate phone number');
      score -= 30;
    }

    try {
      const number = phoneUtil.parseAndKeepRawInput(phone, countryHint);
      const isValid = phoneUtil.isValidNumber(number);
      
      if (!isValid) {
        reasons.push('Invalid according to international standards');
        score -= 50;
      } else {
        formatted = phoneUtil.format(number, PhoneNumberFormat.E164);
        countryCode = phoneUtil.getRegionCodeForNumber(number);
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

module.exports = { ValidationEngine };
