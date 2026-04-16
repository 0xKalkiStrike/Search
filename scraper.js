const axios = require('axios');
const cheerio = require('cheerio');

// Highly varied and modern User Agents to mimic real desktop browsers
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.2420.81',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

/**
 * Intelligent Data Search Engine.
 * Attempts multiple providers (Google, Bing, Brave, DDG) to ensure successful results.
 */
async function searchDetails(items, preferredSource, onStatus) {
  const results = [];
  
  for (const item of items) {
    let success = false;
    
    // If a direct URL is provided, prioritize it and skip search engines
    if (item.url && item.url.startsWith('http')) {
      try {
        if (onStatus) onStatus(`[DIRECT_FETCH] Connecting to ${item.url}...`);
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        const data = await scrapeDirectUrl(item, randomUA);
        results.push(data);
        if (onStatus) onStatus(`[DATA_ACQUIRED] Extracted details from site direct.`);
        success = true;
      } catch (err) {
        if (onStatus) onStatus(`[WARN] Direct fetch failed for ${item.url}.`);
      }
    }

    if (!success) {
      let fallbackChain = ['Google', 'Bing', 'DuckDuckGo'];

      for (const source of fallbackChain) {
        try {
          const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
          const data = await fetchWithRetry(item, source, randomUA, onStatus);
          
          if (data.details !== "N/A" && data.details !== "No snippet found.") {
              results.push(data);
              if (onStatus) onStatus(`[DATA_ACQUIRED] Verification complete via ${source}.`);
              success = true;
              break; 
          }
        } catch (err) {
          if (onStatus) onStatus(`[ENGINE_BUSY] ${source} rotation triggered.`);
          continue;
        }
      }
    }

    if (!success) {
      if (onStatus) onStatus(`[ALERT] Data bypass initiated for manual review.`);
      results.push({ 
        row: item.row, 
        query: item.query || 'N/A',
        details: "Information could not be verified automatically.", 
        url: item.url || 'N/A',
        phone: 'Not found',
        email: 'Not found',
        socials: { twitter: null, facebook: null, instagram: null, linkedin: null }
      });
    }

    // Optimized human-like delay (4-7 seconds for faster throughput)
    const delay = Math.floor(Math.random() * 3000) + 4000;
    
    if (onStatus) onStatus(`Maintaining stealth... Waiting ${Math.round(delay/1000)}s`);
    await new Promise(r => setTimeout(r, delay));
  }

  return results;
}

async function scrapeDirectUrl(item, userAgent) {
  const response = await axios.get(item.url, {
    timeout: 30000,
    headers: { 'User-Agent': userAgent },
    validateStatus: (status) => status === 200
  });

  const $ = cheerio.load(response.data);
  const title = $('title').text().trim() || "Website";
  const bodyText = $('body').text();
  
  let socials = { twitter: null, facebook: null, instagram: null, linkedin: null };

  // Use global flag for multiple matches and deduplicate
  const phoneMatches = bodyText.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
  const phone = phoneMatches ? [...new Set(phoneMatches)].slice(0, 2).join(', ') : "Not found";

  const emailMatches = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  const email = emailMatches ? [...new Set(emailMatches)].slice(0, 2).join(', ') : "Not found";

  const html = response.data.toLowerCase();
  if (html.includes('twitter.com/')) socials.twitter = true;
  if (html.includes('facebook.com/')) socials.facebook = true;
  if (html.includes('instagram.com/')) socials.instagram = true;
  if (html.includes('linkedin.com/')) socials.linkedin = true;

  return {
    row: item.row,
    query: item.query || title,
    details: `[${title}] ` + bodyText.substring(0, 250).replace(/\s+/g, ' ') + '...',
    url: item.url,
    phone,
    email,
    socials
  };
}

async function fetchWithRetry(item, source, userAgent, onStatus, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      if (onStatus) onStatus(`Initializing ${source} query for "${item.query}"...`);
      const query = encodeURIComponent(item.query);
      let searchUrl = '';
      let headers = {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
      };

      if (source === 'DuckDuckGo') {
        searchUrl = `https://html.duckduckgo.com/html/?q=${query}`;
        headers['Referer'] = 'https://duckduckgo.com/';
      } else if (source === 'Google') {
        searchUrl = `https://www.google.com/search?q=${query}&gl=us&hl=en&num=3`;
        headers['Referer'] = 'https://www.google.com/';
      } else if (source === 'Bing') {
        searchUrl = `https://www.bing.com/search?q=${query}`;
        headers['Referer'] = 'https://www.bing.com/';
      }

      const response = await axios.get(searchUrl, {
        timeout: 15000,
        headers: headers,
        validateStatus: (status) => status === 200
      });

      const $ = cheerio.load(response.data);
      let details = "N/A";
      let url = "N/A";
      let phone = "Not found";
      let email = "Not found";
      let socials = { twitter: null, facebook: null, instagram: null, linkedin: null };

      if (source === 'DuckDuckGo') {
        const first = $('.result').first();
        details = first.find('.result__snippet').text().trim() || "N/A";
        url = first.find('.result__url').text().trim() || "N/A";
      } else if (source === 'Google') {
        details = $('.VwiC3b').first().text() || $('.hgKElc').first().text() || $('.BNeawe').first().text() || "No snippet found.";
        url = $('.yuRUbf a').first().attr('href') || $('.kCrYT a').first().attr('href') || "N/A";
        if (url.startsWith('/url?q=')) url = decodeURIComponent(url.split('=')[1].split('&')[0]);
      } else if (source === 'Bing') {
        const first = $('.b_algo').first();
        details = first.find('.b_caption p').text().trim() || first.find('.b_snippet').text().trim() || "N/A";
        // Attempt to get clean URL from citation if href is a bing redirect
        url = first.find('cite').text().trim() || first.find('h2 a').attr('href') || "N/A";
        if (url.includes(' ') && url.includes('http')) url = url.split(' ')[0]; // Basic cleaning
      }

      // Extract metadata using regex from the snippet
      const phoneMatch = details.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch) phone = phoneMatch[0];

      const emailMatch = details.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) email = emailMatch[0];

      // Social detection in snippet
      if (details.toLowerCase().includes('twitter.com/')) socials.twitter = true;
      if (details.toLowerCase().includes('facebook.com/')) socials.facebook = true;
      if (details.toLowerCase().includes('instagram.com/')) socials.instagram = true;
      if (details.toLowerCase().includes('linkedin.com/')) socials.linkedin = true;

      return { 
        row: item.row, 
        query: item.query, // FIXED: Preservation of company name
        details, 
        url, 
        phone, 
        email, 
        socials 
      };
    } catch (err) {
      if (i === retries) throw err;
      const wait = (i + 1) * 7000;
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

module.exports = { searchDetails };
