import { chromium, Browser, Page, ElementHandle } from 'playwright';
import { ValidationEngine, EmailValidationResult, PhoneValidationResult } from './validationEngine';
import { ConfidenceEngine, ConfidenceResult, ConfidenceInput } from './confidenceEngine';
import * as path from 'path';
import * as fs from 'fs';

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

export async function searchDetails(items: any[], preferredSource: string, onStatus: (msg: string) => void) {
  const browser = await chromium.launch({ headless: true });
  const results: any[] = [];

  for (const item of items) {
    let success = false;
    let data: any = null;

    if (item.url && item.url.startsWith('http')) {
      try {
        if (onStatus) onStatus(`[PLAYWRIGHT] Connecting to ${item.url}...`);
        data = await scrapeWithPlaywright(browser, item.url, item, onStatus);
        success = true;
      } catch (err: any) {
        if (onStatus) onStatus(`[WARN] Playwright fetch failed for ${item.url}: ${err.message}`);
      }
    }

    // If initial scrape failed to find info, try enrichment
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
      } catch (err: any) {
        if (onStatus) onStatus(`[WARN] Enrichment failed: ${err.message}`);
      }
    }

    // Fallback if still no data
    if (!data) {
        data = {
            row: item.row,
            query: item.query || 'N/A',
            details: "Information could not be verified automatically.",
            url: item.url || 'N/A',
            phone: 'Not found',
            email: 'Not found',
            validation: null,
            confidence: { score: 0, status: 'Reject', reasons: ['Failed to reach source'] },
            proofs: []
        };
    }

    results.push(data);

    // Stealth delay
    const delay = Math.floor(Math.random() * 2000) + 2000;
    await new Promise(r => setTimeout(r, delay));
  }

  await browser.close();
  return results;
}

