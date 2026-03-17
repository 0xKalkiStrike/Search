export interface CompanyMetadata {
  name: string;
  website?: string;
  socials: {
    linkedin?: string;
    twitter?: string;
    facebook?: string;
    instagram?: string;
  };
  branding: {
    score: number;
    description: string;
    isModern: boolean;
    hasLogo: boolean;
    attractiveness: 'Poor' | 'Average' | 'Stunning';
  };
  screening: {
    status: 'Online' | 'Offline' | 'Checking';
    loadTime?: number;
    rating?: string;
    reviewsCount?: string;
    summary?: string;
  };
}

export interface ProcessingState {
  currentName: string;
  progress: number;
  total: number;
  results: Record<string, CompanyMetadata>;
  isProcessing: boolean;
}
