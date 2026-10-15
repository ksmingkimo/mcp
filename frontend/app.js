// frontend/app.js — 手写 MCP 客户端（阶段 7 的灵魂）
//
// 概念回顾：客户端总共就干三件事——initialize 握手 / tools/list 问菜单 /
// tools/call 点菜。阶段 8 起，这三件事的「发请求内核」抽到了 mcp-client.js
// （McpClient.rpc），本页与 chat.html 共用同一份——改协议细节只改一处。
// 本页只留调试面板自己的活：schema 驱动表单、调用、结果渲染。

let tools = [];          // tools/list 拿到的工具清单
let currentTool = null;  // 左侧当前选中的工具
let inputEls = {};       // 表单控件登记表：参数名 → DOM 元素

// —————— 三件事之一：initialize 握手 ——————
async function connect() {
  const status = document.getElementById("connStatus");
  try {
    const result = await McpClient.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "erp-mcp-debug-panel", version: "1.0.0" },
    });
    status.textContent =
      "已连接 " + result.serverInfo.name + " v" + result.serverInfo.version +
      "（" + MCP_URL + "）";
    status.className = "conn-ok";
    return true;
  } catch (err) {
    status.textContent = "连不上服务器（" + err.message + "）——请先在项目目录跑：" +
      "node server/http.js";
    status.className = "conn-fail";
    return false;
  }
}

// —————— 三件事之二：tools/list 问菜单 ——————
async function loadTools() {
  const listEl = document.getElementById("toolList");
  try {
    const result = await McpClient.rpc("tools/list");
    tools = result.tools;
    listEl.innerHTML = "";
    for (const tool of tools) {
      const btn = document.createElement("button");
      btn.className = "tool-item";
      btn.textContent = tool.name;
      btn.onclick = () => selectTool(tool, btn);
      listEl.appendChild(btn);
    }
    // 默认选中第一个，页面开箱即用
    selectTool(tools[0], listEl.firstChild);
  } catch (err) {
    listEl.innerHTML = '<p class="hint">加载工具失败：' + escapeHtml(err.message) + "</p>";
  }
}

// —————— schema 驱动表单：读工具的参数说明书，自动生成输入框 ——————
// 好处：后端以后加第 7 个工具，这里一行不改，表单自动出现
function selectTool(tool, btn) {
  currentTool = tool;
  document.querySelectorAll(".tool-item").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  document.getElementById("toolInfo").innerHTML =
    "<h2>" + escapeHtml(tool.name) + "</h2>" +
    '<p class="desc">' + escapeHtml(tool.description || "（无描述）") + "</p>";

  renderForm(tool);
  document.getElementById("result").innerHTML = "";
}

function renderForm(tool) {
  const form = document.getElementById("paramForm");
  const callBtn = document.getElementById("callBtn");
  inputEls = {};
  form.innerHTML = "";

  const schema = tool.inputSchema || {};
  const props = schema.properties || {};
  const required = schema.required || [];
  const names = Object.keys(props);

  if (names.length === 0) {
    form.innerHTML = '<p class="hint">本工具没有参数，可直接调用。</p>';
    callBtn.disabled = false;
    return;
  }

  for (const name of names) {
    const spec = props[name];
    const isRequired = required.includes(name);
    const row = document.createElement("div");
    row.className = "form-row";

    // 标签：参数名 + 必填红星；参数说明显示在小字提示里
    const label = document.createElement("label");
    label.innerHTML = escapeHtml(name) + (isRequired ? ' <span class="req">*</span>' : "");
    row.appendChild(label);

    let el;
    if (spec.enum && spec.enum.length) {
      // 有限取值 → 下拉框（比文本框更防呆）
      el = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "（不填）";
      el.appendChild(empty);
      for (const v of spec.enum) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        el.appendChild(opt);
      }
    } else if (spec.type === "number" || spec.type === "integer") {
      el = document.createElement("input");
      el.type = "number";
    } else if (spec.type === "boolean") {
      el = document.createElement("input");
      el.type = "checkbox";
      el.dataset.kind = "boolean";
    } else {
      el = document.createElement("input");
      el.type = "text";
      el.placeholder = "可留空";
    }
    el.dataset.kind = el.dataset.kind || (spec.type === "number" || spec.type === "integer" ? "number" : "string");
    row.appendChild(el);
    inputEls[name] = el;

    if (spec.description) {
      const hint = document.createElement("div");
      hint.className = "hint-text";
      hint.textContent = spec.description;
      row.appendChild(hint);
    }
    form.appendChild(row);
  }

  callBtn.disabled = false;
}

