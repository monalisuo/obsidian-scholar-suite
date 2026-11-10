import { TFile } from "obsidian";

export interface JournalRankBadge {
  text: string;
  type: string;
}

export interface ScholarlyPaper {
  doi?: string;
  title: string;
  authors: string[];
  year?: number | string;
  journal?: string;
  journalRanks?: JournalRankBadge[];
  abstract?: string;
  abstractZh?: string;
  abstractSource?: string;
  citationCount?: number;
  externalIds?: Record<string, string>;
  url?: string;
}

export interface ReferenceItem {
  id: string;
  index?: number;
  title: string;
  zhTitle?: string;
  authors: string[];
  year?: number | string;
  journal?: string;
  journalRanks?: JournalRankBadge[];
  doi?: string;
  citationCount?: number;
  abstract?: string;
  abstractZh?: string;
  abstractSource?: string;
  inVault: boolean;
  vaultFile?: TFile;
  vaultPath?: string;
  vaultTitle?: string;
  rawText?: string;
}

export interface CitationItem {
  id: string;
  index?: number;
  title: string;
  zhTitle?: string;
  authors: string[];
  year?: number | string;
  journal?: string;
  journalRanks?: JournalRankBadge[];
  doi?: string;
  abstract?: string;
  abstractZh?: string;
  abstractSource?: string;
  citationCount?: number;
  isInfluential?: boolean;
  inVault: boolean;
  vaultFile?: TFile;
  vaultPath?: string;
  vaultTitle?: string;
}

export interface PaperMetadata {
  doi?: string;
  title?: string;
  authors?: string[];
  date?: string;
  year?: string;
  journal?: string;
  citekey?: string;
  zotero_key?: string;
  source_note?: string;
  pdf_path?: string;
  abstract?: string;
}

export interface MatchResult {
  matched: boolean;
  file?: TFile;
  matchType?: "doi" | "citekey" | "title";
  confidence?: number;
}

export interface AuditIssue {
  id: string;
  category: "math" | "table" | "citation" | "align";
  severity: "error" | "warning" | "info";
  line: number;
  preview: string;
  message: string;
  autoFixable: boolean;
  fixAction?: () => string;
}

export interface AuditSummary {
  fileName: string;
  totalIssues: number;
  mathIssues: number;
  tableIssues: number;
  citationIssues: number;
  alignIssues: number;
  issues: AuditIssue[];
  fixedCount?: number;
}

export interface ScholarSuiteSettings {
  semanticScholarApiKey: string;
  elsevierApiKey: string;
  easyScholarApiKey: string;
  preferredApi: "semanticscholar" | "crossref" | "openalex";
  defaultTemplatePath: string;
  zoteroPort: number;
  autoOpenSidebar: boolean;
  autoCheckMathOnSave: boolean;
  enforceBlankLinesBetweenRefs: boolean;
  abstractCache: Record<string, string>;
  journalRankCache: Record<string, JournalRankBadge[]>;
  cnkiKeeperAutoLaunch: boolean;
}

export const DEFAULT_SETTINGS: ScholarSuiteSettings = {
  semanticScholarApiKey: "",
  elsevierApiKey: "",
  easyScholarApiKey: "",
  preferredApi: "semanticscholar",
  defaultTemplatePath: "模板/论文精读模板.md",
  zoteroPort: 23119,
  autoOpenSidebar: true,
  autoCheckMathOnSave: false,
  enforceBlankLinesBetweenRefs: true,
  abstractCache: {},
  journalRankCache: {},
  cnkiKeeperAutoLaunch: true,
};
