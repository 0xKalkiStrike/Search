import fs from 'fs';
import path from 'path';
import { ProcessingState, CompanyMetadata } from './types';

const DATA_PATH = path.join(process.cwd(), 'data', 'state.json');

const defaultState: ProcessingState = {
  currentName: '',
  progress: 0,
  total: 0,
  results: {},
  isProcessing: false
};

export function getState(): ProcessingState {
  if (!fs.existsSync(DATA_PATH)) {
    return defaultState;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return defaultState;
  }
}

export function saveState(state: ProcessingState) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
}

export function updateResult(name: string, result: CompanyMetadata) {
  const state = getState();
  state.results[name] = result;
  saveState(state);
}

export function resetState(total: number) {
  saveState({
    ...defaultState,
    total,
    isProcessing: true
  });
}
