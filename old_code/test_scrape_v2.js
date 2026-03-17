const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function test() {
    const browser = await puppeteer.launch({ headless: 'new' });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
        
        const query = "1 Digital Agency";
        console.log(`Searching for ${query} on main DuckDuckGo...`);
        await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2' });
        
        // Wait for results
        try {
            await page.waitForSelector('article h2 a', { timeout: 10000 });
        } catch (e) {
            console.log("article h1 a not found, trying .result__a");
            await page.waitForSelector('.result__a', { timeout: 5000 });
        }
        
        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('article h2 a, .result__a'))
                .map(a => a.href)
                .filter(href => href && href.startsWith('http') && !href.includes('duckduckgo.com'))
                .slice(0, 2);
        });
        
        console.log('Links found:', links);
        
        for (const link of links) {
            console.log(`Scraping ${link}...`);
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await new Promise(r => setTimeout(r, 3000));
            const content = await page.content();
            const $ = cheerio.load(content);
            const text = $('body').text();
            
            console.log(`Text length: ${text.length}`);
            console.log(`Phones:`, text.match(phoneRegex));
            console.log(`Emails:`, text.match(emailRegex));
        }
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await browser.close();
    }
}

test();
