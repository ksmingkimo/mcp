# MCP 制作计划

> MCP 学习项目：把 Sunlike ERP 报表 API 包装成 MCP 服务 + 调用前端。
> 原则：每个阶段先讲概念（为什么 + 目的），用户确认听懂才动手；每阶段验证通过才进下一阶段。
> 状态标记：⬜ 未开始 / 🔵 进行中 / ✅ 完成
> ▶️ **2026-10-08 已恢复**：阶段 0-4 已完成，下一步阶段 5（见对话记录.md Round 11）## 总览

| 阶段 | 主题 | 状态 |
|------|------|------|
| 0 | MCP 概念扫盲 + 项目骨架 | ✅ 完成（2026-09-24） |
| 1 | 最小 MCP Server（Hello World，stdio） | ✅ 完成（2026-10-08；Inspector + Claude Code 自然语言双验证通过） |
| 2 | 登录工具 erp_login（Token 缓存） | ✅ 完成（2026-10-08；冒烟真实登录成功 + Inspector 三路径全过） |
| 3 | getReport 工具（受订单 invso） | ✅ 完成（2026-10-09；冒烟真实查出 9 行特斯拉订单 + Inspector 四路径全过：零参全查/8 月筛选/cusNo=C001/空结果） |
| 4 | getList 工具（成本分析 mrppu）+ 配置驱动注册表 | ✅ 完成（2026-10-12；冒烟 6 条全过 + Inspector 四路径全过） |
| 5 | SSE 流式工具（总分类账）+ 账簿依赖链 | ✅ 完成（2026-10-12；Inspector 实测按用户决定豁免——后端 API 版本问题，见 Round 13） |
| 6 | Streamable HTTP 传输 | ✅ 完成（2026-10-14；curl 六连 + Inspector 三连全过） |
| 7 | 前端① MCP 调试面板 | ✅ 完成（2026-10-14；用户浏览器实测通过） |
| 8 | 前端② AI 对话（LLM 驱动工具调用） | ✅ 完成（2026-10-15；三问实测全过，含上下文学习现场） |
| 9 | 收尾与沉淀 | ✅ 完成（2026-10-15；五题口述全过 + 心得落盘 + 文档核对 + Claude Desktop 注册实测成功） |

## 关键技术决策（2026-09-24 用户拍板）

| 决策 | 选择 |
|------|------|
| 服务语言 | Node.js + 官方 SDK `@modelcontextprotocol/sdk`（本机 Node v24.14.0） |
| 报表范围 | 5 个教学代表：登录 + invso（getReport）+ mrppu（getList）+ accGeneralLedger（SSE 流式）+ AccBook（依赖链）——覆盖全部 4 种调用模式 |
| 前端形态 | 先调试面板（vanilla JS 静态页），后 AI 对话前端 |
| 传输顺序 | 先 stdio（阶段 1-5），阶段 6 加 Streamable HTTP |
| ERP 配置 | 环境变量/配置文件，不写死 |

---

## 阶段 0：MCP 概念扫盲 + 项目骨架

- **目标**：把 MCP 是什么讲清楚，搭好项目骨架
- **概念讲解点**：
  - MCP 是什么（Anthropic 开源标准，2024-11）、为什么叫「AI 的 USB-C」
  - 三个核心概念：Host/Client/Server 三角色、Tools/Resources/Prompts 三能力、JSON-RPC 2.0
  - 两种传输：stdio（本地进程管道）vs Streamable HTTP（网络）
  - 为什么本项目走「包装」路线：ERP 原始 API 是裸 HTTP + 怪异信封，MCP 工具给它干净的契约（名称 + 描述 + 类型化参数 schema）
- **交付物**：`npm init`、安装 `@modelcontextprotocol/sdk` + `zod`、建立 `server/` 目录结构
- **验证方式**：`npm install` 成功，能 import SDK
- **完成记录（2026-09-24）**：
  - 讲义落盘 `MCP概念讲义.md`（12 节，含真实 JSON-RPC 报文示例）
  - npm 初始化：package.json（name=erp-mcp，type=module）
  - 依赖：`@modelcontextprotocol/sdk@1.30.1` + `zod@4.6.5`
  - ⚠️ 踩坑：SDK 1.30.1 发布包缺根入口文件（npm 官方包问题，重装无效、1.29/1.25/1.20/1.15/1.10/1.5 全缺）→ 改用子路径导入 `@modelcontextprotocol/sdk/server/mcp.js`，已验证可用（McpServer/StdioServerTransport 正常）
  - `server/` 目录已建

## 阶段 1：最小 MCP Server（Hello World）