// 收集表单 → arguments 对象：留空的参数干脆不放进 arguments（对应 schema 的 optional）
function collectArgs() {
  const args = {};
  for (const [name, el] of Object.entries(inputEls)) {
    if (el.dataset.kind === "boolean") {
      args[name] = el.checked;
    } else if (el.dataset.kind === "number") {
      if (el.value !== "") args[name] = Number(el.value);
    } else if (el.value !== "") {
      args[name] = el.value;
    }
  }
  return args;
}

// —————— 三件事之三：tools/call 点菜 ——————
async function callTool() {
  if (!currentTool) return;
  const resultEl = document.getElementById("result");
  const callBtn = document.getElementById("callBtn");

  // 必填校验：红星参数留空就拦下
  const required = (currentTool.inputSchema?.required) || [];
  for (const name of required) {
    const el = inputEls[name];
    if (el && el.value === "") {
      resultEl.innerHTML = '<div class="result-box error"><h3>参数不完整</h3><p>必填参数 ' +
        escapeHtml(name) + " 不能为空</p></div>";
      return;
    }
  }

  callBtn.disabled = true;
  resultEl.innerHTML =
    '<div class="waiting">调用中… 本机 ERP 有冷启动习性，首次调用可能要 10 秒以上，请耐心等待。</div>';

  try {
    const result = await rpc("tools/call", {
      name: currentTool.name,
      arguments: collectArgs(),
    });
    renderResult(result);
  } catch (err) {
    resultEl.innerHTML =
      '<div class="result-box error"><h3>调用失败</h3><p>' + escapeHtml(err.message) + "</p></div>";
  } finally {
    callBtn.disabled = false;
  }
}

// —————— 结果展示：MCP 工具返回 content 数组 + 可选 isError ——————
function renderResult(result) {
  const resultEl = document.getElementById("result");
  if (result.isError) {
    resultEl.innerHTML = '<div class="result-box error"><h3>工具返回错误</h3></div>';
  } else {
    resultEl.innerHTML = '<div class="result-box"><h3>调用成功</h3></div>';
  }
  const box = resultEl.firstChild;

  // content 是一个数组：文本内容按「块」排列，一般只有一块 type=text 的 markdown
  for (const item of result.content || []) {
    if (item.type === "text") {
      box.appendChild(renderMiniMarkdown(item.text));
    } else {
      const p = document.createElement("p");
      p.textContent = "（" + item.type + " 类型内容：" + JSON.stringify(item).slice(0, 500) + "）";
      box.appendChild(p);
    }
  }
}

// —————— 迷你 markdown 渲染：只处理服务端会用到的几种形态 ——————
// 服务端返回格式固定：# 标题 / 普通段落 / | 表格 / - 列表。渲染成真 DOM，
// 比 <pre> 原样堆文本更像「产物」；其余行原样保留。
function renderMiniMarkdown(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text).split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("|")) {
      // 表格块：连续的 | 行，第二行是 |---|---| 分隔线
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith("|")) tableLines.push(lines[i++]);
      if (tableLines.length >= 2) {
        frag.appendChild(buildTable(tableLines));
        continue;
      }
    }
    if (line.startsWith("# ")) {
      const h = document.createElement("h4");
      h.textContent = line.slice(2);
      frag.appendChild(h);
      i++;
      continue;
    }
    if (line.trim().startsWith("- ")) {
      const ul = document.createElement("ul");
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        const li = document.createElement("li");
        li.textContent = lines[i].trim().slice(2);
        ul.appendChild(li);
        i++;
      }
      frag.appendChild(ul);
      continue;
    }
    if (line.trim() !== "") {
      const p = document.createElement("p");
      p.textContent = line;
      frag.appendChild(p);
    }
    i++;
  }
  return frag;
}

function buildTable(tableLines) {
  const table = document.createElement("table");
  const rows = tableLines.map((l) =>
    l.slice(1, -1).split("|").map((c) => c.trim())
  );
  const isSep = (row) => row.every((c) => /^:?-{2,}:?$/.test(c));

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  for (const c of rows[0]) {
    const th = document.createElement("th");
    th.textContent = c;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows.slice(1)) {
    if (isSep(row)) continue; // 跳过 |---|---| 分隔线
    const tr = document.createElement("tr");
    for (const c of row) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// —————— 启动：握手 → 问菜单（标准客户端开局两步）——————
document.getElementById("callBtn").onclick = callTool;
(async () => {
  if (await connect()) {
    await loadTools();
  }
})();
