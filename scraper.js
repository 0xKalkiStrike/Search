const path = require('path');
const fs = require('fs');

const { chromium } = require('playwright');
const { ValidationEngine } = require('./validationEngine');
const { ConfidenceEngine } = require('./confidenceEngine');

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

async function searchDetails(items, preferredSource, onStatus) {
  const isCloud = process.env.VERCEL || process.env.RENDER || false;
  if (onStatus) onStatus(`[SYSTEM] Initializing browser engine...`);
  
  let browser;
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
  } catch (launchError) {
    if (onStatus) onStatus(`[CRITICAL] Browser engine failed to start: ${launchError.message}`);
    throw new Error(`Browser launch failed: ${launchError.message}`);
  }
  
  const results = [];

  for (const item of items) {
    let success = false;
    let data = null;

    if (item.url && item.url.startsWith('http')) {
      try {
        if (onStatus) onStatus(`[PLAYWRIGHT] Connecting to ${item.url}...`);
        data = await scrapeWithPlaywright(browser, item.url, item, onStatus);
        success = true;
      } catch (err) {
        if (onStatus) onStatus(`[WARN] Playwright fetch failed for ${item.url}: ${err.message}`);
      }
    }

    if (!data || (data.email === 'Not found' && data.phone === 'Not found')) {
      try {
        if (onStatus) onStatus(`[ENRICH] Initiating Search-Based Intelligence for ${item.query}...`);
        const enrichedData = await enrichWithSearch(browser, item, onStatus);
        
        if (enrichedData.email !== 'Not found' || enrichedData.phone !== 'Not found') {
          if (!data) {
            data = {
              row: item.row,
              query: item.query,
              url: item.url || 'Search Result',
              ...enrichedData,
              validatedEmails: [],
              validatedPhones: [],
              proofs: []
            };
          } else {
            data = { ...data, ...enrichedData };
          }
          success = true;
        }
      } catch (err) {
        if (onStatus) onStatus(`[WARN] Enrichment failed: ${err.message}`);
      }
    }

    if (!data) {
        data = {
            row: item.row,
            query: item.query || 'N/A',
            details: "Information could not be verified automatically.",
            url: item.url || 'N/A',
            phone: 'Not found',
            email: 'Not found',
            validation: null,
            confidence: { score: 0, status: 'Reject', reasons: ['Failed to reach source or block detected'] },
            proofs: []
        };
    }

    results.push(data);
    const delay = Math.floor(Math.random() * 2000) + (isCloud ? 3000 : 2000);
    await new Promise(r => setTimeout(r, delay));
  }

  await browser.close();
  return results;
}

