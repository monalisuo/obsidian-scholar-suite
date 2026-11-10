import { App, TFile } from "obsidian";
import { MatchResult } from "../types";

export class VaultMatcher {
  private app: App;
  private doiMap: Map<string, TFile> = new Map();
  private citekeyMap: Map<string, TFile> = new Map();
  private zoteroKeyMap: Map<string, TFile> = new Map();
  private titleMap: Map<string, TFile> = new Map();
  private vaultFiles: { file: TFile; cleanBase: string; authors: string[]; year: string }[] = [];

  constructor(app: App) {
    this.app = app;
  }

  public normalizeDoi(doi: string): string {
    return doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  }

  public normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, "") // Keep alphanumeric and Chinese characters
      .trim();
  }

  public rebuildIndex(): void {
    this.doiMap.clear();
    this.citekeyMap.clear();
    this.zoteroKeyMap.clear();
    this.titleMap.clear();
    this.vaultFiles = [];

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const authors = Array.isArray(fm?.authors) ? fm.authors.map((a: string) => a.toLowerCase()) : [];
      const year = String(fm?.date || fm?.year || "").trim();

      this.vaultFiles.push({
        file,
        cleanBase: file.basename.toLowerCase(),
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
      }

      // 5. Basename title fallback
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

    // 4. Check Chinese Title (zhTitle)
    if (paper.zhTitle) {
      const normZh = this.normalizeTitle(paper.zhTitle);
      if (normZh.length >= 4) {
        const file = this.titleMap.get(normZh);
        if (file) {
          return { matched: true, file, matchType: "title", confidence: 0.95 };
        }
        for (const [key, f] of this.titleMap.entries()) {
          if (normZh.length >= 6 && (key.includes(normZh) || normZh.includes(key))) {
            return { matched: true, file: f, matchType: "title", confidence: 0.9 };
          }
        }
      }
    }

    // 5. Check Main Title
    if (paper.title) {
      const normT = this.normalizeTitle(paper.title);
      if (normT.length >= 4) {
        const file = this.titleMap.get(normT);
        if (file) {
          return { matched: true, file, matchType: "title", confidence: 0.95 };
        }

        // Substring check for titles >= 10 chars
        if (normT.length >= 10) {
          for (const [key, f] of this.titleMap.entries()) {
            if (key.includes(normT) || normT.includes(key)) {
              return { matched: true, file: f, matchType: "title", confidence: 0.85 };
            }
          }
        }
      }
    }

    // 6. Check Raw text against Basenames (Author + Title match)
    if (paper.raw) {
      const rawLower = paper.raw.toLowerCase();
      for (const v of this.vaultFiles) {
        // If author and key title parts appear in raw line
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