- **目标**：一个 stdio 传输的 server，暴露 1 个无副作用工具，跑通「客户端发现并调用工具」最小闭环
- **概念讲解点**：JSON-RPC 消息在 stdio 上的收发；`tools/list` / `tools/call` 长什么样；工具三要素（name / description / inputSchema）
- **交付物**：`server/index.js` 最小版
- **验证方式**：
  1. MCP Inspector（`npx @modelcontextprotocol/inspector`）列出并调用工具
  2. `claude mcp add` 注册进 Claude Code，自然语言对话实测（MCP 最原汁原味的演示，零客户端代码）
- **完成记录（2026-10-08）**：
  - 冒烟测试 ✅（initialize / tools/list / tools/call 三条响应；日志走 stderr 不污染协议）
  - MCP Inspector ✅ 用户亲手连通并调用 echo（见对话记录 Round 5）
  - `claude mcp add -s local erp-mcp` 注册进 Claude Code ✅（实测：local 作用域写入 `~/.claude.json` 按项目归档，不是项目内 `.mcp.json`；`claude mcp list` 健康检查 √ Connected）
  - 新会话自然语言实测 ✅「帮我复读一句话：MCP 真好玩」→ AI 自主发现并调用 echo，复读成功——「AI 的 USB-C」首次真实插上

## 阶段 2：登录工具 erp_login

- **目标**：工具 `erp_login`（COMPNO/USR/PWD/LANG_ID/SYS_TYPE），真实调 ERP 登录接口
- **概念讲解点**：带副作用的工具；输入 schema 校验（zod）；服务端状态管理（Token 缓存复用）；错误报告（isError + 业务 code 透传）；配置外部化（ERP_BASE_URL/账号走环境变量或 config 文件）
- **交付物**：`server/erp-client.js`（登录 + Token 缓存，参考 `sunlike-erp-api` 技能模板）
- **验证方式**：Inspector 里登录真实 ERP 拿到 Token；错误密码返回可读错误而非崩溃
- ⚠️ 开始前与用户确认测试服务器地址与账套账号（localhost / 192.168.2.167）
- **完成记录（2026-10-08）**：
  - 联调信息：localhost + AT01/SAN/空密码（用户拍板）
  - ⚠️ 联调中发现站点已由 ERPAPI 迁至 **SunReport**（2026-09-30 起，仅前缀变化）→ CLAUDE.md 铁律表已修正
  - 冒烟测试 ✅：无配置 → CONFIG_MISSING 可读错误；带配置 → **真实登录成功**（令牌缓存，有效期与 EXPIRES_IN=60000 秒吻合，时间单位推断被证实）
  - Inspector 实测 ✅ 三路径全过：零参真登 / 重复调用复用缓存（常驻进程状态实锤）/ 错密码 isError+10001
  - 踩坑两个已记录：① 超时分层（外层耐心必须大于内层兜底）② PowerShell 5.1+curl.exe 搅坏 JSON 引号（探测工具会撒谎，对照实验破案）

## 阶段 3：getReport 工具（受订单 invso）

- **目标**：工具 `erp_report_invso`（日期范围/客户/货品筛选），封装 SEARCH_INFO 十元素构造
- **概念讲解点**：业务参数 → 请求体的映射（「包装」的核心）；自动登录（20001/20004 → 重登重试一次）；结果加工成 AI 易读格式；空结果处理
- **交付物**：`server/reports/invso.js`
- **验证方式**：Inspector 用真实账套查受订单出数；对照三步验证法核对请求体字段
- **完成记录（2026-10-09）**：
  - 冒烟测试 ✅：erp_report_invso 零参查出**真实 9 行特斯拉 Model 3 受订单**（含文档示例 SO68030001），markdown 表格自适应 ERP 实际列
  - Inspector 实测 ✅ 四路径全过：零参全查（9 行）/ 8 月日期筛选 / cusNo=C001 / 2020 年空结果（0 行 + 放宽建议）
  - 三层架构立住：index.js（工具注册）→ reports/invso.js（翻译层）→ erp-client.js erpPost（认证/重试/错误通用层）
  - 踩坑两个已记录：③ ERP 冷启动复发（NETWORK 错误信息加预热行动建议）④ 文档 displayFields 计数不准；新认知：REPORT__TAB 列名以 ERP 实际返回为准（自适应表头，已记入 CLAUDE.md 铁律表）

## 阶段 4：getList 工具（成本分析 mrppu）

