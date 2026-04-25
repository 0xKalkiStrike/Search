const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { searchDetails } = require('./scraper');

const app = express();
const port = process.env.PORT || 3000;

const isVercel = process.env.VERCEL || false;
const isRender = process.env.RENDER || false;
const isCloud = isVercel || isRender;
const statsPath = isCloud ? '/tmp/stats.json' : path.join(__dirname, 'stats.json');

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
if (isCloud) {
  const cloudProofsDir = '/tmp/proofs';
  if (!fs.existsSync(cloudProofsDir)) fs.mkdirSync(cloudProofsDir, { recursive: true });
  app.use('/proofs', express.static(cloudProofsDir));
}
app.use(express.json({ limit: '10mb' }));

const uploadDir = isCloud ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const resultsDir = isCloud ? '/tmp/results' : path.join(__dirname, 'results');
const sessionFile = isCloud ? '/tmp/session.json' : path.join(__dirname, 'session.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

const activeJobs = new Map();

function getSessionPath(jobId) {
  if (!jobId) return sessionFile;
  return isCloud ? `/tmp/session_${jobId}.json` : path.join(__dirname, `session_${jobId}.json`);
}

function saveSession(jobId, data) {
  try {
    const sPath = getSessionPath(jobId);
    fs.writeFileSync(sPath, JSON.stringify({ jobId, ...data }));
    fs.writeFileSync(sessionFile, JSON.stringify({ jobId, ...data }));
  } catch (e) {
    console.error('Session save failed:', e);
  }
}

function loadSession(jobId = null) {
  const sPath = getSessionPath(jobId);
  if (fs.existsSync(sPath)) {
    try {
      return JSON.parse(fs.readFileSync(sPath));
    } catch (e) { return null; }
  }
  if (!jobId && fs.existsSync(sessionFile)) {
     try { return JSON.parse(fs.readFileSync(sessionFile)); } catch(e) { return null; }
  }
  return null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `upload_${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({ storage: storage });

app.post('/api/scrape', upload.single('file'), async (req, res) => {
  try {
    const { searchSource } = req.body;
    const file = req.file;
    if (!file) throw new Error("No file uploaded");

    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    const headers = data[0] || [];
    const urlColIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('site url'));
    const queryColIndex = 0;

    const searchItems = data.slice(1).map((row, index) => ({
      row: index + 2,
      query: row[queryColIndex] ? row[queryColIndex].toString() : '',
      url: urlColIndex !== -1 && row[urlColIndex] ? row[urlColIndex].toString() : null
    })).filter(item => item.query || item.url);

    const jobId = Date.now().toString();
    const outPath = path.join(resultsDir, `result_${jobId}.xlsx`);

    // Extended headers for Enterprise Validation
    if (!data[0][1]) data[0][1] = 'Full Details';
    if (!data[0][2]) data[0][2] = 'Source URL';
    if (!data[0][3]) data[0][3] = 'Phone';
    if (!data[0][4]) data[0][4] = 'Email';
    if (!data[0][5]) data[0][5] = 'Confidence Score';
    if (!data[0][6]) data[0][6] = 'Status';
    if (!data[0][7]) data[0][7] = 'Validation Reasons';
    if (!data[0][8]) data[0][8] = 'Proof Reference';

    const jobData = { jobId, searchItems, searchSource, data, total: searchItems.length, outPath };
    fs.writeFileSync(path.join(resultsDir, `job_${jobId}.json`), JSON.stringify(jobData));

    activeJobs.set(jobId, { status: 'processing', results: [], total: searchItems.length, progress: 0, session: jobData });
    
    res.json({ success: true, jobId, total: searchItems.length });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

async function processScrape(jobId, searchItems, searchSource, data, workbook, outPath, startIndex = 0) {
  const job = activeJobs.get(jobId);
  try {
    const itemsToProcess = searchItems.slice(startIndex);

    for (const item of itemsToProcess) {
      if (!activeJobs.has(jobId)) return;

      const onStatus = (msg) => {
        if (job.sse) {
          job.sse.write(`data: ${JSON.stringify({ type: 'status', message: msg })}\n\n`);
        }
      };

      const results = await searchDetails([item], searchSource, onStatus);
      const result = results[0];
      
      job.results.push(result);
      job.progress = Math.round((job.results.length / job.total) * 100);
      
      const rowIndex = result.row - 1;
      data[rowIndex][1] = result.details;
      data[rowIndex][2] = result.url;
      data[rowIndex][3] = result.phone;
      data[rowIndex][4] = result.email;
      data[rowIndex][5] = result.confidence.score;
      data[rowIndex][6] = result.confidence.status;
      data[rowIndex][7] = result.confidence.reasons.join(', ');
      data[rowIndex][8] = result.proofs.join(' | ');
      
      if (job.results.length % 5 === 0 || job.results.length === job.total) {
        try {
          const cpWorksheet = XLSX.utils.aoa_to_sheet(data);
          const cpWorkbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(cpWorkbook, cpWorksheet, "Search Results");
          XLSX.writeFile(cpWorkbook, outPath);
        } catch (e) { console.error('Checkpoint save failed:', e); }
      }

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
          file: outPath
        })}\n\n`);
      }
    }

    const newWorksheet = XLSX.utils.aoa_to_sheet(data);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Search Results");
    XLSX.writeFile(newWorkbook, outPath);

    job.status = 'completed';
    updateStats(job.results.length);
    
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

