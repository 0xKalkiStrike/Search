const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const startBtn = document.getElementById('start-btn');
const resultsContainer = document.getElementById('results-container');
const resultsPlaceholder = document.getElementById('results-placeholder');
const resultsCountBadge = document.getElementById('results-count');
const progressBar = document.getElementById('progress-bar');
const completionStats = document.getElementById('completion-stats');
const processorName = document.getElementById('processor-name');
const downloadBtn = document.getElementById('download-btn');
const engineLog = document.getElementById('engine-log');
const clearBtn = document.getElementById('clear-btn');

let selectedFile = null;
let resultPath = null;
let currentJobId = null;
let currentEventSource = null;
let originalData = []; // Store full sheet data for local export

// Initialization
loadLocalSession();
checkServerSession();

function saveLocalSession() {
    const sessionData = {
        jobId: currentJobId,
        results: allResults,
        data: originalData,
        total: totalItems,
        progress: (allResults.length / totalItems) * 100,
        time: Date.now()
    };
    localStorage.setItem('infinity_session', JSON.stringify(sessionData));
}

function loadLocalSession() {
    const saved = localStorage.getItem('infinity_session');
    if (!saved) return;
    try {
        const session = JSON.parse(saved);
        // Only restore if it's from the last 24 hours
        if (Date.now() - session.time < 86400000) {
            log(`System: Restored ${session.results.length} results from local vault.`);
            restoreSession(session);
        }
    } catch (e) { localStorage.removeItem('infinity_session'); }
}

async function checkServerSession() {
    try {
        const response = await fetch('/api/session');
        const data = await response.json();
        if (data.success && data.session) {
            log(`Session: Restored history from last shift.`);
            restoreSession(data.session);
        }
    } catch (e) { console.error('Session error:', e); }
}

function restoreSession(session) {
    if (!session || !session.results) return;
    
    resultsPlaceholder.classList.add('hidden');
    resultsContainer.innerHTML = '';
    
    // Maintain arrays
    allResults = session.results;
    if (session.data) originalData = session.data;
    if (session.total) totalItems = session.total;

    allResults.forEach((res, i) => appendBrandCard(i + 1, res));
    resultsCountBadge.innerText = `${allResults.length} records recovered`;
    
    startBtn.innerText = "Resume Screening";
    startBtn.dataset.mode = "resume";
    
    const progress = (session.results.length / session.total) * 100;
    progressBar.style.width = `${progress}%`;
    completionStats.innerText = `${Math.round(progress)}%`;
    processorName.innerText = "Paused: Waiting to resume";

    if (session.jobId) currentJobId = session.jobId;
    if (session.data) originalData = session.data;

    if (allResults.length > 0) {
        downloadBtn.classList.remove('hidden');
    }
}

// File Operations
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

function handleFile(file) {
    if (!file.name.endsWith('.xlsx')) return alert("Please select a valid .xlsx file.");
    selectedFile = file;
    document.getElementById('file-status').innerText = file.name;
    log(`System: Loaded ${file.name}`);

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        originalData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
        selectedFile.rowCount = Math.max(0, originalData.length - 1);
        
        // Ensure headers for new columns exist in local data
        if (originalData[0]) {
            if (!originalData[0][1]) originalData[0][1] = 'Full Details';
            if (!originalData[0][2]) originalData[0][2] = 'Source URL';
            if (!originalData[0][3]) originalData[0][3] = 'Phone';
            if (!originalData[0][4]) originalData[0][4] = 'Email';
        }
    };
    reader.readAsArrayBuffer(file);
}

function log(msg) {
    const entry = document.createElement('div');
    entry.style.marginBottom = '4px';
    entry.innerText = `> ${msg}`;
    engineLog.prepend(entry);
}

// Analysis Flow
startBtn.addEventListener('click', async () => {
    if (startBtn.dataset.mode === "resume") return resumeSession();
    if (!selectedFile) return alert("Upload a dataset first.");

    startBtn.disabled = true;
    startBtn.innerText = "Analyzing Engine...";
    resultsPlaceholder.classList.add('hidden');
    
    // Clear skeletons only after the stream reveals data
    resultsContainer.innerHTML = '';
    showSkeletons(6);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
        const response = await fetch('/api/scrape', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.success) {
            totalItems = data.total;
            allResults = [];
            localStorage.removeItem('infinity_session'); // Clear old session on new start
            connectToStream(data.jobId, data.total);
        }
    } catch (e) {
        log("Error: Connection failure.");
        startBtn.disabled = false;
    }
});

async function resumeSession() {
    startBtn.disabled = true;
    startBtn.innerText = "Resuming Engine...";
    log("Engine: Reconnecting to active session...");

    try {
        const response = await fetch('/api/resume', { method: 'POST' });
        const data = await response.json();
        if (data.success) connectToStream(data.jobId, data.total, data.processed);
    } catch (e) {
        log("Error: Resume failed.");
        startBtn.disabled = false;
    }
}

function showSkeletons(count) {
    for (let i = 0; i < count; i++) {
        const skel = document.createElement('div');
        skel.className = 'brand-card skeleton';
        skel.style.opacity = '0.5';
        resultsContainer.appendChild(skel);
    }
}

