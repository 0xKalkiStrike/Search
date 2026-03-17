import { NextRequest, NextResponse } from 'next/server';
import * as xlsx from 'xlsx';
import { resetState, saveState, getState, updateResult } from '@/lib/state';
import { screenCompany } from '@/lib/scraper';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = xlsx.read(buffer);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    
    const names = rows.map(row => row[0]).filter(name => name && typeof name === 'string' && name !== 'Name');

    if (names.length === 0) {
      return NextResponse.json({ error: 'No companies found in file' }, { status: 400 });
    }

    // Start processing in "background"
    resetState(names.length);
    
    // We don't await this so the response is immediate
    processCompanies(names);

    return NextResponse.json({ success: true, count: names.length });
  } catch (error) {
    console.error('Upload failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function processCompanies(names: string[]) {
  console.log('Starting background processing for', names.length, 'companies');
  
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const state = getState();
    
    state.currentName = name;
    state.progress = Math.round(((i + 1) / names.length) * 100);
    saveState(state);
    
    console.log(`[${i+1}/${names.length}] Screening ${name}...`);
    const result = await screenCompany(name);
    updateResult(name, result);
  }
  
  const finalState = getState();
  finalState.isProcessing = false;
  finalState.currentName = 'Done';
  saveState(finalState);
  console.log('Processing complete.');
}
