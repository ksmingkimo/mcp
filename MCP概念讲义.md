# MCP 概念讲义

> 阶段 0 学习材料（2026-09-24）。本文件是「讲给人看」的概念讲义，可反复阅读；后续各阶段的讲义也追加到本文件。
> 项目：把 Sunlike ERP 报表 API 包装成 MCP 服务 + 调用前端。

---

## 一、一句话认识 MCP

**MCP（Model Context Protocol，模型上下文协议）是一个开放标准，规定 AI 应用如何发现、调用外部世界提供的工具和数据。**

- 由 Anthropic 于 2024 年 11 月发布，已发展为行业事实标准
- 它不实现任何 AI 能力，只管「AI 和外部工具之间怎么对话」
- 对标「HTTP 之于网页」：HTTP 规定浏览器和服务器怎么对话，MCP 规定 AI 和工具怎么对话

## 二、背景：AI 的孤岛问题

大模型本身只会「根据训练知识推理」，它：
- 不能查你的 ERP 数据
- 不能访问你的文件
- 不会用你的内部系统

要让 AI 做事，必须把外部能力「喂」给它。在 MCP 之前，每接一个系统都要写定制胶水代码：连 ERP 写一套、连数据库写一套、连日历再写一套；而且每个 AI 应用（Claude、Cursor、自己写的）都要各写一遍。

## 三、MCP 解决的数学：M×N → M+N

- 没有 MCP：3 个 AI 应用 × 4 个外部系统 = 12 套胶水代码
- 有了 MCP：4 个系统各做一个 MCP Server（4 套）+ 3 个应用各做一次 MCP Client 支持（3 套）= 7 套；以后加任何新系统/新应用，只加 1 套

这就是「AI 的 USB-C」比喻的来历：USB-C 统一了设备接口，MCP 统一了 AI 的外部能力接口。

## 四、三个角色：Host / Client / Server

```
┌──────────────────────────────┐
│ Host（AI 应用，如 Claude Code） │  ← 用户面对的东西
│   └─ Client（协议客户端组件）   │  ← Host 内部，负责和 Server 说协议话
└──────────┬───────────────────┘
           │ MCP 协议（JSON-RPC，走 stdio 或 HTTP）
┌──────────┴───────────────────┐
│ Server（能力提供方 = 本项目）   │  ← 把 ERP API 包装成工具暴露出来
└──────────────────────────────┘
```

- **Host**：承载 AI 的宿主应用（Claude Desktop、Claude Code、我们阶段 8 的自定义前端）
- **Client**：Host 内部与 Server 一一对应的连接组件，负责协议编解码
- **Server**：提供能力的一方。本项目的 MCP 服务就是 Server

> 关键认知：**Host 里住着 LLM，Server 里住着工具。MCP 是两者之间的桥。**

## 五、三种能力：Tools / Resources / Prompts

| 能力 | 语义 | 类比 | 本项目 |
|------|------|------|--------|
| **Tools** | 可执行的**动作** | 函数/API | 主角：查报表、登录 |
| **Resources** | 可**读取的数据** | 文件/URL | 后续可选：报表明细清单 |
| **Prompts** | 可复用的**提示词模板** | 快捷指令 | 后续可选：固定问法 |

- Tool：AI 说「调用它」，Server 执行并返回结果（模型可控制执行）
- Resource：AI 说「读它」，Server 返回内容（模型可控制读取）
- Prompt：AI 说「用它」，Server 返回提示词文本（用户控制）

## 六、协议本质：JSON-RPC 2.0

MCP 的消息层是 **JSON-RPC 2.0**：一段 JSON，表达「调用哪个方法、带什么参数」。

三类消息：
1. **请求（Request）**：有 id，期待一个响应
2. **响应（Response）**：带同 id 的 result 或 error
3. **通知（Notification）**：无 id，不期待响应（如日志、进度）

### 握手（initialize）——连接后的第一件事

```json
// Client → Server
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":"2025-06-18",
  "capabilities":{},
  "clientInfo":{"name":"inspector","version":"1.0"}}}
```

```json
// Server → Client
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":"2025-06-18",
  "capabilities":{"tools":{}},
  "serverInfo":{"name":"erp-mcp","version":"0.1.0"},
  "instructions":"这是 ERP 报表 MCP 服务"}}
```

