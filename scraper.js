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
      let fallbackChain = ['DuckDuckGo', 'Google', 'Bing'];

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
  const links = $('a');
  
  links.each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const l = href.toLowerCase();
    if (l.includes('linkedin.com/company/') || l.includes('linkedin.com/in/')) socials.linkedin = href;
    if (l.includes('facebook.com/') && !l.includes('sharer')) socials.facebook = href;
    if (l.includes('instagram.com/')) socials.instagram = href;
    if (l.includes('twitter.com/') || l.includes('x.com/')) socials.twitter = href;
  });

  const phoneMatches = bodyText.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
  const phone = phoneMatches ? [...new Set(phoneMatches)].slice(0, 3).join(', ') : "Not found";

  const emailMatches = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  const email = emailMatches ? [...new Set(emailMatches)].map(e => e.toLowerCase()).slice(0, 3).join(', ') : "Not found";

  // Video detection (More advanced)
  let videoLink = "Not found";
  const videoPatterns = [
    /https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\/[^\s"']+/g,
    /https?:\/\/[^\s"']+\.(mp4|webm|ogg)/g
  ];
  
  for (const pattern of videoPatterns) {
    const videoMatches = response.data.match(pattern);
    if (videoMatches) {
        videoLink = [...new Set(videoMatches)][0];
        break;
    }
  }

  // Calculate Intelligence Score (0-100)
  let score = 20; // Base score for having a website
  if (phone !== "Not found") score += 15;
  if (email !== "Not found") score += 15;
  if (socials.linkedin) score += 10;
  if (socials.facebook) score += 10;
  if (socials.instagram) score += 10;
  if (socials.twitter) score += 5;
  if (videoLink !== "Not found") score += 15;

  return {
    row: item.row,
    query: item.query || title,
    details: `[${title}] ` + bodyText.substring(0, 450).replace(/\s+/g, ' ').trim() + '...',
    url: item.url,
    phone,
    email,
    socials,
    video: videoLink,
    score: Math.min(score, 100)
  };
}

async function fetchWithRetry(item, source, userAgent, onStatus, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      if (onStatus) onStatus(`Initializing ${source} query for "${item.query}"...`);

      if (source === 'DuckDuckGo') {
        return await searchViaDuckDuckGoBrowser(item, userAgent, onStatus);
      }

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

      if (source === 'Google') {
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

      if (source === 'Google') {
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
      const phoneMatches = details.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
      if (phoneMatches) phone = [...new Set(phoneMatches)].slice(0, 2).join(', ');

      const emailMatches = details.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (emailMatches) email = [...new Set(emailMatches)].map(e => e.toLowerCase()).slice(0, 2).join(', ');

      // Social detection in snippet (Smart mapping)
      if (details.toLowerCase().includes('twitter.com/') || details.toLowerCase().includes('x.com/')) socials.twitter = true;
      if (details.toLowerCase().includes('facebook.com/')) socials.facebook = true;
      if (details.toLowerCase().includes('instagram.com/')) socials.instagram = true;
      if (details.toLowerCase().includes('linkedin.com/')) socials.linkedin = true;

      // Video detection in snippet
      let videoLink = "Not found";
      const videoMatch = details.match(/https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\/[^\s"']+/);
      if (videoMatch) videoLink = videoMatch[0];

      // Calculate Snippet Intelligence Score
      let score = 10; // Found on web
      if (url !== "N/A") score += 10;
      if (phone !== "Not found") score += 15;
      if(email !== "Not found") score += 15;
      if(socials.linkedin || socials.facebook) score += 10;
      if(videoLink !== "Not found") score += 10;

      return { 
        row: item.row, 
        query: item.query, 
        details, 
        url: url.startsWith('http') ? url : 'N/A', 
        phone, 
        email, 
        socials,
        video: videoLink,
        score: score
      };
    } catch (err) {
      if (i === retries) throw err;
      const wait = (i + 1) * 7000;
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

function normalizeDuckDuckGoResultUrl(rawUrl) {
  if (!rawUrl) return null;

  // Typical DDG redirect format: /l/?uddg=<encoded_target>
  if (rawUrl.startsWith('/l/?')) {
    const params = new URLSearchParams(rawUrl.split('?')[1] || '');
    const encoded = params.get('uddg');
    if (encoded) {
      try {
        return decodeURIComponent(encoded);
      } catch (e) {
        return encoded;
      }
    }
  }

  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  if (rawUrl.startsWith('http')) return rawUrl;
  return null;
}

function scoreScrapedSignals(result) {
  let signalScore = 0;
  if (result.phone && result.phone !== 'Not found') signalScore += 30;
  if (result.email && result.email !== 'Not found') signalScore += 30;
  if (result.socials?.linkedin) signalScore += 10;
  if (result.socials?.facebook) signalScore += 10;
  if (result.socials?.instagram) signalScore += 10;
  if (result.socials?.twitter) signalScore += 10;
  return signalScore;
}

async function searchViaDuckDuckGoBrowser(item, userAgent, onStatus) {
  const query = encodeURIComponent(item.query);
  const response = await axios.get(`https://html.duckduckgo.com/html/?q=${query}`, {
    timeout: 15000,
    headers: {
      'User-Agent': userAgent,
      'Referer': 'https://duckduckgo.com/',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    validateStatus: (status) => status === 200
  });

  const $ = cheerio.load(response.data);
  const candidates = [];

  $('.result').slice(0, 7).each((_, el) => {
    const title = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    const href = $(el).find('.result__a').attr('href') || $(el).find('.result__url').attr('href');
    const normalizedUrl = normalizeDuckDuckGoResultUrl(href);
    if (normalizedUrl && normalizedUrl.startsWith('http')) {
      candidates.push({ title, snippet, url: normalizedUrl });
    }
  });

  if (!candidates.length) {
    return {
      row: item.row,
      query: item.query,
      details: 'No DuckDuckGo results found.',
      url: 'N/A',
      phone: 'Not found',
      email: 'Not found',
      socials: { twitter: null, facebook: null, instagram: null, linkedin: null },
      video: 'Not found',
      score: 0
    };
  }

  let best = null;

  for (const candidate of candidates) {
    try {
      if (onStatus) onStatus(`[DDG_BROWSER] Visiting ${candidate.url}`);
      const scraped = await scrapeDirectUrl({ ...item, url: candidate.url }, userAgent);
      const combinedDetails = candidate.snippet
        ? `[DDG] ${candidate.snippet} | ${scraped.details}`
        : scraped.details;
      const merged = { ...scraped, details: combinedDetails, query: item.query };
      const signalScore = scoreScrapedSignals(merged);

      if (!best || signalScore > best.signalScore) {
        best = { ...merged, signalScore };
      }

      if (signalScore >= 60) break; // strong match, stop early
    } catch (err) {
      if (onStatus) onStatus(`[DDG_BROWSER] Skipped blocked result ${candidate.url}`);
    }
  }

  if (best) {
    const { signalScore, ...result } = best;
    result.score = Math.max(result.score || 0, Math.min(100, 25 + signalScore));
    return result;
  }

  const fallback = candidates[0];
  return {
    row: item.row,
    query: item.query,
    details: fallback.snippet || 'Snippet-only result from DuckDuckGo.',
    url: fallback.url,
    phone: 'Not found',
    email: 'Not found',
    socials: { twitter: null, facebook: null, instagram: null, linkedin: null },
    video: 'Not found',
    score: 20
  };
}

module.exports = { searchDetails };
