// server/http.js — MCP 服务入口②：Streamable HTTP 传输（阶段 6）
//
// 与 index.js 的差别只有传输：同一批工具（tools.js），这里挂网络接口。
// 概念要点：
//   - 单端点：所有 JSON-RPC 都打到 /mcp（2025-03-26 规范改版后的 Streamable HTTP）
//   - 无状态（stateless）：每个请求一个临时 transport，服务端不管理会话——
//     多个客户端连同一个进程，共享同一份 Token 缓存（登录一次大家用）
//   - JSON 响应模式（enableJsonResponse）：普通请求直接回 application/json，
//     不用 SSE 包裹（SSE 响应留给真正长任务的场景；我们的工具都是短任务）
//   - CORS：浏览器前端（阶段 7/8）跨源访问的前提——「网络门」比「进程管道」
//     多出来的这层门卫必须开门

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";

const PORT = Number(process.env.ERP_MCP_PORT || 3000);

const httpServer = createServer(async (req, res) => {
  // —— CORS 三件套：浏览器 preflight 会先发 OPTIONS 问「让不让跨源」——
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Last-Event-Id, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 只有 /mcp 一个端点，其余路径一律 404（单端点设计的体现）
  if (new URL(req.url || "/", `http://${req.headers.host}`).pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("MCP 端点在 /mcp");
    return;
  }

  // 读请求体；GET 无 body（无状态模式下 transport 会回 405——规范行为）
  let body;
  if (req.method === "POST" || req.method === "DELETE") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf-8");
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // 自检三问之「乱码」：坏 JSON 回标准 -32700 解析错误，不崩服务
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error：请求体不是合法 JSON" },
          id: null,
        })
      );
      return;
    }
  }

  // 无状态：每个请求 = 一套全新的 McpServer + transport（2026-10-14 踩坑：
  // 共享一个 McpServer 时，浏览器复用连接导致第二个请求撞上「Already
  // connected」炸进程——curl 六连没暴露，是因为 curl 每次开新连接、用完即断）
  // 工具注册是纯内存操作，每次重建成本可忽略；Token 缓存在 erp-client
  // 模块级变量里，不随 McpServer 重建而丢——登录状态仍是全进程共享的
  try {
    const mcpServer = new McpServer({ name: "erp-mcp", version: "0.1.0" });
    registerTools(mcpServer); // 与 stdio 入口同一份注册
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // undefined = 不启用会话管理（无状态服务器）
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    // 自检三问兜底：任何意外都不许炸整个进程，只回标准 JSON-RPC 内部错误
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error: " + err.message },
          id: null,
        })
      );
    }
    console.error("[erp-mcp] 请求处理失败：", err);
  }
});

httpServer.listen(PORT, () => {
  console.error(`[erp-mcp] HTTP 入口已启动：http://localhost:${PORT}/mcp（Streamable HTTP）`);
});
