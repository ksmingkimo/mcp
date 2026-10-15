// server/smoke-test.mjs — 冒烟测试（假客户端）
//
// 用途：不经图形界面，从进程层面验证 MCP 服务正常工作。
// 做法：用子进程拉起 server/index.js，通过它的 stdin 发真实 JSON-RPC 消息，
//       从 stdout 读响应并打印出来。
// 以后每加一个新工具，跑一遍本脚本即可回归验证。
//
// 用法：node server/smoke-test.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));

// 拉起子进程：stdin/stdout 接管道（走协议），stderr 直接透传（server 的日志）
const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

// —— 协议侧解析：stdout 里每行是一条 JSON-RPC 消息 ——
let buffer = "";
const responses = [];
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

// 轮询等待下一条响应（超时视为失败；每类消息耐心不同）
// ⚠️ 外层的耐心必须大于服务内部兜底：erp_login 里 fetch 有 10 秒超时，
//    所以它的等待要放宽到 15 秒，否则会先于服务把进程杀掉、看不到错误报告。
function waitForResponse(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (responses.length) {
        clearInterval(timer);
        resolve(responses.shift());
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 20);
  });
}

// —— 按真实客户端的顺序发消息：握手 → 通知 → 发现工具 → 调用工具 ——
send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" }); // 通知：无 id，不期待响应
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "echo", arguments: { message: "你好 MCP！" } },
});
// 第 4、5、6 条：erp_login、erp_report_invso、erp_report_mrppu（不传参数 → 走环境变量配置）。
// 注意：这三条的结果取决于环境（是否配置了 ERP_COMPNO/USR/PWD、ERP 是否在线）——
// 成功或 isError 响应都算协议正常；本测试只验证「工具已注册且能应答」。
send({
  jsonrpc: "2.0", id: 4, method: "tools/call",
  params: { name: "erp_login", arguments: {} },
});
send({
  jsonrpc: "2.0", id: 5, method: "tools/call",
  params: { name: "erp_report_invso", arguments: {} },
});
send({
  jsonrpc: "2.0", id: 6, method: "tools/call",
  params: { name: "erp_report_mrppu", arguments: {} },
});
// 第 7、8 条（阶段 5）：erp_list_books、erp_report_accgl_stream。
// 第 8 条传 bookNo=00000000（探针实测该账簿存在、8 月有 12 行数据）→ 验证真实数据路径；
// 不传 bookNo 的自动兜底路径在另一跑验证过（清单空 → NO_BOOK 清晰报错、不挂起）。
send({
  jsonrpc: "2.0", id: 7, method: "tools/call",
  params: { name: "erp_list_books", arguments: {} },
});
send({
  jsonrpc: "2.0", id: 8, method: "tools/call",
  params: { name: "erp_report_accgl_stream", arguments: { bookNo: "00000000", dateCst: "2026-08" } },
});

// 期待 8 条响应（通知不算）；第 4-7 条放宽耐心，第 8 条流式最长——
// 外层耐心 90 秒必须大于服务内部流式兜底 60 秒（超时分层纪律）
const timeouts = [5000, 5000, 5000, 15000, 30000, 30000, 30000, 90000];
for (let i = 0; i < 8; i++) {
  const resp = await waitForResponse(timeouts[i]);
  if (!resp) {
    console.log(`[第 ${i + 1} 条响应] ⏱️ 超时——服务可能启动失败，看上方 stderr 日志`);
    break;
  }
  console.log(`===== 第 ${i + 1} 条响应 =====`);
  console.log(JSON.stringify(resp, null, 2));
}

child.kill();
console.log("[smoke-test] 结束");