app.get('/api/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  let job = activeJobs.get(jobId);

  if (!job) {
    const jobFile = path.join(resultsDir, `job_${jobId}.json`);
    if (fs.existsSync(jobFile)) {
      try {
        const session = JSON.parse(fs.readFileSync(jobFile));
        job = { status: 'processing', results: [], total: session.total, progress: 0, session };
        activeJobs.set(jobId, job);
      } catch (e) { }
    }
  }

  if (!job) return res.status(404).json({ success: false, message: "Job not found" });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  job.sse = res;

  if (job.session) {
      const startIndex = job.results.length || 0;
      processScrape(jobId, job.session.searchItems, job.session.searchSource, job.session.data, null, job.session.outPath, startIndex);
  }

  req.on('close', () => { job.sse = null; });
});

app.get('/api/download', (req, res) => {
  const { path: filePath, jobId } = req.query;
  if (filePath && fs.existsSync(filePath)) return res.download(filePath);
  res.status(404).send('File not found');
});

app.get('/api/session', (req, res) => {
  const session = loadSession();
  res.json({ success: !!session, session });
});

app.get('/api/resume', (req, res) => {
  const session = loadSession();
  res.json({ success: !!session, session, message: "Use POST to trigger recovery" });
});

app.post('/api/resume', (req, res) => {
  const { action, session, jobId: reqJobId, results: chunkResults } = req.body;

  if (action === 'init' && session) {
    const jobId = session.jobId || Date.now().toString();
    activeJobs.set(jobId, { 
      status: 'processing', 
      results: [], 
      total: session.total || 0, 
      progress: 0,
      session: { ...session, results: [] } 
    });
    return res.json({ success: true, jobId });
  }

  if (action === 'chunk' && reqJobId && chunkResults) {
    const job = activeJobs.get(reqJobId);
    if (!job) return res.status(404).json({ success: false, message: "Job expired during chunking" });
    job.results.push(...chunkResults);
    job.progress = job.total ? Math.round((job.results.length / job.total) * 100) : 0;
    if (job.session) job.session.results = job.results;
    return res.json({ success: true, count: job.results.length });
  }

  let sessionToUse = loadSession() || session;
  if (!sessionToUse) return res.status(404).json({ success: false, message: "No session found." });

  const jobId = sessionToUse.jobId || Date.now().toString();
  activeJobs.set(jobId, { 
    status: 'processing', 
    results: sessionToUse.results || [], 
    total: sessionToUse.total || 0, 
    progress: sessionToUse.total ? Math.round((sessionToUse.results.length / sessionToUse.total) * 100) : 0,
    session: sessionToUse
  });

  res.json({ success: true, jobId, total: sessionToUse.total, processed: (sessionToUse.results || []).length });
});

app.get('/api/results', (req, res) => {
  const session = loadSession();
  if (session) {
    res.json({ success: true, results: session.results });
  } else {
    res.status(404).json({ success: false, message: "No results found" });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    res.json({ success: true, file: req.file.path });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal Server Error during upload' });
  }
});

app.get('/api/stats', (req, res) => res.json(getStats()));

app.post('/api/reset', (req, res) => {
  try {
    activeJobs.clear();
    const dirsToClear = [uploadDir, resultsDir, path.join(__dirname, 'public/proofs')];
    dirsToClear.forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(file => {
          const fp = path.join(dir, file);
          if (fs.lstatSync(fp).isFile()) fs.unlinkSync(fp);
        });
      }
    });
    const rootFiles = fs.readdirSync(__dirname);
    rootFiles.forEach(file => {
      if (file.startsWith('session_') && file.endsWith('.json')) fs.unlinkSync(path.join(__dirname, file));
    });
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    res.json({ success: true });
  } catch (e) { 
    res.status(500).json({ success: false, message: e.message }); 
  }
});

app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Endpoint ${req.originalUrl} not found.` });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
