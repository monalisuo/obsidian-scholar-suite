import { AuditIssue } from "../types";

export class CitationLinker {
  private headRegex =
    /^#{1,6}\s*[【\[〖〔（\(\]]?\s*(?:参考文献|References|REFERENCES)\s*[】\]〗〕）\)]?|^[【\[〖〔（\(\]]?\s*(?:参考文献|References|REFERENCES)\s*[】\]〗〕）\)]?/im;

  private refEntryRegex =
    /^(\s*(?:[-*+]\s+)?)(?:[（\[【〖〔]\s*)?(\d{1,3})\s*[）\]】〗〕\.\s]\s*(.*)$/gm;

  private bodyCiteRegex =
    /(?<![\[\$\^])(?:<sup>)?\s*\[\s*(\d{1,3}(?:\s*[，,、；\-–—]\s*\d{1,3})*)\s*\]\s*(?:<\/sup>)?(?![\]\$\^])/g;

  public parseNumbers(raw: string): number[] {
    const out: number[] = [];
    const parts = raw.split(/[，,、；]/);
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      // Range: 1-3
      const rangeMatch = part.match(/^(\d{1,3})\s*[\-–—]\s*(\d{1,3})$/);
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

  public auditCitations(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];

    // Find reference heading
    const headMatch = this.headRegex.exec(content);
    if (!headMatch) {
      // Check if there is an unheaded list starting with [1]
      const unheaded = /\n\s*(?:[（\[【〖〔]\s*1\s*[）\]】〗〕]|1\s*[\.、])\s+[A-Za-z\u4e00-\u9fa5]/.exec(content);
      if (unheaded && unheaded.index > content.length * 0.4) {
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

    // Extract reference anchors from tail
    const refs = new Set<number>();
    const anchorMatches = tail.matchAll(/\^ref(\d+)\b/g);
    for (const m of anchorMatches) {
      refs.add(parseInt(m[1], 10));
    }

    // Check for references without anchors
    const unanchoredMatches = tail.matchAll(this.refEntryRegex);
    let missingAnchors = 0;
    for (const m of unanchoredMatches) {
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

    // Check dead links in body
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
    enforceBlankLines: boolean = true
  ): {
    optimizedContent: string;
    linksAdded: number;
    anchorsAdded: number;
    changed: boolean;
  } {
    let t = content;
    let heads = this.headRegex.exec(t);

    if (!heads) {
      const unheaded = /\n\s*(?:[（\[【〖〔]\s*1\s*[）\]】〗〕]|1\s*[\.、])\s+[A-Za-z\u4e00-\u9fa5]/.exec(t);
      if (unheaded && unheaded.index > t.length * 0.4) {
        const idx = unheaded.index;
        t = t.substring(0, idx) + "\n\n## 参考文献\n\n" + t.substring(idx + 1);
        heads = this.headRegex.exec(t);
      }
    }

    if (!heads) {
      return { optimizedContent: content, linksAdded: 0, anchorsAdded: 0, changed: false };
    }

    const cut = heads.index;
    let body = t.substring(0, cut);
    let tail = t.substring(cut);

    const refs = new Set<number>();
    let anchorsAdded = 0;
    let linksAdded = 0;

    // 1. Add anchors to tail
    tail = tail.replace(this.refEntryRegex, (orig, _sp, numStr) => {
      const n = parseInt(numStr, 10);
      refs.add(n);
      if (new RegExp(`\\^ref${n}\\b`).test(orig)) {
        return orig;
      }
      anchorsAdded++;
      return orig.trimEnd() + ` ^ref${n}`;
    });

    // 2. Ensure blank lines between reference items if requested
    if (enforceBlankLines) {
      const tl = tail.split("\n");
      const fixed: string[] = [];
      for (let i = 0; i < tl.length; i++) {
        const l = tl[i];
        if (
          i > 0 &&
          this.refEntryRegex.test(l) &&
          fixed.length > 0 &&
          fixed[fixed.length - 1].trim() &&
          this.refEntryRegex.test(fixed[fixed.length - 1]) &&
          !fixed[fixed.length - 1].startsWith("#")
        ) {
          fixed.push("");
        }
        fixed.push(l);
      }
      tail = fixed.join("\n");
    }

    if (refs.size === 0) {
      return { optimizedContent: content, linksAdded: 0, anchorsAdded: 0, changed: false };
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

    // Find candidate spans
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

      const rendered = nums.map((n) => `[[#^ref${n}|[${n}]]]`).join("");
      body = body.substring(0, s.start) + rendered + body.substring(s.end);
      linksAdded += nums.length;
    }

    const optimizedContent = body + tail;
    return {
      optimizedContent,
      linksAdded,
      anchorsAdded,
      changed: optimizedContent !== content,
    };
  }
}
