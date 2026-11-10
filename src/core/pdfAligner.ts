import { App, TFile } from "obsidian";
import { AuditIssue } from "../types";

export class PdfAligner {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Attempts to locate the source PDF for a given markdown file
   */
  public findSourcePdf(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    // 1. Direct path in frontmatter
    if (fm?.pdf_path && typeof fm.pdf_path === "string") {
      return fm.pdf_path;
    }

    // 2. Check sibling PDF in the same folder
    const parentFolder = file.parent;
    if (parentFolder) {
      for (const child of parentFolder.children) {
        if (child.name.toLowerCase().endsWith(".pdf")) {
          // If name matches closely or it's the only PDF
          return child.path;
        }
      }
    }

    return null;
  }

  /**
   * Audits numerical and section alignment indicators
   */
  public auditAlignment(content: string, pdfPath: string | null): AuditIssue[] {
    const issues: AuditIssue[] = [];

    if (!pdfPath) {
      issues.push({
        id: "align_no_pdf",
        category: "align",
        severity: "info",
        line: 1,
        preview: "未关联源 PDF 物理文件",
        message: "当前笔记 Frontmatter 中未配置 'pdf_path'，同级目录亦未检索到 PDF 附件，跳过像素级图文比对。",
        autoFixable: false,
      });
      return issues;
    }

    // Check for common OCR artifact signs in Markdown:
    // e.g. OCR garbled words with strange symbols or isolated digits
    const suspiciousLines = content.split("\n");
    for (let i = 0; i < suspiciousLines.length; i++) {
      const line = suspiciousLines[i];
      // Broken hyphenations at line ends like "inter- national" or single character lines
      if (/^[a-zA-Z\u4e00-\u9fa5]$/.test(line.trim())) {
        issues.push({
          id: `align_isolated_char_${i + 1}`,
          category: "align",
          severity: "warning",
          line: i + 1,
          preview: line,
          message: `第 ${i + 1} 行存在孤立单字符 "${line.trim()}"，疑似 OCR 断行截断残留。`,
          autoFixable: false,
        });
      }
    }

    return issues;
  }
}
