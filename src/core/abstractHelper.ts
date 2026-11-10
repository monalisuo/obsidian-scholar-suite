import { App, TFile, requestUrl } from "obsidian";
import { ReferenceItem, CitationItem } from "../types";
import type ScholarSuitePlugin from "../main";

export interface AbstractUnifiedResult {
  abstract: string;
  source: string;
  authors?: string[];
  journal?: string;
  doi?: string;
}

export class AbstractHelper {
  /**
   * Generates a stable normalized cache key from title and DOI
   */
  public static getCacheKey(item: ReferenceItem | CitationItem): string {
    const raw = (item.doi || item.title || "")
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, "");
    return raw.substring(0, 80);
  }

  /**
   * Extracts abstract from a local Obsidian Markdown note
   */
  public static async extractFromLocalFile(app: App, file: TFile): Promise<string | null> {
    try {
      const content = await app.vault.read(file);

      // 1. Check Frontmatter
      const cache = app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.abstract && typeof cache.frontmatter.abstract === "string") {
        const val = cache.frontmatter.abstract.trim();
        if (val.length > 15) return val;
      }

      // 2. Check ## 摘要 or 摘要： or 【摘要】
      const absRegex =
        /(?:^#{1,4}\s*|[*_]{0,2}|【|\[)\s*摘要\s*[*_]{0,2}(?:】|\])?[:：]?\s*([\s\S]*?)(?=\n#{1,4}\s|\n\n\*\*|\n---|\Z)/im;
      const mZh = absRegex.exec(content);
      if (mZh) {
        const clean = mZh[1].replace(/<[^>]+>/g, "").replace(/\r?\n/g, " ").trim();
        if (clean.length > 20) return clean;
      }

      // 3. Check Abstract (English)
      const enAbsRegex =
        /(?:^#{1,4}\s*|[*_]{0,2}|【|\[)\s*Abstract\s*[*_]{0,2}(?:】|\])?[:：]?\s*([\s\S]*?)(?=\n#{1,4}\s|\n\n\*\*|\n---|\Z)/im;
      const mEn = enAbsRegex.exec(content);
      if (mEn) {
        const clean = mEn[1].replace(/<[^>]+>/g, "").replace(/\r?\n/g, " ").trim();
        if (clean.length > 20) return clean;
      }
    } catch (e) {
      console.warn("Failed to extract local abstract:", e);
    }
    return null;
  }

  /**
   * Comprehensive Multi-Source Abstract Fetcher:
   * Order of precedence:
   * 1. In-memory / Already populated
   * 2. Persistent Abstract Cache in plugin settings
   * 3. Local Obsidian Vault File
   * 4. Zotero Local Database (Instant, 20ms)
   * 5. Chinese Papers -> CNKI 知网原生爬取引擎 (via CDP 9222)
   * 6. English Papers -> Crossref + OpenAlex 协同 DOI 握手链
   * 7. Semantic Scholar (Rate-limit shielded)
   */
  public static async fetchAbstractUnified(
    app: App,
    plugin: ScholarSuitePlugin,
    item: ReferenceItem | CitationItem
  ): Promise<AbstractUnifiedResult | null> {
    const key = this.getCacheKey(item);

    // 1. In-Memory
    if (item.abstract && item.abstract.length > 15 && !item.abstract.includes("暂无该文献")) {
      return {
        abstract: item.abstract,
        source: item.abstractSource || "内存缓存",
      };
    }

    // 2. Persistent Settings Cache
    if (plugin.settings.abstractCache && plugin.settings.abstractCache[key]) {
      const cached = plugin.settings.abstractCache[key];
      if (cached && cached.length > 15) {
        item.abstract = cached;
        item.abstractSource = "本地持久缓存";
        return {
          abstract: cached,
          source: "本地持久缓存",
        };
      }
    }

    // 3. Local Vault Note
    if (item.inVault && item.vaultFile) {
      const localAbs = await this.extractFromLocalFile(app, item.vaultFile);
      if (localAbs) {
        item.abstract = localAbs;
        item.abstractSource = "本地笔记";
        this.saveToCache(plugin, key, localAbs);
        return { abstract: localAbs, source: "本地笔记" };
      }
    }

    // 4. Zotero Local API
    try {
      const zoteroMatch = await plugin.zoteroLocalClient.searchAbstract(item.title, item.doi);
      if (zoteroMatch && zoteroMatch.abstract) {
        item.abstract = zoteroMatch.abstract;
        item.abstractSource = "Zotero 本地库";
        this.saveToCache(plugin, key, zoteroMatch.abstract);
        return { abstract: zoteroMatch.abstract, source: "Zotero 本地库" };
      }
    } catch (e) {
      // Zotero offline
    }

    // 5. Chinese Papers -> CNKI Knowledge Crawler
    const isChinese = /[\u4e00-\u9fa5]/.test(item.title) || (item.zhTitle && /[\u4e00-\u9fa5]/.test(item.zhTitle));
    if (isChinese) {
      const cnkiTarget = item.zhTitle || item.title;
      try {
        const cnkiRes = await plugin.cnkiBridge.fetchCnkiAbstract(cnkiTarget);
        if (cnkiRes.success && cnkiRes.abstract && cnkiRes.abstract.length > 15) {
          item.abstract = cnkiRes.abstract;
          item.abstractSource = "知网 CNKI";
          if (cnkiRes.authors && cnkiRes.authors.length > 0 && (!item.authors || item.authors.length === 0)) {
            item.authors = cnkiRes.authors;
          }
          if (cnkiRes.journal && !item.journal) {
            item.journal = cnkiRes.journal;
          }
          if (cnkiRes.doi && !item.doi) {
            item.doi = cnkiRes.doi;
          }
          this.saveToCache(plugin, key, cnkiRes.abstract);
          return {
            abstract: cnkiRes.abstract,
            source: "知网 CNKI",
            authors: cnkiRes.authors,
            journal: cnkiRes.journal,
            doi: cnkiRes.doi,
          };
        }
      } catch (e) {
        console.warn("CNKI fetch failed:", e);
      }
    }

    // 6. International / English Papers -> Crossref + OpenAlex Chained Handshake
    if (!isChinese || (item.doi && !item.doi.includes("11821"))) {
      try {
        // Step A: Query Crossref (with bibliographic title or DOI)
        const crResult = await plugin.crossrefClient.fetchAbstractWithDoi(item.doi || item.title, item.title);
        
        if (crResult?.abstract && crResult.abstract.length > 20) {
          item.abstract = crResult.abstract;
          item.abstractSource = "Crossref";
          if (crResult.doi && !item.doi) item.doi = crResult.doi;
          this.saveToCache(plugin, key, crResult.abstract);
          return { abstract: crResult.abstract, source: "Crossref", doi: crResult.doi };
        }

        // If Crossref found the DOI but had no abstract, query OpenAlex by that exact DOI!
        const targetDoi = crResult?.doi || item.doi;
        if (targetDoi) {
          if (!item.doi) item.doi = targetDoi;
          const oaDoiAbs = await plugin.openAlexClient.fetchAbstractByDoi(targetDoi);
          if (oaDoiAbs && oaDoiAbs.length > 20) {
            item.abstract = oaDoiAbs;
            item.abstractSource = "OpenAlex (via Crossref DOI)";
            this.saveToCache(plugin, key, oaDoiAbs);
            return { abstract: oaDoiAbs, source: "OpenAlex (via Crossref DOI)", doi: targetDoi };
          }
        }

        // Step B: Query OpenAlex fuzzy search
        const oaAbs = await plugin.openAlexClient.fetchAbstractByTitle(item.title);
        if (oaAbs?.abstract && oaAbs.abstract.length > 20) {
          item.abstract = oaAbs.abstract;
          item.abstractSource = "OpenAlex";
          if (oaAbs.doi && !item.doi) item.doi = oaAbs.doi;
          this.saveToCache(plugin, key, oaAbs.abstract);
          return { abstract: oaAbs.abstract, source: "OpenAlex", doi: oaAbs.doi };
        }
      } catch (e) {
        console.warn("Crossref / OpenAlex lookup failed:", e);
      }

      // Step C: Semantic Scholar fallback
      try {
        const s2Abs = await plugin.semanticScholarClient.fetchAbstract(item.doi || item.title, item.title);
        if (s2Abs && s2Abs.length > 20) {
          item.abstract = s2Abs;
          item.abstractSource = "Semantic Scholar";
          this.saveToCache(plugin, key, s2Abs);
          return { abstract: s2Abs, source: "Semantic Scholar" };
        }
      } catch (e) {
        // S2 rate limited or 404
      }
    }

    return null;
  }

  private static async saveToCache(plugin: ScholarSuitePlugin, key: string, abstract: string): Promise<void> {
    try {
      if (!plugin.settings.abstractCache) {
        plugin.settings.abstractCache = {};
      }
      plugin.settings.abstractCache[key] = abstract;
      await plugin.saveSettings();
    } catch (e) {
      console.warn("Failed to save abstract to cache:", e);
    }
  }

  /**
   * Translates abstract (English -> Chinese or Chinese -> English)
   * Primary: Google Translate GTX Web API
   * High-reliability fallback: MyMemory API with intelligent sentence chunking
   */
  public static async translateText(text: string): Promise<string | null> {
    if (!text || text.trim().length === 0) return null;

    const isEnglish = !/[\u4e00-\u9fa5]/.test(text.substring(0, 50));
    const targetLang = isEnglish ? "zh-CN" : "en";

    // 1. Try Google Translate GTX API
    try {
      const cleanText = text.replace(/[\r\n]+/g, " ").trim();
      const chunks = this.chunkText(cleanText, 1200);
      const translatedChunks: string[] = [];

      for (const chunk of chunks) {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(chunk)}`;
        const res = await requestUrl({
          url,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (res.status === 200 && Array.isArray(res.json) && Array.isArray(res.json[0])) {
          const partTrans = res.json[0].map((p: any) => p[0] || "").join("");
          if (partTrans) translatedChunks.push(partTrans);
        }
      }

      if (translatedChunks.length > 0) {
        return translatedChunks.join(" ");
      }
    } catch (e) {
      // Fallback
    }

    // 2. High-reliability Fallback: MyMemory API with sentence chunking
    try {
      const pair = isEnglish ? "en|zh-CN" : "zh-CN|en";
      const cleanText = text.replace(/[\r\n]+/g, " ").trim();
      const sentences = cleanText.split(/(?<=[.!?。！？]\s+)/);
      const chunks: string[] = [];
      let currentChunk = "";

      for (const s of sentences) {
        if ((currentChunk + " " + s).trim().length <= 380) {
          currentChunk = (currentChunk + " " + s).trim();
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = s.trim();
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      const translatedSentences: string[] = [];
      for (const c of chunks) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(c)}&langpair=${pair}`;
        const res = await requestUrl({ url, method: "GET" });
        if (res.status === 200 && res.json?.responseData?.translatedText) {
          translatedSentences.push(res.json.responseData.translatedText);
        } else {
          translatedSentences.push(c);
        }
      }

      if (translatedSentences.length > 0) {
        return translatedSentences.join(" ");
      }
    } catch (e) {
      console.warn("MyMemory translation failed:", e);
    }

    return null;
  }

  private static chunkText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = start + maxLength;
      if (end < text.length) {
        // Break on period or space if possible
        const lastPeriod = text.lastIndexOf(". ", end);
        if (lastPeriod > start + maxLength * 0.6) {
          end = lastPeriod + 1;
        } else {
          const lastSpace = text.lastIndexOf(" ", end);
          if (lastSpace > start + maxLength * 0.6) {
            end = lastSpace;
          }
        }
      }
      chunks.push(text.substring(start, end).trim());
      start = end;
    }
    return chunks;
  }
}
