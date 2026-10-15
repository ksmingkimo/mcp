// server/tools.js — 工具注册（阶段 6 抽出）
//
// 核心认知落地：工具注册和传输是两件事。本文件只管「能力清单」——
// 把一个 McpServer 该注册的工具全注册上（echo/erp_login/erp_list_books 手写，
// 报表工具由注册表循环生成）。用 stdio 还是 HTTP 连接，由入口文件决定，
// 与本文件无关——两个入口共用同一份注册，工具行为完全一致。
//
// 抽出的直接好处（阶段 6 之前的教训）：认证/重试/单飞/流式解析这些业务能力
// 全部原样复用，加新传输时一行业务代码都不用碰。

import { z } from "zod";
import { ensureLogin, erpPost } from "./erp-client.js";
import { REPORT_REGISTRY } from "./report-registry.js";
import { registerReportTool, buildBookListBody, toMarkdown } from "./report-engine.js";

export function registerTools(server) {
  // —— 工具 1：echo ——
  // 注册工具 = 讲义里的「工具三要素」+ 一个处理函数
  server.registerTool(
    "echo", // ① name：机器标识，客户端 tools/call 时用它指定调哪个工具
    {
      // ② description：给 AI 看的说明书——AI 完全靠它决定「什么时候该调这个工具、怎么传参」
      description:
        "回声工具：把你传入的话原样复读一遍。用于验证 MCP 最小闭环（发现工具 → 调用工具 → 拿到结果）。",
      // ③ inputSchema：参数定义。zod 一个库同时干两件事：定义参数 + 运行时校验
      inputSchema: {
        message: z.string().describe("想让我复读的话"),
      },
    },
    // 处理函数：客户端调用后在这里执行；入参是 SDK 校验过的参数，返回值有固定格式
    async ({ message }) => {
      return {
        content: [{ type: "text", text: `你说的是：${message}` }],
      };
    }
  );

  // —— 工具 2：erp_login ——
  // 阶段 2 的五个新概念都体现在这里：
  // - 有副作用：登录会改变远端会话 + 服务内存里的 Token 缓存
  // - 参数全部可选：账号在环境变量配置里，AI 说「帮我登录 ERP」即可零参数触发
  // - 失败时返回 isError + 可读文本（含 ERP 业务错误码），服务不崩溃
  server.registerTool(
    "erp_login",
    {
      description:
        "登录 Sunlike ERP 获取访问令牌。使用任何 ERP 报表工具之前先调用本工具。令牌由服务内部缓存并自动复用，重复调用无害；账号信息未显式传入时使用服务环境变量配置。",
      inputSchema: {
        compno: z.string().optional().describe("公司代号（不传则用服务配置）"),
        usr: z.string().optional().describe("用户代号（不传则用服务配置）"),
        pwd: z.string().optional().describe("密码（不传则用服务配置，可为空字符串）"),
        langId: z.string().optional().describe("语言标识，默认 zh-cn"),
        sysType: z.string().optional().describe("系统类型，默认 ERP"),
      },
    },
    async ({ compno, usr, pwd, langId, sysType }) => {
      try {
        const { expiresAt, fresh } = await ensureLogin({ compno, usr, pwd, langId, sysType });
        const until = new Date(expiresAt).toLocaleString();
        // 只报结论不吐 Token：Token 留在服务肚子里，AI 不需要也不会见到它
        return {
          content: [
            {
              type: "text",
              text: fresh
                ? `✅ 登录成功，访问令牌已缓存，有效期至 ${until}。`
                : `✅ 已登录（复用缓存令牌），有效期至 ${until}。`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `❌ 登录失败：${err.message}${err.code ? `（错误码 ${err.code}）` : ""}`,
            },
          ],
        };
      }
    }
  );

  // —— 工具 3：erp_list_books（阶段 5）——
  // 概念「依赖链」的前半环：总账报表必须指定账簿，本工具回答「账套有哪些账簿」。
  // 为什么手写不进注册表：它是「清单」不是「报表」——请求体固定、无筛选参数，
  // 结果是喂给另一个工具的参数；为抽象而进注册表就是配置地狱（边界感的体现）。
  server.registerTool(
    "erp_list_books",
    {
      description:
        "查询账套的账簿清单（BOOK_NO 与名称等）。总账报表必须指定账簿：用 erp_report_accgl_stream 查总分类账前，先调本工具查 BOOK_NO；不传 bookNo 时该报表会自动使用清单第一本。",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await erpPost("api/AccBook/GetList", buildBookListBody());
        const books = data.data?.ACC_BOOK_BS || []; // ⚠️ 响应键是 ACC_BOOK_BS，不是 REPORT__TAB
        if (!books.length) {
          // ⚠️ 2026-10-12 实测：清单空 ≠ 没启用总账——AccBook 端点返回 code 0 + 空 data，
          // 但 GetReportStream 用 BOOK_NO=00000000 正常出数（后端清单接口部署不完整）。
          // 文案必须诚实：说「ERP 未返回」，不说「账套未启用」。
          return {
            content: [
              {
                type: "text",
                text:
                  "✅ 账簿清单为空：ERP 未返回账簿数据（可能未启用总账，或后端清单接口异常）。" +
                  "erp_report_accgl_stream 不传 bookNo 的自动兜底因此不可用——如有已知账簿代号可直接传 bookNo 试试。",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `✅ 共 ${books.length} 本账簿：\n\n${toMarkdown(books)}`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `❌ 查询失败：${err.message}${err.code ? `（错误码 ${err.code}）` : ""}`,
            },
          ],
        };
      }
    }
  );

  // —— 报表工具：注册表驱动（阶段 4）——
  // 概念落地：每只报表一条配置（report-registry.js），这里循环生成工具。
  // 工具三要素不再手写——name/description/inputSchema/处理函数全由引擎按配置拼出。
  // 加第 40 只报表 = 加一条配置，这里一行不改。
  for (const cfg of REPORT_REGISTRY) {
    registerReportTool(server, cfg);
  }
}
