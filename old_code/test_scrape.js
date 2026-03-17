const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function test() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    const query = "1 Digital Agency";
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    console.log(`Searching for ${query}...`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.result__a'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http') && !href.includes('duckduckgo.com'))
            .slice(0, 2);
    });
    
    console.log('Links found:', links);
    
    for (const link of links) {
        console.log(`Scraping ${link}...`);
        try {
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
            const content = await page.content();
            const $ = cheerio.load(content);
            const text = $('body').text();
            
            const phones = text.match(phoneRegex);
            const emails = text.match(emailRegex);
            
            console.log(`Phones:`, phones);
            console.log(`Emails:`, emails);
            
            if (!phones && !emails) {
                console.log('Checking for contact page...');
                const contactLink = $('a').filter((i, el) => {
                    const href = $(el).attr('href') || '';
                    const linkText = $(el).text().toLowerCase();
                    return linkText.includes('contact') || href.includes('contact');
                }).first().attr('href');
                
                if (contactLink) {
                    let fullUrl = contactLink;
                    if (!contactLink.startsWith('http')) {
                        fullUrl = new URL(contactLink, link).href;
                    }
                    console.log(`Going to contact page: ${fullUrl}`);
                    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await new Promise(r => setTimeout(r, 2000));
                    const cText = cheerio.load(await page.content())('body').text();
                    console.log('Phones on contact:', cText.match(phoneRegex));
                    console.log('Emails on contact:', cText.match(emailRegex));
                }
            }
        } catch (e) {
            console.error(`Failed ${link}: ${e.message}`);
        }
    }
    
    await browser.close();
}

test();