async function scrapeWithPlaywright(browser: Browser, url: string, item: any, onStatus: (msg: string) => void) {
  const context = await browser.newContext({
    userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  
  try {
    if (onStatus) onStatus(`[PLAYWRIGHT] Scoping ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Aggressive loading for SPAs
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollTo(0, 0));
    
    let allEmails: string[] = [];
    let allPhones: string[] = [];
    let proofs: string[] = [];
    let finalUrl = url;

    const extract = async (p: Page) => {
      const bodyText = await p.innerText('body');
      const html = await p.content();
      
      // 1. Text & HTML-based extraction (Enhanced Regex)
      // Robust Email Regex including obfuscated patterns
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const obfuscatedEmailRegex = /[a-zA-Z0-9._%+-]+\s?(?:\[at\]|@|\(at\))\s?[a-zA-Z0-9.-]+\s?(?:\.|\[dot\]|\(dot\))\s?[a-zA-Z]{2,}/gi;
      
      // Broad Phone Regex for international formats
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
      
      // 2. Attribute-based extraction (mailto/tel)
      const mailtos = await p.$$eval('a[href^="mailto:"]', els => els.map(el => el.getAttribute('href')?.replace('mailto:', '').split('?')[0] || ''));
      const tels = await p.$$eval('a[href^="tel:"]', els => els.map(el => el.getAttribute('href')?.replace('tel:', '') || ''));
      
      return { 
        emails: [...new Set([...emails, ...mailtos])].filter(e => e.includes('@') && e.length > 5), 
        phones: [...new Set([...phones, ...tels])].filter(p => p.replace(/\D/g, '').length >= 8)
      };
    };

    const firstPass = await extract(page);
    allEmails.push(...firstPass.emails);
    allPhones.push(...firstPass.phones);

    // 3. Auto-Navigation to Contact Page if needed (Multiple attempts)
    if (allEmails.length === 0 && allPhones.length === 0) {
      if (onStatus) onStatus(`[DEEP SCAN] No info on home. Searching for Contact/About pages...`);
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors
          .map(a => ({ href: a.href, text: a.innerText.toLowerCase() }))
          .filter(a => 
            a.text.includes('contact') || 
            a.text.includes('about') || 
            a.text.includes('support') || 
            a.text.includes('reach') ||
            a.text.includes('help')
          )
          .map(a => a.href);
      });

      const uniqueLinks = [...new Set(links)].slice(0, 3); // Try up to 3 likely pages

      for (const link of uniqueLinks) {
        if (link && link !== url && link.startsWith('http')) {
          try {
            if (onStatus) onStatus(`[DEEP SCAN] Checking ${link}...`);
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
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

    const validatedEmails: any[] = [];
    const validatedPhones: any[] = [];

    // 4. Validate & Take Proofs
    for (const email of uniqueEmails) {
      const validation = await ValidationEngine.validateEmail(email);
      const proofPath = await captureProof(page, email, `email_${item.row}_${Date.now()}.png`);
      if (proofPath) proofs.push(proofPath);
      validatedEmails.push({ value: email, ...validation, proof: proofPath });
    }

    for (const phone of uniquePhones) {
      const validation = ValidationEngine.validatePhone(phone);
      // Clean phone for proof finding
      const cleanPhone = phone.replace(/[()\-.\s]/g, '');
      const proofPath = await captureProof(page, phone, `phone_${item.row}_${Date.now()}.png`);
      if (proofPath) proofs.push(proofPath);
      validatedPhones.push({ value: phone, ...validation, proof: proofPath });
    }

    const bodyText = await page.innerText('body');
    const title = await page.title();
    const isContactPage = finalUrl.toLowerCase().includes('contact');
    
    // Combine validation results for a global confidence score
    const bestEmail = validatedEmails.find(e => e.isValid) || validatedEmails[0];
    const bestPhone = validatedPhones.find(p => p.isValid) || validatedPhones[0];

    const socials: any = { twitter: null, facebook: null, instagram: null, linkedin: null, whatsapp: null };
    const allLinks = await page.$$eval('a', (els) => els.map(a => a.href));
    allLinks.forEach(l => {
        const low = l.toLowerCase();
        if (low.includes('linkedin.com/company/') || low.includes('linkedin.com/in/')) socials.linkedin = l;
        if (low.includes('facebook.com/')) socials.facebook = l;
        if (low.includes('instagram.com/')) socials.instagram = l;
        if (low.includes('twitter.com/') || low.includes('x.com/')) socials.twitter = l;
        if (low.includes('wa.me/') || low.includes('whatsapp.com/send')) socials.whatsapp = l;
    });

    const confidenceInput: ConfidenceInput = {
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

async function enrichWithSearch(browser: Browser, item: any, onStatus: (msg: string) => void) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const query = encodeURIComponent(`"${item.query}" contact email phone number`);
    const searchUrl = `https://www.google.com/search?q=${query}`;
    
    if (onStatus) onStatus(`[ENRICH] Searching Google for ${item.query}...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Extract potential links and snippets
    const searchResults = await page.$$eval('div.g', els => els.slice(0, 5).map(el => {
      const link = el.querySelector('a')?.href;
      const snippet = (el as HTMLElement).innerText;
      return { link, snippet };
    }));

    let foundEmails: string[] = [];
    let foundPhones: string[] = [];

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}?\)?[-.\s]?\d{3,4}[-.\s]?\d{4,6}/g;

    for (const res of searchResults) {
      // 1. Extract from snippet
      const emails = res.snippet.match(emailRegex) || [];
      const phones = res.snippet.match(phoneRegex) || [];
      foundEmails.push(...emails);
      foundPhones.push(...phones);

      // 2. Deep scrape the result link if it looks promising and is not a major platform
      if (res.link && 
          !res.link.includes('facebook.com') && 
          !res.link.includes('youtube.com') && 
          !res.link.includes('instagram.com') &&
          !res.link.includes('linkedin.com') &&
          (foundEmails.length < 2 || foundPhones.length < 2)) {
         try {
           if (onStatus) onStatus(`[ENRICH] Checking external source: ${res.link.substring(0, 40)}...`);
           const tempPage = await context.newPage();
           await tempPage.goto(res.link, { waitUntil: 'domcontentloaded', timeout: 12000 });
           const body = await tempPage.innerText('body');
           const html = await tempPage.content();
           
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

    return {
      email: uniqueEmails.join(', ') || 'Not found',
      phone: uniquePhones.join(', ') || 'Not found',
      details: `Enriched via Search Results: ${searchResults.length} sources analyzed.`,
      confidence: { score: uniqueEmails.length > 0 || uniquePhones.length > 0 ? 80 : 40, status: (uniqueEmails.length > 0 || uniquePhones.length > 0 ? 'Auto Approve' : 'Reject'), reasons: ['Enriched via external search'] }
    };
  } finally {
    await page.close();
    await context.close();
  }
}

async function captureProof(page: Page, text: string, filename: string): Promise<string | null> {
  try {
    // Find the element containing the text
    // We use a more robust selector to find the smallest element containing the text
    const element = await page.evaluateHandle((searchText) => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while (node = walk.nextNode()) {
        if (node.textContent && node.textContent.includes(searchText)) {
          return node.parentElement;
        }
      }
      return null;
    }, text);

    if (element && (element as ElementHandle).asElement()) {
      const el = (element as ElementHandle).asElement();
      const proofDir = path.join(process.cwd(), 'public', 'proofs');
      if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });
      
      const filePath = path.join(proofDir, filename);
      await el?.screenshot({ path: filePath });
      return `/proofs/${filename}`;
    }
    return null;
  } catch (e) {
    return null;
  }
}
