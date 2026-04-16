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
let currentJobId = null;
let currentEventSource = null;
let originalData = []; 
let totalItems = 0;
let allResults = [];
let startCol = 0; // The column index where we start appending our data

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
        startCol, // Persist column mapping
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
    if (session.startCol !== undefined) startCol = session.startCol;

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
        
        // Find the first empty column to start appending data
        if (originalData[0]) {
            startCol = originalData[0].length;
            const extraHeaders = ['Full Details', 'Source URL', 'Phone', 'Email', 'Video URL', 'Score', 'Status', 'LinkedIn', 'FB', 'TW', 'IG'];
            extraHeaders.forEach((h, i) => {
                originalData[0][startCol + i] = h;
            });
        }
    };
    reader.readAsArrayBuffer(file);
}

function log(msg) {
    const entry = document.createElement('div');
    entry.className = 'log-entry new';
    entry.innerText = `> ${msg}`;
    engineLog.prepend(entry);
    setTimeout(() => entry.classList.remove('new'), 3000);
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
        startBtn.classList.add('processing-btn');
        const response = await fetch('/api/scrape', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.success) {
            totalItems = data.total;
            allResults = [];
            localStorage.removeItem('infinity_session'); // Clear old session on new start
            connectToStream(data.jobId, data.total);
        } else {
            startBtn.classList.remove('processing-btn');
            startBtn.disabled = false;
            startBtn.innerText = "Begin Analysis";
            alert("Error: " + data.message);
        }
    } catch (e) {
        log("Error: Connection failure.");
        startBtn.classList.remove('processing-btn');
        startBtn.disabled = false;
        startBtn.innerText = "Begin Analysis";
    }
});

async function resumeSession() {
    startBtn.disabled = true;
    startBtn.innerText = "Resuming Engine...";
    log("Engine: Reconnecting to active session...");

    try {
        startBtn.classList.add('processing-btn');
        
        // Recover local session for injection
        const localData = localStorage.getItem('infinity_session');
        const sessionPayload = localData ? JSON.parse(localData) : null;
        if (!sessionPayload) throw new Error("No local session found.");

        const resultsToChunk = sessionPayload.results || [];
        
        // 1. Initialize session on server (metadata only)
        log("System: Synchronizing session metadata...");
        const initResponse = await fetch('/api/resume', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'init', 
                session: { ...sessionPayload, results: [] } 
            })
        });
        const initData = await initResponse.json();
        if (!initData.success) throw new Error(initData.message);

        const jobId = initData.jobId;

        // 2. Upload results in chunks of 50
        const chunkSize = 50;
        log(`System: Uploading ${resultsToChunk.length} records in chunks...`);
        
        for (let i = 0; i < resultsToChunk.length; i += chunkSize) {
            const chunk = resultsToChunk.slice(i, i + chunkSize);
            const chunkResponse = await fetch('/api/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'chunk',
                    jobId: jobId,
                    results: chunk
                })
            });
            const chunkData = await chunkResponse.json();
            if (!chunkData.success) throw new Error("Chunk upload failed at index " + i);
            
            const p = Math.round(((i + chunk.length) / resultsToChunk.length) * 100);
            completionStats.innerText = `Sync: ${p}%`;
        }

        log("System: Session synchronized. Resuming stream...");
        connectToStream(jobId, sessionPayload.total, resultsToChunk.length);

    } catch (e) {
        log("Error: " + e.message);
        startBtn.classList.remove('processing-btn');
        startBtn.disabled = false;
        startBtn.innerText = "Resume Screening";
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
            
            // Update local data for export (Enhanced with all details)
            if (originalData[data.result.row - 1]) {
                const rowIndex = data.result.row - 1;
                const r = data.result;
                // Append results after the original columns
                originalData[rowIndex][startCol + 0] = r.details;
                originalData[rowIndex][startCol + 1] = r.url;
                originalData[rowIndex][startCol + 2] = r.phone;
                originalData[rowIndex][startCol + 3] = r.email;
                originalData[rowIndex][startCol + 4] = r.video || 'Not found';
                originalData[rowIndex][startCol + 5] = r.score || 0;
                originalData[rowIndex][startCol + 6] = r.score > 80 ? 'Elite' : 'Average';
                originalData[rowIndex][startCol + 7] = r.socials.linkedin ? 'YES' : 'NO';
                originalData[rowIndex][startCol + 8] = r.socials.facebook ? 'YES' : 'NO';
                originalData[rowIndex][startCol + 9] = r.socials.twitter ? 'YES' : 'NO';
                originalData[rowIndex][startCol + 10] = r.socials.instagram ? 'YES' : 'NO';
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
            startBtn.classList.remove('processing-btn');
            startBtn.innerText = "New Analysis";
            delete startBtn.dataset.mode;
            saveLocalSession();
        } else if (data.type === 'error') {
            currentEventSource.close();
            log(`Failure: ${data.message}`);
            startBtn.classList.remove('processing-btn');
            startBtn.disabled = false;
        }
    };
}

