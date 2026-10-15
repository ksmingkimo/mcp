# CLAUDE.md

## 语言偏好

- 与本 CLI 的所有交互文字一律使用中文。

## 项目性质

本项目是 **MCP（Model Context Protocol）学习项目**：
把 Sunlike ERP 报表 API 包装成 MCP 服务，并实现调用它的前端（先调试面板、后 AI 对话）。
**学习优先于速度**——每个阶段先讲概念、用户听懂再动手，不追求一次做完。

## 教学铁律（本项目最重要的一条）

1. **任何动作之前**（写代码、装依赖、改文件、发请求），必须先告诉用户：
   - 这个动作的**理由**（为什么这么做）
   - 这个动作的**目的**（做完会得到什么）
2. 用户说不懂、或没有明确继续 → **停下等待**，用更简单的方式再讲，讲懂为止
3. 每个阶段开始前，先讲该阶段涉及的概念，再动手

## 文档纪律

| 文件 | 用途 | 维护纪律 |
|------|------|----------|
| `对话记录.md` | 每轮对话的流水账（不是摘要） | **每轮对话结束必须追加**，当场写不拖；格式：日期 + Round N + 主题 + 完成事项/问题/决策 |
| `MCP制作计划.md` | 分阶段路线图（目标/概念/交付物/验证方式/状态） | 阶段开始标记「🔵 进行中」，验证通过标记「✅ 完成」并记录结果 |
| `CLAUDE.md` | 本文件：项目性质、纪律、API 铁律 | 与用户有新约定时同步 |

参考文档（只读，本项目 API 事实来源）：
- `API调整说明文档.md` — 站点迁移规范（SUNFUSION → ERPAPI，Round 62）
- `API服务调用说明文档.md` — 登录 + 报表 API 实测文档（curl + 字段 + 错误码 + SSE 解析）
- `项目经验总结.md` — 63 轮经验提炼（API 对接、AI 集成、UI、部署教训）
- `MCP概念讲义.md` — 学习讲义（阶段 0 概念扫盲，可反复阅读；后续阶段讲义追加到本文件）

## ERP API 铁律（写调用代码前逐条对照）

沿用三步验证法：① 打开原始文档阅读 ② 拿到可工作的 curl/Postman 示例 ③ 逐字段对照代码实现。

| 项 | 值 |
|----|-----|
| API 站点 | `http://{主机}/SunReport`（⚠️ 2026-09-30 由 ERPAPI 迁至 SunReport，仅前缀变化；主机已确认 localhost） |
| 登录端点 | `POST {站点}/auth/login`，字段 `COMPNO`/`USR`/`PWD`/`LANG_ID`/`SYS_TYPE`，COMPNO 不带 `/########` 后缀；PWD 可为空字符串（内网部署） |
| Token 路径 | `response.data.TOKEN`；data 只有 TOKEN/EXPIRES_IN/EXPIRES_TIMESTAMP 三字段（EXPIRES_IN 单位秒；EXPIRES_TIMESTAMP 为 Unix 秒） |
| 认证 | `Authorization: Bearer {TOKEN}` |
| 报表端点 | `POST {站点}/api/{相对路径}`（相对路径不再带 `api/` 前缀） |
| 成功判断 | **`response.code === 0`**，不是 HTTP 200、不是 `response.ok` |
| 请求体 | `{ PGM, SEARCH_INFO: [...], DISPLAY_FIELDS }`，SEARCH_INFO 按索引固定顺序；空筛选传 `""` 不传 null |
| 错误码 | 10001 通用业务错（message 不可靠）；20001/20004 认证失效（重登重试一次） |
| 端点大小写 | 文档不可信，实测为准 |
| 分页 | 服务端无视 offset 的 start → 取全量 `[0, 5000]` |
| 响应列 | `REPORT__TAB` 列名以 ERP **实际返回**为准，不以请求的 DISPLAY_FIELDS 为准（实测：请求 28 列、返回 29 列不同名）→ 结果加工用 `Object.keys(rows[0])` 自适应 |

## 模块完成自检（每个工具/模块完成后追问）

1. 输入为空/超大/乱码 → 会怎样？
2. 网络断了/超时/Token 过期 → 会怎样？
3. 有另一条路径能到达这里吗 → 也覆盖了吗？

## 可复用素材