### 发现工具（tools/list）

```json
// Client → Server
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

```json
// Server → Client（每个工具 = name + description + inputSchema）
{"jsonrpc":"2.0","id":2,"result":{"tools":[{
  "name":"erp_report_invso",
  "description":"查询受订报表（受订单）。支持按受订日期范围、客户代号、货品代号筛选。",
  "inputSchema":{"type":"object","properties":{"...":"..."}}
}]}}
```

### 调用工具（tools/call）

```json
// Client → Server
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name":"erp_report_invso",
  "arguments":{"dateFrom":"2026-08-01","dateTo":"2026-08-31"}}}
```

```json
// Server → Client（结果统一装在 content 数组里）
{"jsonrpc":"2.0","id":3,"result":{
  "content":[{"type":"text","text":"共查到 9 行数据：\n| 受订单号 | 客户 | ..."}],
  "isError":false}}
```

> 看到没？**MCP 的方法就这么几种**（initialize / tools/list / tools/call / ping 等）。协议本身简单，价值在「标准化」。

## 七、工具（Tool）解剖：name / description / inputSchema

一个 MCP 工具的完整定义只有三样东西：

1. **name**：机器标识（如 `erp_report_invso`）
2. **description**：给 AI 看的说明书。⚠️ **这是最关键的一行**——Host 会把所有工具的 name + description 塞进 LLM 的上下文，LLM 完全靠它决定「这个问题该不该调用这个工具、怎么传参」。写不好 description，AI 就会调错或不调
3. **inputSchema**：参数的 JSON Schema——类型、必填、取值范围。一方面给 AI 看（知道要传什么），一方面 Server 端用它校验（防脏参数）

```javascript
{
  name: "erp_report_invso",
  description: "查询受订报表（受订单）。支持按受订日期范围、客户代号、货品代号筛选。",
  inputSchema: {
    type: "object",
    properties: {
      dateFrom: { type: "string", description: "受订日期起，YYYY-MM-DD" },
      dateTo:   { type: "string", description: "受订日期止，YYYY-MM-DD" },
      cusNo:    { type: "string", description: "客户代号，空=全部" }
    },
    required: ["dateFrom", "dateTo"]
  }
}
```

## 八、一次完整调用的生命周期

```
1. Host 启动 → 拉起 Server 子进程（stdio）或连上 HTTP（阶段 6 起）
2. Client 发 initialize → 握手成功，互相通报版本和能力
3. Client 发 tools/list → 拿到 N 个工具的定义
4. 用户问话：「查一下 8 月特斯拉的受订单」
5. Host 把「用户问题 + N 个工具定义」一起发给 LLM
6. LLM 判断 → 输出「调用 erp_report_invso(dateFrom=2026-08-01, dateTo=2026-08-31, cusNo=C001)」
7. Host 收到这个决定 → 通过 Client 发 tools/call 给 Server
8. Server 执行（登录拿 Token → 拼 SEARCH_INFO → 调 ERP API → 校验 code===0）
9. Server 返回结果 → Host 把结果喂回 LLM → LLM 组织成人类语言回答
10.（如果 LLM 觉得信息不够，回到第 6 步继续调其他工具）
```

**关键认知**：LLM 不直接调工具——它只「决定」要调用什么；真正执行的是 Host 通过 MCP 发给 Server。这一步隔离，AI 就没有机会绕过协议直接碰你的系统。

## 九、两种传输：stdio 与 Streamable HTTP

MCP 的「消息」需要一条物理通道。两种主流：

| | stdio | Streamable HTTP |
|--|-------|-----------------|
| 通道 | 本机进程的标准输入/输出管道 | 网络（POST + SSE 响应流） |
| 连接方 | Host 把 Server 当子进程拉起来 | 任何能发 HTTP 的客户端 |
| 安全性 | 天然隔离，不对外开放 | 需要自己考虑鉴权/CORS |
| 典型场景 | Claude Desktop/Code 挂本地工具 | 团队共享服务、浏览器前端 |
| 本项目 | 阶段 1-5 | 阶段 6 起 |

**为什么浏览器连不了 stdio**：浏览器没有「拉起子进程、读它的标准输出」的能力——stdio 是操作系统进程之间的管道。要让网页前端调用 MCP 服务，Server 必须同时监听 HTTP（阶段 6）。好消息：**同一批工具可以同时挂在两种传输上**，SDK 支持。

## 十、本项目为什么要「包装」ERP API

ERP 原始 API 的「原生态」：
- 裸 HTTP：要自己记住 `/SunReport/auth/login`、`/SunReport/api/invso/getReport`（⚠️ 站点 2026-09-30 由 ERPAPI 迁至 SunReport）
- 怪异信封：错误也返回 HTTP 200，成功要看 `code === 0`
- 难懂结构：`SEARCH_INFO` 十个元素按索引排、空筛选传 `""`、端点大小写看实测
- 字段易错：`PWD` 不是 `PSW`、`COMPNO` 不带后缀

包装成 MCP 工具后，AI 看到的只有：
- 名字：`erp_report_invso`
- 一句话说明 + 三个参数

**项目经验总结里 63 轮踩的坑，全部被封装在 Server 内部**——AI 和未来任何客户端永远不需要知道 SEARCH_INFO 长什么样。这就是「包装」的价值：把复杂锁在门后，对外只留一个干净的门把手。

## 十一、本项目路线图与概念的对应

| 阶段 | 在学什么概念 |
|------|--------------|
| 1 最小 Server | Tools + stdio + JSON-RPC 全貌 |
| 2 登录工具 | 带副作用的工具 + 服务端状态（Token 缓存） |
| 3 getReport | 业务参数 → 请求体映射（包装的核心手艺） |
| 4 getList | 配置驱动：一套框架接多种报表 |
| 5 SSE 流式 | 工具返回最终结果；流是服务端内部事 |
| 6 HTTP 传输 | 传输层与工具层解耦 |
| 7 调试面板 | 亲手做 Client：握手/发现/调用 |
| 8 AI 对话 | Host 完整形态：LLM 决策 + 工具执行 |
| 9 收尾 | 能向别人讲清 MCP 是什么 |

## 十二、术语速查表

| 术语 | 一句话 |
|------|--------|
| MCP | AI 应用与外部工具之间的标准协议 |
| Host | 承载 AI 的应用（Claude Code 等） |
| Client | Host 内负责协议通信的组件 |
| Server | 暴露工具/资源/提示词的一方 |
| Tool | 可执行动作（name + description + inputSchema） |
| Resource | 可读取数据 |
| Prompt | 可复用提示词模板 |
| JSON-RPC 2.0 | MCP 的消息格式（请求/响应/通知） |
| initialize | 连接握手方法 |
| tools/list | 发现工具方法 |
| tools/call | 调用工具方法 |
| inputSchema | 工具参数的 JSON Schema 定义 |
| stdio | 本机进程管道传输 |
| Streamable HTTP | 网络传输（POST + SSE） |
| MCP Inspector | 官方的可视化调试工具（阶段 1 用） |

---

## 十三、阶段 2 讲义：登录工具 erp_login（2026-10-08）

### 1. 纯工具 vs 有副作用的工具

- echo：同样输入 → 同样输出，不改变任何状态（纯工具）
- erp_login：改变**两处**状态——远端 ERP 生成了会话、服务内存记住了 Token（副作用）
- 设计要点：AI 的调用行为不可预测（可能重复调、乱序调）→ 带副作用的工具必须「扛得住重复」；登录多调无害，再加缓存让重复调用变得便宜

### 2. inputSchema 的两面：说明书 + 运行时闸门

- 给 AI 看的那面：知道要传什么、什么可以省略
- 运行时的那面：zod 在处理函数执行**之前**真实拦截，缺必填参数时协议层直接报错，处理函数一行都不会执行
- 参数给默认值/可省略 → AI 少填少错，工具更好使（erp_login 零必填：AI 说「帮我登录 ERP」即可触发）

### 3. 服务端状态：常驻进程的内存 = 免费状态管理

- stdio 模式下服务是常驻进程，模块级变量在两次工具调用之间不消失 → Token 缓存不需要数据库、不需要文件
- 分工原则：**服务持状态、AI 拿结论**——Token 留在服务内部，AI 只收到「已登录，有效期至 X」
- 实现细节：`EXPIRES_TIMESTAMP`（Unix 秒，绝对时间）优先；提前 1 分钟判过期留安全余量

### 4. 错误报告：isError + 可读文本 + 业务码透传

- 处理函数里 catch 住失败 → 返回 `{ isError: true, content: [{ type: "text", text: "可读错误" }] }`，不 throw、不崩溃
- 错误文本把 ERP 业务错误码带进去（如「错误码 10001」）→ AI 能读、能转述给用户、能自己决定重试
- 呼应自检三问：断网/超时/错密码都要有可读结局（fetch 加 10 秒超时兜底，不让 AI 干等）

### 5. 配置外部化：环境变量注入

- 站点地址、账号密码走环境变量（ERP_BASE_URL / ERP_COMPNO / ERP_USR / ERP_PWD），代码只读不写死
- 换环境改配置不改代码；账号不进 git
- 工具参数全可选 = 配置兜底 + 传参覆盖（显式传错密码还能测失败路径）

### 阶段 2 实战踩坑（比概念更值钱）

1. **超时要分层**：外层（测试脚本的耐心）必须大于内层（服务内 fetch 兜底），否则内层的错误报告永远没机会出场——冒烟测试 5 秒耐心 vs 服务 10 秒兜底，撞上 ERP 应用池冷启动就翻车
2. **探测工具会撒谎**：PowerShell 5.1 + curl.exe 会把 JSON 里的双引号搅坏，造成「请求正确却被 ERP 拒绝」的假象——结果矛盾时先怀疑自己的工具，用 Git Bash curl / Node fetch 做对照实验
3. **站点会迁移**：参考文档 2026-09-30 更新过，站点从 ERPAPI 迁到 SunReport（仅前缀变化）——旧笔记会悄悄过时，写代码前必须重读文档

---

## 十四、阶段 3 讲义：getReport 工具——翻译层的手艺（2026-10-09）

### 1. 翻译层：两种语言之间的固定规则

AI 说的话（`查 8 月的特斯拉受订单`）和 ERP 听的暗号（`PGM + SEARCH_INFO 十格 + DISPLAY_FIELDS`）之间隔着一层**固定规则的翻译**：

| AI 参数 | 落到哪 | 规则 |
|---------|--------|------|
| `dateFrom`/`dateTo` | SEARCH_INFO[3] | 有值 → `operator:"range"`，`value` 是**数组**；无值 → `this_year` 默认今年 |
| `cusNo` | SEARCH_INFO[4] | `operator:"in"`，不传 → `value:""`（**空字符串，不是 null**） |
| `prdNo` | SEARCH_INFO[5] | 同上 |
| 排序 | SEARCH_INFO[9] | 固定按受订日期升序 |

其余格子（分页 [0,5000]、展示配置、fixCondition、DISPLAY_FIELDS）是**常量**，由工具代填——AI 永远不知道它们存在。63 轮踩坑攒下的暗号知识全部锁在翻译层里，对外只留 4 个友好参数。阶段 4 这层翻译会进化成「一只报表 = 一条配置」。

### 2. 自动登录与「重试一次」

- 报表工具**不调 erp_login**，内部走 `getToken()`：缓存有效直接用，无效静默重登——对 AI 完全透明
- 请求发出后若收到 20001/20004（凭证空/过期）→ 清缓存 → 重登 → **只重试一次**
- 为什么一次：两次都失败说明不是瞬时问题，再试就是死循环（活锁）。一次重试 = 「瞬时故障自动恢复」与「异常尽快暴露」的平衡线

### 3. 结果加工：决定 AI 答得好不好

- ERP 返回 `REPORT__TAB` 行对象数组 → 加工成「共 N 行 + markdown 表格」
- 分工口诀：**description 决定 AI 调不调；结果格式决定 AI 答得好不好**
- ⚠️ 实测新认知：**响应列名以 ERP 实际返回为准**（请求 28 列、返回 29 列不同名）→ 表头用 `Object.keys(rows[0])` 自适应，不硬编码
- 边界：行数达 5000 提示可能未取全，建议缩小日期范围

### 4. 空结果也是「结果」

- 筛选没填 → 请求体传 `""`（ERP 的规矩，null 会炸）
- 查到 0 行 → 明确说「共 0 行」+ 一句行动建议（放宽条件再试）
- 空结果对 AI 是有效信息：它正好用「0 行」回答用户「没有 8 月的受订单」

### 实战踩坑

1. **冷启动会复发**：ERP（IIS 应用池）闲置/重启后首个请求预热可能超过 10 秒兜底 → 报可读 NETWORK 错误、稍后重试即好。错误信息里带上行动建议（「若服务刚启动，可能正在预热」）比干巴巴的「超时」有用得多
2. **文档计数会不准**：文档写 displayFields 27 个实际 28 个——以 curl 示例为准
3. **分层的好处**：认证/重试/错误在 `erpPost`（通用层），SEARCH_INFO 翻译在 `reports/invso.js`（专用层）——阶段 4 配置驱动注册表直接复用前者

---

## 十五、阶段 4 讲义：配置驱动注册表 + 并发大坑（2026-10-09）

### 1. 同接口不同实现：mrppu 与 invso

从 MCP 工具角度一模一样（name/description/inputSchema → 表格），从 ERP 底层看是两种物种：

| | invso | mrppu |
|--|-------|-------|
| 端点 | `invso/getReport` | `mrppu/getList` |
| 请求体 | SEARCH_INFO 十格 + 顶层 DISPLAY_FIELDS | SEARCH_INFO 八格 + OTHERINFO + PAGE_INFO（**无** DISPLAY_FIELDS、**无** orderBy） |
| 分页 | [0] 的 offset | 顶层 PAGE_INFO（-1 = 取全量） |
| 响应 | `data.REPORT__TAB` | `data.TRANS` + 扁平 COLUMN_INFO |
| 日期 | OS_DD 范围/今年 | DATE_CST **单值年月**（equal） |

### 2. 配置驱动注册表：会变的写数据，不变的写一次

- 文件分工 = 概念的直接映射：`report-registry.js`（每只报表一条配置，纯数据）+ `report-engine.js`（通用引擎，加报表时零改动）
- 工具三要素不再手写：name/description/inputSchema/处理函数全部由配置拼出
- 阶段 4 的里程碑证据：**mrppu 零专属代码**——原计划的 `reports/mrppu.js` 被一条配置取代（交付物演进已记录）
- 配置地狱的边界线：只按「换一只报表会不会变」提成配置；SEARCH_INFO 格语义因报表而异 → 配置用 `dateCell`/`fixedCells`/`filterCells` 表达语义，不直接塞十格暗号

### 3. 并发是常态不是意外（今天最大的一课）

- 实测证据：冒烟测试三条 tools/call 连发 → 响应乱序返回（id 6 先于 4、5）→ **MCP 工具是并发执行的**
- Claude Code 也经常并行调多个工具——AI 的调用不仅「重复不可预测」，**时序也不可预测**
- 带副作用的工具既要「扛得住重复」（阶段 2），也要「扛得住并发」（阶段 4）

### 4. 单飞（single-flight）：并发共享同一个请求

```js
if (!loginInFlight) {
  loginInFlight = doLogin({}).finally(() => { loginInFlight = null; });
}
const result = await loginInFlight; // 其余调用者等同一个 promise
```

- 同一时刻最多一个登录请求在飞，其余调用者共享结果
- finally 里清空是关键：失败也清，否则后续调用永远等到同一个已拒绝的 promise

### 实战踩坑

1. **并发登录撞坏 ERP（坑 5）**：三个工具同时「要 Token」→ 三个并发登录 → ERP（.NET）内部非并发安全集合被并发修改 → 10001「collection corrupted」，且**进程内状态持久损坏**——之后单发请求也全炸，只能回收 IIS 应用池（本机池名 `AppPool_SunReport`，已记入 CLAUDE.md）。教训：自己的并发行为可能打坏上游，认证层必须内置并发保护
2. **「0 行」要对照实验**：mrppu 返回 0 行时不能想当然——可能是账套没数据，也可能是请求体构造 bug 让 ERP 返回空。Node 对照三种 dateCst 变体全 code=0 空 → 账套真无成本数据。实测为准铁律的又一次应验

---

## 十六、阶段 5 讲义：SSE 流式报表 + 依赖链（2026-10-12）

### 1. SSE 是什么

- SSE = Server-Sent Events：一条 HTTP 长连接，服务端**单向**持续推送
- 报文格式：每条消息一行 `data: {JSON}`，消息之间用空行分隔
- 与普通 JSON 响应的区别：一次请求 → 一条响应 vs 一次请求 → **一串事件**
- ERP 的用法：进度事件 PERCENT 0→100 一路推，**数据夹在中间的某条消息里**（实测：第二个 90% 消息的 DATA 里带 REPORT__TAB，100% 是纯结束消息）——所以「读完了 9 条消息」不等于「拿到了数据」，要按字段找

### 2. MCP 工具与流：流是服务端内部事

- MCP 的 tools/call 是**一次性请求-响应**：AI 发一次调用，拿一个结果
- 设计决策：服务端把流吃干抹净，返回聚合后的 markdown 表格；进度只进 stderr 日志
- 为什么：AI 的上下文里不需要 9 条进度消息，它需要「共 12 行」+ 表格。流式体验是给人看的界面问题，不是给 AI 的接口问题

### 3. 流式端点的三步判别（失败不走流）

流式端点失败时不会发流，而是别的形态，要按顺序判别：

1. **HTTP 状态**：`resp.ok` 失败 → HTTP 级错误（实测：BOOK_NO 空 → 406 空 body）
2. **Content-Type**：`application/json` → 普通错误信封（实测：Token 无效回 HTTP 200 + code 20004）→ 走认证失效重试
3. **text/event-stream** → 进入流解析

还有第四层：**错误藏在流里**——消息的 ERR 字段非空时要转成可读错误抛出，而不是傻等永远不来的数据。

### 4. 行缓冲：chunk 边界会切断一行

- HTTP 流是分块（chunk）到达的，chunk 边界可能切在一行中间
- 解法：读到换行才处理，**不完整行留在缓冲里等下一个 chunk**（`lines.pop()` 那一行）

### 5. 依赖链：工具喂工具

- 总账报表必须指定账簿 BOOK_NO → 先查账簿清单 → 用清单结果调报表（一个工具的输出是另一个工具的输入）
- 三个落地点：① description 里写清「先调谁、为什么」② bookNo 参数可选 ③ 不传时服务端自动兜底查清单取第一本
- **AI 的调用不可预测，依赖链必须给兜底**——不能假设 AI 一定按两步走

### 6. 占位符模板：一个期间派生整族字段

- 配置数据里 fixCondition 写 `@BOOK_NO`/`@PERIOD`/`@YEARS`/`@IPERIOD`/`@DATE_B`/`@DATE_E`/`@START_DD`
- 引擎按参数派生上下文（dateCst YYYY-MM → 年/月/首日/末日/起止时间戳）统一替换
- 手艺只写一次：文档第十一节还有 API5 七只流式报表（总账 3 + 制造 4），加报表时零引擎改动

### 7. 超时兜底：挂起模式是真实存在的

- 实测「无凭证 → HTTP 200 + 空 body **永久挂起**」——流式请求的超时兜底不是防御性编程，是唯一出路
- 超时分层不变：冒烟外层耐心（90s）必须大于服务内层兜底（60s）

### 实战踩坑

1. **冷启动 + 并发 = 全员超时**：5 个工具并发打冷后端，全部撞在预热窗口上超时——单发 curl 捂热后同代码全过。教训：冒烟测试本身就是并发测试；「全炸」也可能是环境冷，先对照实验再怀疑代码
2. **AccBook/GetList 返回 code 0 + data:{}**（后端清单接口部署不完整），但 GetReportStream 直查正常出数——「清单空 ≠ 没启用总账」。工具文案不能把 API 的异常当事实转述给 AI，要报告「ERP 未返回数据」+ 行动建议
3. **自检「超大」问出真 bug**：dateCst 正则 `\d{2}` 放行 9999-99 → 算出的 DATE_E 是「9999-99-31」这种滑稽值 → 收紧为 01-12 月。模块完成自检不是走过场

---

## 十七、阶段 6 讲义：Streamable HTTP 传输（2026-10-14）

### 1. 工具注册与传输解耦（本阶段最重要的架构动作）

- 之前 index.js 一手包办「创建 server + 注册工具 + 挂传输」；现在拆成三块：
  - `tools.js`：`registerTools(server)`——只管能力清单（6 个工具），不知道也不关心怎么连接
  - `index.js`：stdio 入口（进程管道，客户端拉起子进程）
  - `http.js`：HTTP 入口（网络接口，浏览器可连）
- 直接收益：加新传输时**业务代码一行不碰**——认证/重试/单飞/流式解析全部原样复用。这是前面五个阶段分层打下的地基回馈

### 2. Streamable HTTP：单端点 + 无状态

- 2025-03-26 规范改版：旧 HTTP+SSE（两个端点）→ **Streamable HTTP（单端点）**，所有 JSON-RPC 都 POST 到 `/mcp`
- **无状态模式**：`sessionIdGenerator: undefined` + 每个请求一个临时 transport——服务器不记得「你是谁」，多客户端连同一进程，共享同一份 Token 缓存（登录一次大家用）
- `enableJsonResponse: true`：普通请求直接回 application/json，不裹 SSE（SSE 响应留给真正长任务的场景；我们的流式报表是**服务端内部**的流，工具结果仍是普通 JSON）

### 3. CORS：网络门比进程管道多一层门卫

- stdio 没有「跨源」概念——管道两头就是一对进程
- 浏览器网页调 `http://localhost:3000/mcp` 属于跨源请求，浏览器先发 **OPTIONS preflight** 问「让不让」，服务端回 CORS 头 + 204 才算开门
- 三件套：`Access-Control-Allow-Origin / Methods / Headers`；阶段 7 前端能连的前提

