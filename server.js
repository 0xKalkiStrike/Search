const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { searchDetails } = require('./scraper');

const app = express();
const port = 3000;

const statsPath = path.join(__dirname, 'stats.json');

function getStats() {
  try {
    if (!fs.existsSync(statsPath)) {
      fs.writeFileSync(statsPath, JSON.stringify({ totalScreened: 0 }));
    }
    return JSON.parse(fs.readFileSync(statsPath));
  } catch (e) {
    return { totalScreened: 0 };
  }
}

function updateStats(count) {
  const stats = getStats();
  stats.totalScreened += count;
  fs.writeFileSync(statsPath, JSON.stringify(stats));
}
app.use(express.static('public'));
app.use(express.json());

// Ensure directories exist (handling Vercel read-only filesystem)
const isVercel = process.env.VERCEL || false;
const uploadDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const resultsDir = isVercel ? '/tmp/results' : path.join(__dirname, 'results');
const sessionFile = isVercel ? '/tmp/session.json' : path.join(__dirname, 'session.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

// Job tracking for live updates
const activeJobs = new Map();

// Session Persistence
function saveSession(jobId, data) {
  try {
    fs.writeFileSync(sessionFile, JSON.stringify({ jobId, ...data }));
  } catch (e) {
    console.error('Session save failed:', e);
  }
}

function loadSession() {
  if (fs.existsSync(sessionFile)) {
    try {
      return JSON.parse(fs.readFileSync(sessionFile));
    } catch (e) { return null; }
  }
  return null;
}

// Multi-part storage for files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `upload_${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({ storage: storage });

// Scrape API Endpoint
app.post('/api/scrape', upload.single('file'), async (req, res) => {
  try {
    const { searchSource } = req.body;
    const file = req.file;

    if (!file) throw new Error("No file uploaded");

    // Load Excel sheet using xlsx
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON for easy processing
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Find column indices
    const headers = data[0] || [];
    const urlColIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('site url'));
    const queryColIndex = 0; // Default to first column

    // Map rows to search items
    const searchItems = data.slice(1).map((row, index) => ({
      row: index + 2, // 1-based index including header
      query: row[queryColIndex] ? row[queryColIndex].toString() : '',
      url: urlColIndex !== -1 && row[urlColIndex] ? row[urlColIndex].toString() : null
    })).filter(item => item.query || item.url);

    // Set up output path
    const jobId = Date.now().toString();
    const outPath = path.join(resultsDir, `result_${jobId}.xlsx`);

    // Add headers to the original data array
    if (!data[0][1]) data[0][1] = 'Full Details';
    if (!data[0][2]) data[0][2] = 'Source URL';
    if (!data[0][3]) data[0][3] = 'Phone';
    if (!data[0][4]) data[0][4] = 'Email';

    // Start background processing and return jobId immediately
    activeJobs.set(jobId, { status: 'processing', results: [], total: searchItems.length, progress: 0 });
    
    // Background processing call
    processScrape(jobId, searchItems, searchSource, data, workbook, outPath);

    // Clean up uploaded file
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

    res.json({ success: true, jobId, total: searchItems.length });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

async function processScrape(jobId, searchItems, searchSource, data, workbook, outPath, startIndex = 0) {
  const job = activeJobs.get(jobId);
  try {
    // Slice items if we are resuming
    const itemsToProcess = searchItems.slice(startIndex);

    for (const item of itemsToProcess) {
      // Status update callback for the scraper
      const onStatus = (msg) => {
        if (job.sse) {
          job.sse.write(`data: ${JSON.stringify({ type: 'status', message: msg })}\n\n`);
        }
      };

      const results = await searchDetails([item], searchSource, onStatus);
      const result = results[0];
      
      job.results.push(result);
      job.progress = Math.round((job.results.length / job.total) * 100);
      
      // Update Excel data
      const rowIndex = result.row - 1;
      data[rowIndex][1] = result.details;
      data[rowIndex][2] = result.url;
      data[rowIndex][3] = result.phone;
      data[rowIndex][4] = result.email;
      
      // Persistent Save: Save workbook every 10 records to allow intermediate downloads
      if (job.results.length % 10 === 0 || job.results.length === job.total) {
        try {
          const cpWorksheet = XLSX.utils.aoa_to_sheet(data);
          const cpWorkbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(cpWorkbook, cpWorksheet, "Search Results");
          XLSX.writeFile(cpWorkbook, outPath);
        } catch (e) { console.error('Checkpoint save failed:', e); }
      }

      // Persist session state
      saveSession(jobId, { 
        status: 'processing', 
        results: job.results, 
        total: job.total, 
        searchItems, 
        searchSource, 
        data, 
        outPath,
        time: Date.now()
      });

      if (job.sse) {
        job.sse.write(`data: ${JSON.stringify({ 
          type: 'progress', 
          result, 
          progress: job.progress, 
          count: job.results.length,
          checkpoint: job.results.length >= 100 && job.results.length % 100 === 0,
          file: outPath
        })}\n\n`);
      }
    }

    // Save final Excel
    const newWorksheet = XLSX.utils.aoa_to_sheet(data);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Search Results");
    XLSX.writeFile(newWorkbook, outPath);

    job.status = 'completed';
    job.file = outPath;
    updateStats(job.results.length);
    fs.unlinkSync(sessionFile); // Clear session once fully done

    if (job.sse) {
      job.sse.write(`data: ${JSON.stringify({ type: 'completed', file: outPath, count: job.results.length })}\n\n`);
      job.sse.end();
    }
  } catch (error) {
    console.error('Job Error:', error);
    job.status = 'failed';
    if (job.sse) {
      job.sse.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      job.sse.end();
    }
  }
}

app.get('/api/session', (req, res) => {
  const session = loadSession();
  res.json({ success: !!session, session });
});

app.post('/api/resume', (req, res) => {
  const session = loadSession();
  if (!session) return res.status(404).json({ success: false, message: "No session found" });

  const jobId = session.jobId || Date.now().toString();
  activeJobs.set(jobId, { 
    status: 'processing', 
    results: session.results, 
    total: session.total, 
    progress: Math.round((session.results.length / session.total) * 100) 
  });

  // Start from where we left off
  processScrape(jobId, session.searchItems, session.searchSource, session.data, null, session.outPath, session.results.length);

  res.json({ success: true, jobId, total: session.total, processed: session.results.length });
});

app.get('/api/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  let job = activeJobs.get(jobId);

  // Recovery logic for serverless environments (Vercel)
  if (!job) {
    const session = loadSession();
    if (session && session.jobId === jobId) {
      console.log(`[RECOVERY] Re-activating job ${jobId} from session file.`);
      job = { 
        status: 'processing', 
        results: session.results, 
        total: session.total, 
        progress: Math.round((session.results.length / session.total) * 100) 
      };
      activeJobs.set(jobId, job);
      // Resume the background process
      processScrape(jobId, session.searchItems, session.searchSource, session.data, null, session.outPath, session.results.length);
    }
  }

  if (!job) {
    console.error(`[STREAM_ERROR] Job ${jobId} not found and no session recovery possible.`);
    return res.status(404).json({ success: false, message: "Job not found or expired" });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  job.sse = res;

  req.on('close', () => {
    job.sse = null;
  });
});

// Separate Upload API Endpoint (to solve 500 errors)
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    res.json({ success: true, file: req.file.path });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error during upload' });
  }
});

