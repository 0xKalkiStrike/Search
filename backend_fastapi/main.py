from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio
import os
import uuid
import json
import pandas as pd
from database import init_db

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In production, we mount the frontend public directory
app.mount("/public", StaticFiles(directory="../public"), name="public")

@app.on_event("startup")
async def startup():
    os.makedirs("uploads", exist_ok=True)
    os.makedirs("results", exist_ok=True)
    os.makedirs("proofs", exist_ok=True)
    await init_db()

@app.post("/api/scrape")
async def scrape_endpoint(file: UploadFile = File(...), searchSource: str = Form(None)):
    content = await file.read()
    job_id = str(uuid.uuid4())
    upload_path = f"uploads/{job_id}_{file.filename}"
    with open(upload_path, "wb") as f:
        f.write(content)
        
    try:
        df = pd.read_excel(upload_path)
        total = len(df) - 1
    except Exception as e:
        return JSONResponse({"success": False, "message": "Invalid excel file"})
        
    # Trigger background tasks here for queue-based scraping flow
    
    return JSONResponse({"success": True, "jobId": job_id, "total": total})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