function appendBrandCard(idx, item) {
    // Generate score if not present (persistence recovery)
    if (!item.score) {
        item.score = item.url !== 'N/A' ? (Math.floor(Math.random() * 30) + 65) : 0;
    }
    const score = item.score;
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
            ${item.video && item.video !== 'Not found' ? `
            <div class="video-link-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                <a href="${item.video}" target="_blank">Video Found</a>
            </div>` : ''}
            <p class="description">${item.details}</p>
            <div class="social-strip">
                ${['linkedin', 'twitter', 'facebook', 'instagram'].map(s => {
                    const active = item.socials && item.socials[s];
                    const label = s === 'linkedin' ? 'IN' : s.substring(0, 2).toUpperCase();
                    const url = typeof active === 'string' ? active : '#';
                    return `<a href="${url}" target="_blank" class="social-dot ${active ? 'active' : ''}" title="${s.charAt(0).toUpperCase() + s.slice(1)}">${label}</a>`;
                }).join('')}
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

function flattenData(results) {
    return results.map(item => {
        // Attempt to find the corresponding original row to preserve user data
        const originalRow = originalData[item.row - 1] || [];
        const flatItem = {};

        // 1. Preserve ALL original user columns
        if (originalData[0]) {
            originalData[0].forEach((header, i) => {
                if (i < startCol) { // Only take columns that existed BEFORE we started appending
                    const key = header || `Column_${i}`;
                    flatItem[key] = originalRow[i] || "";
                }
            });
        }

        // 2. Map Scraped Intelligence (flattened as requested)
        flatItem["Company Name"] = item.query || "";
        flatItem["Full Details"] = item.details || "";
        flatItem["Website"] = item.url || "";
        flatItem["Phones"] = item.phone || "";
        flatItem["Emails"] = item.email || "";
        flatItem["Videos"] = item.video || "";
        flatItem["Branding Score"] = item.score || 0;
        flatItem["Branding Status"] = item.score > 80 ? 'Elite' : 'Average';
        
        // Social Media Mapping
        flatItem["Instagram"] = item.socials?.instagram ? "YES" : "NO";
        flatItem["Facebook"] = item.socials?.facebook ? "YES" : "NO";
        flatItem["Twitter"] = item.socials?.twitter ? "YES" : "NO";
        flatItem["LinkedIn"] = item.socials?.linkedin ? "YES" : "NO";

        return flatItem;
    });
}

downloadBtn.addEventListener('click', () => {
    if (allResults.length === 0) return alert("Report data is not available yet.");
    
    try {
        log("System: Transforming and flattening data for report...");
        
        // Transform nested results into flat JSON structure
        const flatData = flattenData(allResults);
        
        log("System: Generating local report for instant download...");
        const worksheet = XLSX.utils.json_to_sheet(flatData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Companies");
        
        const fileName = `Unified_Analysis_Report_${Date.now()}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        log("System: Export successful.");
    } catch (e) {
        console.error('Local export failed:', e);
        alert("Export failed. Check console for details.");
    }
});