// Reset API Endpoint (to solve 404 errors)
app.post('/api/reset', (req, res) => {
  try {
    const folders = [uploadDir, resultsDir];
    folders.forEach(dir => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          if (fs.lstatSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      }
    });
    res.json({ success: true, message: 'History and temporary files cleared' });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

// Download Endpoint (Enhanced for Vercel/Serverless Resilience)
app.get('/api/download', (req, res) => {
  const { path: filePath, jobId } = req.query;

  // 1. Direct file check
  if (filePath && fs.existsSync(filePath)) {
    return res.download(filePath);
  }

  // 2. Recovery Logic: If file is missing, try to regenerate from session or active job
  const session = loadSession();
  const job = activeJobs.get(jobId);

  // If we have data but no file, rebuild it on the fly
  if ((job && job.results.length > 0) || (session && session.jobId === jobId)) {
    try {
      const resultsToUse = job ? job.results : session.results;
      const dataToUse = job ? (session ? session.data : []) : session.data;
      
      // If we don't have the full sheet data, we can at least rebuild from the results we have
      let finalData = dataToUse;
      if (finalData.length === 0 || finalData.length === 1) {
          finalData = [['Query', 'Full Details', 'Source URL', 'Phone', 'Email']];
          resultsToUse.forEach(r => {
              finalData.push([r.query, r.details, r.url, r.phone, r.email]);
          });
      }

      const newWorksheet = XLSX.utils.aoa_to_sheet(finalData);
      const newWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Recovered Results");
      
      const buffer = XLSX.write(newWorkbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=results_${jobId || Date.now()}.xlsx`);
      return res.send(buffer);
    } catch (e) {
      console.error('Download recovery failed:', e);
    }
  }

  res.status(404).send('File expired or session lost. Please try resuming the scan.');
});

const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

server.timeout = 600000; // 10 minutes timeout for long scrapes
