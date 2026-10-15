// server/report-registry.js — 报表注册表（阶段 4）
//
// 「每只报表 = 一条配置」：加新报表只在这里加一条配置，引擎（report-engine.js）一行不改。
//
// 配置字段说明：
//   key/name     报表标识与中文名
//   toolName     MCP 工具名（erp_report_ 前缀）
//   description  AI 说明书——决定 AI 什么时候调、怎么传参，认真写
//   style        "getReport"（十格标准布局）/ "getList"（八格 + OTHERINFO/PAGE_INFO）
//                / "stream"（SSE 长连接：三格 + fixCondition 占位符模板）
//   endpoint     {站点}/api/ 之后的相对路径（大小写以实测为准）
//   pgm/dataKey  程序代号 / 响应里数据行的键名
//   params       AI 参数定义（引擎据此生成 inputSchema）
//   request      请求体专属数据（displayFields/fixCondition/日期格/筛选格映射…）
//   truncateAt   达到该行数提示可能未取全（对应 getReport 的 [0,5000]）
//   emptyHint    查到 0 行时给 AI 的建议

export const REPORT_REGISTRY = [
  // —— 受订报表（阶段 3 交付，阶段 4 迁入注册表）——
  {
    key: "invso",
    name: "受订报表",
    toolName: "erp_report_invso",
    description:
      "查询受订报表（受订单明细）。返回指定日期范围内的受订单，可按客户代号、货品代号筛选；日期不传默认查今年。适合回答「某段时间/某客户的受订单有多少、金额多少」类问题。",
    style: "getReport",
    endpoint: "invso/getReport", // ⚠️ 实测 /invso 全小写（Postman 验证过）
    pgm: "REP_SOLIST",
    dataKey: "REPORT__TAB",
    params: [
      { name: "dateFrom", description: "受订日期起（YYYY-MM-DD），不传默认今年 1 月 1 日" },
      { name: "dateTo", description: "受订日期止（YYYY-MM-DD），不传默认今年 12 月 31 日" },
      { name: "cusNo", description: "客户代号，空=全部客户" },
      { name: "prdNo", description: "货品代号，空=全部货品" },
    ],
    request: {
      displayFields: [
        "CUS_NO", "CUS_NAME", "OS_DD", "OS_NO", "PRD_NO", "PRD_NAME",
        "PRD_MARK", "A001", "WH_NAME", "UNIT", "UP", "QTY", "DIS_CNT",
        "AMT_DIS_CNT", "AMTN", "AMTN_NET", "TAX", "AMTN_WITHTAX",
        "QTY_PS", "QTY_PS_UNSH", "QTY_JH", "QTY_UNPS", "QTY_PRE",
        "QTY_PRE_UNSH", "QTY_RK", "QTY_RK_UNSH", "EST_DD", "REM_B",
      ], // 28 个（文档标题写「27个」实际列了 28 个——以 curl 示例为准）
      fixCondition: { REPORT_DD_FIELD: "OS_DD", SUB_CUS: "" },
      dateCell: { index: 3, field: "OS_DD", paramFrom: "dateFrom", paramTo: "dateTo" },
      filterCells: [
        { index: 4, field: "CUS_NO", checkUnder: "T", param: "cusNo" },
        { index: 5, field: "PRD_NO", param: "prdNo" },
        { index: 6, field: "DEP", checkUnder: "T" }, // 本工具不开放 → 恒空
        { index: 7, field: "WH", checkUnder: "T" }, // 本工具不开放 → 恒空
        { index: 8, field: "CHK_STATUS", operator: "equal" }, // 不限制审核状态
      ],
      orderBy: { OS_DD: "asc" },
    },
    truncateAt: 5000,
    emptyHint: "可放宽日期范围或清空客户/货品筛选再试",
  },

  // —— 产品成本分析表（阶段 4 新增：getList 端点，纯配置零专属代码）——
  {
    key: "mrppu",
    name: "产品成本分析表",
    toolName: "erp_report_mrppu",
    description:
      "查询产品成本分析表。返回成本年月、单据、货品、数量与成本金额明细，可按成本年月（YYYY-MM）、部门代号、生产货品代号筛选。适合回答「某月成本是多少、某货品的成本构成」类问题。",
    style: "getList",
    endpoint: "mrppu/getList",
    pgm: "MRPPU",
    dataKey: "TRANS", // ⚠️ 不是 REPORT__TAB
    params: [
      { name: "dateCst", description: "成本年月（YYYY-MM），不传查全部期间" },
      { name: "dep", description: "部门代号，空=全部部门" },
      { name: "prdNo", description: "生产货品代号，空=全部货品" },
    ],
    request: {
      otherInfo: { DEP_GROUP: "00000000", INCLUDESON: "F" },
      displayFields: [
        "BIL_DD", "BIL_NO", "ITM", "PRD_NO", "PRD_NAME", "A001", "BAT_NO",
        "WH", "UNIT_NAME", "QTY", "QTY1", "CST", "CST_OUT", "CST_ALL",
        "SO_NO", "JH_NO", "MO_NO", "TW_NO", "TZ_NO", "DATE_CST", "CST_MAN1", "CST_MAK1",
      ],
      fixCondition: { CHK_ALL: "F" },
      fixedCells: [
        // [2]~[5] 固定禁用格：形状取自 AsCoding 实测代码；DATE_CST 格的 value 从 dateCst 参数注入
        { field: "DEP_GROUP", operator: "contain" },
        { field: "BIL_ID", operator: "in", fieldType: "select" },
        { field: "DATE_CST", operator: "equal", fieldType: "date", param: "dateCst" },
        { field: "CLOSE_ID", operator: "equal", fieldType: "string" },
      ],
      filterCells: [
        { index: 6, field: "DEP", checkUnder: "T", param: "dep" },
        { index: 7, field: "PRD_NO", param: "prdNo" },
      ],
    },
    // 无 truncateAt：getList 走 PAGE_INFO 分页且本服务 PAGE_SIZE=-1 取全量，不存在 5000 截断
    emptyHint: "可清空成本年月/部门/货品筛选再试",
  },

  // —— 总分类账（阶段 5 新增：SSE 长连接流式，第三种 style "stream"）——
  // 「读流的手艺」在引擎与 erp-client（行缓冲/ERR/超时），这里只写 accgl 的事件语义：
  // 占位符模板与 AsCoding 实测配置一致——@BOOK_NO/@PERIOD/@YEARS/@IPERIOD/@DATE_B/
  // @DATE_E/@START_DD 由引擎按参数派生替换（一个会计期间派生整族字段）。
  {
    key: "accgl",
    name: "总分类账",
    toolName: "erp_report_accgl_stream",
    description:
      "查询总分类账（长连接流式报表）。返回指定会计期间的科目发生额与余额明细。bookNo（账簿代号）不传时自动使用账簿清单第一本账簿；需要指定账簿先调 erp_list_books 查 BOOK_NO。适合回答「某科目某期间的发生额、余额是多少」类问题。",
    style: "stream",
    endpoint: "accGeneralLedger/GetReportStream",
    pgm: "ACCRPTGL", // 实测该端点不校验 PGM，但请求体必须带
    dataKey: "REPORT__TAB",
    params: [
      { name: "bookNo", description: "账簿代号（BOOK_NO），不传自动用账簿清单第一本（用 erp_list_books 可查全部账簿）" },
      { name: "dateCst", description: "会计期间（YYYY-MM），不传默认当前月" },
    ],
    request: {
      stream: {
        needsBook: true, // BOOK_NO 铁律：总账报表必填（空值 ERP 回 406），引擎会自动兜底取第一本
        showBody: "T",
        displayFields: [
          "ACC_NO", "ACC_NAME", "ACC_IPERIOD", "DC", "REM_TYPE",
          "FZHS_TITLE", "CUR_NAME", "AMTN_D", "AMTN_C", "AMTN_BAL",
        ],
        fixCondition: {
          BOOK_NO: "@BOOK_NO",
          CUR_ID: "",
          ACC_IPERIOD_B: "@PERIOD",
          ACC_IPERIOD_E: "@PERIOD",
          CHK_ACCN_TYPE: "2",
          ACC_NO: "",
          ACC_NO_B: "",
          ACC_NO_E: "",
          REL_CLS_B: 1,
          REL_CLS_E: 10,
          AMTN_BAL_TYPE: "1",
          CHK_POSTACC: "F",
          CHK_STOP: "F",
          CHK_NOVOH: "F",
          CHK_NOVOH_BAL_ZERO: "F",
          CHK_FZHS_DETAIL: "F",
          CHK_ARP_DAT: "F",
          CHK_DETAIL_ACCN: "F",
          CHK_NO_POA_VOH: "F",
          CHK_NO_SYTZ_VOH: "F",
          SHOW_BN_TYPE: "1",
          ORDERBY_TYPE: "1",
          START_DD: "@START_DD",
          YEARS: "@YEARS",
          IPERIOD: "@IPERIOD",
          TYPE_NO: "01",
          CHK_GROUP_CUR_LOC: "F",
          DATE_B: "@DATE_B",
          DATE_E: "@DATE_E",
        },
        orderBy: { SYS_DATE: "asc" },
      },
    },
    emptyHint: "可换个会计期间（dateCst，格式 YYYY-MM）再试",
  },
];
