import { AuditIssue } from "../types";

export class TableConverter {
  /**
   * Scans content for raw HTML tables
   */
  public auditTables(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const htmlTableRegex = /<table[\s\S]*?<\/table>/gi;
    let match: RegExpExecArray | null;

    while ((match = htmlTableRegex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      issues.push({
        id: `html_table_${lineNum}`,
        category: "table",
        severity: "info",
        line: lineNum,
        preview: match[0].substring(0, 70).replace(/\n/g, " ") + "...",
        message: "检测到原生 HTML <table> 结构。转换为标准 Markdown 管道表格可增强阅读体验并激活公式渲染支持。",
        autoFixable: true,
      });
    }

    return issues;
  }

  /**
   * Converts HTML <table> to Markdown pipe table
   */
  public htmlTableToMarkdown(htmlTable: string): string {
    // Extract rows
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    const rows: string[][] = [];
    let isHeaderRow = true;
    let hasHeader = false;

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(htmlTable)) !== null) {
      const rowContent = rowMatch[0];
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        let cellText = cellMatch[1];
        // Clean inner tags like <p>, <span>, but keep sub/sup and math
        cellText = cellText
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<\/?(?:p|div|span)[^>]*>/gi, "")
          .replace(/\r?\n/g, " ")
          .trim();
        // Escape pipes
        cellText = cellText.replace(/\|/g, "\\|");
        cells.push(cellText);
      }

      if (cells.length > 0) {
        if (rowContent.toLowerCase().includes("<th")) {
          hasHeader = true;
        }
        rows.push(cells);
      }
    }

    if (rows.length === 0) return htmlTable;

    // Determine max columns
    const maxCols = Math.max(...rows.map((r) => r.length));
    if (maxCols === 0) return htmlTable;

    // Build markdown table
    const mdLines: string[] = [];

    // Header
    const firstRow = rows[0];
    while (firstRow.length < maxCols) firstRow.push("");
    mdLines.push("| " + firstRow.join(" | ") + " |");

    // Separator
    const separator = Array(maxCols).fill("---");
    mdLines.push("| " + separator.join(" | ") + " |");

    // Body rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      while (row.length < maxCols) row.push("");
      mdLines.push("| " + row.join(" | ") + " |");
    }

    return "\n\n" + mdLines.join("\n") + "\n\n";
  }

  /**
   * Converts all HTML tables in content to Markdown tables
   */
  public convertAllTables(content: string): { convertedContent: string; count: number } {
    let count = 0;
    const htmlTableRegex = /<table[\s\S]*?<\/table>/gi;

    const convertedContent = content.replace(htmlTableRegex, (match) => {
      count++;
      return this.htmlTableToMarkdown(match);
    });

    return { convertedContent, count };
  }
}
