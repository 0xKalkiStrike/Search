import puppeteer, { Browser } from 'puppeteer';
import * as cheerio from 'cheerio';
import { CompanyMetadata } from './types';

export async function searchDuckDuckGo(query: string, num: number = 3): Promise<string[]> {
  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    console.log('Searching DDG:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    
    // Wait for results
    await page.waitForSelector('.result__a, article h2 a', { timeout: 10000 });
    
    const content = await page.content();
    const $ = cheerio.load(content);
    const links: string[] = [];
    
    $('.result__a, article h2 a').each((i, el) => {
      if (i < num) {
        const href = $(el).attr('href');
        if (href && !href.includes('duckduckgo.com')) {
          links.push(href);
        }
      }
    });

    console.log('Found links:', links);
    return links;
  } catch (err) {
    console.error('Search failed:', err);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

export async function screenCompany(name: string): Promise<CompanyMetadata> {
  const result: CompanyMetadata = {
    name,
    socials: {},
    branding: {
      score: 0,
      description: 'Pending analysis',
      isModern: false,
      hasLogo: false,
      attractiveness: 'Average'
    },
    screening: {
      status: 'Checking'
    }
  };

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    // 1. Find Website
    const searchResults = await searchDuckDuckGo(`${name} official website`);
    const website = searchResults[0];
    
    if (!website) {
      result.screening.status = 'Offline';
      return result;
    }

    result.website = website;
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    
    const startTime = Date.now();
    await page.goto(website, { waitUntil: 'networkidle2', timeout: 30000 });
    result.screening.loadTime = Date.now() - startTime;
    result.screening.status = 'Online';

    const content = await page.content();
    const $ = cheerio.load(content);

    // 2. Extract Socials
    $('a').each((i, el) => {
      const href = $(el).attr('href')?.toLowerCase() || '';
      if (href.includes('linkedin.com/company')) result.socials.linkedin = href;
      if (href.includes('twitter.com/') || href.includes('x.com/')) result.socials.twitter = href;
      if (href.includes('facebook.com/')) result.socials.facebook = href;
      if (href.includes('instagram.com/')) result.socials.instagram = href;
    });

    // 3. Branding Assessment (Heuristic)
    const hasFavicon = $('link[rel*="icon"]').length > 0;
    const hasGtm = content.includes('googletagmanager');
    const hasTailwind = content.includes('tailwind');
    const hasNext = content.includes('_next');
    const metaViewport = $('meta[name="viewport"]').length > 0;
    
    let brandingScore = 30;
    if (hasFavicon) brandingScore += 10;
    if (metaViewport) brandingScore += 10;
    if (hasGtm) brandingScore += 10;
    if (hasTailwind || hasNext) brandingScore += 20;
    
    const imgs = $('img');
    const logoKeywords = ['logo', 'brand', 'header'];
    const hasLogo = imgs.toArray().some(img => {
      const alt = $(img).attr('alt')?.toLowerCase() || '';
      const src = $(img).attr('src')?.toLowerCase() || '';
      return logoKeywords.some(k => alt.includes(k) || src.includes(k));
    });
    
    if (hasLogo) brandingScore += 20;
    
    result.branding.hasLogo = hasLogo;
    result.branding.isModern = hasNext || hasTailwind;
    result.branding.score = Math.min(brandingScore, 100);
    
    if (brandingScore > 80) result.branding.attractiveness = 'Stunning';
    else if (brandingScore > 50) result.branding.attractiveness = 'Average';
    else result.branding.attractiveness = 'Poor';
    
    result.branding.description = `${result.branding.isModern ? 'Modern tech stack detected. ' : ''}${hasLogo ? 'Professional branding present.' : 'Missing clear brand identification.'}`;

    // 4. Ratings/Reviews
    const reviewLinks = await searchDuckDuckGo(`${name} reviews trustpilot glassdoor g2`);
    if (reviewLinks.length > 0) {
       result.screening.summary = `Potential reviews found at ${new URL(reviewLinks[0]).hostname}`;
    }

  } catch (error) {
    console.error(`Error screening ${name}:`, error);
    result.screening.status = 'Offline';
  } finally {
    if (browser) await browser.close();
  }

  return result;
}
