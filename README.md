# Obsidian Scholar Suite

[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/monalisuo/obsidian-scholar-suite?style=flat-square)](https://github.com/monalisuo/obsidian-scholar-suite/releases)

**Obsidian Scholar Suite** 是专为人文社科、经济地理与学术科研工作者打造的高性能学术文献增强套件。

借鉴并融合了 **Zotero-Reference** 与 **ReadCube Papers** 的优秀交互设计，让您在 Obsidian 中阅读 Markdown 论文笔记时，能够右侧实时展现完整的**参考文献网络**、**外部权威施引图谱**、**Sciverse 语义相关文献**、**期刊分区标签（EasyScholar）**，并与本地知识库建立双向穿透链接。此外，套件内置了专为 MinerU 等 OCR 转换工具设计的**多模态论文质检与修复工具箱**，并支持一键将文献及真 PDF 全文导入 Zotero。

---

## ✨ 核心特性

### 1. 🎓 Zotero-Reference 级三位一体引文视窗
- **三栏学术视窗**：
  - **参考文献 (References)**：阅读当前论文时，右侧栏即时呈现该文引用的全部学术文献。
  - **引证文献 (Citations / Cited-by)**：一键同步知网（CNKI）官方权威被引量、Elsevier Scopus 或 OpenAlex 施引文献，追踪研究脉络与学术前沿。
  - **相关文献 (Related Works)**：基于 **Sciverse** 学术大模型引擎，利用图谱拓扑与语义切块向量召回，智能挖掘与当前论文主题深度关联的延伸文献。
- **本地知识库双向穿透比对 (Vault Cross-Matching)**：
  - 自动检测引文列表中有哪些论文已存在于您的 Obsidian 库中；
  - 已收录文献显示 `[在库]` 徽章，点击即可秒级打开本地对应笔记；
  - 针对中文拼音作者、双语题名进行智能模糊对齐。

---

### 2. 🧹 参考文献全格式自适应解析与双向冗余清洗
针对国内顶刊（《地理学报》《经济研究》等）及 MinerU OCR 转换排版深度调优：
- **前置冗余剔除**：自动识别并剥离中文文献前的英文翻译与包裹括号，如 `Chen Xian... [陈宪, 黄建锋...]`；
- **后置冗余深度清除**：
  - 剔除语言标识：如 `(in Chinese)`、`[in Chinese with English abstract]`、`（in Chinese）`、`［in Chinese with English summary］` 等；
  - 剔除后置英文对照翻译块：自动剥离如 `[Chen Xian, Huang Jianfeng... Quantitative & Technical Economics, 2004(10): 65-71.]`，智能断言保护卷期数字括号（如 `2004(10): 65-71.`）绝不误截断；
  - 剔除尾随无括号英文对照追加段落；
- **OCR 碎空格修复**：自动合并中文汉字之间的零散空格；
- **纯外文文献严格保护**：双向清洗机制受汉字统计阈值严密约束，100% 保护纯外文条目（如 `Rosenthal & Strange 2001`、`Marshall 1920`）结构完整性。

---

### 3. 📥 Zotero 协同与真 PDF 全文自动嗅探挂载
- **一键导入 Zotero**：一键将卡片文献推送到 Zotero 当前选中分类（走 Connector 23119 端口，**零弹窗免授权**）；
- **四级真 PDF 全文嗅探**：
  1. **OpenAlex OA**：自动嗅探开放获取全文直链；
  2. **Semantic Scholar OA**：检索开放全文归档；
  3. **Unpaywall**：多途径合法开放全文检索；
  4. **知网（CNKI）CDP 浏览器通道**：复用本地已登录机构认证状态的浏览器通道，自动下载知网真 PDF 并挂载为附件。

---

### 4. 🏷️ 权威期刊层级与 EasyScholar 分区标签
集成 EasyScholar 官方开放接口，自动对当前论文及其所有引文的期刊进行智能检索与可视化标记：
- **中文核心**：`[CSSCI]`、`[北大核心]`、`[CSCD]`、`[卓越行动计划]`
- **国际评级**：`[中科院1区Top]`、`[SSCI Q1]`、`[SCI Q1]`、`[JCR Q1]`
- **影响因子与预警提示**：实时显示 JCR 影响因子与官方期刊预警状态；
- **持久层本地缓存**：查询结果自动保存在本地，避免频繁重复请求。

---

### 5. 🌐 知网权威引文网络深度整合
- 一键从知网拉取当前论文的官方权威被引频次与施引文献列表；
- 自动回写当前笔记 Frontmatter：
  - `citations: 51`（官方核心被引次数）
  - `downloads: 1205`（知网下载量）
- 过滤无关干扰，精简聚焦一级学术影响力。

---

### 6. 📖 沉浸式阅读与交互增强
- **文本划选与复制**：引文卡片全面放开原生鼠标划选，方便复制引文摘要或核心观点；
- **一键中英双语互译**：引文卡片内置一键翻译按钮，外文文献标题与摘要瞬间转换为优美中文，无需跳出笔记；
- **多模态 PDF-to-MD 质检工具**：一键扫描并修复 LaTeX 公式冲突（单 `$`、跨行 `$$`）、清理残留 HTML 表格、排查本地插图死链。

---

## 🚀 安装指南

### 方法一：通过 BRAT 插件直接安装（推荐）
1. 在 Obsidian 中安装并启用 **Obsidian42 - BRAT** 插件；
2. 打开 BRAT 设置，点击 `Add Beta plugin`；
3. 输入本仓库地址：`https://github.com/monalisuo/obsidian-scholar-suite`；
4. 点击添加后，在“第三方插件”列表中启用 **Scholar Suite** 即可。

### 方法二：手动安装
1. 前往 [Releases](https://github.com/monalisuo/obsidian-scholar-suite/releases) 下载最新版的发布包；
2. 解压得到 `main.js`、`manifest.json`、`styles.css` 三个文件；
3. 将解压出的文件夹重命名为 `obsidian-scholar-suite`，拷贝至您的知识库目录：
   ```text
   <Your-Vault>/.obsidian/plugins/obsidian-scholar-suite/
   ```
4. 在 Obsidian `设置 -> 第三方插件` 中点击刷新，并开启 **Scholar Suite**。

---

## ⚙️ 配置说明

安装后可在 `设置 -> Scholar Suite 学术套件` 中按需配置：

| 配置项 | 说明 |
| :--- | :--- |
| **Sciverse API Key** | （推荐）用于启用「相关文献」选项卡的 AI 图谱拓扑发现与语义向量关联挖掘。 |
| **EasyScholar 密钥** | （强烈推荐）用于自动渲染中文期刊 CSSCI / 北大核心与国际 SCI/SSCI 分区标签。可前往 [EasyScholar 官网](https://www.easyscholar.cc/) 个人中心复制。 |
| **Elsevier Scopus API Key** | （可选）用于获取权威的 Scopus 施引文献与被引次数。可前往 [Elsevier Developer Portal](https://dev.elsevier.com/) 免费申请。 |
| **Semantic Scholar API Key** | （可选）配置后可提高 Semantic Scholar 的请求频率上限。 |
| **默认文献精读模板路径** | 用于一键创建在库引文笔记时套用的 Templater 模板路径。 |

---

## 🛠️ 本地开发与构建

如果您希望为本项目贡献代码或二次开发：

```bash
# 1. 克隆仓库
git clone https://github.com/monalisuo/obsidian-scholar-suite.git
cd obsidian-scholar-suite

# 2. 安装依赖
npm install

# 3. 开发模式（监听文件改动自动编译）
npm run dev

# 4. 生产环境构建打包
npm run build
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源协议分发与使用。
欢迎提出 Issue 或 Pull Request 共同改进！
