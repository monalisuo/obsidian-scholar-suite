import { AuditIssue } from "../types";

export class MathDoctor {
  /**
   * Scans content for LaTeX math rendering pitfalls in Obsidian:
   * 1. Unbalanced inline `$` or block `$$` delimiters
   * 2. Math formulas accidentally placed inside HTML <table> tags (Obsidian MathJax ignores HTML blocks)
   * 3. Chinese text erroneously wrapped in `$` by OCR engines
   */
  public auditMath(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const lines = content.split("\n");

    // 1. Check overall $ count
    // First remove code blocks (```...```) and inline code (`...`)
    const cleanNoCode = content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]+`/g, "");

    const dollarMatches = cleanNoCode.match(/(?<!\\)\$/g);
    const totalDollars = dollarMatches ? dollarMatches.length : 0;

    if (totalDollars % 2 !== 0) {
      issues.push({
        id: "math_unbalanced_dollar",
        category: "math",
        severity: "error",
        line: 1,
        preview: `全文共有 ${totalDollars} 个 '$' 定界符（奇数，存在未闭合公式）`,
        message: "检测到未闭合的数学公式定界符 '$'。这会导致后续整段甚至数页正文被错误识别为 LaTeX 代码而渲染异常。",
        autoFixable: false,
      });
    }

    // 2. Check for formulas trapped inside HTML <table>
    const htmlTableRegex = /<table[\s\S]*?<\/table>/gi;
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = htmlTableRegex.exec(content)) !== null) {
      const tableContent = tableMatch[0];
      if (/(?<!\\)\$/.test(tableContent)) {
        // Find line number
        const charIdx = tableMatch.index;
        const lineNum = content.substring(0, charIdx).split("\n").length;
        issues.push({
          id: `math_in_html_table_${lineNum}`,
          category: "math",
          severity: "error",
          line: lineNum,
          preview: tableContent.substring(0, 80) + "...",
          message: "HTML <table> 内嵌套了 LaTeX 公式 '$...$'。Obsidian 原生渲染器不会处理 HTML 块内的 MathJax，需转为 Markdown 管道表格。",
          autoFixable: true,
        });
      }
    }

    // 3. Check line-by-line for Chinese text erroneously wrapped in $
    const chineseWrappedRegex = /\$([\u4e00-\u9fa5\s，。！？、（）]{4,})\$/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpExecArray | null;
      while ((m = chineseWrappedRegex.exec(line)) !== null) {
        issues.push({
          id: `math_chinese_wrap_${i + 1}`,
          category: "math",
          severity: "warning",
          line: i + 1,
          preview: m[0],
          message: `疑似中文正文被错误包裹在 '$' 定界符中: "${m[1]}"`,
          autoFixable: true,
        });
      }
    }

    return issues;
  }

  /**
   * Fixes common math issues:
   * - Unwraps pure Chinese text falsely wrapped in `$...$`
   */
  public fixMath(content: string): { fixedContent: string; fixesCount: number } {
    let fixesCount = 0;

    // Fix Chinese text falsely wrapped in $
    const chineseWrappedRegex = /\$([\u4e00-\u9fa5\s，。！？、（）]{4,})\$/g;
    const fixedContent = content.replace(chineseWrappedRegex, (_match, inner) => {
      fixesCount++;
      return inner;
    });

    return { fixedContent, fixesCount };
  }
}
