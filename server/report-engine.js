// server/report-engine.js — 报表通用引擎（阶段 4）
//
// 职责：把「所有报表都一样」的逻辑只写一次——
//   1) 读注册表配置 → 生成 MCP 工具（name/description/inputSchema 全由配置拼出）
//   2) 按配置的 style 构造请求体（getReport 十格 / getList 八格两种形状）
//   3) 取数、加工成 markdown 表格、统一空结果/截断/错误文案
// 「每只报表不一样」的部分全在 report-registry.js 的数据里，本文件加新报表时一行不改。

import { z } from "zod";
import { erpPost, erpPostStream } from "./erp-client.js";

// —— 工具注册：一条配置 → 一个 MCP 工具 ——
// 工具三要素（name/description/inputSchema）不再手写，由配置数据拼出来。
export function registerReportTool(server, cfg) {
  server.registerTool(
    cfg.toolName,
    {
      description: cfg.description, // AI 说明书直接来自配置：配置写得好不好，决定 AI 调得好不好
      inputSchema: buildInputSchema(cfg.params),
    },
    async (args) => {
      try {
        const { count, table } = await queryReport(cfg, args);
        const head = `✅ 查询完成：共 ${count} 行`;
        if (count === 0) {
          // 空结果是有效信息：明确说 0 行，并给 AI 一条可执行的建议
          return { content: [{ type: "text", text: `${head}。（${cfg.emptyHint}）` }] };
        }
        const tail =
          cfg.truncateAt && count >= cfg.truncateAt
            ? `\n⚠️ 结果达到 ${cfg.truncateAt} 行上限，可能未取全，建议缩小筛选范围。`
            : "";
        return { content: [{ type: "text", text: `${head}\n\n${table}${tail}` }] };
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
}

// —— inputSchema：参数定义写在配置里，这里统一变成 zod schema ——
function buildInputSchema(params) {
  const schema = {};
  for (const p of params) {
    schema[p.name] = z.string().optional().describe(p.description);
  }
  return schema;
}

// —— 查询：style 决定请求体形状，其余（认证/取数/加工）通用 ——
export async function queryReport(cfg, args = {}) {
  if (cfg.style === "stream") return queryStream(cfg, args); // 形状 ③ 走流式通道
  const body =
    cfg.style === "getList" ? buildGetListBody(cfg, args) : buildGetReportBody(cfg, args);
  const data = await erpPost(`api/${cfg.endpoint}`, body); // 认证/重试/错误都在 erpPost 里
  const rows = data.data?.[cfg.dataKey] || [];
  return { rows, count: rows.length, table: toMarkdown(rows) };
}

// —— 请求体形状 ①：getReport（invso 等标准报表）——
// SEARCH_INFO 十格标准布局；分页走 [0] 的 offset。
function buildGetReportBody(cfg, args) {
  const r = cfg.request;
  const searchInfo = [];
  searchInfo[0] = { offset: [0, 5000], temp: true }; // 一刀切全量（文档对 offset 说法自相矛盾，[0,5000] 两种解释都兼容）
  searchInfo[1] = { showLadder: "F", displayFields: r.displayFields, sumFields: [] };
  searchInfo[2] = { fixCondition: r.fixCondition };
  if (r.dateCell) {
    // 日期格：给了日期 → range（value 是数组）；不给 → this_year 默认今年
    const from = args[r.dateCell.paramFrom];
    const to = args[r.dateCell.paramTo];
    const year = String(new Date().getFullYear());
    searchInfo[r.dateCell.index] = {
      field: r.dateCell.field,
      operator: from || to ? "range" : "this_year",
      fieldType: "date",
      need: true,
      fieldDisabled: true,
      value: [from || `${year}-01-01`, to || `${year}-12-31`],
    };
  }
  for (const f of r.filterCells || []) {
    // 筛选格：param 绑定的从参数取值，没绑定的恒空（ERP 规矩：空筛选传 "" 不传 null）
    const cell = { field: f.field, operator: f.operator || "in", fieldDisabled: false };
    if (f.checkUnder) cell.checkUnder = f.checkUnder;
    cell.value = f.param ? args[f.param] || "" : "";
    searchInfo[f.index] = cell;
  }
  if (r.orderBy) searchInfo.push({ orderBy: r.orderBy });
  return {
    PGM: cfg.pgm,
    SEARCH_INFO: searchInfo.filter(Boolean),
    DISPLAY_FIELDS: r.displayFields.join(","),
  };
}

// —— 请求体形状 ②：getList（mrppu 等）——
// SEARCH_INFO 八格、无 orderBy、无顶层 DISPLAY_FIELDS；分页走顶层 PAGE_INFO。
function buildGetListBody(cfg, args) {
  const r = cfg.request;
  const searchInfo = [
    { showBody: "T", showLadder: "F", displayFields: r.displayFields }, // [0] 无 offset：分页在顶层 PAGE_INFO
    { fixCondition: r.fixCondition }, // [1]
  ];
  for (const c of r.fixedCells || []) {
    // 固定禁用格：形状由配置给，value 支持从参数注入（如 DATE_CST ← dateCst）
    const cell = { field: c.field, operator: c.operator, fieldDisabled: true };
    if (c.fieldType) cell.fieldType = c.fieldType;
    cell.value = c.param ? args[c.param] || "" : "";
    searchInfo.push(cell);
  }
  for (const f of r.filterCells || []) {
    const cell = { field: f.field, operator: f.operator || "in", fieldDisabled: false };
    if (f.checkUnder) cell.checkUnder = f.checkUnder;
    cell.value = f.param ? args[f.param] || "" : "";
    searchInfo[f.index] = cell;
  }
  return {
    PGM: cfg.pgm,
    OTHERINFO: r.otherInfo,
    SEARCH_INFO: searchInfo.filter(Boolean),
    PAGE_INFO: { PAGE_SIZE: -1, CURRENT_PAGE: 1 }, // -1 = 取全量（与 AsCoding 实测一致）
  };
}

// —— 请求体形状 ③：stream（长连接 SSE，如总分类账）——
// SEARCH_INFO 三格：[0] 展示配置、[1] fixCondition（占位符模板）、[2] orderBy。
// 占位符思路（与 AsCoding buildRequestStream 同源）：fixCondition 里写 @BOOK_NO/@PERIOD/
// @YEARS/@IPERIOD/@DATE_B/@DATE_E/@START_DD，这里按参数派生上下文统一替换——
// 「一个会计期间派生整族字段」的手艺只写一次，总账家族加报表时零改动复用。
function buildStreamBody(cfg, args) {
  const s = cfg.request.stream;
  const ctx = buildStreamCtx(cfg, args);
  const ph = (v) => (typeof v === "string" && v.startsWith("@") ? ctx[v.slice(1)] ?? "" : v);
  const fixCondition = {};
  for (const [k, v] of Object.entries(s.fixCondition || {})) {
    fixCondition[k] = ph(v);
  }
  return {
    PGM: cfg.pgm,
    SEARCH_INFO: [
      { showBody: s.showBody || "T", showLadder: s.showLadder || "F", displayFields: s.displayFields, sumFields: [] },
      { fixCondition },
      { orderBy: s.orderBy || { SYS_DATE: "asc" } },
    ],
    DISPLAY_FIELDS: s.displayFields.join(","),
  };
}

// 占位符上下文：dateCst（YYYY-MM，默认当前月）→ PERIOD/YEARS/IPERIOD/DATE_B/DATE_E/START_DD。
// 非法格式不报错，回退当月（与 AsCoding buildStreamCtx 同口径）。
function buildStreamCtx(cfg, args) {
  const now = new Date();
  // 格式对但数值荒谬（如 9999-99）也会被拦下：月份必须 01-12（自检三问之「超大」）
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(args.dateCst || "")
    ? args.dateCst
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const years = parseInt(period.slice(0, 4), 10);
  const iperiod = parseInt(period.slice(5, 7), 10);
  const lastDay = new Date(years, iperiod, 0).getDate(); // 本月第 0 天 = 上月末 → 本月天数
  return {
    BOOK_NO: args.bookNo || "",
    PERIOD: period,
    YEARS: years,
    IPERIOD: iperiod,
    DATE_B: `${period}-01`,
    DATE_E: `${period}-${String(lastDay).padStart(2, "0")}`,
    START_DD: `${period}-01T00:00:00`,
  };
}

// 账簿兜底（依赖链的「不让 AI 猜」落地）：BOOK_NO 是总账报表必填条件（空值 ERP 回 406）。
// AI 忘传 bookNo 时，服务端自动查账簿清单取第一本——AI 的调用不可预测，依赖链要给兜底。
async function resolveBookNo(cfg, args) {
  if (args.bookNo) return args.bookNo;
  const data = await erpPost("api/AccBook/GetList", buildBookListBody());
  const books = data.data?.ACC_BOOK_BS || [];
  if (!books.length) {
    // 实测证据（2026-10-12）：清单空可能是后端清单接口异常，不代表没启用总账——
    // 错误文案给 AI 可行动的下一步，而不是断言「未启用」
    const err = new Error("ERP 未返回账簿清单，无法自动确定账簿——请先用 erp_list_books 确认，或直接传 bookNo 指定账簿");
    err.code = "NO_BOOK";
    throw err;
  }
  return books[0].BOOK_NO;
}

// —— 流式查询：流在服务端吃干抹净，返回最终聚合结果 ——
// 概念课核心结论：MCP 工具调用是一次性请求-响应，AI 拿到的是完整表格；
// 流式进度（PERCENT）只进日志（erpPostStream 里 console.error），不进结果。
export async function queryStream(cfg, args = {}) {
  if (cfg.request.stream?.needsBook) {
    args = { ...args, bookNo: await resolveBookNo(cfg, args) };
  }
  const body = buildStreamBody(cfg, args);
  const messages = await erpPostStream(`api/${cfg.endpoint}`, body); // 传输层：行缓冲/ERR/超时/认证重试
  // 事件语义在这里解释：数据在 DATA.REPORT__TAB 里（可能分多条消息），拼成最终行集合
  const rows = [];
  for (const msg of messages) {
    if (Array.isArray(msg.DATA?.[cfg.dataKey])) rows.push(...msg.DATA[cfg.dataKey]);
  }
  return { rows, count: rows.length, table: toMarkdown(rows) };
}

// —— 账簿清单请求体（AccBook/GetList）——
// 两个用途：erp_list_books 工具 + 流式报表的 bookNo 兜底（resolveBookNo）。
// 形状与 getList 不同（顶层 DEP、SEARCH_INFO 四格、PAGE_INFO 200），单列一个构建器。
export function buildBookListBody() {
  return {
    DEP: "00000000",
    SEARCH_INFO: [
      {
        showBody: "F",
        showLadder: null,
        showSumField: null,
        displayFields: [
          "BOOK_NO", "NAME", "BOOK_XZ", "ACC_MD", "CUR_ID", "CUR_NAME", "TYPE_NO",
          "TYPE_NAME", "DEP", "DEP_NAME", "START_DD", "STOP_DD", "YEARS", "IPERIOD",
          "USR_NAME", "SYS_DATE", "MODIFY_MAN_NAME", "MODIFY_DD",
        ],
        sumFields: [],
      },
      { fixCondition: {} },
      { field: "BOOK_NO", operator: "in", fieldType: "string", fieldDisabled: false, value: "" },
      { field: "NAME", operator: "contain", fieldType: "string", fieldDisabled: false, value: "" },
    ],
    PAGE_INFO: { PAGE_SIZE: 200, CURRENT_PAGE: 1 },
  };
}

// —— 结果加工：行对象数组 → markdown 表格 ——
export function toMarkdown(rows) {
  if (!rows.length) return "";
  const header = Object.keys(rows[0]); // 表头顺序以 ERP 返回为准（实测：响应列可能与请求的 displayFields 不同）
  const lines = [
    "| " + header.join(" | ") + " |",
    "|" + header.map(() => "---").join("|") + "|",
  ];
  for (const row of rows) {
    lines.push("| " + header.map((h) => String(row[h] ?? "")).join(" | ") + " |");
  }
  return lines.join("\n");
}