### 4. 坏输入防御：门卫自己的铠甲

- 坏 JSON → 400 + 标准 -32700 Parse error（不崩服务）
- 其他路径 → 404（单端点的体现：除了 /mcp 哪都不通）
- GET（无状态模式下）→ transport 按规范回 405

### 实战踩坑

1. **stdio 的 EOF 即散场**：用管道 `printf | node index.js` 快检时 stdin 传完即关 → 进程退场、响应看不到。保持 stdin 打开（sleep）才正常——stdio 是「进程管道」的活生生演示：管道一断，会话即终
2. **Git Bash curl 传中文搅坏字节**：`curl -d` 里的中文到服务端已是乱码字节，echo 忠实回显（服务端无 bug）——Windows 控制台 + curl 的老毛病；浏览器前端（阶段 7）不受影响
3. **共享 McpServer 撞「Already connected」**（Round 15，Inspector 实测揪出）：一个 McpServer 同一时刻只能连一个 transport；浏览器连接复用（keep-alive：发完 initialize 不挂断、接着发 tools/list）让第二个请求撞上它，炸掉整个进程。curl 六连没暴露——curl 每次开新连接、用完即断。修复：无状态模式**每请求新建 McpServer + registerTools**（纯内存操作成本可忽略；Token 缓存在 erp-client 模块级变量，不受重建影响）+ 请求处理 try/catch 兜底（意外只回 -32603，不炸进程）。教训：同一件事换一条路径（curl → 浏览器）就能踩出不一样的坑——自检三问「另一条路径」的价值现场

