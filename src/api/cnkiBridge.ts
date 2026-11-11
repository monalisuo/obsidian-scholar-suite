import { requestUrl } from "obsidian";

export interface CnkiFetchResult {
  success: boolean;
  title?: string;
  authors?: string[];
  journal?: string;
  doi?: string;
  abstract?: string;
  error?: string;
  needKeeper?: boolean;
}

export interface CnkiCitingPaperRaw {
  title: string;
  authors: string[];
  journal: string;
  year: string;
  citationCount: number;
  downloadCount?: number;
  fund?: string;
  sourceType?: string;
}

export interface CnkiCitationResult {
  success: boolean;
  title?: string;
  citation_count?: number;
  second_citation_count?: number;
  references_count?: number;
  co_references_count?: number;
  co_citations_count?: number;
  download_count?: number;
  citations?: CnkiCitingPaperRaw[];
  error?: string;
  needKeeper?: boolean;
}

export class CnkiBridge {
  private cdpUrl: string = "http://127.0.0.1:9222";

  private getScriptPath(scriptName: string): string {
    const adapter = (window as any).app?.vault?.adapter;
    const basePath = adapter?.basePath || "";
    const path = (window as any).require ? (window as any).require("path") : null;
    if (basePath && path) {
      return path.join(basePath, "研究项目", "园区产业内容", "runtime", scriptName);
    }
    return `runtime/${scriptName}`;
  }

  /**
   * Check if Chrome CDP 9222 (CNKI Keeper) is alive
   */
  public async isCdpAlive(): Promise<boolean> {
    try {
      const res = await requestUrl({
        url: `${this.cdpUrl}/json/version`,
        method: "GET",
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Launch CNKI Keeper in background if not already running
   * @param headless Whether to launch in silent headless mode (Default true after login)
   */
  public async launchKeeper(headless: boolean = true): Promise<boolean> {
    try {
      if (await this.isCdpAlive()) return true;

      // Use Node child_process inside Obsidian desktop
      const child_process = (window as any).require ? (window as any).require("child_process") : null;
      if (!child_process) return false;

      const keeperScript = this.getScriptPath("cnki_keeper.py");
      const flag = headless ? "--headless" : "--visible";
      const cmd = `conda run -n research --no-capture-output python "${keeperScript}" ${flag}`;
      
      child_process.exec(cmd, { windowsHide: true });
      
      // Wait up to 6 seconds for keeper to start listening
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await this.isCdpAlive()) return true;
      }
    } catch (e) {
      console.warn("Failed to launch CNKI Keeper:", e);
    }
    return false;
  }

  /**
   * Fetch CNKI abstract and metadata for a Chinese paper title
   */
  public async fetchCnkiAbstract(title: string): Promise<CnkiFetchResult> {
    const cleanTitle = title
      .replace(/[\[\]【】\(\)（）]/g, " ")
      .replace(/["']/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanTitle || cleanTitle.length < 3) {
      return { success: false, error: "标题过短，无法检索知网" };
    }

    try {
      const child_process = (window as any).require ? (window as any).require("child_process") : null;
      if (!child_process) {
        return { success: false, error: "当前运行环境不支持 Node child_process" };
      }

      // Check if keeper is running, if not try to launch
      const alive = await this.isCdpAlive();
      if (!alive) {
        const launched = await this.launchKeeper();
        if (!launched) {
          return {
            success: false,
            error: "知网常驻服务 (CDP 9222) 未开启。请先在控制台启动 keeper，或点击插件栏知网启动按钮。",
            needKeeper: true,
          };
        }
      }

      const fetcherScript = this.getScriptPath("cnki_fetcher.py");
      const cmd = `conda run -n research --no-capture-output python "${fetcherScript}" --title "${cleanTitle}"`;

      return await new Promise<CnkiFetchResult>((resolve) => {
        child_process.exec(
          cmd,
          { timeout: 35000, windowsHide: true },
          (error: any, stdout: string, stderr: string) => {
            if (error) {
              console.warn("CNKI fetch exec error:", error, stderr);
              resolve({
                success: false,
                error: `知网检索执行超时或失败: ${error.message || stderr}`,
              });
              return;
            }

            try {
              // Find the JSON line in output
              const lines = stdout.trim().split("\n");
              let jsonStr = "";
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith("{") && line.endsWith("}")) {
                  jsonStr = line;
                  break;
                }
              }

              if (!jsonStr) {
                resolve({ success: false, error: "知网脚本未返回有效的 JSON 数据" });
                return;
              }

              const data = JSON.parse(jsonStr);
              resolve(data);
            } catch (parseErr: any) {
              resolve({ success: false, error: `解析知网返回结果失败: ${parseErr.message}` });
            }
          }
        );
      });
    } catch (e: any) {
      return { success: false, error: `CNKI Bridge 异常: ${e.message}` };
    }
  }

  /**
   * Fetch CNKI citation count and citing papers for a Chinese paper title
   */
  public async fetchCnkiCitations(title: string): Promise<CnkiCitationResult> {
    const cleanTitle = title
      .replace(/[\[\]【】\(\)（）]/g, " ")
      .replace(/["']/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanTitle || cleanTitle.length < 3) {
      return { success: false, error: "标题过短，无法检索知网" };
    }

    try {
      const child_process = (window as any).require ? (window as any).require("child_process") : null;
      if (!child_process) {
        return { success: false, error: "当前运行环境不支持 Node child_process" };
      }

      const alive = await this.isCdpAlive();
      if (!alive) {
        const launched = await this.launchKeeper();
        if (!launched) {
          return {
            success: false,
            error: "知网常驻服务 (CDP 9222) 未开启。请先在控制台启动 keeper，或点击插件栏知网启动按钮。",
            needKeeper: true,
          };
        }
      }

      const fetcherScript = this.getScriptPath("cnki_fetcher.py");
      const cmd = `conda run -n research --no-capture-output python "${fetcherScript}" --mode citations --title "${cleanTitle}"`;

      return await new Promise<CnkiCitationResult>((resolve) => {
        child_process.exec(
          cmd,
          { timeout: 40000, windowsHide: true },
          (error: any, stdout: string, stderr: string) => {
            if (error) {
              console.warn("CNKI citations fetch exec error:", error, stderr);
              resolve({
                success: false,
                error: `知网引证检索执行超时或失败: ${error.message || stderr}`,
              });
              return;
            }

            try {
              const lines = stdout.trim().split("\n");
              let jsonStr = "";
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith("{") && line.endsWith("}")) {
                  jsonStr = line;
                  break;
                }
              }

              if (!jsonStr) {
                resolve({ success: false, error: "知网引证脚本未返回有效数据" });
                return;
              }

              const data = JSON.parse(jsonStr);
              resolve(data);
            } catch (parseErr: any) {
              resolve({ success: false, error: `解析知网引证数据失败: ${parseErr.message}` });
            }
          }
        );
      });
    } catch (e: any) {
      return { success: false, error: `CNKI Bridge 异常: ${e.message}` };
    }
  }

