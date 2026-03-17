const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const xlsx = require('xlsx');
const puppeteer = process.env.VERCEL ? require('puppeteer-core') : require('puppeteer');
const chromium = process.env.VERCEL ? require('@sparticuz/chromium') : null;
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

// Middleware
app.use(express.static('static'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'templates'));

// Fix for CSP Issues
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
  );
  next();
});

// Multer for file upload
const uploadDir = process.env.VERCEL ? '/tmp/uploads' : 'uploads/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

const resultsDir = process.env.VERCEL ? '/tmp/results' : 'results';
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
const resultsPath = path.join(resultsDir, 'results.json');

// Improved Regex
const phoneRegex = /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

async function scrapeSite(browser, url) {
  try {
    console.log(`Scraping: ${url}`);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // Faster wait: only wait for a bit of dynamic content or use networkidle if possible
    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 });
    } catch (e) {
      console.log(`Still loading ${url} but continuing...`);
    }
    
    const content = await page.content();
    const $ = cheerio.load(content);
    
    // Extract from mailto and tel links directly
    let phones = [];
    let emails = [];
    
    $('a[href^="tel:"]').each((i, el) => {
      phones.push($(el).attr('href').replace('tel:', '').trim());
    });
    
    $('a[href^="mailto:"]').each((i, el) => {
      emails.push($(el).attr('href').replace('mailto:', '').trim());
    });

    const text = $('body').text();
    phones.push(...(text.match(phoneRegex) || []));
    emails.push(...(text.match(emailRegex) || []));

    // Try finding contact page if we don't have much
    if (phones.length <= 1 && emails.length === 0) {
      const contactLink = $('a').filter((i, el) => {
        const h = ($(el).attr('href') || '').toLowerCase();
        const t = $(el).text().toLowerCase();
        return t.includes('contact') || t.includes('about') || h.includes('contact');
      }).first().attr('href');

      if (contactLink) {
        let fullContactUrl = contactLink;
        if (!contactLink.startsWith('http')) {
          const baseUrl = new URL(url).origin;
          fullContactUrl = new URL(contactLink, baseUrl).href;
        }
        console.log(`Deep scraping: ${fullContactUrl}`);
        await page.goto(fullContactUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        try {
          await page.waitForNetworkIdle({ idleTime: 500, timeout: 3000 });
        } catch (e) {}
        const cContent = await page.content();
        const c$ = cheerio.load(cContent);
        
        c$('a[href^="tel:"]').each((i, el) => phones.push(c$(el).attr('href').replace('tel:', '').trim()));
        c$('a[href^="mailto:"]').each((i, el) => emails.push(c$(el).attr('href').replace('mailto:', '').trim()));
        
        const cText = c$('body').text();
        phones.push(...(cText.match(phoneRegex) || []));
        emails.push(...(cText.match(emailRegex) || []));
      }
    }

    await page.close();
    return [[...new Set(phones)], [...new Set(emails)]];
  } catch (error) {
    console.warn('Scrape failed for', url, error.message);
    return [[], []];
  }
}

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/results', (req, res) => {
  if (fs.existsSync(resultsPath)) {
    const data = fs.readFileSync(resultsPath, 'utf8');
    const results = JSON.parse(data);
    res.render('results', { results });
  } else {
    res.render('results', { results: {} });
  }
});

app.get('/download', (req, res) => {
  if (!fs.existsSync(resultsPath)) {
    return res.status(404).send('No results found to download.');
  }

  try {
    const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    const rows = [];
    
    // Header
    rows.push(['Name', 'Phone Numbers', 'Emails', 'Sources']);

    for (const name in data) {
      rows.push([
        name,
        data[name].phones.join(', '),
        data[name].emails.join(', '),
        data[name].sources.join(', ')
      ]);
    }

    const worksheet = xlsx.utils.aoa_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Scrape Results");

    const buf = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="scrape_results.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (error) {
    console.error('Download failed:', error);
    res.status(500).send('Failed to generate Excel file.');
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.render('index', { error: 'No file uploaded' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const names = xlsx.utils.sheet_to_json(sheet, { header: 1 }).map(row => row[0]).filter(name => name);

    // Initial response to redirect to dashboard
    res.render('dashboard', { count: names.length });

    // Process in background
    processNamesInBackground(names);

  } catch (error) {
    console.error('Failed to process upload:', error);
    res.status(500).render('index', { error: 'An error occurred while processing the file.' });
  }
});

async function processNamesInBackground(names) {
  let browser;
  try {
    let results = {};
    
    // Load existing results to resume
    if (fs.existsSync(resultsPath)) {
      try {
        const existingData = fs.readFileSync(resultsPath, 'utf8');
        results = JSON.parse(existingData);
        console.log(`Loaded ${Object.keys(results).length} existing results for resume.`);
      } catch (e) {
        console.warn('Failed to parse existing results.json, starting fresh.');
      }
    }

    console.log(`Processing ${names.length} names in background...`);
    
    const launchOptions = process.env.VERCEL ? {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    } : {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };

    browser = await puppeteer.launch(launchOptions);

    const limit = pLimit(3); // 3 names in parallel

    const tasks = names.map((name, index) => limit(async () => {
      try {
        const progress = Math.round(((index + 1) / names.length) * 100);
        
        // Skip if already processed
        if (results[name]) {
          console.log(`Skipping already processed name: ${name}`);
          io.emit('status', { 
            message: `Resuming: Skipping ${name}`, 
            progress: progress,
            current: name 
          });
          io.emit('result', { name, ...results[name] });
          return;
        }

        io.emit('status', { 
          message: `Searching for: ${name}`, 
          progress: progress,
          current: name 
        });

        const links = await searchDuckDuckGoWithName(browser, name);
        let phones = [];
        let emails = [];

        // Scrape links in parallel for this name
        const scrapeResults = await Promise.all(links.map(link => scrapeSite(browser, link)));
        
        scrapeResults.forEach(([p, e]) => {
          phones.push(...p);
          emails.push(...e);
        });

        const entry = {
          phones: [...new Set(phones)],
          emails: [...new Set(emails)],
          sources: links
        };
        
        results[name] = entry;
        io.emit('result', { name, ...entry });

        // Periodically save results
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

      } catch (err) {
        console.error(`Error processing ${name}:`, err);
      }
    }));

    await Promise.all(tasks);
    
    console.log('Batch processing complete.');
    io.emit('complete', { results });
    await browser.close();

  } catch (error) {
    console.error('Background process failed:', error);
    if (browser) await browser.close();
    io.emit('error', { message: 'Background processing failed' });
  }
}

async function searchDuckDuckGoWithName(browser, query, numResults = 3) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    // Make the query more specific to find contact info
    const targetedQuery = `${query} official website contact email phone`;
    console.log(`Searching DuckDuckGo for: ${targetedQuery}`);
    
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(targetedQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForSelector('article h2 a, .result__a', { timeout: 15000 });

    const links = await page.evaluate((num) => {
      const results = Array.from(document.querySelectorAll('article h2 a, .result__a')).slice(0, num);
      return results
        .map(a => a.href)
        .filter(href => href && href.startsWith('http') && !href.includes('duckduckgo.com'));
    }, numResults);

    await page.close();
    return links;
  } catch (error) {
    console.warn('DuckDuckGo search failed:', error.message);
    return [];
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const basePort = process.env.PORT ? Number(process.env.PORT) : 3000;

function startServer(port) {
  server.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

if (!process.env.VERCEL) {
  startServer(basePort);
}

module.exports = app;

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});