---

## 十八、阶段 7 讲义：手写 MCP 客户端（2026-10-14）

### 1. 客户端总共就干三件事

| 事 | JSON-RPC 请求 | 说明 |
|----|--------------|------|
| 握手 | `initialize` | 自报家门（协议版本 + 客户端信息），服务器回 serverInfo |
| 问菜单 | `tools/list` | 拿到每个工具的 name / description / inputSchema |
| 点菜 | `tools/call` | `{name, arguments}` 执行工具，结果回 content 数组 |

之前这三件事都被 Inspector / Claude Code 包在壳里；阶段 7 亲手把它们写成三个 fetch。

### 2. 服务器把难的活干完了，客户端才有资格简单

- 阶段 6 的两个开关（**无状态** + **enableJsonResponse**）在这里兑现：每次调用 = 一个普通 `fetch POST`，发 JSON、收 JSON，不需要管理会话、不需要读 SSE 流
- 呼应阶段 5 那句话：流式进度是服务端内部的事——accgl 的 SSE 解析在服务器里完成，客户端拿到的已经是最终表格
- ⚠️ 但有一根线不能剪：请求头必须带 `Accept: application/json, text/event-stream`，缺了服务器回 -32000「Not Acceptable」（Round 15 的坑，教训直接写进前端代码）

