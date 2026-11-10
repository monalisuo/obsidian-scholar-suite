import { App, TFile } from "obsidian";
import { MatchResult } from "../types";

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "are", "was",
  "were", "into", "their", "about", "study", "analysis", "case", "based"
]);

export class VaultMatcher {
  private app: App;
  private doiMap: Map<string, TFile> = new Map();
  private citekeyMap: Map<string, TFile> = new Map();
  private zoteroKeyMap: Map<string, TFile> = new Map();
  private titleMap: Map<string, TFile> = new Map();
  private mainTitleMap: Map<string, TFile> = new Map();
  private vaultFiles: {
    file: TFile;
    cleanBase: string;
    cleanTitle: string;
    keywords: string[];
    authors: string[];
    year: string;
  }[] = [];

  constructor(app: App) {
    this.app = app;
  }

  public normalizeDoi(doi: string): string {
    return doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  }

  public normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "") // Strip underscores, spaces, punctuation completely
      .trim();
  }

  public extractKeywords(title: string): string[] {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  }

  public rebuildIndex(): void {
    this.doiMap.clear();
    this.citekeyMap.clear();
    this.zoteroKeyMap.clear();
    this.titleMap.clear();
    this.mainTitleMap.clear();
    this.vaultFiles = [];

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const authors = Array.isArray(fm?.authors)
        ? fm.authors.map((a: string) => a.toLowerCase().trim())
        : fm?.authors
        ? [String(fm.authors).toLowerCase().trim()]
        : [];
      const year = String(fm?.date || fm?.year || "").trim();

      const rawTitle = fm?.title && typeof fm.title === "string" ? fm.title : file.basename;
      const cleanTitle = this.normalizeTitle(rawTitle);
      const keywords = this.extractKeywords(rawTitle);

      this.vaultFiles.push({
        file,
        cleanBase: file.basename.toLowerCase(),
        cleanTitle,
        keywords,
        authors,
        year,
      });

      if (!fm) continue;

      // 1. DOI
      if (fm.doi && typeof fm.doi === "string") {
        const normDoi = this.normalizeDoi(fm.doi);
        if (normDoi) this.doiMap.set(normDoi, file);
      }

      // 2. Citekey
      if (fm.citekey && typeof fm.citekey === "string") {
        this.citekeyMap.set(fm.citekey.trim().toLowerCase(), file);
      }

      // 3. Zotero Key
      if (fm.zotero_key && typeof fm.zotero_key === "string") {
        this.zoteroKeyMap.set(fm.zotero_key.trim(), file);
      }

      // 4. Title from Frontmatter
      if (fm.title && typeof fm.title === "string") {
        const normT = this.normalizeTitle(fm.title);
        if (normT.length >= 4) {
          this.titleMap.set(normT, file);
        }

        // Subtitle split (before : or — or -)
        const mainPart = fm.title.split(/[:：—–]/)[0].trim();
        const normMain = this.normalizeTitle(mainPart);
        if (normMain.length >= 10 && !this.mainTitleMap.has(normMain)) {
          this.mainTitleMap.set(normMain, file);
        }
      }

      // 5. Basename fallback
      const normBase = this.normalizeTitle(file.basename);
      if (normBase.length >= 4 && !this.titleMap.has(normBase)) {
        this.titleMap.set(normBase, file);
      }
    }
  }

  public match(paper: {
    doi?: string;
    citekey?: string;
    zoteroKey?: string;
    title?: string;
    zhTitle?: string;
    authors?: string[];
    year?: string | number;
    raw?: string;
  }): MatchResult {
    // 1. Check DOI
    if (paper.doi) {
      const normDoi = this.normalizeDoi(paper.doi);
      const file = this.doiMap.get(normDoi);
      if (file) {
        return { matched: true, file, matchType: "doi", confidence: 1.0 };
      }
    }

    // 2. Check Zotero Key
    if (paper.zoteroKey) {
      const file = this.zoteroKeyMap.get(paper.zoteroKey.trim());
      if (file) {
        return { matched: true, file, matchType: "citekey", confidence: 1.0 };
      }
    }

    // 3. Check Citekey
    if (paper.citekey) {
      const file = this.citekeyMap.get(paper.citekey.trim().toLowerCase());
      if (file) {
        return { matched: true, file, matchType: "citekey", confidence: 1.0 };
      }
    }

    const testTitles: string[] = [];
    if (paper.zhTitle) testTitles.push(paper.zhTitle);
    if (paper.title) testTitles.push(paper.title);

    // 4. Exact and Substring Title Matching
    for (const t of testTitles) {
      const normT = this.normalizeTitle(t);
      if (normT.length >= 4) {
        const file = this.titleMap.get(normT);
        if (file) {
          return { matched: true, file, matchType: "title", confidence: 0.98 };
        }

        // Check main title map (title before colon)
        const mainPart = t.split(/[:：—–]/)[0].trim();
        const normMain = this.normalizeTitle(mainPart);
        if (normMain.length >= 10) {
          const mainFile = this.mainTitleMap.get(normMain);
          if (mainFile) {
            return { matched: true, file: mainFile, matchType: "title", confidence: 0.92 };
          }
        }

        // Substring check for titles >= 8 chars
        if (normT.length >= 8) {
          for (const [key, f] of this.titleMap.entries()) {
            if (key.includes(normT) || normT.includes(key)) {
              return { matched: true, file: f, matchType: "title", confidence: 0.9 };
            }
          }
        }
      }
    }

    // 5. Keyword Overlap (Jaccard / Token Overlap)
    for (const t of testTitles) {
      const targetKeywords = this.extractKeywords(t);
      if (targetKeywords.length >= 3) {
        const targetSet = new Set(targetKeywords);

        for (const item of this.vaultFiles) {
          if (item.keywords.length < 3) continue;
          let shared = 0;
          for (const kw of item.keywords) {
            if (targetSet.has(kw)) shared++;
          }

          const ratio = (shared * 2) / (targetKeywords.length + item.keywords.length);
          if (shared >= 3 && ratio >= 0.65) {
            return { matched: true, file: item.file, matchType: "title", confidence: 0.88 };
          }
        }
      }
    }

    // 6. First Author + Year + Key Token check
    if (paper.authors && paper.authors.length > 0 && paper.year) {
      const firstAuth = paper.authors[0].toLowerCase().split(/\s+/).pop()?.replace(/[^a-z\u4e00-\u9fa5]/g, "");
      const targetYear = String(paper.year).trim();

      if (firstAuth && firstAuth.length >= 2 && targetYear.length === 4) {
        const targetKw = paper.title ? this.extractKeywords(paper.title) : [];

        for (const item of this.vaultFiles) {
          if (item.year === targetYear) {
            const hasAuthor = item.authors.some((a) => a.includes(firstAuth)) || item.cleanBase.includes(firstAuth);
            if (hasAuthor) {
              if (targetKw.length > 0) {
                const kwMatch = item.keywords.some((k) => targetKw.includes(k));
                if (kwMatch) {
                  return { matched: true, file: item.file, matchType: "title", confidence: 0.85 };
                }
              } else {
                return { matched: true, file: item.file, matchType: "title", confidence: 0.75 };
              }
            }
          }
        }
      }
    }

    // 7. Check Raw text against Basenames (Author + Title match)
    if (paper.raw) {
      const rawLower = paper.raw.toLowerCase();
      for (const v of this.vaultFiles) {
        const parts = v.cleanBase.split("-").map((p) => p.trim());
        if (parts.length >= 3) {
          const authorPart = parts[0].replace("等", "").trim();
          const titlePart = parts[2].trim();
          if (authorPart && titlePart && rawLower.includes(authorPart) && (rawLower.includes(titlePart) || titlePart.includes(rawLower))) {
            return { matched: true, file: v.file, matchType: "title", confidence: 0.85 };
          }
        }
      }
    }

    return { matched: false };
  }
}