- 技能 `sunlike-erp-api`（`C:\Users\Administrator\.claude\skills\sunlike-erp-api\`）— 登录/Token 缓存的 Node.js 模板与陷阱清单
- AsCoding 项目 `D:\VibeCoding\AsCoding\js\` — 请求构造与 SSE 解析的实战参考（reports.js / api.js）

## 技术环境备注

- Node v24.14.0；`@modelcontextprotocol/sdk@1.30.1`、`zod@4.6.5`（已装）
- ⚠️ SDK 1.30.1 发布包**缺根入口文件**（npm 官方包问题，`@modelcontextprotocol/sdk` 根导入报 ERR_MODULE_NOT_FOUND）→ 一律用**子路径导入**：`@modelcontextprotocol/sdk/server/mcp.js`、`@modelcontextprotocol/sdk/server/stdio.js`（2026-09-24 实测可用）
- ⚠️ `claude mcp add` 作用域实测（2026-10-08）：`-s local`（默认）写入用户级 `~/.claude.json` 按项目路径归档；`-s project` 才写项目内 `.mcp.json`（团队共享可提交）；`-s user` 全局生效。注册后需新开会话才加载工具。
- ⚠️ Claude Desktop 注册 MCP（2026-10-15 实测）：配置在 `%APPDATA%\Claude\claude_desktop_config.json` 的 `mcpServers` 键——command=node 绝对路径 / args=server/index.js / env 块传 ERP_BASE_URL+ERP_COMPNO+ERP_USR+ERP_PWD（账号走环境变量不进代码）。**改前必须完全退出 Desktop**（托盘右键 Quit；关窗口≠退出，它退出时回写配置会覆盖手工修改——实测两次正常退出未成后拍板命令结束进程）。本机已注册 erp-mcp 并实测自然语言查 ERP 成功
- ⚠️ PowerShell 5.1 给原生程序传含双引号的参数会搅坏引号（`curl.exe -d '{JSON}'` 实测：ERP 报 10001「Value cannot be null」，同样请求 Git Bash curl / Node fetch 成功）→ 发 JSON 请求用 Git Bash 的 curl、Node fetch 或 Invoke-RestMethod，别用 PowerShell + curl.exe（2026-10-08 实测）
- ⚠️ 本机 ERP（IIS）有冷启动习性：重启/闲置后首个请求预热可能 >10s → 首次调用报 NETWORK 错误属正常，稍后重试即可（错误信息已带行动建议）；超时兜底登录 10s / 报表 12s（2026-10-09 实测）；**并发打冷后端 = 全员超时**（2026-10-12 实测：冒烟 5 工具连发全撞预热窗口，单发 curl 捂热后同代码全过）→ 遇「全炸」先对照实验，别急着怀疑代码
- ⚠️ **AccBook/GetList 当前返回空数据**（2026-10-12 实测）：`code 0 + data:{}`，请求体与文档逐字段一致——后端清单接口疑似部署不完整。但总账模块健康：GetReportStream 用 `BOOK_NO=00000000` 直查正常出数（2026-08 期间 12 行）→ **「清单空 ≠ 未启用总账」**，工具文案按此口径（报告「ERP 未返回数据」，不断言「未启用」）
- ⚠️ 2026-10-12 用户报告**后端 API 版本有状况**：accgl 流式端点当前执行报错 → 阶段 5 的 Inspector 实测按用户决定豁免（此前冒烟出 12 行真数据为后端变更前证据）；accgl 代码保留，后端稳定后补测
- ⚠️ 2026-10-14 用户报告**后端 API 已升级**：修复多个问题，accgl 恢复可用（未实测复核）→ 上述 AccBook 空 data / accgl 报错两条怪象可能已翻篇；阶段 5 Inspector 豁免可随时撤销补测
- ⚠️ **ERP 后端对并发登录敏感**（2026-10-09 实测）：并发登录请求会撞坏 .NET 内部非并发集合 → 10001「concurrent update … corrupted its state」，且**进程内状态持久损坏**（此后单发请求也全炸）→ 恢复只能回收应用池：本机站点在 Default Web Site 下，池名 `AppPool_SunReport`，`Restart-WebAppPool -Name 'AppPool_SunReport'`。服务端认证层已内置单飞（single-flight）保护，同一时刻最多一个登录请求
- ⚠️ HTTP 入口（server/http.js，阶段 6 起）：端口 `ERP_MCP_PORT`（默认 3000），单端点 `POST /mcp`；无状态模式（每请求一临时 transport，多客户端共享同一 Token 缓存）；CORS 已放开（浏览器前端前提）。Git Bash curl -d 传中文会搅坏字节（2026-10-14 实测），浏览器前端不受影响
- ⚠️ Streamable HTTP 无状态模式必须**每请求新建 McpServer**（2026-10-14 Inspector 实测踩坑）：共享一个 McpServer 时，浏览器连接复用（keep-alive）会让第二个请求撞「Already connected … use a separate Protocol instance」炸进程——curl 六连没暴露是因为 curl 每次开新连接、用完即断。http.js 现每请求现场 new McpServer + registerTools（纯内存操作，Token 缓存仍在模块级共享），并有 try/catch 兜底（意外回 -32603，不炸进程）
- ⚠️ 前端（frontend/，阶段 7/8 起）：零构建静态页——index.html 调试面板、chat.html AI 对话（DeepSeek deepseek-chat，非思考模型），双击即开；共享内核 mcp-client.js（Accept 头教训在码内）。**凭据约定：LLM API key 只存浏览器 localStorage，绝不写入代码文件或文档**——用户提供过的 key 建议用后重置（2026-10-15 约定）
- ⚠️ 项目已推送 GitHub（2026-10-15，Round 19）：仓库 https://github.com/ksmingkimo/mcp（public，用户手动建仓）；本地 main 跟踪 origin/main；文档中 AT01/SAN 为演示账号（用户澄清，无脱敏要求）；.gitignore 排除 node_modules/.env*（新增文档后先 commit 再 push）