### 3. schema 驱动表单：读说明书干活

- 每个工具的 inputSchema（JSON Schema 子集，zod 自动生成）就是「参数说明书」：有哪些参数、什么类型、必填吗、干什么用
- 前端代码读说明书自动生成表单：string → 文本框；number → 数字框；boolean → 勾选框；有 enum → 下拉框；required → 红星 + 提交校验；optional 留空 → 干脆不放进 arguments
- 与阶段 4 后端「配置驱动注册表」是一对：**后端加报表只加配置，前端加参数零改动**——工具再多，页面代码不膨胀

### 4. 结果与防御

- 工具结果 = content 数组（一般一块 `{type:"text", text: markdown}`）+ 可选 isError；服务端返回格式固定（标题/表格/列表），写了个几十行的迷你 markdown 渲染器把表格渲染成真 DOM
- `escapeHtml`：ERP 数据当文本处理，绝不当 HTML 拼接——防注入是基本礼貌
- 连接状态条：握手失败直接提示「先启动 node server/http.js」（常驻进程教训的落地）
- 冷启动提示：调用中显示「首次调用可能超 10 秒」，把 Round 3 的 ERP 脾气提前告知用户

### 5. 调试面板的定位

- 不是「重写一个 Inspector」——它是 AI 对话模式的**对照尺子**：以后对话答错了，人肉点一下同一工具，立刻分清是「模型蠢」还是「工具坏」
- file:// 双击打开可行：Origin 为 null 也在 `Allow-Origin: *` 的覆盖内，零构建体验成立

