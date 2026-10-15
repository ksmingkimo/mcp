// frontend/mcp-client.js — MCP 客户端共享内核（阶段 8 抽出）
//
// 调试面板（app.js）和 AI 对话（chat.js）都要干的客户端三件事，收在这里一份：
//   initialize 握手 / tools/list 问菜单 / tools/call 点菜
// 服务器「无状态 + JSON 响应模式」的甜头在这兑现：每件事 = 一个普通 fetch POST。
// 挂到 window.McpClient 上，两个页面各自引用（零构建项目的共享方式）。

const MCP_URL = "http://localhost:3000/mcp";
let idCounter = 0;

async function rpc(method, params = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // ⚠️ Accept 必须同时接受两种格式，否则服务器回 -32000「Not Acceptable」
      // —— Round 15 用 curl 亲手撞过的坑，教训写进代码里
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idCounter, method, params }),
  });

  if (!res.ok) {
    throw new Error("HTTP " + res.status + "：" + (await res.text()).slice(0, 200));
  }

  const data = await res.json();
  if (data.error) {
    throw new Error("[" + data.error.code + "] " + data.error.message);
  }
  return data.result;
}

async function connect() {
  return rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "erp-mcp-frontend", version: "2.0.0" },
  });
}

async function listTools() {
  return (await rpc("tools/list")).tools;
}

window.McpClient = { rpc, connect, listTools };
