import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { ReferenceItem, CitationItem, ScholarlyPaper } from "../types";
import { PaperCard } from "./components/PaperCard";
import { AbstractHelper } from "../core/abstractHelper";
import type ScholarSuitePlugin from "../main";

export const VIEW_TYPE_SCHOLAR_REFERENCE = "scholar-suite-reference-view";

export class ReferenceView extends ItemView {
  plugin: ScholarSuitePlugin;
  currentFile: TFile | null = null;
  currentPaper: ScholarlyPaper | null = null;
  references: ReferenceItem[] = [];
  citations: CitationItem[] = [];
  activeTab: "references" | "citations" = "references";
  isLoading: boolean = false;
  isCurrentAbstractOpen: boolean = false;
  searchQuery: string = "";
  apiStatusNote: string = "";
  isBatchFetching: boolean = false;
  batchProgress: string = "";
  isCdpReady: boolean = false;
  isZoteroReady: boolean = false;

  constructor(leaf: WorkspaceLeaf, plugin: ScholarSuitePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SCHOLAR_REFERENCE;
  }

  getDisplayText(): string {
    return "Scholar Reference 引文网络";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      await this.loadFile(file);
    } else {
      this.render();
    }
  }

  public async refreshForActiveFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      await this.loadFile(file);
    }
  }

  public async loadFile(file: TFile): Promise<void> {
    this.currentFile = file;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    const title = fm?.title || file.basename;
    const doi = fm?.doi;

    this.isLoading = true;
    this.apiStatusNote = "";
    this.renderLoading(title);

    // Check service connectivity
    this.isCdpReady = await this.plugin.cnkiBridge.isCdpAlive();
    this.isZoteroReady = await this.plugin.zoteroLocalClient.isZoteroRunning();

    try {
      // Step 1: ALWAYS parse local markdown references first (Instant, accurate, offline ground truth)
      const content = await this.app.vault.read(file);
      const localRefs = this.parseLocalMarkdownReferences(content);

      // Extract local abstract for the current paper
      const localAbstract = await AbstractHelper.extractFromLocalFile(this.app, file);

      this.currentPaper = {
        title,
        authors: Array.isArray(fm?.authors) ? fm.authors : fm?.authors ? [fm.authors] : [],
        year: fm?.date || fm?.year,
        journal: fm?.journal,
        doi,
        abstract: localAbstract || undefined,
      };

      // Asynchronously fetch current paper journal ranks (EasyScholar)
      if (this.currentPaper.journal) {
        this.plugin.easyScholarClient
          .fetchJournalRanks(this.currentPaper.journal, this.plugin)
          .then((ranks) => {
            if (ranks && ranks.length > 0 && this.currentPaper) {
              this.currentPaper.journalRanks = ranks;
              this.render();
            }
          });
      }

      this.references = localRefs;
      this.citations = [];

      // Batch pre-fetch EasyScholar journal tiers for all references in parallel
      const journalsToQuery = Array.from(
        new Set(
          this.references
            .map((r) => r.journal)
            .filter((j): j is string => !!j && j.trim().length >= 2)
        )
      );

      if (journalsToQuery.length > 0) {
        Promise.all(
          journalsToQuery.map(async (j) => {
            try {
              const ranks = await this.plugin.easyScholarClient.fetchJournalRanks(j, this.plugin);
              if (ranks && ranks.length > 0) {
                for (const item of this.references) {
                  if (item.journal === j) {
                    item.journalRanks = ranks;
                  }
                }
              }
            } catch (e) {
              // Ignore single lookup failure
            }
          })
        ).then(() => {
          this.render();
        });
      }

      // If local had 0 references, query OpenAlex batch first, then Semantic Scholar fallback
      let identifier = doi ? this.plugin.vaultMatcher.normalizeDoi(doi) : null;
      if (this.references.length === 0 && (identifier || title)) {
        try {
          const oaRefs = await this.plugin.openAlexClient.fetchReferencedWorks(identifier || title, title);
          if (oaRefs && oaRefs.length > 0) {
            this.references = oaRefs.map((r, idx) => {
              const m = this.plugin.vaultMatcher.match({
                doi: r.doi,
                title: r.title,
              });
              return {
                ...r,
                index: idx + 1,
                inVault: m.matched,
                vaultFile: m.file,
                vaultPath: m.file?.path,
                vaultTitle: m.file?.basename,
              };
            });
            this.render();
          }
        } catch (e) {
          // ignore
        }

        if (this.references.length === 0) {
          try {
            const s2Data = await this.plugin.semanticScholarClient.fetchPaperAndCitations(
              identifier || title,
              title
            );
            if (s2Data.references && s2Data.references.length > 0) {
              this.references = s2Data.references.map((r, idx) => {
                const m = this.plugin.vaultMatcher.match({
                  doi: r.doi,
                  title: r.title,
                });
                return {
                  ...r,
                  index: idx + 1,
                  inVault: m.matched,
                  vaultFile: m.file,
                  vaultPath: m.file?.path,
                  vaultTitle: m.file?.basename,
                };
              });
              this.render();
            }
          } catch (e) {
            // ignore
          }
        }

        // Fetch EasyScholar ranks for online references if retrieved
        if (this.references.length > 0) {
          const onlineJournals = Array.from(
            new Set(this.references.map((r) => r.journal).filter((j): j is string => !!j && j.trim().length >= 2))
          );
          if (onlineJournals.length > 0) {
            Promise.all(
              onlineJournals.map(async (j) => {
                const ranks = await this.plugin.easyScholarClient.fetchJournalRanks(j, this.plugin);
                if (ranks && ranks.length > 0) {
                  for (const item of this.references) {
                    if (item.journal === j) item.journalRanks = ranks;
                  }
                }
              })
            ).then(() => this.render());
          }
        }
      }

      // Step 2: Query Academic APIs for online enrichment and Citations (Cited By)
      // 2A. Query OpenAlex for Citations (Cited By Papers)
      try {
        const oaResult = await this.plugin.openAlexClient.fetchCitingPapers(identifier || title, title);
        if (oaResult.citations && oaResult.citations.length > 0) {
          this.citations = oaResult.citations.map((c, idx) => {
            const m = this.plugin.vaultMatcher.match({
              doi: c.doi,
              title: c.title,
            });
            return {
              ...c,
              index: idx + 1,
              inVault: m.matched,
              vaultFile: m.file,
              vaultPath: m.file?.path,
              vaultTitle: m.file?.basename,
            };
          });
          if (this.currentPaper && oaResult.totalCount > 0) {
            this.currentPaper.citationCount = oaResult.totalCount;
          }
          this.render();

          // Pre-fetch journal ranks for citations
          const citingJournals = Array.from(
            new Set(this.citations.map((c) => c.journal).filter((j): j is string => !!j && j.trim().length >= 2))
          );
          if (citingJournals.length > 0) {
            Promise.all(
              citingJournals.map(async (j) => {
                const ranks = await this.plugin.easyScholarClient.fetchJournalRanks(j, this.plugin);
                if (ranks && ranks.length > 0) {
                  for (const c of this.citations) {
                    if (c.journal === j) c.journalRanks = ranks;
                  }
                }
              })
            ).then(() => this.render());
          }
        }
      } catch (e) {
        console.warn("OpenAlex citations fetch failed:", e);
      }

      // 2B. Query Scopus (Elsevier) for authoritative citation count
      try {
        const scopusData = await this.plugin.elsevierClient.fetchScopusData(identifier || title, title);
        if (scopusData && this.currentPaper) {
          if (scopusData.citationCount !== undefined) {
            this.currentPaper.citationCount = Math.max(this.currentPaper.citationCount || 0, scopusData.citationCount);
          }
          if (scopusData.doi && !this.currentPaper.doi) {
            this.currentPaper.doi = scopusData.doi;
          }
        }
      } catch (e) {
        console.warn("Elsevier Scopus fetch failed:", e);
      }

      // 2C. Query Semantic Scholar fallback
      try {
        const s2Data = await this.plugin.semanticScholarClient.fetchPaperAndCitations(
          identifier || title,
          title
        );

        if (s2Data.paper && this.currentPaper) {
          this.currentPaper = {
            ...this.currentPaper,
            ...s2Data.paper,
            abstract: this.currentPaper.abstract || s2Data.paper.abstract,
            citationCount: Math.max(this.currentPaper.citationCount || 0, s2Data.paper.citationCount || 0),
          };
        }

        if (this.citations.length === 0 && s2Data.citations && s2Data.citations.length > 0) {
          this.citations = s2Data.citations.map((c, idx) => {
            const m = this.plugin.vaultMatcher.match({
              doi: c.doi,
              title: c.title,
            });
            return {
              ...c,
              index: idx + 1,
              inVault: m.matched,
              vaultFile: m.file,
              vaultPath: m.file?.path,
              vaultTitle: m.file?.basename,
            };
          });
        }

        if (this.references.length > 0 && s2Data.references && s2Data.references.length > 0) {
          this.enrichLocalReferencesWithApi(this.references, s2Data.references);
        }
      } catch (e) {
        // S2 offline or 429
      }
    } catch (err: any) {
      console.warn("Failed to load reference network:", err);
      this.apiStatusNote = `引文网络加载遇到异常: ${err.message}`;
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private enrichLocalReferencesWithApi(localList: ReferenceItem[], apiList: ReferenceItem[]): void {
    for (const loc of localList) {
      const normLoc = loc.title.toLowerCase().replace(/[^\w]/g, "");
      if (normLoc.length < 6) continue;
      for (const api of apiList) {
        const normApi = api.title.toLowerCase().replace(/[^\w]/g, "");
        if (normApi.includes(normLoc) || normLoc.includes(normApi)) {
          if (api.doi && !loc.doi) loc.doi = api.doi;
          if (api.abstract && !loc.abstract) loc.abstract = api.abstract;
          if (api.citationCount !== undefined) loc.citationCount = api.citationCount;
          break;
        }
      }
    }
  }

  /**
   * Universal Reference Parser:
   * Supports:
   * 1. Multi-style headings: ## 参考文献, ## References, ## 参考文献（据 PDF 重建）, ## 参考文献(References)：
   * 2. Numbered references: [1], [ 1 ], ［1］, [[#^ref1|[1]]], 1., 1、, - [1]
   * 3. Author-Year unnumbered references
   * 4. Multiline continuation & block link stripping (^ref12)
   * 5. Truncation before Appendices, Acknowledgements, and editorial notes
   */
  private parseLocalMarkdownReferences(content: string): ReferenceItem[] {
    const items: ReferenceItem[] = [];

    // Strip YAML frontmatter to prevent matching "References" in tags/source
    let offset = 0;
    let text = content;
    if (content.startsWith("---")) {
      const endFm = content.indexOf("\n---", 3);
      if (endFm !== -1) {
        offset = endFm + 4;
        text = content.substring(offset);
      }
    }

    const headRegex =
      /(?:^|\n|[>。！？\.!?\)])\s*(?:#{1,6}\s*)?[【\[〖〔（\(]?\s*(?:参\s*考\s*文\s*献|References|REFERENCES|Cited References|Reference List)(?:\s*[\(（][^\n\)）]+[\)）])?\s*[:：]?\s*[】\]〗〕）\)]?\s*(?:\r?\n|$)/gi;

    let cut = -1;
    const matches = Array.from(text.matchAll(headRegex));
    const validMatches = matches.filter((m) => offset + m.index > content.length * 0.15);

    if (validMatches.length > 0) {
      // Pick the last heading match
      const best = validMatches[validMatches.length - 1];
      cut = offset + best.index + best[0].length;
    } else {
      // Unheaded fallback:
      // 1. [[#^ref\d+|[X]]] at start of line (space optional after bracket)
      // 2. [1] or ［1］ or 1. or [ 1 ] at start of line
      // 3. Circled numbers: ①, ②, ③, etc. (footnotes)
      // 4. Or unnumbered lines with ［J］ or [J]
      const unheaded =
        /\n\s*(?:(?:\[\[#\^ref\d+\|\[?\s*\d+\s*\]?\]\]|[（\[【〖〔\uFF3B]\s*(?:1|[1-9]\d?)\s*[）\]】〗〕\uFF3D])\s*[A-Za-z\u4e00-\u9fa5]|(?:1\s*[\.、]|[①②③④⑤⑥⑦⑧⑨⑩])\s+[A-Za-z\u4e00-\u9fa5])/.exec(
          text
        );
      if (unheaded && offset + unheaded.index > content.length * 0.2) {
        cut = offset + unheaded.index;
      } else {
        const unnumberedJ = /\n([\u4e00-\u9fa5A-Za-z].*?[［\[][JjMmDd][］\]].*?\r?\n)/.exec(
          text.substring(Math.floor(text.length * 0.35))
        );
        if (unnumberedJ) {
          cut = offset + Math.floor(text.length * 0.35) + unnumberedJ.index;
        }
      }
    }

    if (cut === -1) return items;

    let tail = content.substring(cut);

    // Truncate appendix, acknowledgements, editorial signatures, or journal postscripts
    const appendixRegex =
      /\n(?:#{1,6}\s*)?(?:附录|Appendix|致谢|Acknowledgements|■\s*本文图文责任编辑|注释|Notes|（责任编辑[·:：]|［责任编辑[·:：]|责任编辑[:：]|编校[:：])/i;
    const appMatch = appendixRegex.exec(tail);
    if (appMatch) {
      tail = tail.substring(0, appMatch.index);
    }

    // Truncate any subsequent top-level or secondary section headings (e.g. English Abstract, etc.)
    const nextHead = tail.search(/\n#{1,6}\s+[^\n]+/);
    if (nextHead !== -1) {
      tail = tail.substring(0, nextHead);
    }

    const lines = tail.split("\n");

    // Strategy 1: Numbered lines with continuation support
    // Matches: [1], [ 1 ], ［1］, [[#^ref1|[1]]], ①, (1), （1）, 1., 1、, - [1], etc.
    const numRegex =
      /^\s*(?:[-*+]\s+)?(?:\[\[#\^ref\d+\|)?(?:[（\[【〖〔\uFF3B]\s*)?(\d{1,3}|[①②③④⑤⑥⑦⑧⑨⑩])\s*[）\]】〗〕\uFF3D\.\s、]*(?:\]\])?\s*(.*)$/;
    const circledMap: Record<string, number> = {
      "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5, "⑥": 6, "⑦": 7, "⑧": 8, "⑨": 9, "⑩": 10
    };
    const numberedMatches: { num: number; raw: string }[] = [];
    let currentEntry: { num: number; raw: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith("#")) break;

      const m = numRegex.exec(line);
      if (m && m[1] && m[2] && m[2].length > 4) {
        if (currentEntry) numberedMatches.push(currentEntry);
        const parsedNum = circledMap[m[1]] || parseInt(m[1], 10) || (numberedMatches.length + 1);
        currentEntry = {
          num: parsedNum,
          raw: m[2].replace(/\^ref\d+\b/g, "").trim(),
        };
      } else if (currentEntry) {
        currentEntry.raw += " " + line.replace(/\^ref\d+\b/g, "").trim();
      }
    }
    if (currentEntry) numberedMatches.push(currentEntry);

    const paragraphs = tail
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 25 && !p.startsWith("#") && !p.startsWith("（责任编辑") && !p.startsWith("［责任编辑") && !p.startsWith("责任编辑"));

    // Check if numberedMatches is really a numbered list or just accidental line-leading numbers in Author-Year text
    const isReallyNumbered =
      numberedMatches.length >= 2 ||
      (numberedMatches.length >= 1 && numberedMatches.length >= paragraphs.length);

    if (isReallyNumbered) {
      for (const item of numberedMatches) {
        const parsed = this.parseCitationComponents(item.raw);
        const mResult = this.plugin.vaultMatcher.match({
          title: parsed.title,
          zhTitle: parsed.zhTitle,
          raw: item.raw,
        });

        items.push({
          id: `local_ref_${item.num}`,
          index: item.num,
          title: parsed.displayTitle,
          zhTitle: parsed.zhTitle,
          authors: parsed.authors,
          year: parsed.year,
          journal: parsed.journal,
          inVault: mResult.matched,
          vaultFile: mResult.file,
          vaultPath: mResult.file?.path,
          vaultTitle: mResult.file?.basename,
          rawText: item.raw,
        });
      }
      return items;
    }

    // Strategy 2: Paragraph / Author-Year unnumbered entries
    if (paragraphs.length >= 2) {
      for (let idx = 0; idx < paragraphs.length; idx++) {
        const raw = paragraphs[idx].replace(/\^ref\d+\b/g, "").replace(/\r?\n/g, " ").trim();
        const parsed = this.parseCitationComponents(raw);
        const mResult = this.plugin.vaultMatcher.match({
          title: parsed.title,
          zhTitle: parsed.zhTitle,
          raw,
        });

        items.push({
          id: `local_ref_${idx + 1}`,
          index: idx + 1,
          title: parsed.displayTitle,
          zhTitle: parsed.zhTitle,
          authors: parsed.authors,
          year: parsed.year,
          journal: parsed.journal,
          inVault: mResult.matched,
          vaultFile: mResult.file,
          vaultPath: mResult.file?.path,
          vaultTitle: mResult.file?.basename,
          rawText: raw,
        });
      }
      return items;
    }

    return items;
  }

  /**
   * Accurate Chinese and English Citation Component Parser:
   * In GB/T 7714: Authors. Title. Journal, Year, Volume(Issue): Pages.
   * In Author-Year: Authors. Year. Title. Journal...
   */
  private parseCitationComponents(raw: string): {
    displayTitle: string;
    title: string;
    zhTitle?: string;
    authors: string[];
    year?: string;
    journal?: string;
  } {
    // 0. Quoted title check: Authors (Year) “Title” Journal...
    const quoteMatch = raw.match(
      /^(.*?)\s*\((\d{4}[a-z]?)\)\s*[“"']([^”"']+)[”"'][,.]?\s*(.*?)(?:,\s*(?:volume|vol|\d+|pp|\d+-\d+).*)?$/i
    );
    if (quoteMatch) {
      const qAuthors = quoteMatch[1].split(/[,，]| and /).map((s) => s.trim()).filter(Boolean);
      const qYear = quoteMatch[2];
      const qTitle = quoteMatch[3].trim();
      const qJournal = quoteMatch[4].split(/[,，]/)[0].trim();
      return {
        displayTitle: qTitle,
        title: qTitle,
        authors: qAuthors,
        year: qYear,
        journal: qJournal,
      };
    }

    // 0B. Semicolon-delimited authors (MDPI / Springer format: Author1, A.; Author2, B. Title. Journal Year, Vol, Page.)
    if (raw.slice(0, 200).includes(";")) {
      const semiMatch = raw.match(/^(.*?;\s*[^.]+?\.)\s+(.+?\.)\s+(.+?\s+(?:18|19|20)\d{2}.*)$/);
      if (semiMatch) {
        const sAuthors = semiMatch[1].replace(/\.$/, "").split(";").map((a) => a.trim()).filter(Boolean);
        const sTitle = semiMatch[2].replace(/\.$/, "").replace(/^["“]|["”]$/g, "").trim();
        const sRest = semiMatch[3];
        const yMatch = sRest.match(/\b(18|19|20)\d{2}\b/);
        const sYear = yMatch ? yMatch[0] : undefined;
        const sJournal = sRest.split(/\s+(?:18|19|20)\d{2}/)[0].replace(/\[.*?\]/g, "").trim();
        return {
          displayTitle: sTitle,
          title: sTitle,
          authors: sAuthors,
          year: sYear,
          journal: sJournal,
        };
      }
    }

    // 1. Look for Chinese bracketed citation: [贺灿飞, 朱晟君. 中国产业发展与布局的关联法则. 地理学报, 2020, 75(12): 2684-2698.]
    const zhBracketMatch = raw.match(/\[([\u4e00-\u9fa5][^\]]+)\]/);
    const zhText = zhBracketMatch ? zhBracketMatch[1] : undefined;

    let zhTitle: string | undefined = undefined;
    let zhAuthors: string[] = [];
    let zhJournal: string | undefined = undefined;

    if (zhText) {
      const zhSegments = zhText.split(/[\.。\uFF0E]\s*/).map((s) => s.trim()).filter(Boolean);
      if (zhSegments.length >= 2) {
        zhAuthors = zhSegments[0]
          .split(/[,，、]/)
          .map((a) => a.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2").trim())
          .filter(Boolean);

        zhTitle = zhSegments[1]
          .replace(/\[\s*[A-Za-z/]+\s*\]|［\s*[A-Za-z/]+\s*］/g, "")
          .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
          .trim();

        if (zhSegments.length >= 3) {
          const jMatch = zhSegments[2].split(/[,，]/);
          zhJournal = jMatch[0].replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2").trim();
        }
      } else {
        zhTitle = zhText.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2").trim();
      }
    }

    // 2. English / Standard GB/T 7714 citation parts (supporting both ASCII . and fullwidth ．)
    const enText = zhBracketMatch ? raw.substring(0, zhBracketMatch.index).trim() : raw;

    // 2A. Check APA Author-Year format: Author(s). (Year). Title. Journal...
    const apaMatch = enText.match(/^(.*?)\s*\((\d{4}[a-z]?)\)[\.:]?\s+(.+?[\.\?])\s+(.+)$/);
    if (apaMatch) {
      const apaAuthors = apaMatch[1].split(/[,，;&、]|\band\b/i).map((a) => a.trim()).filter(Boolean);
      const apaYear = apaMatch[2];
      const apaTitle = apaMatch[3].replace(/[\.\?]$/, "").replace(/^["“]|["”]$/g, "").trim();
      const apaRest = apaMatch[4].trim();
      const apaJournal = apaRest.split(/[,，\.\d]/)[0].trim();
      return {
        displayTitle: zhTitle && zhTitle.length >= 2 ? (apaTitle.length > 5 ? `${zhTitle} (${apaTitle})` : zhTitle) : apaTitle,
        title: zhTitle || apaTitle,
        zhTitle,
        authors: zhAuthors.length ? zhAuthors : apaAuthors,
        year: apaYear,
        journal: zhJournal || apaJournal,
      };
    }

    const enSegments = enText.split(/[\.。\uFF0E\?\!]\s*/).map((s) => s.trim()).filter(Boolean);

    let enAuthors: string[] = [];
    let enTitle = "";
    let enJournal: string | undefined = undefined;

    if (enSegments.length >= 2) {
      enAuthors = enSegments[0].split(/[,，、]/).map((a) => a.trim()).filter(Boolean);

      // Check Author-Year pattern: Segment 1 is a 4-digit year, e.g. "1990", "2005", "(2005)"
      const isYearSeg1 = /^\(?\s*(?:18|19|20)\d{2}[a-z]?\s*\)?$/.test(enSegments[1]);

      if (isYearSeg1) {
        enTitle = (enSegments[2] || "")
          .replace(/\[\s*[A-Za-z/]+\s*\]|［\s*[A-Za-z/]+\s*］/g, "")
          .replace(/^["“]|["”]$/g, "")
          .trim();
        if (enSegments.length >= 4) {
          enJournal = enSegments[3].split(/[,，:]/)[0].trim();
        }
      } else {
        enTitle = enSegments[1]
          .replace(/\[\s*[A-Za-z/]+\s*\]|［\s*[A-Za-z/]+\s*］/g, "")
          .replace(/^["“]|["”]$/g, "")
          .trim();
        if (enSegments.length >= 3) {
          enJournal = enSegments[2].split(/[,，]/)[0].trim();
        }
      }
    } else {
      enTitle = enText.replace(/^["“]|["”]$/g, "").trim();
    }

    // 3. Extract year
    const yearMatch = raw.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : undefined;

    // 4. Clean journal names
    if (zhJournal) {
      zhJournal = zhJournal
        .replace(/\[\s*[A-Za-z/]+\s*\]|［\s*[A-Za-z/]+\s*］/g, "")
        .split(/[,，\d]/)[0]
        .trim();
    }
    if (enJournal) {
      enJournal = enJournal
        .replace(/\[\s*[A-Za-z/]+\s*\]|［\s*[A-Za-z/]+\s*］/g, "")
        .replace(/\s*\(forthcoming\)/i, "")
        .trim();
    }

    // 5. Construct Display Title
    let displayTitle = "";
    let finalTitle = "";

    if (zhTitle && zhTitle.length >= 2) {
      finalTitle = zhTitle;
      displayTitle = enTitle && enTitle.length > 5 ? `${zhTitle} (${enTitle})` : zhTitle;
    } else {
      finalTitle = enTitle || raw;
      displayTitle = enTitle || raw;
    }

    const finalAuthors = zhAuthors.length > 0 ? zhAuthors : enAuthors;
    const finalJournal = zhJournal || enJournal;

    return {
      displayTitle,
      title: finalTitle,
      zhTitle,
      authors: finalAuthors,
      year,
      journal: finalJournal,
    };
  }

  private renderLoading(title: string): void {
    const { containerEl } = this;
    containerEl.empty();
    const loadingDiv = containerEl.createDiv({ cls: "scholar-loading-container" });
    loadingDiv.createEl("div", { cls: "scholar-spinner" });
    loadingDiv.createEl("p", { text: `正在连接学术知识网络检索引文: ${title.substring(0, 40)}...` });
  }

  private renderEmpty(message: string): void {
    const { containerEl } = this;
    containerEl.empty();
    const emptyDiv = containerEl.createDiv({ cls: "scholar-empty-container" });
    emptyDiv.createEl("div", { cls: "scholar-empty-icon", text: "📚" });
    emptyDiv.createEl("p", { text: message });
  }

  public render(): void {
    const { containerEl } = this;
    containerEl.empty();

    if (!this.currentFile) {
      this.renderEmpty("请打开一篇文献笔记以查看引文网络");
      return;
    }

    const wrapper = containerEl.createDiv({ cls: "scholar-reference-view-wrapper" });

    // 1. Service Status Bar (CNKI CDP & Zotero)
    const statusBar = wrapper.createDiv({ cls: "scholar-service-bar" });

    // CNKI Status Pill
    const cnkiPill = statusBar.createDiv({
      cls: `scholar-service-pill ${this.isCdpReady ? "service-online" : "service-offline"}`,
      text: this.isCdpReady ? "🟢 知网CDP: 就绪" : "⚪ 知网CDP: 未连接 (点击启动)",
    });
    cnkiPill.title = this.isCdpReady
      ? "知网浏览器服务已连接 (CDP 127.0.0.1:9222)，可免验证码实时抓取中文摘要"
      : "点击可在后台拉起知网常驻服务 (CDP 9222)";
    cnkiPill.onclick = async () => {
      if (!this.isCdpReady) {
        cnkiPill.innerText = "⏳ 正在启动知网服务...";
        const ok = await this.plugin.cnkiBridge.launchKeeper();
        this.isCdpReady = ok;
        cnkiPill.className = `scholar-service-pill ${this.isCdpReady ? "service-online" : "service-offline"}`;
        cnkiPill.innerText = this.isCdpReady ? "🟢 知网CDP: 就绪" : "❌ 启动失败，请检查 Python 环境";
        if (ok) new Notice("知网常驻服务 (CDP 9222) 已成功启动！");
      }
    };

    // Zotero Status Pill (Interactive Click-to-Detect)
    const zoteroPill = statusBar.createDiv({
      cls: `scholar-service-pill ${this.isZoteroReady ? "service-online" : "service-offline"}`,
      text: this.isZoteroReady ? "🟢 Zotero: 已连接" : "⚪ Zotero: 未检测到",
    });
    zoteroPill.style.cursor = "pointer";
    zoteroPill.title = this.isZoteroReady
      ? "已检测到 Zotero 本地 API (23119 端口)，点击可重新检测"
      : "未检测到 Zotero，请启动 Zotero 桌面端后点击此处重连";
    zoteroPill.onclick = async () => {
      zoteroPill.innerText = "⏳ 正在检测 Zotero...";
      this.isZoteroReady = await this.plugin.zoteroLocalClient.isZoteroRunning();
      zoteroPill.className = `scholar-service-pill ${this.isZoteroReady ? "service-online" : "service-offline"}`;
      zoteroPill.innerText = this.isZoteroReady ? "🟢 Zotero: 已连接" : "⚪ Zotero: 未检测到";
      if (this.isZoteroReady) {
        new Notice("Zotero 桌面端已连接 (23119 端口)，已解锁本地文库秒级匹配与一键入库！");
      } else {
        new Notice("未检测到 Zotero，请确认 Zotero 桌面端是否正在运行。");
      }
    };

    // Scopus (Elsevier) Status Pill
    const scopusPill = statusBar.createDiv({
      cls: `scholar-service-pill ${this.plugin.settings.elsevierApiKey ? "service-online" : "service-offline"}`,
      text: this.plugin.settings.elsevierApiKey ? "🟢 Scopus: 就绪" : "⚪ Scopus: 未配Key",
    });
    scopusPill.title = "爱思唯尔 Scopus 权威引证数据库";

    // EasyScholar Status Pill
    const easyScholarPill = statusBar.createDiv({
      cls: `scholar-service-pill ${this.plugin.settings.easyScholarApiKey ? "service-online" : "service-offline"}`,
      text: this.plugin.settings.easyScholarApiKey ? "🟢 EasyScholar: 就绪" : "⚪ EasyScholar: 未配Key",
    });
    easyScholarPill.title = "EasyScholar 期刊层级与分区 (CSSCI / 北大核心 / CSCD / SSCI / 中科院分区 / IF)";

    // 2. Header Card (Current Paper)
    const headerCard = wrapper.createDiv({ cls: "scholar-current-paper-card" });
    headerCard.createEl("h3", { text: this.currentPaper?.title || this.currentFile.basename });

    const metaLine = headerCard.createDiv({ cls: "scholar-current-paper-meta" });
    const authors = this.currentPaper?.authors?.slice(0, 3).join(", ") || "";
    const year = this.currentPaper?.year ? ` (${this.currentPaper.year})` : "";
    const journal = this.currentPaper?.journal ? ` · ${this.currentPaper.journal}` : "";
    metaLine.createEl("span", { text: `${authors}${year}${journal}` });

    // Current Paper Journal Ranks (EasyScholar)
    if (this.currentPaper?.journalRanks && this.currentPaper.journalRanks.length > 0) {
      const ranksEl = metaLine.createSpan({ cls: "scholar-journal-ranks" });
      for (const b of this.currentPaper.journalRanks) {
        ranksEl.createSpan({
          cls: `scholar-rank-badge rank-${b.type}`,
          text: b.text,
        });
      }
    }

    if (this.currentPaper?.doi) {
      const doiEl = metaLine.createEl("a", {
        cls: "scholar-doi-badge",
        text: `DOI: ${this.currentPaper.doi}`,
        href: `https://doi.org/${this.currentPaper.doi}`,
      });
      doiEl.target = "_blank";
    }

    if (this.currentPaper?.citationCount !== undefined && this.currentPaper.citationCount > 0) {
      metaLine.createEl("span", {
        cls: "scholar-citation-count-tag",
        text: `总被引: ${this.currentPaper.citationCount} 次`,
      });
    }

    // Save Current Paper to Zotero
    const currentZoteroBtn = metaLine.createEl("button", {
      cls: "scholar-action-btn scholar-zotero-btn",
      text: "➕ 存入 Zotero",
    });
    currentZoteroBtn.title = "将本文元数据及摘要存入 Zotero 桌面端";
    currentZoteroBtn.onclick = async () => {
      if (!this.currentPaper) return;
      currentZoteroBtn.innerText = "正在存入...";
      currentZoteroBtn.disabled = true;
      const res = await this.plugin.zoteroLocalClient.saveItemToZotero(this.currentPaper);
      if (res.success) {
        currentZoteroBtn.innerText = "✅ 已存 Zotero";
        new Notice(`已成功将本文《${this.currentPaper.title}》存入 Zotero！`);
      } else {
        currentZoteroBtn.innerText = "重试存入 Zotero";
        currentZoteroBtn.disabled = false;
        new Notice(`存入 Zotero 失败: ${res.message || "请确认 Zotero 桌面端已开启"}`);
      }
    };

    // Abstract Accordion for Current Paper
    if (this.currentPaper?.abstract) {
      const currentAbsToggle = headerCard.createEl("button", {
        cls: "scholar-action-btn",
        text: this.isCurrentAbstractOpen ? "📄 收起本文摘要" : "📄 查看本文摘要",
      });
      const currentAbsBox = headerCard.createDiv({ cls: "scholar-current-abstract-box" });
      currentAbsBox.style.display = this.isCurrentAbstractOpen ? "block" : "none";
      currentAbsBox.innerText = this.currentPaper.abstract;

      currentAbsToggle.onclick = () => {
        this.isCurrentAbstractOpen = !this.isCurrentAbstractOpen;
        currentAbsBox.style.display = this.isCurrentAbstractOpen ? "block" : "none";
        currentAbsToggle.innerText = this.isCurrentAbstractOpen ? "📄 收起本文摘要" : "📄 查看本文摘要";
      };
    }

    // Actions Header (Quick Audit + Batch Fetch All)
    const headerActions = headerCard.createDiv({ cls: "scholar-header-actions" });

    const auditBtn = headerActions.createEl("button", {
      cls: "scholar-audit-trigger-btn",
      text: "🔍 多模态质检",
    });
    auditBtn.onclick = () => {
      if (this.currentFile) {
        this.plugin.openMultimodalAuditModal(this.currentFile);
      }
    };

    // Batch Fetch Button for ALL papers
    const batchBtn = headerActions.createEl("button", {
      cls: "scholar-batch-btn",
      text: this.isBatchFetching ? `⚡ 抓取中 ${this.batchProgress}` : "⚡ 批量拉取全部摘要",
    });
    batchBtn.onclick = async () => {
      if (this.isBatchFetching) return;
      await this.runBatchAbstractFetch();
    };

    // Notice line if any
    if (this.apiStatusNote) {
      wrapper.createDiv({ cls: "scholar-status-note", text: this.apiStatusNote });
    }

    // 3. Tab switch (References vs Citations)
    const tabsContainer = wrapper.createDiv({ cls: "scholar-tabs-container" });
    const refInVaultCount = this.references.filter((r) => r.inVault).length;
    const refTab = tabsContainer.createDiv({
      cls: `scholar-tab ${this.activeTab === "references" ? "active" : ""}`,
      text: `参考文献 (${this.references.length}) [在库: ${refInVaultCount}]`,
    });
    refTab.onclick = () => {
      this.activeTab = "references";
      this.render();
    };

    const citeInVaultCount = this.citations.filter((c) => c.inVault).length;
    const citeTab = tabsContainer.createDiv({
      cls: `scholar-tab ${this.activeTab === "citations" ? "active" : ""}`,
      text: `引证文献 (${this.citations.length}) [在库: ${citeInVaultCount}]`,
    });
    citeTab.onclick = () => {
      this.activeTab = "citations";
      this.render();
    };

    // 4. Search filter
    const searchContainer = wrapper.createDiv({ cls: "scholar-search-box" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: "过滤当前引文列表 (按标题/作者)...",
      value: this.searchQuery,
    });
    searchInput.oninput = (e: any) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderList(listContainer);
    };

    // 5. List container
    const listContainer = wrapper.createDiv({ cls: "scholar-papers-list" });
    this.renderList(listContainer);
  }

  /**
   * Batch fetches abstracts for ALL references (Chinese via CNKI, English via Crossref/OpenAlex)
   */
  private async runBatchAbstractFetch(): Promise<void> {
    const targets = this.references.filter((r) => {
      const hasAbs = r.abstract && r.abstract.length > 20 && !r.abstract.includes("暂无");
      return !hasAbs;
    });

    if (targets.length === 0) {
      new Notice("所有参考文献均已成功获取摘要！");
      return;
    }

    this.isBatchFetching = true;
    new Notice(`开始批量检索 ${targets.length} 篇文献摘要 (本地 / Zotero / 知网CNKI / Crossref / OpenAlex)...`);

    let done = 0;
    for (const item of targets) {
      done++;
      this.batchProgress = `(${done}/${targets.length})`;
      this.render();

      try {
        await AbstractHelper.fetchAbstractUnified(this.app, this.plugin, item);
      } catch (e) {
        console.warn(`Batch fetch failed for ${item.title}:`, e);
      }

      // Polite delay between requests
      await new Promise((r) => setTimeout(r, 400));
    }

    this.isBatchFetching = false;
    this.batchProgress = "";
    new Notice(`全域文献摘要批量获取完成！已更新持久缓存。`);
    this.render();
  }

  private renderList(container: HTMLElement): void {
    container.empty();
    const items = this.activeTab === "references" ? this.references : this.citations;

    const filtered = items.filter((item) => {
      if (!this.searchQuery) return true;
      const matchTitle = item.title.toLowerCase().includes(this.searchQuery);
      const matchAuthor = item.authors.some((a) => a.toLowerCase().includes(this.searchQuery));
      return matchTitle || matchAuthor;
    });

    if (filtered.length === 0) {
      if (this.activeTab === "citations") {
        const noCiteDiv = container.createDiv({ cls: "scholar-no-results" });
        const year = this.currentPaper?.year || "";
        const isRecent = year && (String(year).includes("2024") || String(year).includes("2025") || String(year).includes("2026"));
        noCiteDiv.createEl("p", {
          text: isRecent
            ? `暂无外部引证记录（本文发表于 ${year} 年，近发表前沿文献通常需要 1~2 年产生学术引证积累）。`
            : "暂未从开放引证图谱 (OpenAlex / Scopus / S2) 检索到外部施引文献。",
        });
        noCiteDiv.createEl("p", {
          cls: "scholar-subtext",
          text: `💡 提示：点击上方【参考文献 (${this.references.length})】标签页可浏览本论文引用的全部文献、摘要及本地知识库收录状态。`,
        });
      } else {
        container.createDiv({
          cls: "scholar-no-results",
          text: this.searchQuery ? "未找到符合过滤条件的引文" : "未检索到参考文献记录",
        });
      }
      return;
    }

    for (const item of filtered) {
      PaperCard.render(
        container,
        item,
        this.app,
        this.plugin,
        () => {
          this.plugin.vaultMatcher.rebuildIndex();
          this.render();
        }
      );
    }
  }
}