---

## 十九、阶段 8 讲义：AI 对话（LLM 驱动工具调用，2026-10-15）

### 1. MCP 的完整形态：模型也是「消费者」

- 阶段 7 的调式面板是**人**当消费者（人点按钮）；阶段 8 的**大模型**当消费者（模型点菜）
- 同一份工具说明书（inputSchema）三种吃法：Inspector 吃、表单渲染吃、模型的 `tools` 参数吃——「同一套工具契约，任何 Host 都能消费」的实物兑现
- 关键认知：**模型只负责「开口点菜」，真正动手执行工具的永远是前端代码**

### 2. tool_use 循环的骨架

- `messages` 数组全量发送（系统提示 + 用户话 + 模型答 + 工具结果回填），连续追问自带上下文
- 工具说明书翻译成 OpenAI tools 格式：`{type:"function", function:{name, description, parameters: inputSchema}}`——zod 的 describe() 就是写给模型的说明书
- 模型回 `tool_calls`（finish_reason: "tool_calls"）→ 前端逐个执行（**串行**：ERP 并发敏感）→ 结果以 `{role:"tool", tool_call_id}` 回填 → 再问模型 → 直到它说人话（stop）
- 防御：轮数上限（模型可能「想一直点菜」）、JSON.parse(args) 用 try/catch（模型在「造句」不是「填表」，会手滑）