- **目标**：`erp_report_mrppu`——getList 端点、OTHERINFO、PAGE_INFO、响应取 `data.TRANS`
- **概念讲解点**：同接口不同实现 → 引出**配置驱动注册表**思路（每只报表 = 一条配置：端点/PGM/响应数据键/筛选字段），为扩展 40 只铺路
- **交付物**：`server/report-registry.js` + `server/reports/mrppu.js`
- **验证方式**：Inspector 查询出数；空数据 `TRANS: []` 不报错
- **交付物演进（2026-10-09）**：`reports/mrppu.js` 专属翻译文件被注册表一条配置取代——mrppu 零专属代码，通用逻辑收进 `server/report-engine.js`（交付物实为 report-engine.js + report-registry.js + index.js 循环注册）；`reports/invso.js` 迁入注册表后已删除
- **进度记录（2026-10-09）**：冒烟 6 条全过（invso 回归 9 行一致 + mrppu 空数据不报错）；Node 对照确认账套无成本数据（三种 dateCst 变体全 0 行）；⚠️ 踩坑 5：并发登录撞坏 ERP（.NET 集合并发损坏 10001）→ 已修复（ensureLogin 单飞）+ 应用池回收恢复，详见对话记录 Round 10
- **完成记录（2026-10-12）**：Inspector 实测 ✅ 四路径全过（mrppu 零参 0 行+建议 / dateCst=2026-08 筛选 / invso 零参回归 9 行特斯拉 / erp_login 复用缓存）；Tools 列表 4 个工具中后两个由注册表循环生成，与手写工具外观无差别

## 阶段 5：SSE 流式工具（总分类账）+ 依赖链

- **目标**：`erp_list_books`（AccBook/GetList）+ `erp_report_accgl_stream`（accGeneralLedger/GetReportStream）
- **概念讲解点**：依赖链（账簿 → 报表）；服务端 fetch + ReadableStream 解析 SSE（行缓冲/PERCENT/ERR 经验，Node 24 自带 fetch）；**MCP 工具返回最终聚合结果，流式进度是服务端内部事**；超时兜底
- **交付物**：`server/reports/accgl.js`
- **验证方式**：Inspector 查总分类账出数（带 BOOK_NO）；空账簿返回清晰错误而非挂起
- **交付物演进（2026-10-12）**：「读流的手艺」是通用件——`erp-client.js` 新增 `erpPostStream`（三步判别/行缓冲/ERR/60s 超时/认证重试）+ 引擎第三种 style `"stream"`（占位符模板/期间派生/账簿兜底）；accgl 只留注册表一条配置；`erp_list_books` 手写于 index.js（清单不是报表，不进注册表——配置地狱边界）
- **进度记录（2026-10-12）**：冒烟 8 条全过——accgl 用 bookNo=00000000 + dateCst=2026-08 查出 **12 行真实总分类账**（流进度只进 stderr 日志）；不传 bookNo 走兜底 → NO_BOOK 清晰错误不挂起；invso 回归 9 行。⚠️ 探针破案：AccBook/GetList 当前返回 code 0 + data:{}（后端清单接口部署不完整，请求体与文档逐字段一致），但 GetReportStream 直查正常 → 账簿还在、总账模块健康；工具文案已按「清单空 ≠ 未启用总账」口径修正。详见对话记录 Round 12 + 讲义第十六节
- **完成记录（2026-10-12）**：标记 ✅——冒烟全过为准；**Inspector 实测按用户决定豁免**（后端 API 版本状况，accgl 当前执行报错，详见对话记录 Round 13）。accgl 代码保留，后端稳定后可随时补测
- **补充（2026-10-14）**：用户报告后端 API 已升级（修复多个问题，accgl 恢复可用，未实测复核）→ 豁免可随时撤销补测；此前记录的 AccBook 空 data / accgl 报错两个怪象可能已翻篇

## 阶段 6：Streamable HTTP 传输

- **目标**：同一批工具再挂 HTTP 传输，让浏览器前端能连
- **概念讲解点**：为什么浏览器连不了 stdio（进程管道 vs 网络）；Streamable HTTP 的 JSON-RPC 封装（POST + 可选 SSE 响应流）；SDK 多传输并存
- **交付物**：`server/http.js`（HTTP 入口，复用同一批工具注册）
- **验证方式**：curl 发 `initialize` / `tools/list` / `tools/call` 拿到结果；Inspector 用 HTTP 模式再测一遍
- **交付物演进（2026-10-14）**：工具注册抽成 `server/tools.js`（`registerTools(server)`，工具注册与传输解耦落地）；`index.js` 瘦身为纯 stdio 入口；`http.js` 单端点 /mcp + 无状态（每请求一临时 transport）+ enableJsonResponse + CORS
- **进度记录（2026-10-14）**：curl 六连全过——initialize ✅ / tools/list 6 工具 ✅ / tools/call echo ✅ / 坏 JSON 400 ✅ / 别的路径 404 ✅ / OPTIONS 204 ✅；stdio 回归通过（抽注册无损）。详见对话记录 Round 14 + 讲义第十七节
- **完成记录（2026-10-14）**：Inspector HTTP 模式实测 ✅——tools/list 6 工具 / erp_login 零参 / erp_report_invso 零参（9 行特斯拉）全过。实测揪出 curl 六连没暴露的真 bug：共享一个 McpServer + 浏览器连接复用 → 第二个请求抛「Already connected」炸进程（curl 每次新连接用完即断所以没暴露）→ 修复：无状态模式每请求新建 McpServer + transport（工具注册纯内存操作成本可忽略；Token 缓存模块级不受影响）+ 请求处理 try/catch 兜底（意外只回 -32603）。修复后 Node 模拟浏览器复用连接三连全过。详见对话记录 Round 15

