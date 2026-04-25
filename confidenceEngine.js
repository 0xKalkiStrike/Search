class ConfidenceEngine {
  static calculateScore(input) {
    let score = 50; // Base score
    const reasons = [];

    if (input.foundOnContactPage) {
      score += 15;
      reasons.push('Found on official contact page');
    }
    if (input.foundInFooterHeader) {
      score += 10;
      reasons.push('Found in site footer/header');
    }
    if (input.frequency > 1) {
      score += 10;
      reasons.push(`Found ${input.frequency} times across site`);
    }
    if (input.mxValid) {
      score += 20;
      reasons.push('MX records verified');
    } else {
      score -= 20;
      reasons.push('No MX records found');
    }
    if (input.socialMatch) {
      score += 15;
      reasons.push('Matches social profile data');
    }
    if (input.googleBusinessMatch) {
      score += 20;
      reasons.push('Verified via Google Business');
    }
    if (input.externalSourceMatch) {
      score += 15;
      reasons.push('Matches external public sources');
    }

    // Penalties
    if (input.isDisposable) {
      score -= 50;
      reasons.push('Disposable email penalty');
    }
    if (input.isFake) {
      score -= 80;
      reasons.push('Fake number pattern penalty');
    }

    // Clamp score
    score = Math.min(100, Math.max(0, score));

    let status;
    if (score >= 70) {
      status = 'Auto Approve';
    } else {
      status = 'Reject';
    }

    return {
      score,
      status,
      reasons
    };
  }
}

module.exports = { ConfidenceEngine };
