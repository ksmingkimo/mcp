// server/erp-client.js — ERP 客户端模块（阶段 2：登录 + Token 缓存）
//
// 职责：与 Sunlike ERP 的登录接口打交道，并把 Token 管起来。
// 这是阶段 2 五个概念里「配置外部化」「Token 缓存」「错误透传」三个的落地点。
//
// ⚠️ 站点历史：SunFusion → ERPAPI → SunReport（2026-09-30 起，仅前缀变化）。
// 当前站点以 SunReport 为准（见 CLAUDE.md ERP API 铁律 + API服务调用说明文档.md）。

// —— 概念 5：配置外部化 ——
// 代码只读环境变量，不写死任何账号。ERP_BASE_URL 给教学环境默认值；
// 账号（COMPNO/USR/PWD）必须显式提供，不进代码、不进 git。
function getConfig() {
  return {
    baseUrl: (process.env.ERP_BASE_URL || "http://localhost/SunReport").replace(/\/+$/, ""),
    compno: process.env.ERP_COMPNO || "",
    usr: process.env.ERP_USR || "",
    pwd: process.env.ERP_PWD || "", // 内网部署密码可为空字符串
  };
}

// —— 概念 3：Token 缓存 ——
// MCP 服务是常驻进程，模块级变量在两次工具调用之间不会消失，
// 所以「内存」就是免费的状态存储，不需要数据库、不需要文件。
let cache = { token: null, expiresAt: 0 };

function cacheValid() {
  const margin = 60_000; // 提前 1 分钟判过期，避免「刚好在临界点」翻车
  return cache.token && Date.now() < cache.expiresAt - margin;
}

// 真实调 ERP 登录接口。overrides 可覆盖配置（比如传入错误密码测失败路径）。
async function doLogin(overrides = {}) {
  const config = getConfig();

  // 工具参数的 camelCase → ERP 要求的大写字段：这是「包装层」的翻译职责
  const compno = overrides.compno ?? config.compno;
  const usr = overrides.usr ?? config.usr;
  const pwd = overrides.pwd ?? config.pwd;
  const langId = overrides.langId ?? "zh-cn";
  const sysType = overrides.sysType ?? "ERP";

  if (!compno || !usr) {
    const err = new Error("未配置 ERP 账号：请设置环境变量 ERP_COMPNO / ERP_USR，或在调用时传入");
    err.code = "CONFIG_MISSING";
    throw err;
  }

  let resp;
  try {
    resp = await fetch(`${config.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ COMPNO: compno, USR: usr, PWD: pwd, LANG_ID: langId, SYS_TYPE: sysType }),
      signal: AbortSignal.timeout(10_000), // 自检三问之「网络断了/超时」：10 秒兜底，不让 AI 干等
    });
  } catch (e) {
    const err = new Error(`连不上 ERP 服务器（${config.baseUrl}）：${e.message}。若服务刚启动，可能正在预热，稍后重试即可`);
    err.code = "NETWORK";
    throw err;
  }

  if (!resp.ok) {
    const err = new Error(`ERP 登录失败：HTTP ${resp.status}`);
    err.code = "HTTP_" + resp.status;
    throw err;
  }

  const data = await resp.json();

  // ⚠️ 铁律：成功 = code === 0，不是 HTTP 200
  if (data.code === 0 && data.data?.TOKEN) {
    // EXPIRES_TIMESTAMP 是 Unix 秒（绝对时间，优先用）；EXPIRES_IN 是秒（相对时长，兜底）
    const expiresAt = data.data.EXPIRES_TIMESTAMP
      ? data.data.EXPIRES_TIMESTAMP * 1000
      : Date.now() + (data.data.EXPIRES_IN || 600) * 1000;
    cache = { token: data.data.TOKEN, expiresAt };
    return { token: data.data.TOKEN, expiresAt };
  }

  // —— 概念 4：错误透传 ——
  // 业务失败时把 ERP 的错误码挂在 Error 上抛出去，让工具层能把
  // 「错误码 10001」原样转述给 AI（10001 是通用错，message 仅供参考）。
  const err = new Error(data.message || "未知错误");
  err.code = data.code;
  throw err;
}

// 带缓存的登录入口：
// - 不传参数且缓存有效 → 直接复用（第二次调用瞬间返回，能观察到「复用」）
// - 传入任一参数（如错误密码）→ 强制真登录，方便测试失败路径
// - ⚠️ 单飞（single-flight）：缓存无效时多个调用并发触发登录 → 共享同一个
//   进行中的请求，绝不并发打登录接口。实测教训（2026-10-09）：MCP 工具是并发
//   执行的，三个工具同时「要 Token」曾并发发出三个登录请求，把 ERP 后端
//   （.NET 非并发安全集合）直接撞坏（10001 collection corrupted，需应用池回收）。
let loginInFlight = null; // 进行中的登录 promise；完成（无论成败）即清空

export async function ensureLogin(overrides = {}) {
  const hasOverride = Object.values(overrides).some((v) => v !== undefined);
  if (!hasOverride && cacheValid()) {
    return { token: cache.token, expiresAt: cache.expiresAt, fresh: false };
  }
  if (hasOverride) {
    // 显式传参 = 调用方要一次真登录（如错密码测试），不参与单飞共享
    const result = await doLogin(overrides);
    return { ...result, fresh: true };
  }
  if (!loginInFlight) {
    // finally 里清空：失败也清，否则后续调用会永远等到同一个已拒绝的 promise
    loginInFlight = doLogin({}).finally(() => {
      loginInFlight = null;
    });
  }
  const result = await loginInFlight;
  return { ...result, fresh: false }; // 共享的是并发中另一次登录的结果，不算自己 fresh
}

// 给后续报表工具用的入口：缓存有效直接给 Token，无效自动重登
export async function getToken() {
  return (await ensureLogin()).token;
}

// 清缓存：认证失效时调用（见 erpPost 的重试逻辑）
export function clearCache() {
  cache = { token: null, expiresAt: 0 };
}

// —— 通用 ERP 请求（阶段 3 起）——
// 所有报表工具共用这一段：自动带 Token、认证失效（20001/20004）清缓存重登并重试
// **一次**、业务错误带码抛出。报表专用逻辑（SEARCH_INFO 翻译）由各 reports/*.js 负责，
// 这样阶段 4 做「配置驱动注册表」时，每只报表只需写自己的翻译，认证/重试/错误全部复用。
export async function erpPost(path, body) {
  const config = getConfig();

  const send = async () => {
    const token = await getToken(); // 缓存有效直接用，无效自动重登（对调用方透明）
    let resp;
    try {
      resp = await fetch(`${config.baseUrl}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000), // 报表查询比登录慢，给 12 秒（教学环境够用）
      });
    } catch (e) {
      const err = new Error(`连不上 ERP 服务器（${config.baseUrl}）：${e.message}。若服务刚启动，可能正在预热，稍后重试即可`);
      err.code = "NETWORK";
      throw err;
    }
    if (!resp.ok) {
      const err = new Error(`ERP 请求失败：HTTP ${resp.status}`);
      err.code = "HTTP_" + resp.status;
      throw err;
    }
    return await resp.json();
  };

  let data = await send();

  // 认证失效（20001 凭证空 / 20004 凭证过期）→ 清缓存 → 重登 → 重试一次。
  // 只重试一次：两次都失败说明不是瞬时问题，再试就是死循环。
  if (data.code === 20001 || data.code === 20004) {
    clearCache();
    data = await send(); // getToken 会重新登录
  }

  // ⚠️ 铁律：成功 = code === 0
  if (data.code !== 0) {
    const err = new Error(data.message || "未知错误");
    err.code = data.code;
    throw err;
  }
  return data;
}