### 3. 模型为什么能点对菜（三个机制）

1. **接话机器**：模型的本质是「预测下一段文字」；工具调用 = 训练时学会的一种「行话」——想用工具就输出严格 JSON 指令（function calling 训练/指令微调）
2. **语义匹配选工具**：用户的话 × 各工具的 description 比对——工具描述写糊了，模型就选错工具
3. **注意力机制 + 上下文学习**：生成每个字时都能回头扫视整个上下文；历史里出现过「C001↔特斯拉」（如一次全量查询的结果），下次说特斯拉就能现场翻到 C001——实测现场：第一问查不到 → 第二问全量 → 第三问「突然会了」。边界：知识不持久（新对话归零）、受窗口限制、必须真实出现在历史里

### 4. 实战踩坑

1. **UI 错误被当成工具失败回填**：chat.js 成功路径写一个按需创建的 DOM 元素 → 空引用炸 → catch 把「UI 崩了」当「工具失败」回填给模型 → 四个工具明明全成功，模型却被误导得出「ERP 整体异常」——**工具回填质量决定模型判断**。教训：工具结果回填是模型眼中的「现实」，前端自己的 bug 绝不能混进去
2. **模型猜年份不可靠**：「8 月」被猜成 2025（那年真 0 行）；问得越具体答得越准；模型也会发明多余参数（zod 剥未知键，无害）
3. **key 不进任何文件**：localStorage 存浏览器本地；已贴进聊天窗口的 key 建议用后重置
4. **thinking 禁用靠选型**：deepseek-chat 非思考版，天然满足