  /**
   * Download CNKI full-text PDF via resident Chrome CDP 9222
   */
  public async downloadCnkiPdf(
    title: string
  ): Promise<{ success: boolean; file_path?: string; bytes?: number; error?: string }> {
    const cleanTitle = title
      .replace(/[\[\]【】\(\)（）]/g, " ")
      .replace(/["']/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanTitle || cleanTitle.length < 3) {
      return { success: false, error: "标题过短，无法检索知网" };
    }

    try {
      const child_process = (window as any).require ? (window as any).require("child_process") : null;
      if (!child_process) {
        return { success: false, error: "当前运行环境不支持 Node child_process" };
      }

      const alive = await this.isCdpAlive();
      if (!alive) {
        const launched = await this.launchKeeper();
        if (!launched) {
          return {
            success: false,
            error: "知网常驻服务 (CDP 9222) 未开启",
          };
        }
      }

      const fetcherScript = this.getScriptPath("cnki_fetcher.py");
      const cmd = `conda run -n research --no-capture-output python "${fetcherScript}" --mode download --title "${cleanTitle}"`;

      return await new Promise((resolve) => {
        child_process.exec(
          cmd,
          { timeout: 50000, windowsHide: true },
          (error: any, stdout: string, stderr: string) => {
            if (error) {
              resolve({
                success: false,
                error: `知网下载执行失败: ${error.message || stderr}`,
              });
              return;
            }

            try {
              const lines = stdout.trim().split("\n");
              let jsonStr = "";
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith("{") && line.endsWith("}")) {
                  jsonStr = line;
                  break;
                }
              }

              if (!jsonStr) {
                resolve({ success: false, error: "知网下载脚本未返回有效数据" });
                return;
              }

              const data = JSON.parse(jsonStr);
              resolve(data);
            } catch (parseErr: any) {
              resolve({ success: false, error: `解析知网下载结果失败: ${parseErr.message}` });
            }
          }
        );
      });
    } catch (e: any) {
      return { success: false, error: `CNKI Bridge 异常: ${e.message}` };
    }
  }
}
