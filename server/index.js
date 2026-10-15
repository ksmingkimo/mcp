// server/index.js — MCP 服务入口①：stdio 传输（阶段 1 起）
//
// 本文件只做三件事：
//   1) 创建 MCP Server，自报家门（握手时客户端会收到这些信息）
//   2) 调 registerTools 注册全部工具（与 http.js 共用同一份注册，行为一致）
//   3) 挂上 stdio 传输，开始等待客户端消息
//
// ⚠️ 大坑预警：stdio 传输下，stdout 是「协议专用通道」——服务器靠它把 JSON-RPC
// 响应回给客户端。往 stdout 写任何别的东西（最典型的就是 console.log）都会污染
// 协议流、让客户端解析失败。所以本服务的日志一律用 console.error（走 stderr）。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer({
  name: "erp-mcp", // 服务身份
  version: "0.1.0", // 版本号
});

registerTools(server); // 工具注册与传输解耦：同一份注册，两种接法（stdio / HTTP）

// 挂上 stdio 传输：进程的标准输入/输出从此成为 MCP 协议通道。
// 没有端口、没有 URL——客户端是通过「拉起子进程」的方式启动本文件的。
const transport = new StdioServerTransport();
await server.connect(transport);

// 走到这里进程不退出：server 一直运行，等待客户端发来的 JSON-RPC 消息。
console.error("[erp-mcp] 已启动，等待客户端连接（stdio 模式）");
