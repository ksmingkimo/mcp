// frontend/chat.js — AI 对话（阶段 8 的灵魂）：LLM 驱动工具调用循环
//
// 核心概念：模型自己不会执行任何工具——它只会「开口点菜」，
// 真正动手执行工具的是前端（也就是这里）。循环长这样：
//   你问 → [消息 + 6 个工具说明书] 发给模型
//        → 模型回 tool_calls（「我要调 erp_report_invso，参数…」）
//        → 前端用 McpClient.rpc 执行（阶段 7 的内核原样复用）
//        → 结果以 role:"tool" 回填 → 再发给模型 → 直到它说出人话为止

const LLM_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat"; // 非思考版——「thinking 禁用」靠选型天然满足
const KEY_STORAGE = "deepseek_api_key";
const SYSTEM_PROMPT =
  "你是 ERP 数据助手。用中文回答，回答必须基于工具返回的真实数据；" +
  "工具报错或没数据时，如实转述并给出可尝试的建议。";

let messages = []; // 消息数组常驻内存：用户问 / 模型答 / 工具结果回填，全量发送所以连续追问有上下文
let llmTools = []; // 工具说明书翻译成 OpenAI 的 tools 格式

// —————— 页面元素 ——————
const logEl = document.getElementById("chatLog");
const inputEl = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const keyEl = document.getElementById("apiKey");
const statusEl = document.getElementById("connStatus");

// —————— API Key：只存本机浏览器 localStorage，绝不写进任何文件 ——————
keyEl.value = localStorage.getItem(KEY_STORAGE) || "";
keyEl.oninput = () => {
  localStorage.setItem(KEY_STORAGE, keyEl.value.trim());
  sendBtn.disabled = !keyEl.value.trim() || !connected;
};
keyEl.type = "password";

let connected = false;

// —————— 开局：MCP 握手 → 问菜单 → 说明书翻译成模型的 tools 格式 ——————
async function setup() {
  try {
    const info = await McpClient.connect();
    const mcpTools = await McpClient.listTools();
    // 同一份说明书三种吃法：Inspector 吃、调试面板表单吃、大模型 tools 参数吃
    llmTools = mcpTools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    connected = true;
    sendBtn.disabled = !keyEl.value.trim();
    statusEl.textContent = "已连接 " + info.serverInfo.name + " · " + mcpTools.length + " 个工具";
    statusEl.className = "conn-ok";
    addSystemCard("准备就绪。示例问题：「特斯拉 8 月的受订单有多少？」");
  } catch (err) {
    statusEl.textContent = "MCP 连接失败（" + err.message + "）——请先启动 node server/http.js 后刷新页面";
    statusEl.className = "conn-fail";
  }
}

// —————— 消息区渲染 ——————
function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

// 工具调用过程卡片：把循环过程摆到明面上（白盒理念）
function addToolCard(name, argsText, status, resultText) {
  const card = document.createElement("div");
  card.className = "tool-card " + status;
  card.innerHTML =
    "<div class='tool-card-head'>🤖 工具调用：" + escapeHtml(name) +
    (argsText ? " <span class='tool-args'>" + escapeHtml(argsText) + "</span>" : "") + "</div>" +
    // body 无条件创建：结果回填时直接写它（踩坑：曾按需创建，成功路径写空引用炸过）
    "<div class='tool-card-body'>" + escapeHtml(resultText || "") + "</div>";
  logEl.appendChild(card);
  logEl.scrollTop = logEl.scrollHeight;
  return card;
}

function addSystemCard(text) {
  const div = document.createElement("div");
  div.className = "system-card";
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

// —————— 与 DeepSeek 的一轮对话（OpenAI 兼容格式）——————
async function askLlm() {
  const resp = await fetch(LLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + keyEl.value.trim(),
    },
    body: JSON.stringify({ model: MODEL, messages, tools: llmTools }),
  });

  if (resp.status === 401) {
    throw new Error("API Key 无效（401）——请检查粘贴的 key 是否完整");
  }
  if (!resp.ok) {
    throw new Error("模型接口 HTTP " + resp.status + "：" + (await resp.text()).slice(0, 300));
  }
  const data = await resp.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("模型返回异常：" + JSON.stringify(data).slice(0, 300));
  return msg;
}

// —————— 工具调用循环：调完一轮再来一轮，直到模型说人话 ——————
async function send() {
  const text = inputEl.value.trim();
  if (!text || !connected || !keyEl.value.trim()) return;
  inputEl.value = "";
  sendBtn.disabled = true;
  addBubble("user", text);
  messages.push({ role: "user", content: text });

  try {
    for (let round = 0; round < 10; round++) {
      // 10 轮上限：防止模型「想一直点菜」把循环变成无底洞（自检三问之兜底）
      const msg = await askLlm();
      messages.push(msg); // assistant 消息进历史（含 tool_calls 或正文）

      if (msg.tool_calls?.length) {
        // 模型点了菜 → 前端替它执行。
        // 串行执行：ERP 后端对并发敏感（登录撞坏应用池的教训），一个接一个最稳
        for (const tc of msg.tool_calls) {
          const args = tc.function.arguments;
          const card = addToolCard(tc.function.name, args, "running");
          const head = card.querySelector(".tool-card-head");
          const body = card.querySelector(".tool-card-body");
          let toolResult;
          try {
            const result = await McpClient.rpc("tools/call", {
              name: tc.function.name,
              arguments: JSON.parse(args),
            });
            toolResult = JSON.stringify(result);
            const summary = summarize(result);
            if (result.isError) {
              // 工具正常返回但自带 isError（业务层错误，如 ERP 冷启动超时）：
              // 如实标 ⚠️ 显示真实原因，不冒充「前端执行失败」
              card.classList.replace("running", "fail");
              head.textContent += " ⚠️ " + summary;
            } else {
              card.classList.replace("running", "ok");
              head.textContent += " ✅ " + summary;
            }
            body.textContent = summary;
          } catch (err) {
            toolResult = JSON.stringify({ error: err.message });
            card.classList.replace("running", "fail");
            head.textContent += " ❌ 执行失败：" + err.message;
          }
          // 结果以「工具」角色回填给模型，tool_call_id 要一一对应
          messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        }
        continue; // 再问模型一轮：看完结果它可能再点菜，也可能开始作答
      }

      if (msg.content) addBubble("ai", msg.content);
      else addBubble("ai", "（模型没有输出文字内容）");
      break;
    }
  } catch (err) {
    addBubble("ai", "出错了：" + err.message);
  } finally {
    sendBtn.disabled = false;
  }
}

// 把 MCP 结果压成一句话摘要，让过程卡片一眼可读
function summarize(result) {
  const texts = (result.content || []).filter((c) => c.type === "text").map((c) => c.text);
  const text = texts.join("\n");
  if (result.isError) return "工具返回错误：" + text;
  return text.slice(0, 300) || "（无文本内容）";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// —————— 启动 ——————
messages.push({ role: "system", content: SYSTEM_PROMPT });
sendBtn.onclick = send;
inputEl.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
};
setup();
