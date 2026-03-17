import { NextResponse } from 'next/server';
import { getState } from '@/lib/state';

export async function GET() {
  const state = getState();
  return NextResponse.json(state);
}