// —— 长连接 SSE 流式请求（阶段 5 起）——
// 与 erpPost 的区别：响应不是一次性 JSON，而是一条条 `data: {JSON}` + 空行的
// 事件流（Content-Type: text/event-stream）。三步判别全部有实测依据（文档 9.3）：
//   ① res.ok 失败 → HTTP 级错误（如 BOOK_NO 空 → 406）
//   ② Content-Type 含 application/json → 错误 JSON（Token 无效实测回 HTTP 200 + code 20004）
//   ③ text/event-stream → 进入流解析
// 返回消息数组（{CODE, PERCENT, TITLE, ERR, DATA, IS_RES_ID}），事件语义由调用方解释。
export async function erpPostStream(path, body) {
  const config = getConfig();

  const send = async () => {
    const token = await getToken();
    let resp;
    try {
      resp = await fetch(`${config.baseUrl}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        // 长连接比普通报表慢；且实测「无凭证 → HTTP 200 + 空 body 永久挂起」，
        // 超时兜底是唯一出路。60 秒：小账套几秒就完，挂起时不让 AI 干等太久。
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      const err = new Error(`连不上 ERP 服务器（${config.baseUrl}）：${e.message}。若服务刚启动，可能正在预热，稍后重试即可`);
      err.code = "NETWORK";
      throw err;
    }
    if (!resp.ok) {
      // 406 = BOOK_NO 空等业务性 HTTP 错误（BOOK_NO 铁律：正常路径已在请求前拦截，这是兜底）
      const err = new Error(`ERP 流式请求失败：HTTP ${resp.status}`);
      err.code = "HTTP_" + resp.status;
      throw err;
    }
    const ctype = resp.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      // 流式端点的失败不走流：解析普通 JSON，业务错误带码抛出（20001/20004 由外层重试）
      const j = await resp.json();
      if (j.code !== 0) {
        const err = new Error(j.message || "未知错误");
        err.code = j.code;
        throw err;
      }
      return [];
    }
    return await parseSseStream(resp);
  };

  try {
    return await send();
  } catch (err) {
    if (err.code === 20001 || err.code === 20004) {
      // 认证失效：清缓存重登重试一次（与 erpPost 同一套防活锁纪律）
      clearCache();
      return await send();
    }
    throw err;
  }
}

// —— SSE 流解析：逐 chunk 读、行缓冲、事件切分 ——
// 行缓冲：chunk 边界可能切断一行，不完整行保留到下一个 chunk（文档 9.3 要点 1）
async function parseSseStream(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const messages = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // 最后一行可能不完整，留给下一个 chunk
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue; // 空行/其他前缀直接跳过
      let msg;
      try {
        msg = JSON.parse(line.slice(6));
      } catch {
        continue; // 非 JSON 行跳过（文档实测口径）
      }
      if (msg.ERR) {
        // 错误藏在流里：转成可读错误，而不是傻等永远不来的数据
        const err = new Error(`ERP 流内错误：${msg.ERR}`);
        err.code = "STREAM_ERR";
        throw err;
      }
      // 进度是服务端内部事：只进日志（stderr 不污染协议），不进工具结果
      console.error(`[erp-mcp] 流进度 ${msg.PERCENT ?? "?"}%：${msg.TITLE || ""}`);
      messages.push(msg);
    }
  }
  return messages;
}