async function scrapeWithPlaywright(browser, url, item, onStatus) {
  const isCloud = process.env.VERCEL || process.env.RENDER || false;
  const context = await browser.newContext({
    userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  
  try {
    if (onStatus) onStatus(`[PLAYWRIGHT] Scoping ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: isCloud ? 45000 : 30000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(isCloud ? 5000 : 3000);
    await page.evaluate(() => window.scrollTo(0, 0));
    
    let allEmails = [];
    let allPhones = [];
    let proofs = [];
    let finalUrl = url;

    const extract = async (p) => {
      const bodyText = await p.innerText('body').catch(() => "");
      const html = await p.content().catch(() => "");
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const obfuscatedEmailRegex = /[a-zA-Z0-9._%+-]+\s?(?:\[at\]|@|\(at\))\s?[a-zA-Z0-9.-]+\s?(?:\.|\[dot\]|\(dot\))\s?[a-zA-Z]{2,}/gi;
      const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}?\)?[-.\s]?\d{3,4}[-.\s]?\d{4,6}/g;
      
      const emails = [
        ...(bodyText.match(emailRegex) || []),
        ...(html.match(emailRegex) || []),
        ...(bodyText.match(obfuscatedEmailRegex) || []).map(e => e.replace(/\[at\]|\(at\)/gi, '@').replace(/\[dot\]|\(dot\)/gi, '.').replace(/\s/g, ''))
      ];
      const phones = [
        ...(bodyText.match(phoneRegex) || []),
        ...(html.match(phoneRegex) || [])
      ];
      const mailtos = await p.$$eval('a[href^="mailto:"]', els => els.map(el => el.getAttribute('href')?.replace('mailto:', '').split('?')[0] || '')).catch(() => []);
      const tels = await p.$$eval('a[href^="tel:"]', els => els.map(el => el.getAttribute('href')?.replace('tel:', '') || '')).catch(() => []);
      
      return { 
        emails: [...new Set([...emails, ...mailtos])].filter(e => e.includes('@') && e.length > 5), 
        phones: [...new Set([...phones, ...tels])].filter(p => p.replace(/\D/g, '').length >= 8)
      };
    };

    const firstPass = await extract(page);
    allEmails.push(...firstPass.emails);
    allPhones.push(...firstPass.phones);

    if (allEmails.length === 0 && allPhones.length === 0) {
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors
          .map(a => ({ href: a.href, text: a.innerText.toLowerCase() }))
          .filter(a => a.text.includes('contact') || a.text.includes('about') || a.text.includes('support') || a.text.includes('reach') || a.text.includes('help'))
          .map(a => a.href);
      }).catch(() => []);

      const uniqueLinks = [...new Set(links)].slice(0, 3);
      for (const link of uniqueLinks) {
        if (link && link !== url && link.startsWith('http')) {
          try {
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: isCloud ? 25000 : 15000 });
            await page.waitForTimeout(2000);
            const pass = await extract(page);
            allEmails.push(...pass.emails);
            allPhones.push(...pass.phones);
            if (allEmails.length > 0 || allPhones.length > 0) {
              finalUrl = link;
              break; 
            }
          } catch (e) {}
        }
      }
    }

    const uniqueEmails = [...new Set(allEmails.map(e => e.toLowerCase()))].slice(0, 5);
    const uniquePhones = [...new Set(allPhones)].slice(0, 5);
    const validatedEmails = [];
    const validatedPhones = [];

    for (const email of uniqueEmails) {
      const validation = await ValidationEngine.validateEmail(email);
      const proofPath = await captureProof(page, email, `email_${item.row}_${Date.now()}.png`);
      if (proofPath) proofs.push(proofPath);
      validatedEmails.push({ value: email, ...validation, proof: proofPath });
    }

    for (const phone of uniquePhones) {
      const validation = ValidationEngine.validatePhone(phone);
      const proofPath = await captureProof(page, phone, `phone_${item.row}_${Date.now()}.png`);
      if (proofPath) proofs.push(proofPath);
      validatedPhones.push({ value: phone, ...validation, proof: proofPath });
    }

    const bodyText = await page.innerText('body').catch(() => "N/A");
    const title = await page.title().catch(() => "N/A");
    const isContactPage = finalUrl.toLowerCase().includes('contact');
    const bestEmail = validatedEmails.find(e => e.isValid) || validatedEmails[0];
    const bestPhone = validatedPhones.find(p => p.isValid) || validatedPhones[0];

    const socials = { twitter: null, facebook: null, instagram: null, linkedin: null, whatsapp: null };
    const allLinks = await page.$$eval('a', (els) => els.map(a => a.href)).catch(() => []);
    allLinks.forEach(l => {
        const low = l.toLowerCase();
        if (low.includes('linkedin.com/company/') || low.includes('linkedin.com/in/')) socials.linkedin = l;
        if (low.includes('facebook.com/')) socials.facebook = l;
        if (low.includes('instagram.com/')) socials.instagram = l;
        if (low.includes('twitter.com/') || low.includes('x.com/')) socials.twitter = l;
        if (low.includes('wa.me/') || low.includes('whatsapp.com/send')) socials.whatsapp = l;
    });

    const confidenceInput = {
      foundOnContactPage: isContactPage,
      foundInFooterHeader: true,
      frequency: allEmails.length + allPhones.length,
      mxValid: bestEmail ? bestEmail.hasMx : false,
      socialMatch: !!(socials.linkedin || socials.facebook || socials.instagram),
      googleBusinessMatch: false, 
      externalSourceMatch: !!socials.whatsapp,
      isDisposable: bestEmail ? bestEmail.isDisposable : false,
      isFake: bestPhone ? bestPhone.isFake : false
    };

    const confidence = ConfidenceEngine.calculateScore(confidenceInput);

    return {
      row: item.row,
      query: item.query || title,
      details: bodyText.substring(0, 300).replace(/\s+/g, ' ').trim() + '...',
      url: finalUrl,
      phone: validatedPhones.map(p => p.formatted || p.value).join(', ') || 'Not found',
      email: validatedEmails.map(e => e.value).join(', ') || 'Not found',
      validatedEmails,
      validatedPhones,
      confidence,
      proofs: [...new Set(proofs)],
      score: confidence.score
    };

  } finally {
    await page.close();
    await context.close();
  }
}

async function enrichWithSearch(browser, item, onStatus) {
  const isCloud = process.env.VERCEL || process.env.RENDER || false;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const query = encodeURIComponent(`"${item.query}" contact email phone number`);
    const searchUrl = `https://www.google.com/search?q=${query}`;
    if (onStatus) onStatus(`[ENRICH] Searching Google for ${item.query}...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: isCloud ? 30000 : 20000 });
    await page.waitForTimeout(3000);

    const searchResults = await page.$$eval('div.g', els => els.slice(0, 5).map(el => {
      const link = el.querySelector('a')?.href;
      const snippet = el.innerText;
      return { link, snippet };
    })).catch(() => []);

    let foundEmails = [];
    let foundPhones = [];
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}?\)?[-.\s]?\d{3,4}[-.\s]?\d{4,6}/g;

    for (const res of searchResults) {
      const emails = res.snippet.match(emailRegex) || [];
      const phones = res.snippet.match(phoneRegex) || [];
      foundEmails.push(...emails);
      foundPhones.push(...phones);

      if (res.link && !res.link.includes('facebook.com') && !res.link.includes('youtube.com') && !res.link.includes('instagram.com') && !res.link.includes('linkedin.com') && (foundEmails.length < 2 || foundPhones.length < 2)) {
         try {
           const tempPage = await context.newPage();
           await tempPage.goto(res.link, { waitUntil: 'domcontentloaded', timeout: 15000 });
           const body = await tempPage.innerText('body').catch(() => "");
           const html = await tempPage.content().catch(() => "");
           foundEmails.push(...(body.match(emailRegex) || []));
           foundEmails.push(...(html.match(emailRegex) || []));
           foundPhones.push(...(body.match(phoneRegex) || []));
           foundPhones.push(...(html.match(phoneRegex) || []));
           await tempPage.close();
         } catch(e) {}
      }
    }

    const uniqueEmails = [...new Set(foundEmails.map(e => e.toLowerCase()))].filter(e => e.length > 5);
    const uniquePhones = [...new Set(foundPhones)].filter(p => p.replace(/\D/g, '').length >= 8);
    const score = uniqueEmails.length > 0 || uniquePhones.length > 0 ? 80 : 40;
    return {
      email: uniqueEmails.join(', ') || 'Not found',
      phone: uniquePhones.join(', ') || 'Not found',
      details: `Enriched via Search Results: ${searchResults.length} sources analyzed.`,
      confidence: { score: score, status: (score >= 70 ? 'Auto Approve' : 'Reject'), reasons: ['Enriched via external search'] }
    };
  } finally {
    await page.close();
    await context.close();
  }
}

async function captureProof(page, text, filename) {
  const isCloud = process.env.VERCEL || process.env.RENDER || false;
  try {
    const element = await page.evaluateHandle((searchText) => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while (node = walk.nextNode()) {
        if (node.textContent && node.textContent.includes(searchText)) return node.parentElement;
      }
      return null;
    }, text);

    if (element && element.asElement()) {
      const el = element.asElement();
      const proofDir = isCloud ? '/tmp/proofs' : path.join(process.cwd(), 'public', 'proofs');
      if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });
      const filePath = path.join(proofDir, filename);
      await el.screenshot({ path: filePath });
      return `/proofs/${filename}`;
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { searchDetails };
