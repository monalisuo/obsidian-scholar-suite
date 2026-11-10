import { requestUrl } from "obsidian";
import { ReferenceItem, CitationItem, ScholarlyPaper } from "../types";

export class SemanticScholarClient {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  public setApiKey(apiKey?: string) {
    this.apiKey = apiKey;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": "ObsidianScholarSuite/1.0.0",
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }
    return headers;
  }

  public async fetchPaperAndCitations(
    identifier: string,
    fallbackTitle?: string
  ): Promise<{
    paper?: ScholarlyPaper;
    references: ReferenceItem[];
    citations: CitationItem[];
  }> {
    let cleanId = identifier.startsWith("10.") ? `DOI:${identifier}` : identifier;
    const fields =
      "title,authors,year,venue,citationCount,abstract,externalIds,references.title,references.authors,references.year,references.externalIds,references.citationCount,references.abstract,citations.title,citations.authors,citations.year,citations.externalIds,citations.abstract,citations.isInfluential";

    let url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(cleanId)}?fields=${fields}`;

    try {
      let response = await requestUrl({
        url,
        method: "GET",
        headers: this.getHeaders(),
      });

      // If DOI returned 404, try searching by title if provided
      if (response.status === 404 && fallbackTitle && !/[\u4e00-\u9fa5]/.test(fallbackTitle)) {
        const paperId = await this.searchByTitle(fallbackTitle);
        if (paperId) {
          url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${fields}`;
          response = await requestUrl({
            url,
            method: "GET",
            headers: this.getHeaders(),
          });
        }
      }

      if (response.status !== 200) {
        throw new Error(`Semantic Scholar returned status ${response.status}`);
      }

      const data = response.json;
      const paper: ScholarlyPaper = {
        title: data.title || "",
        authors: (data.authors || []).map((a: any) => a.name || ""),
        year: data.year,
        journal: data.venue,
        citationCount: data.citationCount,
        abstract: data.abstract,
        doi: data.externalIds?.DOI,
        externalIds: data.externalIds,
      };

      const references: ReferenceItem[] = (data.references || [])
        .filter((r: any) => r && r.title)
        .map((r: any, idx: number) => ({
          id: r.paperId || `ref_${idx}`,
          index: idx + 1,
          title: r.title,
          authors: (r.authors || []).map((a: any) => a.name || ""),
          year: r.year,
          doi: r.externalIds?.DOI,
          citationCount: r.citationCount,
          abstract: r.abstract,
          inVault: false,
        }));

      const citations: CitationItem[] = (data.citations || [])
        .filter((c: any) => c && c.title)
        .map((c: any, idx: number) => ({
          id: c.paperId || `cite_${idx}`,
          index: idx + 1,
          title: c.title,
          authors: (c.authors || []).map((a: any) => a.name || ""),
          year: c.year,
          doi: c.externalIds?.DOI,
          citationCount: c.citationCount,
          abstract: c.abstract,
          isInfluential: Boolean(c.isInfluential),
          inVault: false,
        }));

      return { paper, references, citations };
    } catch (err) {
      console.warn("Semantic Scholar fetch failed:", err);
      return { references: [], citations: [] };
    }
  }

  public async fetchAbstract(doiOrId: string, title?: string): Promise<string | null> {
    try {
      let cleanId = doiOrId.startsWith("10.") ? `DOI:${doiOrId}` : doiOrId;
      let url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(cleanId)}?fields=abstract,title`;
      let res = await requestUrl({ url, headers: this.getHeaders() });
      if (res.status === 200 && res.json?.abstract) {
        return res.json.abstract;
      }

      if (title) {
        const searchUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=abstract`;
        res = await requestUrl({ url: searchUrl, headers: this.getHeaders() });
        if (res.status === 200 && res.json?.data?.[0]?.abstract) {
          return res.json.data[0].abstract;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch abstract:", e);
    }
    return null;
  }

  public async searchByTitle(title: string): Promise<string | null> {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=paperId,externalIds,title`;
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: this.getHeaders(),
      });
      if (response.status === 200 && response.json?.data?.length > 0) {
        const item = response.json.data[0];
        return item.externalIds?.DOI || item.paperId || null;
      }
    } catch (e) {
      console.warn("Semantic Scholar title search failed:", e);
    }
    return null;
  }
}
