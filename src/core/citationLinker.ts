import { AuditIssue } from "../types";

export interface CitationOptimizeResult {
  optimizedContent: string;
  linksAdded: number;
  anchorsAdded: number;
  bilingualCleaned: number;
  abstractStripped: boolean;
  changed: boolean;
}

export class CitationLinker {
  private headRegex =
    /(?:#{1,6}\s*[【［\[(（]?\s*(?:参\s*考\s*文\s*献|References|REFERENCES|Cited References)(?:\s*[\(（][^\n\)）]+[\)）])?\s*[:：]?[】］\])）]?|\n\s*[【［\[(（]?\s*(?:参\s*考\s*文\s*献|References|REFERENCES|Cited References)(?:\s*[\(（][^\n\)）]+[\)）])?\s*[:：]?[】］\])）]?(?:\r?\n|$))/i;

  private refEntryRegex =
    /^(\s*(?:[-*+]\s+)?)(?:\[\[#\^ref\d+\|)?(?:[（\[【〖〔\uFF3B]\s*)?(\d{1,3})\s*[）\]】〗〕\uFF3D\.\s、]*(?:\]\])?\s*(.*)$/gm;

  private bodyCiteRegex =
    /(?<![\[\$\^])(?:<sup>)?\s*\[\s*(\d{1,3}(?:\s*[，,、；\-–—]\s*\d{1,3})*)\s*\]\s*(?:<\/sup>)?(?![\]\$\^])/g;

  public parseNumbers(raw: string): number[] {
    const out: number[] = [];
    const parts = raw.split(/[，,、；]/);
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      // Range: 1-3
      const rangeMatch = part.match(/^(\d{1,3})\s*[\-–—~]\s*(\d{1,3})$/);
      if (rangeMatch) {
        const a = parseInt(rangeMatch[1], 10);
        const b = parseInt(rangeMatch[2], 10);
        if (a <= b && b - a <= 60) {
          for (let n = a; n <= b; n++) out.push(n);
          continue;
        }
      }
      const singleMatch = part.match(/^(\d{1,3})$/);
      if (singleMatch) {
        out.push(parseInt(singleMatch[1], 10));
      }
    }
    // Deduplicate preserving order
    const seen = new Set<number>();
    return out.filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }

  public cleanChineseSpaces(text: string): string {
    let res = text;
    while (/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/.test(res)) {
      res = res.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2");
    }
    return res;
  }

  public cleanRefEntry(
    rawRest: string,
    cleanBilingual: boolean = true
  ): { cleaned: string; isBilingualCleaned: boolean } {
    let cleaned = rawRest.trim();
    cleaned = cleaned.replace(/\^ref\d+\b/g, "").trim();

    let isBilingualCleaned = false;
    if (cleanBilingual) {
      // 风格 1: 英文在前，中文在后 [中文作者. 中文篇名...]
      const zhMatch = cleaned.match(/[\[\uFF3B]([\u4e00-\u9fa5][^\]\uFF3D]{7,})[\]\uFF3D]/);
      if (zhMatch && /[a-zA-Z]{4,}/.test(cleaned.substring(0, zhMatch.index))) {
        cleaned = zhMatch[1].trim();
        isBilingualCleaned = true;
      } else {
        // 风格 2: 中文在前，英文在后 [English Authors...]
        const enBracket = cleaned.match(/[\[\uFF3B]([A-Za-z\s,.\-–—:;0-9/&\'\"`\(\)]+)[\]\uFF3D]\s*$/);
        if (enBracket && /[\u4e00-\u9fa5]{4,}/.test(cleaned.substring(0, enBracket.index))) {
          cleaned = cleaned.substring(0, enBracket.index).trim();
          isBilingualCleaned = true;
        }
      }
    }

    // Clean OCR spaces between Chinese characters
    cleaned = this.cleanChineseSpaces(cleaned);

    // Strip inline/trailing OCR cross-page header/footer
    cleaned = cleaned
      .replace(
        /\s*\b\d{2,4}\s*(?:地\s*理\s*学\s*报|经\s*济\s*地\s*理|地\s*理\s*研\s*究|地\s*理\s*科\s*学|[0-9一二三四]\s*期|\b\d{1,3}\s*卷)\b.*$/i,
        ""
      )
      .trim();

    return { cleaned, isBilingualCleaned };
  }

  public stripTrailingAbstract(tail: string): { strippedTail: string; stripped: boolean } {
    const firstNl = tail.indexOf("\n");
    if (firstNl === -1) {
      return { strippedTail: tail, stripped: false };
    }

    const headerLine = tail.substring(0, firstNl);
    let contentTail = tail.substring(firstNl);
    let stripped = false;

    // 1. Check for Abstract / Keywords section
    const absRegex =
      /\n\s*(?:(?:#{1,6}\s*)?(?:Abstract|ABSTRACT|Key\s*words|Keywords)\s*[:：]|\bAbstract\s*[:：]|\bKeywords\s*[:：])/i;
    const absMatch = absRegex.exec(contentTail);
    if (absMatch) {
      contentTail = contentTail.substring(0, absMatch.index);
      stripped = true;
    }

    // 2. Check for appendix, acknowledgements, editorial remarks
    const appRegex =
      /\n(?:#{1,6}\s*)?(?:附录|Appendix|致谢|Acknowledgements|■\s*本文图文责任编辑|注释|Notes|（责任编辑|［责任编辑|责任编辑[:：])/i;
    const appMatch = appRegex.exec(contentTail);
    if (appMatch) {
      contentTail = contentTail.substring(0, appMatch.index);
      stripped = true;
    }

    // 3. Check for subsequent top-level or secondary section headings (skipping headerLine)
    const nextHead = contentTail.search(/\n#{1,6}\s+[^\n]+/);
    if (nextHead !== -1) {
      contentTail = contentTail.substring(0, nextHead);
      stripped = true;
    }

    return { strippedTail: (headerLine + contentTail).trimEnd(), stripped };
  }

  public auditCitations(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];

    // Find reference heading
    const headMatch = this.headRegex.exec(content);
    if (!headMatch) {
      const unheaded = /\n\s*(?:[（\[【〖〔\uFF3B]\s*1\s*[）\]】〗〕\uFF3D]|1\s*[\.、])\s+[A-Za-z\u4e00-\u9fa5]/.exec(content);
      if (unheaded && unheaded.index > content.length * 0.3) {
        issues.push({
          id: "citation_missing_heading",
          category: "citation",
          severity: "warning",
          line: content.substring(0, unheaded.index).split("\n").length,
          preview: "[1] 第一条文献...",
          message: "检测到末尾存在未命名的参考文献列表，建议规范注入 '## 参考文献' 标题。",
          autoFixable: true,
        });
      }
      return issues;
    }

    const cut = headMatch.index;
    const body = content.substring(0, cut);
    const tail = content.substring(cut);

    // 1. Audit trailing English Abstract / Keywords
    const { stripped: hasTrailingAbstract } = this.stripTrailingAbstract(tail);
    if (hasTrailingAbstract) {
      issues.push({
        id: "citation_trailing_abstract",
        category: "citation",
        severity: "warning",
        line: content.substring(0, cut).split("\n").length,
        preview: "Abstract: ... Keywords: ...",
        message: "参考文献区后附带冗余英文摘要镜像（Abstract / Keywords），建议规范切除以保证文献区纯净。",
        autoFixable: true,
      });
    }

    // 2. Audit bilingual noise (English translation attached to Chinese entries)
    let bilingualCount = 0;
    const entryMatches = Array.from(tail.matchAll(this.refEntryRegex));
    for (const m of entryMatches) {
      const rest = m[3] || "";
      if (/\[[\u4e00-\u9fa5][^\]]{8,}\]/.test(rest) && /[a-zA-Z]{4,}/.test(rest)) {
        bilingualCount++;
      }
    }

    if (bilingualCount > 0) {
      issues.push({
        id: "citation_bilingual_noise",
        category: "citation",
        severity: "info",
        line: content.substring(0, cut).split("\n").length,
        preview: `发现 ${bilingualCount} 条中文参考文献包含拼音/英文双语冗余`,
        message: "国内刊物常附带拼音与英文翻译，建议提纯为纯中文原著，避免污染引文列表与知识网络。",
        autoFixable: true,
      });
    }

    // 3. Extract reference anchors from tail
    const refs = new Set<number>();
    const anchorMatches = tail.matchAll(/\^ref(\d+)\b/g);
    for (const m of anchorMatches) {
      refs.add(parseInt(m[1], 10));
    }

    // Check for references without anchors
    let missingAnchors = 0;
    for (const m of entryMatches) {
      const num = parseInt(m[2], 10);
      if (!refs.has(num)) {
        missingAnchors++;
      }
    }

    if (missingAnchors > 0) {
      issues.push({
        id: "citation_missing_anchors",
        category: "citation",
        severity: "warning",
        line: content.substring(0, cut).split("\n").length,
        preview: `参考文献区共有 ${missingAnchors} 处条目尚未配置 ^refN 块锚点`,
        message: "参考文献列表缺少 ^refN 块锚点，正文引用无法触发悬停预览卡片和双向点击跳转。",
        autoFixable: true,
      });
    }

    // 4. Check dead links in body
    const bodyLinks = body.matchAll(/\[\[#\^ref(\d+)\|/g);
    const deadLinks: number[] = [];
    for (const m of bodyLinks) {
      const num = parseInt(m[1], 10);
      if (!refs.has(num)) {
        deadLinks.push(num);
      }
    }

    if (deadLinks.length > 0) {
      issues.push({
        id: "citation_dead_links",
        category: "citation",
        severity: "error",
        line: 1,
        preview: `发现 ${deadLinks.length} 处悬空死链: [${deadLinks.slice(0, 5).join(", ")}...]`,
        message: "正文中的引文跳转链接指向了参考文献中不存在的编号（死链）。",
        autoFixable: false,
      });
    }

    return issues;
  }

  public optimizeCitationLinks(
    content: string,
    options?: {
      enforceBlankLines?: boolean;
      stripAbstract?: boolean;
      cleanBilingual?: boolean;
      useSuperscript?: boolean;
    }
  ): CitationOptimizeResult {
    const enforceBlankLines = options?.enforceBlankLines ?? true;
    const stripAbstract = options?.stripAbstract ?? true;
    const cleanBilingual = options?.cleanBilingual ?? true;
    const useSuperscript = options?.useSuperscript ?? true;

    let t = content;
    let heads = this.headRegex.exec(t);

    if (!heads) {
      const unheaded = /\n\s*(?:[（\[【〖〔\uFF3B]\s*1\s*[）\]】〗〕\uFF3D]|1\s*[\.、])\s+[A-Za-z\u4e00-\u9fa5]/.exec(t);
      if (unheaded && unheaded.index > t.length * 0.3) {
        const idx = unheaded.index;
        t = t.substring(0, idx) + "\n\n## 参考文献\n\n" + t.substring(idx + 1);
        heads = this.headRegex.exec(t);
      }
    }

    if (!heads) {
      return {
        optimizedContent: content,
        linksAdded: 0,
        anchorsAdded: 0,
        bilingualCleaned: 0,
        abstractStripped: false,
        changed: false,
      };
    }

    const cut = heads.index;
    let body = t.substring(0, cut);
    let tail = t.substring(cut);

    let abstractStripped = false;
    if (stripAbstract) {
      const res = this.stripTrailingAbstract(tail);
      tail = res.strippedTail;
      abstractStripped = res.stripped;
    }

    const refs = new Set<number>();
    let anchorsAdded = 0;
    let bilingualCleaned = 0;
    let linksAdded = 0;

    // 1. Clean entries and add anchors to tail
    tail = tail.replace(this.refEntryRegex, (_orig, _sp, numStr, restStr) => {
      const n = parseInt(numStr, 10);
      refs.add(n);

      const { cleaned, isBilingualCleaned } = this.cleanRefEntry(restStr, cleanBilingual);
      if (isBilingualCleaned) {
        bilingualCleaned++;
      }

      anchorsAdded++;
      return `[${n}] ${cleaned} ^ref${n}`;
    });

    // 2. Ensure blank lines between reference items if requested
    if (enforceBlankLines) {
      const tl = tail.split("\n");
      const fixed: string[] = [];
      const entryTest = /^\s*(?:[-*+]\s+)?(?:\[\[#\^ref\d+\|)?\[\s*\d+\s*\]/;
      for (let i = 0; i < tl.length; i++) {
        const l = tl[i];
        if (
          i > 0 &&
          entryTest.test(l) &&
          fixed.length > 0 &&
          fixed[fixed.length - 1].trim() &&
          entryTest.test(fixed[fixed.length - 1]) &&
          !fixed[fixed.length - 1].startsWith("#")
        ) {
          fixed.push("");
        }
        fixed.push(l);
      }
      tail = fixed.join("\n");
    }

    if (refs.size === 0) {
      return {
        optimizedContent: content,
        linksAdded: 0,
        anchorsAdded: 0,
        bilingualCleaned,
        abstractStripped,
        changed: false,
      };
    }

    // 3. Find existing links in body
    const existingSpans: [number, number][] = [];
    const existingMatches = body.matchAll(/\[\[#\^ref\d+\|[^\]]*\]\]/g);
    for (const m of existingMatches) {
      if (m.index !== undefined) {
        existingSpans.push([m.index, m.index + m[0].length]);
      }
    }

    const insideExisting = (p0: number, p1: number): boolean => {
      return existingSpans.some(([a, b]) => a <= p0 && p1 <= b);
    };

    // Find candidate spans in body
    const spans: { start: number; end: number; raw: string; inner: string }[] = [];
    const citeMatches = body.matchAll(this.bodyCiteRegex);
    for (const m of citeMatches) {
      if (m.index !== undefined && !insideExisting(m.index, m.index + m[0].length)) {
        spans.push({
          start: m.index,
          end: m.index + m[0].length,
          raw: m[0],
          inner: m[1],
        });
      }
    }

    // Sort spans by start asc, length desc
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept: typeof spans = [];
    let lastEnd = -1;
    for (const s of spans) {
      if (s.start >= lastEnd) {
        kept.push(s);
        lastEnd = s.end;
      }
    }

    // Replace from tail to head
    for (let i = kept.length - 1; i >= 0; i--) {
      const s = kept[i];
      const nums = this.parseNumbers(s.inner);
      if (nums.length === 0) continue;
      // All cited numbers must exist in refs to prevent false matches
      if (nums.some((n) => !refs.has(n))) continue;

      const innerLinks = nums.map((n) => `[[#^ref${n}|[${n}]]]`).join("");
      const rendered = useSuperscript ? `<sup>${innerLinks}</sup>` : innerLinks;
      body = body.substring(0, s.start) + rendered + body.substring(s.end);
      linksAdded += nums.length;
    }

    const optimizedContent = body.trimEnd() + "\n\n" + tail.trim() + "\n";
    return {
      optimizedContent,
      linksAdded,
      anchorsAdded,
      bilingualCleaned,
      abstractStripped,
      changed: optimizedContent !== content,
    };
  }
}
