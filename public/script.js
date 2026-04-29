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
const tabDashboard = document.getElementById('tab-dashboard');

const resultsView = document.getElementById('results-container');

const viewTitle = document.getElementById('view-title');

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

function setFilter(filterType) {
    // UI Filters Removed
}

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
            const extraHeaders = ['Full Details', 'Source URL', 'Phone', 'Email', 'Proof Reference'];
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
                originalData[rowIndex][startCol + 0] = r.details;
                originalData[rowIndex][startCol + 1] = r.url;
                originalData[rowIndex][startCol + 2] = r.phone;
                originalData[rowIndex][startCol + 3] = r.email;
                originalData[rowIndex][startCol + 4] = r.proofs ? r.proofs.join(' | ') : '';
            }

            // Handle intermediate milestones
            if (data.checkpoint) {
                downloadBtn.classList.remove('hidden');
                log("Milestone: High-volume data reached (100 records). Triggering automated report...");
                
                // AUTOMATIC DOWNLOAD AT 100 DATA MILESTONE
                setTimeout(() => {
                    const downloadEvent = new Event('click');
                    downloadBtn.dispatchEvent(downloadEvent);
                }, 1000);
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
    const score = item.confidence?.score || 0;
    
    let ratingColor = "#f87171";
    let ratingText = "Unreliable";
    if (score >= 80) { ratingColor = "#4ade80"; ratingText = "Good"; }
    else if (score >= 50) { ratingColor = "#fbbf24"; ratingText = "Average"; }

    const s = item.socials || {};
    const socialsHTML = `
        ${s.linkedin ? `<a href="${s.linkedin}" target="_blank" style="color: #0ea5e9; text-decoration: none; margin-right: 12px; font-weight: 500;">LinkedIn</a>` : ''}
        ${s.facebook ? `<a href="${s.facebook}" target="_blank" style="color: #3b82f6; text-decoration: none; margin-right: 12px; font-weight: 500;">Facebook</a>` : ''}
        ${s.twitter ? `<a href="${s.twitter}" target="_blank" style="color: #38bdf8; text-decoration: none; margin-right: 12px; font-weight: 500;">Twitter</a>` : ''}
        ${s.instagram ? `<a href="${s.instagram}" target="_blank" style="color: #ec4899; text-decoration: none; margin-right: 12px; font-weight: 500;">Instagram</a>` : ''}
        ${s.whatsapp ? `<a href="${s.whatsapp}" target="_blank" style="color: #22c55e; text-decoration: none; margin-right: 12px; font-weight: 500;">WhatsApp</a>` : ''}
    `.trim();

    const card = document.createElement('div');
    card.className = 'brand-card';
    card.style.padding = '20px';
    card.style.marginBottom = '15px';
    card.style.background = '#1e1e24';
    card.style.borderRadius = '10px';
    card.style.border = '1px solid #333';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '10px';
    card.style.position = 'relative';

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <h3 style="margin: 0; font-size: 20px; color: #f8fafc;">${item.query}</h3>
            <span style="color: ${ratingColor}; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; background: rgba(255,255,255,0.05); border: 1px solid ${ratingColor};">
                Rating: ${ratingText} (${score}%)
            </span>
        </div>
        
        <div style="font-size: 15px; color: #a5b4fc; margin-top: 5px;">
            <strong style="color: #94a3b8;">Site URL:</strong> <a href="${item.url}" target="_blank" style="color: #818cf8; text-decoration: none;">${item.url}</a>
        </div>
        
        <div style="font-size: 15px; color: #f1f5f9;">
            <strong style="color: #94a3b8;">Contact Numbers:</strong> ${item.phone || 'Not found'}
        </div>
        
        <div style="font-size: 15px; color: #f1f5f9;">
            <strong style="color: #94a3b8;">Email Ids:</strong> ${item.email || 'Not found'}
        </div>
        
        ${socialsHTML ? `
        <div style="font-size: 15px; color: #f1f5f9; margin-top: 5px; padding-top: 10px; border-top: 1px dashed #333;">
            <strong style="color: #94a3b8; display: block; margin-bottom: 6px;">Social Media Links:</strong> ${socialsHTML}
        </div>
        ` : ''}
        
        <div style="font-size: 13px; color: #9ca3af; margin-top: 10px; padding-top: 10px; border-top: 1px solid #333;">
            <em>${item.details}</em>
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
        flatItem["Proof Reference"] = (item.proofs || []).join('; ');

        let category = "Generic";
        const emailLower = (item.email || "").toLowerCase();
        if (emailLower.includes("sales") || emailLower.includes("marketing")) category = "Sales";
        else if (emailLower.includes("support") || emailLower.includes("help")) category = "Support";
        else if (emailLower.includes("hr") || emailLower.includes("career")) category = "HR";
        else if (emailLower.includes("ceo") || emailLower.includes("founder")) category = "Founder";
        else if (emailLower && !emailLower.includes("info") && !emailLower.includes("admin")) category = "Personal";
        flatItem["Category"] = category;

        return flatItem;
    });
}

downloadBtn.addEventListener('click', () => {
    if (allResults.length === 0) return alert("Report data is not available yet.");
    
    try {
        log("System: Transforming and flattening data for report...");
        
        // Export should include Validated records only
        const validatedResults = allResults;
        
        // Transform nested results into flat JSON structure
        const flatData = flattenData(validatedResults);
        
        log(`System: Generating local report for ${validatedResults.length} validated records...`);
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