## 阶段 7：前端① MCP 调试面板

- **目标**：静态网页（vanilla JS，零构建，沿用 AsCoding 偏好）：列工具 → 按 inputSchema 渲染参数表单 → 调工具 → 展示结果
- **概念讲解点**：亲手实现 MCP 客户端：握手（initialize）、JSON-RPC 帧、schema 驱动表单；SSE 响应读取
- **交付物**：`frontend/`（index.html + css + js）
- **验证方式**：浏览器里完成「登录 → 查受订单 → 查总分类账」全流程
- **完成记录（2026-10-14）**：`frontend/` 三文件交付（零构建静态页，双击即开）；手写 MCP 客户端三件事（initialize/tools/list/tools/call）+ schema 驱动表单（enum 下拉/类型映射/必填校验/可选留空）+ 迷你 markdown 表格渲染 + 连接状态条；Accept 头（text/event-stream）教训写进客户端代码。用户浏览器实测通过（登录 → 查受订单）。「SSE 响应读取」概念点按计划表原意落地为服务端已开 enableJsonResponse——客户端无需读流，这本身就是教学结论。详见对话记录 Round 16 + 讲义第十八节

## 阶段 8：前端② AI 对话（LLM 驱动工具调用）

- **目标**：对话页 + LLM API（沿用多模型经验：thinking mode 禁用、CORS 处理），浏览器端实现工具调用循环：问话 → LLM 带工具定义 → 模型决定调哪个 MCP 工具 → 前端代为调用 → 结果回填 → 模型作答
- **概念讲解点**：MCP 的完整形态——同一套工具契约任何 Host 都能消费；浏览器端 tool_use 循环
- **交付物**：`frontend/chat.html` + `frontend/chat.js`
- **验证方式**：自然语言问「特斯拉 8 月的受订单有多少」，前端自动调 `erp_report_invso` 并给出答案
- **完成记录（2026-10-15）**：交付 chat.html + chat.js + 共享内核 mcp-client.js（从 app.js 抽出，承诺兑现）；LLM 用 DeepSeek（deepseek-chat 非思考模型，thinking 禁用靠选型满足；key 只存 localStorage 不落盘）。实测三问全过——第 3 问「八月份特斯拉」模型凭上下文里的全量结果自动翻译出 cusNo=C001（上下文学习现场）。期间揪出并修复 UI 空引用 bug（工具其实全成功，catch 把 UI 错误当工具失败回填，模型被假情报误导）——「工具回填质量决定模型判断」活教材。详见对话记录 Round 17 + 讲义第十九节

## 阶段 9：收尾与沉淀

- **目标**：整理学习成果
- **交付物**：MCP制作计划.md 各阶段状态补全；对话记录补全；「MCP 学习心得」要点（MCP 是什么/不是什么、什么时候该用、stdio 与 HTTP 的选择）；可选：注册进 Claude Desktop 作为日常工具
- **验证方式**：三份管理文档与代码一致；用户能自己向别人讲清 MCP 是什么
- **完成记录（2026-10-15）**：五题口述全过（用户能自己讲清 MCP）；`MCP学习心得.md` 落盘（七节，用户口述为主体 + 补漏）；三份管理文档与代码一致性核对通过（CLAUDE.md 追加前端凭据约定）；彩蛋实测——erp-mcp 注册进 Claude Desktop（`claude_desktop_config.json` 的 mcpServers：stdio 拉子进程 + env 块传账号，配置写入前先完全退出 App），自然语言查 ERP 成功——**第三个 Host 插上，「AI 的 USB-C」终极验证**。悬置：特斯拉方案①/③、accgl Inspector 补测（后端已升级，随时可拾）

---

## 可复用素材清单

- `sunlike-erp-api` 技能（`C:\Users\Administrator\.claude\skills\sunlike-erp-api\`）：登录/Token 缓存 Node.js 模板、陷阱清单
- AsCoding 项目 `D:\VibeCoding\AsCoding\js\`：请求构造、SSE 解析实战参考
- 三份参考文档：`API调整说明文档.md` / `API服务调用说明文档.md` / `项目经验总结.md`
