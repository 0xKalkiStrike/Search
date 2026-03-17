'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Search, Globe, Shield, Star, BarChart3, CheckCircle2, AlertCircle, ExternalLink, Linkedin, Twitter, Facebook, Instagram } from 'lucide-react';
import { CompanyMetadata, ProcessingState } from '@/lib/types';

export default function ScreeningDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ProcessingState>({
    currentName: '',
    progress: 0,
    total: 0,
    results: {},
    isProcessing: false
  });
  const [error, setError] = useState<string | null>(null);

  // Poll results every 2 seconds if processing
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (state.isProcessing || Object.keys(state.results).length === 0) {
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/results');
          const data = await res.json();
          setState(data);
        } catch (e) {
          console.error('Polling error:', e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [state.isProcessing]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setError(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setState(prev => ({ ...prev, isProcessing: true }));
    } catch (err) {
      setError('Failed to upload file');
    }
  };

  const resultsArray = Object.values(state.results).reverse();

  return (
    <div className="min-h-screen p-8 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-12 flex justify-between items-end">
        <div>
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-bold gradient-text mb-2"
          >
            Business Screening AI
          </motion.h1>
          <p className="text-zinc-400">Advanced branding, social, and website analysis engine.</p>
        </div>
        
        {state.isProcessing && (
          <div className="text-right">
            <p className="text-sm font-mono text-zinc-500 mb-1">Processing: {state.currentName}</p>
            <div className="w-64 h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
              <motion.div 
                className="h-full bg-blue-500"
                initial={{ width: 0 }}
                animate={{ width: `${state.progress}%` }}
              />
            </div>
            <p className="text-xs text-zinc-600 mt-1">{state.progress}% Complete • {state.results ? Object.keys(state.results).length : 0}/{state.total}</p>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar / Upload */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass p-6 rounded-3xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Upload size={20} className="text-blue-400" />
              Upload Data
            </h2>
            <form onSubmit={handleUpload} className="space-y-4">
              <label className="block">
                <div className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 transition-colors rounded-2xl p-8 text-center cursor-pointer">
                  <Upload className="mx-auto mb-2 text-zinc-500" />
                  <span className="text-sm text-zinc-400">{file ? file.name : "Select Excel File"}</span>
                  <input 
                    type="file" 
                    className="hidden" 
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </div>
              </label>
              <button 
                disabled={!file || state.isProcessing}
                className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {state.isProcessing ? 'Analyzing...' : 'Start Screening'}
              </button>
              {error && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertCircle size={12}/> {error}</p>}
            </form>
          </div>

          <div className="glass p-6 rounded-3xl">
            <h2 className="text-lg font-semibold mb-4">Screening Stats</h2>
            <div className="space-y-4">
              <StatItem icon={<Globe size={16}/>} label="Websites Found" value={resultsArray.filter(r => r.website).length} />
              <StatItem icon={<Shield size={16}/>} label="Modern Stacks" value={resultsArray.filter(r => r.branding.isModern).length} />
              <StatItem icon={<Star size={16}/>} label="Top Brands" value={resultsArray.filter(r => r.branding.score > 80).length} />
            </div>
          </div>
        </div>

        {/* Results Main Area */}
        <div className="lg:col-span-3">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              Recent Analysis
              <span className="text-sm font-normal text-zinc-500 bg-zinc-900 px-3 py-1 rounded-full border border-zinc-800">
                {resultsArray.length} results
              </span>
            </h2>
          </div>

          <div className="grid gap-6">
            <AnimatePresence mode="popLayout">
              {resultsArray.map((company, idx) => (
                <motion.div
                  key={company.name}
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                  className="glass p-6 rounded-3xl group overflow-hidden relative"
                >
                  <div className="flex flex-col md:flex-row gap-6 relative z-10">
                    {/* Brand Score Circle */}
                    <div className="flex-shrink-0 flex items-center justify-center">
                      <div className="relative w-24 h-24">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-zinc-900" />
                          <circle 
                            cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="6" fill="transparent" 
                            strokeDasharray={2 * Math.PI * 44} 
                            strokeDashoffset={2 * Math.PI * 44 * (1 - company.branding.score / 100)}
                            className={company.branding.score > 70 ? "text-emerald-500" : company.branding.score > 40 ? "text-amber-500" : "text-rose-500"} 
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold">{company.branding.score}</span>
                          <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Brand</span>
                        </div>
                      </div>
                    </div>

                    {/* Company Info */}
                    <div className="flex-grow">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className="text-2xl font-bold group-hover:text-blue-400 transition-colors flex items-center gap-2">
                            {company.name}
                            {company.branding.isModern && <CheckCircle2 size={16} className="text-emerald-500" />}
                          </h3>
                          {company.website ? (
                            <a href={company.website} target="_blank" className="text-sm text-zinc-400 hover:text-white flex items-center gap-1">
                              <Globe size={14}/> {new URL(company.website).hostname} <ExternalLink size={12}/>
                            </a>
                          ) : (
                            <span className="text-sm text-zinc-600 italic">No website located</span>
                          )}
                        </div>
                        <div className={`px-4 py-1 rounded-full text-xs font-bold border ${getAttractivenessStyle(company.branding.attractiveness)}`}>
                          {company.branding.attractiveness} Branding
                        </div>
                      </div>

                      <p className="text-sm text-zinc-400 mb-4 line-clamp-2">{company.branding.description}</p>
                      
                      <div className="flex flex-wrap gap-4 mt-auto">
                        <SocialIcon icon={<Linkedin size={16}/>} url={company.socials.linkedin} />
                        <SocialIcon icon={<Twitter size={16}/>} url={company.socials.twitter} />
                        <SocialIcon icon={<Facebook size={16}/>} url={company.socials.facebook} />
                        <SocialIcon icon={<Instagram size={16}/>} url={company.socials.instagram} />
                        
                        <div className="ml-auto flex gap-4">
                           <div className="text-right">
                              <p className="text-[10px] text-zinc-500 uppercase">Load Time</p>
                              <p className="text-sm font-semibold">{company.screening.loadTime ? `${(company.screening.loadTime / 1000).toFixed(2)}s` : 'N/A'}</p>
                           </div>
                           <div className="text-right">
                              <p className="text-[10px] text-zinc-500 uppercase">Status</p>
                              <p className={`text-sm font-semibold ${company.screening.status === 'Online' ? 'text-emerald-400' : 'text-rose-400'}`}>{company.screening.status}</p>
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Subtle corner detail */}
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 blur-3xl rounded-full -mr-12 -mt-12" />
                </motion.div>
              ))}
            </AnimatePresence>
            
            {resultsArray.length === 0 && !state.isProcessing && (
              <div className="text-center py-20 glass rounded-3xl">
                <Search size={48} className="mx-auto text-zinc-800 mb-4" />
                <h3 className="text-xl font-semibold text-zinc-500">No screenings yet</h3>
                <p className="text-zinc-600">Upload an Excel sheet to begin full business analysis.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function SocialIcon({ icon, url }: { icon: React.ReactNode, url?: string }) {
  return (
    <a 
      href={url || '#'} 
      target="_blank"
      className={`p-2 rounded-lg border transition-all ${url ? 'border-zinc-800 text-zinc-400 hover:border-white hover:text-white' : 'border-zinc-900/50 text-zinc-800 cursor-not-allowed opacity-30'}`}
      onClick={e => !url && e.preventDefault()}
    >
      {icon}
    </a>
  );
}

function getAttractivenessStyle(type: string) {
  switch (type) {
    case 'Stunning': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'Average': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'Poor': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    default: return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
  }
}