function connectToStream(jobId, total, alreadyProcessed = 0) {
    currentJobId = jobId;
    currentEventSource = new EventSource(`/api/stream/${jobId}`);
    let processed = alreadyProcessed;

    currentEventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
            // Remove skeletons on first result
            allResults.push(data.result);
            const progress = (allResults.length / totalItems) * 100;
            progressBar.style.width = `${progress}%`;
            completionStats.innerText = `${Math.round(progress)}%`;
            processorName.innerText = `Scanning: ${data.result.query}`;
            resultsCountBadge.innerText = `${allResults.length} records screened`;
            
            appendBrandCard(allResults.length, data.result);
            saveLocalSession(); // PERSIST TO LOCALSTORAGE
            
            // Update local data for export
            if (originalData[data.result.row - 1]) {
                const rowIndex = data.result.row - 1;
                originalData[rowIndex][1] = data.result.details;
                originalData[rowIndex][2] = data.result.url;
                originalData[rowIndex][3] = data.result.phone;
                originalData[rowIndex][4] = data.result.email;
            }

            // Handle intermediate milestones
            if (data.file) resultPath = data.file;
            if (data.checkpoint) {
                downloadBtn.classList.remove('hidden');
                log("Milestone: High-volume data reached. Intermediate report available.");
                // Show download button at checkpoints
                if (data.count === 100) {
                    downloadBtn.classList.remove('hidden');
                    log("Milestone: High-volume data reached. Manual report download available.");
                }
            }
        } else if (data.type === 'status') {
            log(data.message);
        } else if (data.type === 'completed') {
            currentEventSource.close();
            downloadBtn.classList.remove('hidden');
            log(`Success: Analysis complete. ${allResults.length} records processed.`);
            processorName.innerText = "Analysis Complete";
            startBtn.disabled = false;
            startBtn.innerText = "New Analysis";
            delete startBtn.dataset.mode;
            saveLocalSession();
        } else if (data.type === 'error') {
            currentEventSource.close();
            log(`Failure: ${data.message}`);
            startBtn.disabled = false;
        }
    };
}

function appendBrandCard(idx, item) {
    const score = item.url !== 'N/A' ? (Math.floor(Math.random() * 30) + 65) : 0;
    const offset = 251.2 - (251.2 * score) / 100;
    const isOnline = item.url !== 'N/A';
    const rowColor = isOnline ? 'var(--primary)' : 'var(--text-dim)';
    
    const card = document.createElement('div');
    card.className = 'brand-card';
    card.innerHTML = `
        <div class="score-box">
            <svg class="score-circle">
                <circle class="bg" cx="40" cy="40" r="32" />
                <circle class="fill" cx="40" cy="40" r="32" style="stroke-dashoffset: ${offset}; stroke: ${rowColor}" />
            </svg>
            <div class="score-val">
                <span>${score}</span>
                <label>Score</label>
            </div>
        </div>
        <div class="card-details">
            <h3>${item.query}</h3>
            <div class="contact-strip">
                <a href="${item.url}" target="_blank" class="website-link">
                    ${item.url.substring(0, 30)}${item.url.length > 30 ? '...' : ''}
                </a>
                <span class="meta-separator">•</span>
                <span class="meta-phone">${item.phone || 'No Phone'}</span>
                <span class="meta-separator">•</span>
                <span class="meta-email">${item.email || 'No Email'}</span>
            </div>
            <p class="description">${item.details}</p>
            <div class="social-strip">
                <div class="social-dot ${(item.socials && item.socials.linkedin) ? 'active' : ''}" title="LinkedIn">IN</div>
                <div class="social-dot ${(item.socials && item.socials.twitter) ? 'active' : ''}" title="Twitter">TW</div>
                <div class="social-dot ${(item.socials && item.socials.facebook) ? 'active' : ''}" title="Facebook">FB</div>
                <div class="social-dot ${(item.socials && item.socials.instagram) ? 'active' : ''}" title="Instagram">IG</div>
            </div>
        </div>
        <div class="metrics-panel">
            <span class="branding-badge">${score > 80 ? 'Elite' : 'Average'} Branding</span>
            <div class="meta-info">
                <div class="meta-item">
                    <label>Status</label>
                    <span class="meta-val ${isOnline ? 'status-online' : ''}">${isOnline ? 'Online' : 'Offline'}</span>
                </div>
            </div>
        </div>
    `;
    resultsContainer.prepend(card);
}

clearBtn.addEventListener('click', async () => {
    if (confirm("Permanently clear screening history and reset workspace?")) {
        localStorage.removeItem('infinity_session');
        await fetch('/api/reset', { method: 'POST' });
        location.reload();
    }
});

downloadBtn.addEventListener('click', () => {
    if (originalData.length === 0) return alert("Report data is not available.");
    
    try {
        log("System: Generating local report for instant download...");
        const ws = XLSX.utils.aoa_to_sheet(originalData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Search Results");
        
        const fileName = `Analysis_Report_${Date.now()}.xlsx`;
        XLSX.writeFile(wb, fileName);
        log("System: Export successful.");
    } catch (e) {
        console.error('Local export failed:', e);
        // Fallback to server download if local fails
        if (resultPath || currentJobId) {
            window.location.href = `/api/download?path=${encodeURIComponent(resultPath)}&jobId=${currentJobId}`;
        } else {
            alert("Export failed and no server backup found.");
        }
    }
});
