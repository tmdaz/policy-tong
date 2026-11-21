/**
 * 政策通 · 申报材料生成（前端）
 *
 * 依赖：assets/filegen.js（window.PT_FILES）、assets/member.js（window.PT）、
 *       assets/services.js（window.PT_SERVICES）、assets/entries.js（window.PT_ENTRIES）
 *
 * 分工（这是产品底线）：
 *   表格、条件判定、材料清单  → 全部由代码算，能追到条款；不用模型
 *   项目简介 / 申请理由 / 资金使用计划 → 可选调用 /api/compose，失败就留可见占位
 *   企业名称、信用代码、法人、电话、银行账号 → 只进本地生成的文件，绝不发给模型
 */
(function () {
  "use strict";

  var FILES = window.PT_FILES;
  var S = window.PT_SERVICES || { programs: [] };
  var ENTRIES = window.PT_ENTRIES || [];
  var PT = window.PT || null;

  /* ---------- 小工具 ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ymd(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }
  function nowText() {
    var d = new Date();
    return ymd(d) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ");
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  function safeFile(s) {
    return String(s || "未命名").replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 30);
  }

  /** 每份自产文件都要带这句：非官方表样 + 生成时间 */
  function disclaimer() {
    return "本材料由「政策通」依据公开政策整理，非主管部门官方表样；提交前请以官方表格与窗口要求为准。生成时间 " + nowText() + "。";
  }

  function toast(text) {
    if (PT && PT.toast) return PT.toast(text);
    var t = document.createElement("div");
    t.className = "pt-toast";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("on"); }, 10);
    setTimeout(function () { t.classList.remove("on"); setTimeout(function () { t.remove(); }, 300); }, 2400);
  }

  /* ---------- 字段定义 ---------- */

  /** 工商字段（不进模型，只进本地文件） */
  var COMPANY_FIELDS = [
    { key: "name", label: "企业名称", type: "text", ph: "与营业执照完全一致" },
    { key: "creditCode", label: "统一社会信用代码", type: "text", ph: "18 位，见营业执照" },
    { key: "establishedAt", label: "成立日期", type: "date" },
    { key: "registeredCapital", label: "注册资本（万元）", type: "number" },
    { key: "address", label: "注册地址", type: "text", ph: "与营业执照一致" },
    { key: "assets", label: "资产总额（万元）", type: "number" },
    { key: "legalName", label: "法定代表人", type: "text" },
    { key: "contactPhone", label: "联系电话", type: "text" },
    { key: "account", label: "开户行及账号", type: "text", ph: "开户银行 + 账号" },
  ];

  /** 判定用的条件字段：直接用 member.js 里那份 FIELDS，标签与选项保持一致 */
  var COND_KEYS = ["region", "industry", "years", "employees", "revenue", "category", "firstStartup", "innovative", "rdRatio", "invest", "loanYears", "insuredMonths", "layoffRate"];

  function FIELDS() { return (PT && PT.FIELDS) || {}; }

  var PRODUCTS = [
    { key: "company", name: "企业基本情况表", formats: ["xlsx", "csv", "docx"], desc: "工商信息键值表，一份录入，多处复用" },
    { key: "check", name: "申报条件自查表", formats: ["xlsx", "docx"], desc: "条件 / 填报值 / 是否满足 / 依据条号 + 原文摘录", needProgram: true },
    { key: "material", name: "材料清单（含装订顺序）", formats: ["xlsx", "docx"], desc: "材料名、必备性、状态，末节给份数与装订顺序", needProgram: true },
    { key: "attach", name: "填报对照单", formats: ["xlsx", "docx"], desc: "左列字段、右列你的值，对着官方表格抄" },
    { key: "statement", name: "申报说明书（草稿）", formats: ["docx"], desc: "五节结构；叙述段可让 AI 起草，也可自己填", needProgram: false },
  ];

  var PLACEHOLDER = {
    项目简介: "【请补充：结合本主营产品说明项目内容与预期成效，150–250 字。】",
    申请理由: "【请补充：说明本企业为何符合该项目的支持方向与申报条件，150–250 字。】",
    资金使用计划: "【请补充：说明资金用途与金额安排（设备、研发、场地、人员等），150–250 字。】",
  };

  /* ---------- 数据 ---------- */

  function programById(id) {
    for (var i = 0; i < S.programs.length; i++) if (S.programs[i].id === id) return S.programs[i];
    return null;
  }

  function entryOfPolicy(policyId) {
    for (var i = 0; i < ENTRIES.length; i++) if (ENTRIES[i].policyId === policyId) return ENTRIES[i];
    return null;
  }

  function company() {
    if (PT && PT.company) return PT.company();
    return {};
  }

  function saveCompany(c) {
    if (PT && PT.saveCompany) PT.saveCompany(c);
  }

  /** 把 company 还原成 diagnose() 认得的 form */
  function formFromCompany(c, program) {
    var f = {};
    COND_KEYS.forEach(function (k) {
      if (c[k] !== undefined && c[k] !== "") f[k] = c[k];
    });
    // 成立年限：填了成立日期就以日期为准，不让用户自己算
    if (c.establishedAt) {
      var years = (Date.now() - new Date(c.establishedAt + "T00:00:00").getTime()) / (365.25 * 86400000);
      f.years = Math.floor(years * 10) / 10;
    }
    if (program) {
      (program.rules || []).forEach(function (r) {
        if (f[r.key] === undefined && c[r.key] !== undefined) f[r.key] = c[r.key];
      });
    }
    return f;
  }

  /* ---------- 产物：行数据 ---------- */

  function valueText(def, v) {
    if (v === true) return "是";
    if (v === false) return "否";
    if (v === undefined || v === null || v === "") return "";
    if (def && def.type === "number") return String(v);
    return String(v);
  }

  /** 企业基本情况表：12 个工商字段键值表（9 个登记信息 + 地区 / 行业 / 人数） */
  function buildCompanyRows(c) {
    var head = ["字段", "填报值", "说明"];
    var fd = FIELDS();
    var extra = [
      { key: "region", label: "注册 / 经营地区" },
      { key: "industry", label: "所属行业" },
      { key: "employees", label: "从业人数（人）" },
    ];
    var rows = COMPANY_FIELDS.map(function (f) {
      var v = valueText(f, c[f.key]);
      return [f.label, v || "（未填）", v ? "" : "建议补齐，多数窗口要求与执照一致"];
    });
    extra.forEach(function (f) {
      var v = valueText(fd[f.key], c[f.key]);
      rows.push([f.label, v || "（未填）", v ? "" : "用于判断中小企业划型与行业条件"]);
    });
    var f2 = formFromCompany(c, null);
    if (c.revenue !== undefined && c.revenue !== "") {
      rows.push(["上年度营业收入（万元）", String(c.revenue), "用于判断划型与营收类条件"]);
    }
    if (f2.years !== undefined) {
      rows.push(["成立年限（按成立日期计算）", String(f2.years) + " 年", "用于判断「正常运营满 X 年」类条件"]);
    }
    return { head: head, rows: rows };
  }

  /** 申报条件自查表：直接复用 diagnose()，不另写判定逻辑 */
  function buildCheckRows(program, c) {
    if (!program) return null;
    var form = formFromCompany(c, program);
    var d = PT ? PT.diagnose(program, form) : { hits: [], misses: [] };
    var items = d.hits.concat(d.misses);
    // 命中在前，未满足在后，方便一眼看出差哪条
    items.sort(function (a, b) { return (a.ok === b.ok ? 0 : a.ok ? -1 : 1); });
    var head = ["条件", "填报值", "是否满足", "依据条号", "条款原文摘录"];
    var rows = items.map(function (it) {
      var v = it.value === true ? "是" : it.value === false ? "否" : it.value === undefined || it.value === "" ? "未填" : String(it.value);
      return [
        it.label,
        v,
        it.ok ? "满足" : "未满足 / 待补",
        "第" + it.section + "条" + (it.sectionTitle ? " " + it.sectionTitle : ""),
        it.evidence || "",
      ];
    });
    return { head: head, rows: rows, score: d.score, pass: d.pass, misses: d.misses.length, total: d.total };
  }

  /** 材料 → 条件：按项目规则的 key 精确对，对不上就写「—」，不硬凑 */
  var MATERIAL_RULE_KEY = [
    [/社保|参保|缴费/, "insuredMonths"],
    [/学历|毕业|学生证|在校/, "category"],
    [/研发|知识产权|专利/, "rdRatio"],
    [/财务|审计|报表/, "revenue"],
    [/从业人数|花名册/, "employees"],
    [/经营场所|场地|租赁|房产/, "invest"],
  ];

  function matchCondition(material, program) {
    var pair = MATERIAL_RULE_KEY.filter(function (x) { return x[0].test(material); })[0];
    if (!pair) return "—";
    var rule = (program.rules || []).filter(function (r) { return r.key === pair[1]; })[0];
    return rule ? rule.label : "—";
  }

  /** 材料清单：材料名、必备性、对应条件、状态；末节给份数与装订顺序 */
  function buildMaterialRows(program) {
    if (!program) return null;
    var head = ["序号", "材料名称", "必备性", "对应条件", "状态"];
    var rows = (program.materials || []).map(function (m, i) {
      return [String(i + 1), m, "必备", matchCondition(m, program), "待准备"];
    });
    rows.push(["", "【份数与装订】A4 纸打印，一式两份，按上表顺序装订成册；复印件加盖公章，原件备查。份数以窗口要求为准。", "", "", ""]);
    rows.push(["", "【提交方式】" + submissionHint(program), "", "", ""]);
    return { head: head, rows: rows };
  }

  function submissionHint(program) {
    var e = entryOfPolicy(program.policyId);
    if (!e) return "以官方页面公布的方式提交。";
    if (e.status === "online") return "需要在官方系统在线填报：" + (e.systemName || "") + (e.systemUrl && e.directJump ? "（" + e.systemUrl + "）" : "") + "。";
    if (e.status === "dual") return "先备齐材料，再在系统提交或按要求送窗口" + (e.systemName ? "：" + e.systemName : "") + "。";
    if (e.status === "download") return "表格下载后填写，纸质材料按要求报送受理窗口。";
    if (e.status === "window") return "到线下窗口提交" + (e.window && e.window.addr ? "：" + e.window.addr : "（地点以官方答复为准）") + "。";
    return "原文未写明办理入口，提交前请向主管部门确认。";
  }

  /** 填报对照单：我们不掌握官方表头，所以只给「字段 → 你的值」，官方栏位留空手填 */
  function buildAttachmentRows(c, program) {
    var head = ["序号", "字段（本平台口径）", "你的填报值", "官方表格栏位（按官方表格手填）"];
    var rows = [];
    var i = 1;
    COMPANY_FIELDS.forEach(function (f) {
      var v = valueText(f, c[f.key]);
      rows.push([String(i++), f.label, v || "（未填）", ""]);
    });
    var fd = FIELDS();
    COND_KEYS.forEach(function (k) {
      if (c[k] === undefined || c[k] === "") return;
      rows.push([String(i++), (fd[k] && fd[k].label) || k, valueText(fd[k], c[k]), ""]);
    });
    if (rows.length < i) rows.push([String(i), "（按官方表格逐项核对）", "", ""]);
    return { head: head, rows: rows, note: "我们没有官方表样原件，因此不预填官方表格；本单用于把信息抄到官方表格时逐项对照。" };
  }

  /* ---------- 产物：说明书 ---------- */

  function statementSections(c, program, composed) {
    var fd = FIELDS();
    var years = formFromCompany(c, null).years;
    var basic = [
      (c.name || "（企业名称未填）") + (c.establishedAt ? "，成立于 " + c.establishedAt : "") + (years !== undefined ? "（经营约 " + years + " 年）" : "") + "。",
      c.address ? "注册地址：" + c.address + "。" : "",
      c.legalName ? "法定代表人：" + c.legalName + "。" : "",
      c.registeredCapital ? "注册资本 " + c.registeredCapital + " 万元。" : "",
      c.industry ? "所属行业：" + c.industry + "。" : "",
      c.employees !== undefined && c.employees !== "" ? "现有从业人数 " + c.employees + " 人。" : "",
      c.revenue !== undefined && c.revenue !== "" ? "上年度营业收入 " + c.revenue + " 万元。" : "",
      program ? "拟申报项目：" + program.name + "（" + program.agency + "）。" : "",
    ].filter(Boolean).join("");

    var commit =
      "本企业承诺：以上填报信息及所附材料真实、准确、完整，不存在虚假记载、误导性陈述或重大遗漏；" +
      "如有不实，愿承担相应责任并接受主管部门处理。本说明书为申报准备稿，最终以正式申报材料为准。";

    return [
      { heading: "一、企业基本情况", text: basic },
      { heading: "二、项目简介", text: (composed && composed["项目简介"]) || PLACEHOLDER["项目简介"] },
      { heading: "三、申请理由与政策符合性", text: (composed && composed["申请理由"]) || PLACEHOLDER["申请理由"] },
      { heading: "四、资金使用计划", text: (composed && composed["资金使用计划"]) || PLACEHOLDER["资金使用计划"] },
      { heading: "五、真实性承诺", text: commit },
    ];
  }

  function buildStatement(c, program, composed) {
    return statementSections(c, program, composed);
  }

  /* ---------- 组装文件 ---------- */

  function selectedProducts(state) {
    return PRODUCTS.filter(function (p) { return state.products[p.key]; });
  }

  function docxBlocks(state) {
    var c = state.company;
    var program = programById(state.programId);
    var blocks = [];
    var picked = selectedProducts(state);

    picked.forEach(function (p) {
      if (p.key === "company") {
        blocks.push({ type: "h1", text: "一、企业基本情况表" });
        var t = buildCompanyRows(c);
        blocks.push({ type: "table", head: t.head, rows: t.rows, widths: [26, 40, 34] });
      }
      if (p.key === "check" && program) {
        var chk = buildCheckRows(program, c);
        blocks.push({ type: "h1", text: "二、申报条件自查表" });
        blocks.push({ type: "p", text: "共 " + chk.total + " 项条件，满足 " + (chk.total - chk.misses) + " 项，待补足 " + chk.misses + " 项。自查结论来自已收录条款的逐条比对，不等于审批结论。" });
        blocks.push({ type: "table", head: chk.head, rows: chk.rows, widths: [28, 12, 12, 18, 30] });
      }
      if (p.key === "material" && program) {
        var mat = buildMaterialRows(program);
        blocks.push({ type: "h1", text: "三、材料清单" });
        blocks.push({ type: "table", head: mat.head, rows: mat.rows, widths: [6, 40, 10, 26, 18] });
      }
      if (p.key === "attach") {
        var att = buildAttachmentRows(c, program);
        blocks.push({ type: "h1", text: "四、填报对照单" });
        blocks.push({ type: "p", text: att.note });
        blocks.push({ type: "table", head: att.head, rows: att.rows, widths: [6, 22, 32, 40] });
      }
      if (p.key === "statement") {
        blocks.push({ type: "h1", text: "五、申报说明书（草稿）" });
        buildStatement(c, program, state.composed).forEach(function (sec) {
          blocks.push({ type: "h2", text: sec.heading });
          blocks.push({ type: "p", text: sec.text });
        });
      }
    });
    blocks.push({ type: "p", text: disclaimer() });
    return blocks;
  }

  function downloadWord(state) {
    var blob = FILES.toDocx({
      title: "申报材料（整理稿 · 非官方表样）",
      blocks: docxBlocks(state),
      footer: disclaimer(),
    });
    FILES.download(blob, "申报材料_" + safeFile(state.company.name) + "_" + ymd() + ".docx");
  }

  function sheetsOf(state) {
    var c = state.company;
    var program = programById(state.programId);
    var sheets = [];
    selectedProducts(state).forEach(function (p) {
      if (p.key === "company") {
        var t = buildCompanyRows(c);
        sheets.push({ name: "企业基本情况", rows: [t.head].concat(t.rows), headerRows: 1, cols: [24, 34, 26] });
      }
      if (p.key === "check" && program) {
        var chk = buildCheckRows(program, c);
        sheets.push({ name: "条件自查", rows: [chk.head].concat(chk.rows), headerRows: 1, cols: [40, 16, 14, 18, 50] });
      }
      if (p.key === "material" && program) {
        var mat = buildMaterialRows(program);
        sheets.push({ name: "材料清单", rows: [mat.head].concat(mat.rows), headerRows: 1, cols: [6, 46, 10, 26, 12] });
      }
      if (p.key === "attach") {
        var att = buildAttachmentRows(c, program);
        sheets.push({ name: "填报对照单", rows: [att.head].concat(att.rows), headerRows: 1, cols: [6, 26, 34, 30] });
      }
    });
    return sheets;
  }

  function downloadExcel(state) {
    var sheets = sheetsOf(state);
    if (!sheets.length) return toast("勾选的产物没有表格形式，请改选 Word");
    var blob = FILES.toXlsx({ sheets: sheets });
    FILES.download(blob, "申报材料_" + safeFile(state.company.name) + "_" + ymd() + ".xlsx");
  }

  function downloadCsv(state) {
    var sheets = sheetsOf(state);
    if (!sheets.length) return toast("勾选的产物没有表格形式，请改选 Word");
    var rows = [];
    sheets.forEach(function (s, i) {
      if (i) rows.push([]);
      rows.push([s.name]);
      var width = 0;
      s.rows.forEach(function (r) { width = Math.max(width, r.length); });
      s.rows.forEach(function (r) {
        var line = r.slice();
        while (line.length < width) line.push("");
        rows.push(line);
      });
    });
    rows.push([]);
    rows.push([disclaimer()]);
    FILES.download(FILES.toCsv(rows), "申报材料_" + safeFile(state.company.name) + "_" + ymd() + ".csv");
  }

  function plainText(state) {
    var c = state.company;
    var program = programById(state.programId);
    var out = [];
    out.push("申报材料（整理稿 · 非官方表样）");
    out.push("");
    selectedProducts(state).forEach(function (p) {
      if (p.key === "company") {
        var t = buildCompanyRows(c);
        out.push("一、企业基本情况表");
        t.rows.forEach(function (r) { out.push(r[0] + "：" + r[1] + (r[2] ? "（" + r[2] + "）" : "")); });
        out.push("");
      }
      if (p.key === "check" && program) {
        var chk = buildCheckRows(program, c);
        out.push("二、申报条件自查表");
        chk.rows.forEach(function (r) { out.push(r[0] + "｜填报：" + r[1] + "｜" + r[2] + "｜依据" + r[3] + "｜" + clip(r[4], 60)); });
        out.push("");
      }
      if (p.key === "material" && program) {
        var mat = buildMaterialRows(program);
        out.push("三、材料清单");
        mat.rows.forEach(function (r) { if (r[1]) out.push((r[0] ? r[0] + ". " : "") + r[1] + (r[2] ? "（" + r[2] + "）" : "")); });
        out.push("");
      }
      if (p.key === "attach") {
        var att = buildAttachmentRows(c, program);
        out.push("四、填报对照单");
        att.rows.forEach(function (r) { out.push(r[1] + "：" + r[2]); });
        out.push("");
      }
      if (p.key === "statement") {
        out.push("五、申报说明书（草稿）");
        buildStatement(c, program, state.composed).forEach(function (sec) {
          out.push(sec.heading);
          out.push(sec.text);
          out.push("");
        });
      }
    });
    out.push("———");
    out.push(disclaimer());
    return out.join("\n");
  }

  /* ---------- 预览 ---------- */

  function tableHtml(title, head, rows, note) {
    return '<div class="mt-block">' +
      "<h3>" + esc(title) + "</h3>" +
      (note ? '<p class="pt-tiny">' + esc(note) + "</p>" : "") +
      '<div class="pt-table-wrap"><table class="pt-table mt-table"><thead><tr>' +
      head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr>" + head.map(function (_, i) {
          var cell = r[i] == null ? "" : String(r[i]);
          var long = cell.length > 40;
          return "<td" + (long ? ' class="mt-long"' : "") + ">" + esc(cell) + "</td>";
        }).join("") + "</tr>";
      }).join("") +
      "</tbody></table></div></div>";
  }

  function previewHtml(state) {
    var c = state.company;
    var program = programById(state.programId);
    var parts = [];
    selectedProducts(state).forEach(function (p) {
      if (p.key === "company") {
        var t = buildCompanyRows(c);
        parts.push(tableHtml("一、企业基本情况表", t.head, t.rows));
      }
      if (p.key === "check") {
        if (!program) { parts.push('<div class="mt-block"><h3>二、申报条件自查表</h3><p class="pt-tiny">没选申报项目，这一项跳过。</p></div>'); return; }
        var chk = buildCheckRows(program, c);
        parts.push(tableHtml("二、申报条件自查表", chk.head, chk.rows, "共 " + chk.total + " 项，满足 " + (chk.total - chk.misses) + " 项；自查不等于审批结论。"));
      }
      if (p.key === "material" && program) {
        var mat = buildMaterialRows(program);
        parts.push(tableHtml("三、材料清单", mat.head, mat.rows));
      }
      if (p.key === "attach") {
        var att = buildAttachmentRows(c, program);
        parts.push(tableHtml("四、填报对照单", att.head, att.rows, att.note));
      }
      if (p.key === "statement") {
        var secs = buildStatement(c, program, state.composed);
        parts.push('<div class="mt-block"><h3>五、申报说明书（草稿）</h3>' +
          secs.map(function (s) {
            var empty = /^【请补充/.test(s.text);
            return "<h4>" + esc(s.heading) + "</h4><p" + (empty ? ' class="mt-todo"' : "") + ">" + esc(s.text) + "</p>";
          }).join("") + "</div>");
      }
    });
    return parts.join("");
  }

  /* ---------- AI 段落 ---------- */

  function bandEmployees(n) {
    n = Number(n || 0);
    if (!n) return "未填";
    if (n < 5) return "5 人以下";
    if (n < 20) return "5–20 人";
    if (n < 50) return "20–50 人";
    if (n < 100) return "50–100 人";
    if (n < 300) return "100–300 人";
    return "300 人以上";
  }
  function bandRevenue(n) {
    n = Number(n || 0);
    if (!n) return "未填";
    if (n < 100) return "100 万以下";
    if (n < 300) return "100–300 万";
    if (n < 1000) return "300–1000 万";
    if (n < 4000) return "1000–4000 万";
    return "4000 万以上";
  }

  /**
   * 只发区间，不发任何能定位到具体企业的信息。
   * 企业名称 / 信用代码 / 法人 / 电话 / 银行账号 一律不出浏览器。
   */
  function composePayload(state) {
    var c = state.company;
    var program = programById(state.programId);
    var years = formFromCompany(c, null).years;
    var entry = program ? entryOfPolicy(program.policyId) : null;
    var policy = null;
    for (var i = 0; i < (window.POLICIES || []).length; i++) if (program && window.POLICIES[i].id === program.policyId) policy = window.POLICIES[i];
    var clauses = policy
      ? (policy.sections || []).slice(0, 6).map(function (s) {
          return { policyTitle: policy.title, documentNo: policy.documentNo || "", sectionNo: s.no, text: clip(s.text, 400) };
        })
      : [];
    return {
      docType: "statement",
      program: program ? { name: program.name, agency: program.agency, summary: program.summary } : { name: "", agency: "", summary: "" },
      profile: {
        industry: c.industry || "未填",
        region: c.region || "未填",
        years: years === undefined ? 0 : years,
        employeesBand: bandEmployees(c.employees),
        revenueBand: bandRevenue(c.revenue),
        firstStartup: c.firstStartup !== false,
      },
      clauses: clauses,
      sections: ["项目简介", "申请理由", "资金使用计划"],
    };
  }

  function composeApi() {
    var api = window.CHAT_API || "";
    if (!api) return "";
    return api.replace(/\/api\/chat\/?$/, "/api/compose");
  }

  function aiCompose(state) {
    var api = composeApi();
    if (!api || typeof fetch !== "function") return Promise.resolve(null);
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    return fetch(api, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(composePayload(state)),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        if (!j || !j.sections) return null;
        var out = {};
        Object.keys(j.sections).forEach(function (k) { if (j.sections[k]) out[k] = String(j.sections[k]).trim(); });
        return Object.keys(out).length ? { sections: out, mode: j.mode || "model", notice: j.notice || "" } : null;
      })
      .catch(function () { clearTimeout(timer); return null; });
  }

  /* ---------- 视图 ---------- */

  var state = { step: 1, company: {}, programId: "", products: { company: true, check: true, material: true, attach: true, statement: true }, composed: null, aiNotice: "" };

  function inputHtml(key, def) {
    var v = state.company[key];
    var id = "mt-f-" + key;
    if (def.type === "select") {
      var opts = (def.options || []).map(function (o) {
        return '<option value="' + esc(o) + '"' + (String(v) === String(o) ? " selected" : "") + ">" + esc(o) + "</option>";
      }).join("");
      return '<label class="pt-field" for="' + id + '"><span>' + esc(def.label) + '</span><select id="' + id + '" name="' + key + '"><option value=""' + (v == null || v === "" ? " selected" : "") + ">请选择</option>" + opts + "</select></label>";
    }
    if (def.type === "bool") {
      return '<label class="pt-field" for="' + id + '"><span>' + esc(def.label) + '</span><select id="' + id + '" name="' + key + '">' +
        '<option value=""' + (v == null || v === "" ? " selected" : "") + ">请选择</option>" +
        '<option value="true"' + (v === true ? " selected" : "") + ">是</option>" +
        '<option value="false"' + (v === false ? " selected" : "") + ">否</option></select></label>";
    }
    var type = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
    var extra = type === "number" ? ' min="0" step="' + (def.step || 1) + '"' : "";
    return '<label class="pt-field" for="' + id + '"><span>' + esc(def.label) + "</span>" +
      '<input id="' + id + '" name="' + key + '" type="' + type + '"' + extra +
      ' value="' + esc(v == null ? "" : v) + '"' + (def.ph ? ' placeholder="' + esc(def.ph) + '"' : "") + " /></label>";
  }

  function readForm() {
    var c = Object.assign({}, state.company);
    $$("#mt-root [name]").forEach(function (el) {
      var k = el.getAttribute("name");
      var v = el.value;
      if (v === "") { c[k] = ""; return; }
      if (v === "true") c[k] = true;
      else if (v === "false") c[k] = false;
      else if (el.type === "number") c[k] = Number(v);
      else c[k] = v;
    });
    return c;
  }

  function renderStep1() {
    var fd = FIELDS();
    var condFields = COND_KEYS.map(function (k) { return fd[k] ? Object.assign({ key: k }, fd[k]) : null; }).filter(Boolean);
    return '<section class="pt-panel mt-form" id="mt-step1">' +
      '<div class="pt-ph"><p class="pt-h4">第 1 步 · 企业信息</p><span class="pt-tiny">只存在本机浏览器，不上传</span></div>' +
      '<p class="pt-p">带 <b>*</b> 的建议填全；其余留空也能生成，表格里会标「（未填）」提醒你补。</p>' +
      '<div class="mt-form-grid">' +
      COMPANY_FIELDS.map(function (f) { return inputHtml(f.key, f); }).join("") +
      "</div>" +
      '<p class="pt-label" style="margin-top:18px">经营与申报条件（用于条件自查，选项口径与政策条款对应）</p>' +
      '<div class="mt-form-grid">' + condFields.map(function (f) { return inputHtml(f.key, f); }).join("") + "</div>" +
      '<div class="pt-row"><button type="button" class="pt-btn primary" id="mt-next1">下一步：选要什么</button>' +
      '<span class="pt-tiny">信息随时改，改了再点下一步就重新算</span></div>' +
      "</section>";
  }

  function renderStep2() {
    var items = PRODUCTS.map(function (p) {
      var on = !!state.products[p.key];
      var need = p.needProgram && !state.programId;
      return '<button type="button" class="pill mt-prod' + (on ? " on" : "") + '" data-prod="' + p.key + '" aria-pressed="' + (on ? "true" : "false") + '"' + (need ? " disabled" : "") + ">" +
        "<b>" + esc(p.name) + "</b><span>" + esc(p.desc) + "</span>" +
        '<em>' + p.formats.map(function (f) { return f.toUpperCase(); }).join(" / ") + "</em>" +
        (need ? '<i class="pt-tiny">需先选申报项目</i>' : "") +
        "</button>";
    }).join("");

    var progs = S.programs.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === state.programId ? " selected" : "") + ">" + esc(p.name) + "（" + esc(p.level) + "）</option>";
    }).join("");

    return '<section class="pt-panel mt-form" id="mt-step2">' +
      '<div class="pt-ph"><p class="pt-h4">第 2 步 · 选要什么</p><span class="pt-tiny">可多选，勾了什么就生成什么</span></div>' +
      '<label class="pt-field"><span>申报项目（选了才能生成条件自查表、材料清单）</span>' +
      '<select id="mt-program"><option value="">不指定（只生成基本情况表与对照单）</option>' + progs + "</select></label>" +
      '<div class="mt-prods">' + items + "</div>" +
      '<div class="pt-row"><button type="button" class="pt-btn ghost" id="mt-back1">‹ 上一步</button>' +
      '<button type="button" class="pt-btn primary" id="mt-next2">下一步：预览</button></div>' +
      "</section>";
  }

  function renderStep3() {
    var program = programById(state.programId);
    var entry = program ? entryOfPolicy(program.policyId) : null;
    var entryLine = "";
    if (entry) {
      var LABEL = { download: "可下载官方表格", online: "需在官方系统填报", dual: "先下载表格，再线上/窗口提交", window: "线下窗口办理", unconfirmed: "未确认（原文没写清入口）" };
      entryLine = '<p class="pt-tiny mt-entry-inline"><b>办理方式：</b>' + esc(LABEL[entry.status] || "") +
        (entry.systemName ? " · " + esc(entry.systemName) : "") +
        (entry.systemUrl && entry.directJump ? ' · <a href="' + esc(entry.systemUrl) + '" target="_blank" rel="noopener noreferrer">打开系统 ↗</a>' : "") +
        (entry.systemUrl && !entry.directJump ? " · 地址需手动复制（该类系统证书不受信任，不做直跳）" : "") +
        "</p>";
    }

    var aiState = state.composed ? "已用 AI 起草（可再改）" : state.aiNotice || "叙述段落目前是可见占位，填不出来就自己写，别交空话";
    return '<section class="mt-print-wrap" id="mt-step3">' +
      '<div class="mt-toolbar">' +
      '<div class="pt-row">' +
      '<button type="button" class="pt-btn primary" id="mt-word">下载 Word</button>' +
      '<button type="button" class="pt-btn ghost" id="mt-excel">下载 Excel</button>' +
      '<button type="button" class="pt-btn ghost" id="mt-csv">下载 CSV</button>' +
      '<button type="button" class="pt-btn ghost" id="mt-copy">复制全文</button>' +
      '<button type="button" class="pt-btn ghost" id="mt-print">打印成 PDF</button>' +
      '<button type="button" class="pt-btn ghost" id="mt-back2">‹ 改一改</button>' +
      "</div>" +
      '<p class="pt-tiny" id="mt-ai-state">' + esc(aiState) + "</p>" +
      (state.products.statement ? '<div class="pt-row"><button type="button" class="pt-btn ghost" id="mt-ai">让 AI 起草「项目简介 / 申请理由 / 资金使用计划」</button><span class="pt-tiny">只发行业、地区、年限、人数区间、营收区间；企业名称与信用代码不发送</span></div>' : "") +
      entryLine +
      "</div>" +
      '<div class="mt-paper" id="mt-paper">' +
      '<header class="mt-paper-head"><h2>申报材料（整理稿）</h2>' +
      '<p>' + esc(state.company.name || "（企业名称未填）") + " · " + esc(ymd()) + "</p></header>" +
      previewHtml(state) +
      '<footer class="mt-paper-foot">' + esc(disclaimer()) + "</footer>" +
      "</div></section>";
  }

  function setStep(n) {
    state.step = n;
    $$("#mt-steps li").forEach(function (li) {
      var s = Number(li.getAttribute("data-step"));
      li.classList.toggle("on", s === n);
      li.classList.toggle("done", s < n);
    });
    render();
    var root = $("#mt-root");
    if (root && root.scrollIntoView) root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function render() {
    var root = $("#mt-root");
    if (!root) return;
    if (state.step === 1) root.innerHTML = renderStep1();
    else if (state.step === 2) root.innerHTML = renderStep2();
    else root.innerHTML = renderStep3();
    bind();
  }

  function bind() {
    var root = $("#mt-root");
    if (!root) return;

    if (state.step === 1) {
      $$("[name]", root).forEach(function (el) {
        el.addEventListener("change", function () {
          state.company = readForm();
          saveCompany(state.company);
        });
      });
      $("#mt-next1").addEventListener("click", function () {
        state.company = readForm();
        saveCompany(state.company);
        if (!state.company.name) { toast("至少把企业名称填上，不然文件不好认"); }
        setStep(2);
      });
      return;
    }

    if (state.step === 2) {
      $("#mt-program").addEventListener("change", function (e) {
        state.programId = e.target.value;
        render();
      });
      $$("[data-prod]", root).forEach(function (b) {
        b.addEventListener("click", function () {
          if (b.disabled) return;
          var k = b.getAttribute("data-prod");
          state.products[k] = !state.products[k];
          render();
        });
      });
      $("#mt-back1").addEventListener("click", function () { setStep(1); });
      $("#mt-next2").addEventListener("click", function () {
        if (!selectedProducts(state).length) { toast("至少勾一项产物"); return; }
        setStep(3);
      });
      return;
    }

    // 第 3 步
    $("#mt-back2").addEventListener("click", function () { setStep(2); });
    $("#mt-word").addEventListener("click", function () { downloadWord(state); });
    $("#mt-excel").addEventListener("click", function () { downloadExcel(state); });
    $("#mt-csv").addEventListener("click", function () { downloadCsv(state); });
    $("#mt-print").addEventListener("click", function () { window.print(); });
    $("#mt-copy").addEventListener("click", function () {
      var text = plainText(state);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast("已复制全文"); }, function () { toast("复制失败，请手动选中预览内容"); });
      } else {
        toast("浏览器不支持剪贴板，请手动选中预览内容");
      }
    });
    var ai = $("#mt-ai");
    if (ai) {
      ai.addEventListener("click", function () {
        ai.disabled = true;
        ai.textContent = "正在起草…";
        aiCompose(state).then(function (res) {
          ai.disabled = false;
          ai.textContent = "让 AI 起草「项目简介 / 申请理由 / 资金使用计划」";
          if (!res) {
            state.aiNotice = "AI 接口没接通（或未配置），已保留模板占位；这几段建议自己写，别交空话";
            $("#mt-ai-state").textContent = state.aiNotice;
            return;
          }
          state.composed = res.sections;
          state.aiNotice = res.mode === "model" ? "AI 已起草三节，数字已按白名单校验，请你自己再核一遍" : "AI 未通过校验，已回落到模板占位" + (res.notice ? "（" + res.notice + "）" : "");
          render();
        });
      });
    }
  }

  /* ---------- 启动 ---------- */

  function initMaterials() {
    var root = $("#mt-root");
    if (!root) return;
    if (!FILES) {
      root.innerHTML = '<div class="pt-panel"><p class="pt-h4">文件生成模块没加载</p><p class="pt-p">刷新一下页面；如果还不行，换浏览器再试（需要支持现代 JavaScript 的浏览器）。</p></div>';
      return;
    }

    // 微信内置浏览器禁止下载文件，点了没反应也不报错 —— 先说清楚
    var ua = navigator.userAgent || "";
    if (/MicroMessenger/i.test(ua)) {
      var wx = $("#mt-wx");
      if (wx) wx.hidden = false;
    }

    state.company = Object.assign({}, company());
    var qs = new URLSearchParams(location.search);
    state.programId = qs.get("program") || "";

    // 从「项目申报」诊断页带过来的条件，直接续上
    if (PT && PT.state && PT.state.materialDraft) {
      var draft = PT.state.materialDraft;
      if (!state.programId && draft.programId) state.programId = draft.programId;
      if (draft.programId === state.programId && draft.form) {
        Object.keys(draft.form).forEach(function (k) {
          if (state.company[k] === undefined || state.company[k] === "") state.company[k] = draft.form[k];
        });
      }
    }

    // 底部「这个项目怎么交」：只在选了项目后显示对应那一条
    var entryBox = $("#mt-entry");
    if (entryBox) {
      var rows = $$("[data-prog-entry]", entryBox);
      var show = function () {
        entryBox.hidden = !state.programId;
        rows.forEach(function (li) { li.hidden = li.getAttribute("data-prog-entry") !== state.programId; });
      };
      show();
      var sel = $("#mt-program");
      if (sel) sel.addEventListener("change", show);
      var obs = setInterval(show, 600);
      setTimeout(function () { clearInterval(obs); }, 20000);
    }

    render();
  }

  window.PT_DOCGEN = {
    buildCompanyRows: buildCompanyRows,
    buildCheckRows: buildCheckRows,
    buildMaterialRows: buildMaterialRows,
    buildAttachmentRows: buildAttachmentRows,
    buildStatement: buildStatement,
    formFromCompany: formFromCompany,
    composePayload: composePayload,
    aiCompose: aiCompose,
    initMaterials: initMaterials,
    // 测试用：把整份 docx 的 blocks 取出来，脚本里能直接跑
    _docxBlocks: docxBlocks,
    _plainText: plainText,
    PRODUCTS: PRODUCTS,
    PLACEHOLDER: PLACEHOLDER,
  };

  document.addEventListener("DOMContentLoaded", function () {
    if (document.body && document.body.getAttribute("data-page") === "materials") {
      try { initMaterials(); } catch (err) { if (window.console) console.error("[docgen]", err); }
    }
  });
})();
