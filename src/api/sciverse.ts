import { requestUrl } from "obsidian";
import { CitationItem } from "../types";

export interface SciverseResult {
  success: boolean;
  papers: CitationItem[];
  total: number;
  error?: string;
}

export class SciverseClient {
  private apiKey: string;
  private baseUrl: string = "https://api.sciverse.space";

  constructor(apiKey: string = "") {
    this.apiKey = apiKey.trim();
  }

  public setApiKey(key: string) {
    this.apiKey = key.trim();
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 10);
  }

  private cleanTitleForSearch(title: string): string {
    return title
      .replace(/^\[\d+\]\s*/, "")
      .replace(/\[J\]|\[M\]|\[D\]|\[C\]|\[R\]/gi, " ")
      .replace(/[《》""''「」【】\[\]\(\)（）]/g, " ")
      .replace(/[\:\：\-\—\.\,\，]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Fetch related literature using Sciverse API:
   * 1. If DOI is present, queries /meta-paper-relations (relation: RELATED_WORKS)
   * 2. Queries /meta-search for semantic thematic related papers with full metadata
   */
  public async fetchRelatedWorks(
    doi?: string,
    title?: string,
    pageSize: number = 20
  ): Promise<SciverseResult> {
    if (!this.apiKey) {
      return {
        success: false,
        papers: [],
        total: 0,
        error: "未配置 Sciverse API Key，请在插件设置中填入 Token",
      };
    }

    const cleanDoi = doi ? doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "";
    const cleanTitle = title ? this.cleanTitleForSearch(title) : "";

    const papersMap = new Map<string, CitationItem>();

    // 1. If DOI available, query /meta-paper-relations for graph topology related works
    if (cleanDoi) {
      try {
        const res = await requestUrl({
          url: `${this.baseUrl}/meta-paper-relations`,
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            unique_id: `paper:${cleanDoi}`,
            relation: "RELATED_WORKS",
            page: 1,
            page_size: Math.min(pageSize, 25),
          }),
        });

        if (res.status === 200 && res.json && Array.isArray(res.json.items)) {
          for (const item of res.json.items) {
            const rawTitle = (item.title || "").trim();
            if (!rawTitle) continue;

            const paperDoi = (item.id && item.id.startsWith("paper:")) ? item.id.replace(/^paper:/, "") : undefined;
            const normKey = rawTitle.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");

            papersMap.set(normKey, {
              id: item.id || `sci_rel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              title: rawTitle,
              authors: [],
              doi: paperDoi,
              sourceType: "Sciverse 图谱关联",
              inVault: false,
            });
          }
        }
      } catch (e) {
        console.warn("Sciverse meta-paper-relations request error:", e);
      }
    }

    // 2. Query /meta-search for semantic & thematic related works with rich metadata
    const searchQuery = cleanTitle || (cleanDoi ? `doi:${cleanDoi}` : "");
    if (searchQuery && searchQuery.length >= 2) {
      try {
        const res = await requestUrl({
          url: `${this.baseUrl}/meta-search`,
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: searchQuery,
            page: 1,
            page_size: pageSize,
          }),
        });

        if (res.status === 200 && res.json && Array.isArray(res.json.results)) {
          for (const r of res.json.results) {
            const rTitle = (r.title || "").trim();
            if (!rTitle) continue;

            const normKey = rTitle.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");

            // Parse authors
            let authors: string[] = [];
            if (Array.isArray(r.author)) {
              authors = r.author
                .map((a: any) => (typeof a === "string" ? a : (a?.name || "")).trim())
                .filter(Boolean);
            } else if (typeof r.author === "string") {
              authors = r.author.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
            }

            const yearVal = r.publication_published_year
              ? String(Math.round(Number(r.publication_published_year)))
              : undefined;

            const venue =
              r.publication_venue_name_unified ||
              (Array.isArray(r.publication_publisher) ? r.publication_publisher[0] : "") ||
              "";

            const existing = papersMap.get(normKey);
            if (existing) {
              // Enrich existing topology item with rich metadata
              if (authors.length > 0) existing.authors = authors;
              if (yearVal) existing.year = yearVal;
              if (venue) existing.journal = venue;
              if (r.doi) existing.doi = r.doi;
              if (r.abstract) existing.abstract = r.abstract;
              if (r.citation_count) existing.citationCount = Math.round(Number(r.citation_count));
            } else {
              papersMap.set(normKey, {
                id: r.unique_id || r.doi || `sci_meta_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                title: rTitle,
                authors,
                year: yearVal,
                journal: venue,
                doi: r.doi || undefined,
                abstract: r.abstract || undefined,
                citationCount: r.citation_count ? Math.round(Number(r.citation_count)) : undefined,
                sourceType: "Sciverse 语义关联",
                inVault: false,
              });
            }
          }
        }
      } catch (e) {
        console.warn("Sciverse meta-search error:", e);
      }
    }

    const papers = Array.from(papersMap.values());
    return {
      success: papers.length > 0,
      papers,
      total: papers.length,
      error: papers.length === 0 ? "Sciverse 未检索到相关文献记录" : undefined,
    };
  }
}
