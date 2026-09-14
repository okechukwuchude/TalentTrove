export type Workplace = 'remote' | 'hybrid' | 'onsite';
export type Employment = 'full-time' | 'part-time' | 'contract' | 'internship';

export type RawPosting = {
  title: string;
  company: string;
  locations?: string[];
  country?: string | null;
  workplace?: Workplace | null;
  employment?: Employment | null;
  description?: string | null;
  postedAt?: Date | null;
  url: string;
  source: string;
};

export type IngestionAdapter = {
  name: string;
  fetchPostings(): Promise<RawPosting[]>;
};
