/**
 * 会员与服务中心（前端演示态）
 *
 * 依赖：assets/data.js（window.POLICIES）、assets/services.js（window.PT_SERVICES）、
 *       assets/retrieval.js（window.PolicyRetrieval）
 *
 * 说明：本文件的账号、权益、订单、工单、申报单全部存在浏览器 localStorage，
 *      用于把「注册 → 开通 → 解锁 → 推送 → 提问 → 转专家 → 申报」整条链路跑通。
 *      真实支付与真实审核不在本阶段实现，页面已注明「演示态」。
 */
(function () {
  "use strict";

  var KEY = "pt.v1";
  var S = window.PT_SERVICES || { plans: [], experts: [], programs: [], topics: [] };
  var POLICIES = window.POLICIES || [];
  var RETRIEVAL = window.PolicyRetrieval;
  var INDEX = RETRIEVAL ? RETRIEVAL.createIndex(POLICIES) : null;

  var CITIES = [
    "长沙市", "株洲市", "湘潭市", "衡阳市", "邵阳市", "岳阳市", "常德市",
    "张家界市", "益阳市", "郴州市", "永州市", "怀化市", "娄底市", "湘西土家族苗族自治州",
  ];

  var FREQ_LABEL = { weekly: "每周一次", daily: "每天一次", instant: "有新政策立即推" };
  var FREQ_LEVEL = { weekly: 0, daily: 1, instant: 2 };
  var CATEGORY_LABEL = {
    tax: "税费优惠", subs: "补贴申报", finance: "融资贷款",
    qualification: "认定资质", hr: "用工社保", other: "其他",
  };

  /* ---------- 小工具 ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return "¥" + Number(n || 0).toLocaleString("zh-CN"); }
  function num(n) { return Number(n || 0).toLocaleString("zh-CN"); }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " "); return s.length > n ? s.slice(0, n) + "…" : s; }
  function uid(prefix) { return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); }

  function ymd(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }
  function ym(d) { d = d || new Date(); var m = d.getMonth() + 1; return d.getFullYear() + "-" + (m < 10 ? "0" + m : m); }
  function nowText() {
    var d = new Date();
    return ymd(d) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function addYears(dateStr, n) {
    var d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    d.setFullYear(d.getFullYear() + n);
    return ymd(d);
  }
  function daysFromToday(dateStr) {
    if (!dateStr) return null;
    var t = new Date(dateStr + "T23:59:59").getTime();
    var left = Math.ceil((t - Date.now()) / 86400000);
    // 已过期返回 0，避免出现「截止还剩 -172 天」
    return left > 0 ? left : 0;
  }

  /* ---------- 存储 ---------- */

  function blank() {
    return {
      user: null,
      planCode: "free",
      planStart: "",
      planExpire: "",
      usage: { interpDate: "", interpUsed: 0, askMonth: "", askUsed: 0, year: "", generalUsed: 0, expertUsed: 0 },
      push: { themes: [], regions: ["湖南省"], freq: "weekly", channels: ["inbox"] },
      tickets: [],
      applies: [],
      orders: [],
      inbox: [],
    };
  }

  var ST = blank();
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      ST = Object.assign(blank(), parsed);
      ST.usage = Object.assign(blank().usage, parsed.usage || {});
      ST.push = Object.assign(blank().push, parsed.push || {});
    }
  } catch (e) { ST = blank(); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { /* 隐私模式下静默失败 */ }
  }

  /* ---------- 套餐与权益 ---------- */

  function planByCode(code) {
    for (var i = 0; i < S.plans.length; i++) if (S.plans[i].code === code) return S.plans[i];
    return S.plans[0] || { code: "free", name: "免费注册", level: 0, limits: {} };
  }

  function planExpired() {
    return !!(ST.planCode !== "free" && ST.planExpire && ST.planExpire < ymd());
  }

  function plan() {
    return planExpired() ? planByCode("free") : planByCode(ST.planCode);
  }

  function isMember() { return plan().level >= 1; }

  function limits() { return plan().limits || {}; }

  /** 按自然日 / 自然月 / 自然年重置用量 */
  function resetPeriods() {
    var t = ymd(), m = ym(), y = String(new Date().getFullYear());
    if (ST.usage.interpDate !== t) { ST.usage.interpDate = t; ST.usage.interpUsed = 0; }
    if (ST.usage.askMonth !== m) { ST.usage.askMonth = m; ST.usage.askUsed = 0; }
    if (ST.usage.year !== y) { ST.usage.year = y; ST.usage.generalUsed = 0; ST.usage.expertUsed = 0; }
  }

  var QUOTA = {
    interp: { limit: function () { return limits().interpDaily; }, used: function () { return ST.usage.interpUsed; }, add: function () { ST.usage.interpUsed++; } },
    ask: { limit: function () { return limits().askMonthly; }, used: function () { return ST.usage.askUsed; }, add: function () { ST.usage.askUsed++; } },
    general: { limit: function () { return limits().generalYearly; }, used: function () { return ST.usage.generalUsed; }, add: function () { ST.usage.generalUsed++; } },
    expert: { limit: function () { return limits().expertYearly; }, used: function () { return ST.usage.expertUsed; }, add: function () { ST.usage.expertUsed++; } },
  };

  function quota(feature) {
    resetPeriods();
    var q = QUOTA[feature];
    if (!q) return { limit: 0, used: 0, left: 0, unlimited: false };
    var limit = q.limit();
    var used = q.used();
    if (limit === -1) return { limit: -1, used: used, left: Infinity, unlimited: true };
    return { limit: limit || 0, used: used, left: Math.max((limit || 0) - used, 0), unlimited: false };
  }

  function consume(feature) {
    var q = quota(feature);
    if (!q.unlimited && q.left <= 0) return false;
    QUOTA[feature].add();
    save();
    return true;
  }

  /* ---------- 账号 ---------- */

  function login(phone) {
    ST.user = { phone: String(phone || ""), createdAt: nowText(), org: ST.user && ST.user.org ? ST.user.org : {} };
    save();
    syncHeader();
    return ST.user;
  }

  function logout() {
    ST.user = null;
    save();
    syncHeader();
  }

  function maskPhone(p) { return String(p || "").replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2"); }

  /* ---------- 订单与模拟支付 ---------- */

  function createOrder(opt) {
    var o = {
      no: "PT" + Date.now().toString().slice(-10),
      type: opt.type,
      refId: opt.refId || "",
      title: opt.title,
      amount: Math.round(opt.amount || 0),
      status: "pending",
      channel: "",
      createdAt: nowText(),
      paidAt: "",
      meta: opt.meta || {},
    };
    ST.orders.unshift(o);
    save();
    return o;
  }

  function payOrder(no, channel) {
    for (var i = 0; i < ST.orders.length; i++) {
      var o = ST.orders[i];
      if (o.no !== no || o.status === "paid") continue;
      o.status = "paid";
      o.channel = channel || "manual";
      o.paidAt = nowText();
      fulfill(o);
      save();
      return o;
    }
    return null;
  }

  /** 支付成功后的履约：开会员 / 派单 / 启动申报服务 */
  function fulfill(order) {
    if (order.type === "membership") {
      var code = order.meta.planCode;
      var p = planByCode(code);
      var base = planExpired() || !ST.planExpire ? ymd() : ST.planExpire;
      ST.planCode = code;
      ST.planStart = ST.planStart && !planExpired() ? ST.planStart : ymd();
      ST.planExpire = addYears(base, 1);
      // 升档后按新档位放开主题上限
      var maxT = p.limits.pushThemes;
      if (maxT !== -1 && ST.push.themes.length > maxT) ST.push.themes = ST.push.themes.slice(0, maxT);
      ST.inbox.unshift({
        id: uid("msg"), at: nowText(), kind: "account",
        title: "会员已开通：" + p.name,
        body: "有效期至 " + ST.planExpire + "。全部条款解读、AI 提问额度与政策推送已按新档位生效。",
        read: false,
      });
    }
    if (order.type === "ticket") {
      var tk = findTicket(order.refId);
      if (tk) { tk.status = "pending_assign"; tk.paidAt = nowText(); tk.price = order.amount; }
    }
    if (order.type === "apply") {
      var ap = findApply(order.refId);
      if (ap) { ap.paid = true; ap.status = "contracted"; ap.paidAt = nowText(); }
    }
  }

  /* ---------- 站内信 ---------- */

  function unread() { return ST.inbox.filter(function (m) { return !m.read; }).length; }

  function markRead(id) {
    ST.inbox.forEach(function (m) { if (!id || m.id === id) m.read = true; });
    save();
  }

  /* ---------- 政策推送 ---------- */

  function topicByCode(code) {
    for (var i = 0; i < S.topics.length; i++) if (S.topics[i].code === code) return S.topics[i];
    return null;
  }

  function topicAliases(codes) {
    var out = [];
    (codes || []).forEach(function (c) {
      var t = topicByCode(c);
      if (t) out = out.concat(t.aliases);
    });
    return out;
  }

  function isHunanRegion(region) {
    region = String(region || "");
    if (region.indexOf("全国") >= 0) return false;
    if (region.indexOf("湖南") >= 0) return true;
    return CITIES.indexOf(region) >= 0;
  }

  function matchPush(cfg, sinceDays) {
    cfg = cfg || ST.push;
    var days = sinceDays || 0;
    var since = days > 0 ? new Date(Date.now() - days * 86400000) : null;
    var aliases = topicAliases(cfg.themes);
    var regions = cfg.regions || [];
    var wantNational = regions.indexOf("全国") >= 0;

    return POLICIES.filter(function (p) {
      if (p.isSample) return false;
      var pub = p.publishedAt ? new Date(p.publishedAt + "T00:00:00") : null;
      if (since && pub && pub < since) return false;
      var tagHit = aliases.length === 0
        ? false
        : (p.tags || []).some(function (t) { return aliases.indexOf(t) >= 0; });
      if (!tagHit) return false;
      var regionHit = false;
      regions.forEach(function (r) {
        if (r === "全国") { if (p.level === "national") regionHit = true; }
        else if (r === "湖南省") { if (isHunanRegion(p.region) || p.level === "national") regionHit = true; }
        else if (String(p.region) === r) regionHit = true;
      });
      if (!regionHit && wantNational && p.level === "national") regionHit = true;
      return regionHit;
    }).sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); });
  }

  function savePush(cfg) {
    ST.push = Object.assign(ST.push, cfg);
    save();
  }

  function pushPreviewInbox() {
    var hits = matchPush(ST.push).slice(0, 6);
    return hits.map(function (p) {
      return {
        id: "push-" + p.id,
        at: p.publishedAt,
        kind: "policy",
        title: p.title,
        body: clip(p.summary, 90),
        href: "policy-" + p.id + ".html",
        read: false,
      };
    });
  }

  /* ---------- 专题解答 ---------- */

  function findTicket(id) {
    for (var i = 0; i < ST.tickets.length; i++) if (ST.tickets[i].id === id) return ST.tickets[i];
    return null;
  }

  function citeOf(doc) {
    var p = null;
    for (var i = 0; i < POLICIES.length; i++) if (POLICIES[i].id === doc.policyId) p = POLICIES[i];
    if (!p) return null;
    var sec = null;
    (p.sections || []).forEach(function (s) { if (s.no === doc.sectionNo) sec = s; });
    return {
      policyId: p.id,
      policyTitle: p.title,
      sectionNo: doc.sectionNo,
      sectionTitle: sec ? sec.title : doc.sectionTitle,
      text: sec ? sec.text : doc.text,
    };
  }

  /** 用已收录条款做一次「一般解答」：摘录 + 出处，不做推断 */
  function aiAnswer(question) {
    if (!INDEX) return { text: "条款检索不可用，请改用专家解答。", cites: [] };
    var docs = RETRIEVAL.retrieve(INDEX, question, { k: 5 });
    if (!docs.length) {
      return {
        text: "政策库里暂时没有能直接回答这个问题的条款。可以换个说法再问，或转专家解答——专家会结合你的企业情况给出判断。",
        cites: [],
      };
    }
    var top = docs.slice(0, 2);
    var lines = [];
    lines.push("先给结论：按已收录的条款，" + (top[0].kind === "interpretation" ? "可参照「" + top[0].sectionTitle + "」" : "相关要求集中在下面的条款里") + "。");
    lines.push("");
    lines.push("要点：");
    top.forEach(function (d, i) {
      var c = citeOf(d);
      var body = c ? clip(c.text, 110) : clip(d.text, 110);
      lines.push("①②".charAt(i) + " " + body + "〔" + clip(d.policyTitle, 18) + "·第" + d.sectionNo + "条〕");
    });
    lines.push("");
    lines.push("不确定的地方：你的具体情况（地区、行业、成立年限、参保月数）会影响结论，这部分需要专家确认。");
    return { text: lines.join("\n"), cites: top.map(citeOf).filter(Boolean) };
  }

  function createTicket(opt) {
    var ans = opt.ask === false ? null : aiAnswer(opt.question);
    var tk = {
      id: uid("tk"),
      no: "T" + Date.now().toString().slice(-8),
      category: opt.category || "other",
      question: opt.question,
      policyId: opt.policyId || "",
      status: "ai_answered",
      price: 0,
      expertId: "",
      createdAt: nowText(),
      paidAt: "",
      answeredAt: "",
      messages: [],
      rating: 0,
    };
    if (ans) {
      tk.messages.push({ role: "user", text: opt.question, at: tk.createdAt });
      tk.messages.push({ role: "ai", text: ans.text, cites: ans.cites, at: nowText() });
    }
    ST.tickets.unshift(tk);
    save();
    return tk;
  }

  function recommendExperts(category) {
    var map = {
      tax: ["税收优惠", "企业所得税", "增值税"],
      subs: ["创业补贴", "就业补贴", "社保补贴"],
      finance: ["融资支持", "贷款贴息", "创业担保"],
      qualification: ["认定资质", "专项资金", "科技型企业"],
      hr: ["用工成本", "就业补贴", "社保补贴"],
    };
    var words = map[category] || [];
    var list = S.experts.filter(function (e) {
      return e.domains.some(function (d) { return words.indexOf(d) >= 0; });
    });
    return list.length ? list : S.experts.slice(0, 2);
  }

  function pickExpert(id) {
    for (var i = 0; i < S.experts.length; i++) if (S.experts[i].id === id) return S.experts[i];
    return null;
  }

  /** 模拟专家接单并给出结构化答复（演示态） */
  function expertAnswer(tk) {
    var e = pickExpert(tk.expertId);
    var docs = INDEX ? RETRIEVAL.retrieve(INDEX, tk.question, { k: 3 }) : [];
    var cites = docs.map(citeOf).filter(Boolean);
    var lines = [];
    lines.push("【结论】");
    lines.push("按你描述的情况，属于可以准备申报的范围，但有一处需要先核实：" + (cites[0] ? "「" + (cites[0].sectionTitle || "相关条款") + "」里的适用条件" : "适用条件") + "。");
    lines.push("");
    lines.push("【依据条款】");
    cites.forEach(function (c, i) {
      lines.push("①②③".charAt(i) + " 《" + clip(c.policyTitle, 24) + "》第" + c.sectionNo + "条 · " + (c.sectionTitle || ""));
    });
    lines.push("");
    lines.push("【材料清单】");
    lines.push("① 营业执照与法定代表人身份证明　② 近 12 个月社保或纳税记录　③ 与申报条件对应的证明材料　④ 对公账户信息");
    lines.push("");
    lines.push("【办理路径】");
    lines.push("线上填报 → 区县初审 → 市州复核 → 公示拨付；建议在截止日前 15 个工作日提交，留出补正时间。");
    lines.push("");
    lines.push("【风险提示】");
    lines.push("审批结果以主管部门认定为准，我们不承诺获批；材料真实性由企业负责。");
    return {
      by: e ? e.name : "专家",
      level: e ? e.level : "L1",
      text: lines.join("\n"),
      cites: cites,
    };
  }

  function expertTake(tkId) {
    var tk = findTicket(tkId);
    if (!tk) return null;
    tk.status = "in_progress";
    tk.answeredAt = "";
    save();
    return tk;
  }

  function expertReply(tkId) {
    var tk = findTicket(tkId);
    if (!tk) return null;
    var a = expertAnswer(tk);
    tk.messages.push({ role: "expert", text: a.text, cites: a.cites, by: a.by, level: a.level, at: nowText() });
    tk.status = "answered";
    tk.answeredAt = nowText();
    save();
    return tk;
  }

  /* ---------- 项目申报 ---------- */

  function programById(id) {
    for (var i = 0; i < S.programs.length; i++) if (S.programs[i].id === id) return S.programs[i];
    return null;
  }

  function policyById(id) {
    for (var i = 0; i < POLICIES.length; i++) if (POLICIES[i].id === id) return POLICIES[i];
    return null;
  }

  function sectionOf(policyId, no) {
    var p = policyById(policyId);
    if (!p) return null;
    var hit = null;
    (p.sections || []).forEach(function (s) { if (String(s.no) === String(no)) hit = s; });
    return hit;
  }

  function evalRule(rule, v) {
    var target = rule.value;
    switch (rule.op) {
      case "eq": return v === target;
      case "in": return (target || []).indexOf(v) >= 0;
      case "gte": return Number(v) >= Number(target);
      case "lte": return Number(v) <= Number(target);
      case "prefix":
        if (rule.key === "region") return target === "湖南" ? isHunanRegion(v) : String(v || "").indexOf(target) === 0;
        return String(v || "").indexOf(target) === 0;
      default: return false;
    }
  }

  function diagnose(program, form) {
    var hits = [], misses = [];
    program.rules.forEach(function (r) {
      var v = form[r.key];
      var ok = evalRule(r, v);
      var sec = sectionOf(program.policyId, r.section);
      var item = {
        key: r.key,
        label: r.label,
        ok: ok,
        value: v,
        section: r.section,
        evidence: sec ? clip(sec.text, 120) : "",
        sectionTitle: sec ? sec.title : "",
      };
      if (ok) hits.push(item); else misses.push(item);
    });
    var total = hits.length + misses.length || 1;
    return {
      pass: misses.length === 0,
      score: Math.round((hits.length / total) * 100),
      hits: hits,
      misses: misses,
      total: total,
    };
  }

  function quote(program, amount) {
    var f = program.feeModel || {};
    var amt = Number(amount || 0);
    var ratioMin = Math.round((amt * (f.ratioMin || 0)) / 100);
    var ratioMax = Math.round((amt * (f.ratioMax || 0)) / 100);
    return {
      type: f.type,
      ratioMin: ratioMin,
      ratioMax: ratioMax,
      diagnosis: f.diagnosis || 0,
      agency: f.agency || 0,
      full: f.full || 0,
      bonus: f.bonus || 0,
      fixedTotal: (f.diagnosis || 0) + (f.agency || 0) + (f.full || 0) + (f.bonus || 0),
    };
  }

  function findApply(id) {
    for (var i = 0; i < ST.applies.length; i++) if (ST.applies[i].id === id) return ST.applies[i];
    return null;
  }

  var APPLY_STEPS = ["已提交", "资格诊断完成", "材料清单确认", "申报提交", "跟踪评审", "结果"];

  function createApply(program, form) {
    var d = diagnose(program, form);
    var ap = {
      id: uid("ap"),
      no: "A" + Date.now().toString().slice(-8),
      programId: program.id,
      programName: program.name,
      policyId: program.policyId,
      form: form,
      diagnosis: d,
      quote: quote(program, form.expectAmount || program.amountMin),
      status: "submitted",
      step: 1,
      paid: false,
      createdAt: nowText(),
      timeline: [{ at: nowText(), text: "提交服务单，资格诊断已生成" }],
    };
    ST.applies.unshift(ap);
    save();
    return ap;
  }

  function advanceApply(id) {
    var ap = findApply(id);
    if (!ap) return null;
    if (ap.step < APPLY_STEPS.length - 1) {
      ap.step++;
      ap.timeline.push({ at: nowText(), text: "推进到：" + APPLY_STEPS[ap.step] });
    } else {
      ap.timeline.push({ at: nowText(), text: "结果已记录，服务结束" });
    }
    if (ap.step >= 3) ap.status = "processing";
    save();
    return ap;
  }

  /* ---------- 页头同步 ---------- */

  function syncHeader() {
    var el = $("[data-pt-user]");
    if (el) {
      el.textContent = ST.user ? "我的" : "登录";
      el.setAttribute("href", ST.user ? "account.html" : "login.html");
    }
    var badge = $("[data-pt-plan]");
    if (badge) {
      badge.textContent = plan().name;
      badge.hidden = !isMember();
    }
  }

  /* ---------- 通用 UI：支付弹层 ---------- */

  function payModal(order, onDone) {
    var mask = document.createElement("div");
    mask.className = "pt-mask";
    mask.innerHTML =
      '<div class="pt-modal" role="dialog" aria-modal="true" aria-label="确认支付">' +
        '<div class="pt-modal-head"><b>确认支付</b><button type="button" class="pt-x" data-close aria-label="关闭">×</button></div>' +
        '<div class="pt-modal-body">' +
          '<p class="pt-ord">' + esc(order.title) + '</p>' +
          '<p class="pt-amt">' + money(order.amount) + '</p>' +
          '<p class="pt-ord">订单号 ' + esc(order.no) + '</p>' +
          '<div class="pt-ch">' +
            '<label><input type="radio" name="paych" value="transfer" checked /> 对公转账（推荐，后台人工核销）</label>' +
            '<label><input type="radio" name="paych" value="wechat" /> 微信支付（资质审核中，暂不可用）</label>' +
            '<label><input type="radio" name="paych" value="demo" /> 演示支付（不产生真实扣款）</label>' +
          '</div>' +
          '<p class="pt-tiny">演示态：确认后立即开通，不产生真实扣款。正式版本走对公转账或微信支付，开通时点以实际到账为准。</p>' +
        '</div>' +
        '<div class="pt-modal-foot"><button type="button" class="pt-btn ghost" data-close>取消</button><button type="button" class="pt-btn primary" data-ok>确认</button></div>' +
      '</div>';
    document.body.appendChild(mask);
    document.body.classList.add("pt-lock");

    function close() {
      mask.remove();
      document.body.classList.remove("pt-lock");
    }
    function ok() {
      var ch = (mask.querySelector('input[name="paych"]:checked') || {}).value || "transfer";
      if (ch === "wechat") {
        var tip = mask.querySelector(".pt-tiny");
        tip.textContent = "微信支付需要商户号与备案域名，本阶段尚未接入。请改选「对公转账」或「演示支付」。";
        tip.style.color = "var(--red)";
        return;
      }
      payOrder(order.no, ch);
      close();
      if (onDone) onDone();
    }
    mask.addEventListener("click", function (e) {
      if (e.target === mask || e.target.hasAttribute("data-close")) close();
    });
    mask.querySelector("[data-ok]").addEventListener("click", ok);
  }

  function toast(text) {
    var t = document.createElement("div");
    t.className = "pt-toast";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("on"); }, 10);
    setTimeout(function () { t.classList.remove("on"); setTimeout(function () { t.remove(); }, 300); }, 2200);
  }

  function needLogin(next) {
    location.href = "login.html?next=" + encodeURIComponent(next || location.pathname.split("/").pop() || "account.html");
  }

  /* ---------- 页面：登录 ---------- */

  function initLogin() {
    var form = $("#lg-form");
    if (!form) return;
    var phoneEl = $("#lg-phone"), codeEl = $("#lg-code");
    var sendBtn = $("#lg-send"), tip = $("#lg-tip");
    var timer = null;

    if (ST.user) {
      var n = new URLSearchParams(location.search).get("next");
      location.replace(n || "account.html");
      return;
    }

    sendBtn.addEventListener("click", function () {
      var phone = phoneEl.value.trim();
      if (!/^1\d{10}$/.test(phone)) {
        tip.textContent = "请输入 11 位手机号";
        tip.className = "pt-tip bad";
        return;
      }
      tip.textContent = "验证码已发送（演示态固定为 123456）";
      tip.className = "pt-tip ok";
      var left = 60;
      sendBtn.disabled = true;
      timer = setInterval(function () {
        left--;
        sendBtn.textContent = left + "s 后重发";
        if (left <= 0) { clearInterval(timer); sendBtn.disabled = false; sendBtn.textContent = "获取验证码"; }
      }, 1000);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var phone = phoneEl.value.trim();
      var code = codeEl.value.trim();
      if (!/^1\d{10}$/.test(phone)) { tip.textContent = "请输入 11 位手机号"; tip.className = "pt-tip bad"; return; }
      if (code !== "123456") { tip.textContent = "验证码不正确（演示态请输入 123456）"; tip.className = "pt-tip bad"; return; }
      var agree = $("#lg-agree");
      if (agree && !agree.checked) { tip.textContent = "请先阅读并同意服务协议与隐私政策"; tip.className = "pt-tip bad"; return; }
      login(phone);
      var n = new URLSearchParams(location.search).get("next");
      location.replace(n || "account.html");
    });

    var demo = $("#lg-demo");
    if (demo) demo.addEventListener("click", function () {
      login("13800000000");
      var n = new URLSearchParams(location.search).get("next");
      location.replace(n || "account.html");
    });
  }

  /* ---------- 页面：定价 ---------- */

  function initPricing() {
    var wrap = $("#pr-plans");
    if (!wrap) return;

    function render() {
      var curCode = ST.user ? plan().code : "";
      wrap.innerHTML = S.plans.map(function (p) {
        var isCur = !!curCode && p.code === curCode;
        var btn;
        if (isCur) btn = '<button type="button" class="pt-btn ghost wide" disabled>当前档位</button>';
        else if (p.code === "free") btn = '<a class="pt-btn ghost wide" href="login.html?next=account.html">注册即用</a>';
        else btn = '<button type="button" class="pt-btn primary wide" data-buy="' + p.code + '">' +
          (isMember() ? "升级到 " + p.name : "开通 " + p.name) + '</button>';
        return '<div class="plan-card' + (p.recommend ? " hot" : "") + (isCur ? " cur" : "") + '">' +
          (p.recommend ? '<span class="plan-flag">推荐</span>' : "") +
          '<p class="plan-name">' + esc(p.name) + '</p>' +
          '<p class="plan-price"><b>' + money(p.price) + '</b><span>/ ' + esc(p.period) + '</span></p>' +
          '<p class="plan-tag">' + esc(p.tagline) + '</p>' +
          '<ul class="plan-perks">' + p.perks.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul>' +
          btn + '</div>';
      }).join("");

      $$("[data-buy]", wrap).forEach(function (b) {
        b.addEventListener("click", function () {
          if (!ST.user) return needLogin("pricing.html");
          var code = b.getAttribute("data-buy");
          var p = planByCode(code);
          var o = createOrder({ type: "membership", title: "会员开通：" + p.name + "（1 年）", amount: p.price, meta: { planCode: code } });
          payModal(o, function () {
            save(); render(); renderMatrix();
            toast("已开通 " + p.name + "，有效期至 " + ST.planExpire);
          });
        });
      });
    }

    function renderMatrix() {
      var box = $("#pr-matrix");
      if (!box) return;
      var rows = [
        ["政策检索与条款原文", "search"], ["条款解读", "interp"], ["AI 提问", "ask"],
        ["政策推送", "push"], ["一般解答", "general"], ["专家解答", "expert"], ["项目申报", "apply"],
      ];
      var head = '<tr><th style="width:30%">权益</th>' + S.plans.map(function (p) {
        return '<th class="' + (p.code === plan().code ? "on" : "") + '">' + esc(p.name) + "</th>";
      }).join("") + "</tr>";
      var body = rows.map(function (r) {
        return "<tr><td>" + r[0] + "</td>" + S.plans.map(function (p) {
          return "<td>" + esc(p.matrix[r[1]] || "—") + "</td>";
        }).join("") + "</tr>";
      }).join("");
      box.innerHTML = "<table class='pt-table'><thead>" + head + "</thead><tbody>" + body + "</tbody></table>";
    }

    render(); renderMatrix();
  }

  /* ---------- 页面：账户 ---------- */

  function initAccount() {
    var root = $("#ac-root");
    if (!root) return;

    if (!ST.user) {
      root.innerHTML = '<div class="pt-panel pt-center">' +
        '<p class="pt-h3">还没有登录</p>' +
        '<p class="pt-p">登录后可查看会员状态、配额余量、推送设置、解答工单与申报进度。</p>' +
        '<div class="pt-row"><a class="pt-btn primary" href="login.html?next=account.html">手机号登录</a>' +
        '<a class="pt-btn ghost" href="pricing.html">先看会员权益</a></div></div>';
      return;
    }

    var p = plan();
    var q1 = quota("ask"), q2 = quota("general"), q3 = quota("expert");
    var expDays = daysFromToday(ST.planExpire);

    function bar(q) {
      if (q.unlimited) return '<div class="pt-bar"><i style="width:100%"></i></div><p class="pt-tiny">不限量</p>';
      var pct = q.limit ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 0;
      return '<div class="pt-bar"><i style="width:' + pct + '%"></i></div>' +
        '<p class="pt-tiny">已用 ' + num(q.used) + " / " + num(q.limit) + "</p>";
    }

    root.innerHTML =
      '<div class="pt-grid-2">' +
        '<div class="pt-panel">' +
          '<div class="pt-idcard">' +
            '<span class="pt-avatar">' + esc(maskPhone(ST.user.phone).slice(-2)) + '</span>' +
            '<div><p class="pt-h3">' + esc(maskPhone(ST.user.phone)) + '</p>' +
            '<p class="pt-tiny">注册于 ' + esc(ST.user.createdAt) + '</p></div>' +
            '<span class="pt-badge ' + (isMember() ? "ok" : "") + '">' + esc(p.name) + '</span>' +
          '</div>' +
          (isMember()
            ? '<p class="pt-p">会员有效期至 <b>' + esc(ST.planExpire) + '</b>' +
              (expDays !== null ? '（还剩 ' + expDays + ' 天）' : "") + '</p>'
            : '<p class="pt-p">当前为免费档。开通后解锁全部条款解读、更高提问额度与政策推送。</p>') +
          '<div class="pt-row">' +
            (isMember() ? '<a class="pt-btn ghost" href="pricing.html">续费 / 升级</a>' : '<a class="pt-btn primary" href="pricing.html">去开通会员</a>') +
            '<button type="button" class="pt-btn ghost" id="ac-logout">退出登录</button>' +
          '</div>' +
        '</div>' +

        '<div class="pt-panel">' +
          '<p class="pt-h4">本月配额</p>' +
          '<p class="pt-label">AI 提问（每月）</p>' + bar(q1) +
          '<p class="pt-label">一般解答（每年）</p>' + bar(q2) +
          '<p class="pt-label">专家解答（每年）</p>' + bar(q3) +
          '<p class="pt-tiny" style="margin-top:12px">条款解读按篇放开：免费档每篇前 3 条，会员全量。</p>' +
        '</div>' +
      '</div>' +

      '<div class="pt-grid-2" style="margin-top:16px">' +
        '<div class="pt-panel">' +
          '<div class="pt-ph"><p class="pt-h4">我的政策推送</p><a class="pt-link" href="push.html">设置 ›</a></div>' +
          (ST.push.themes.length
            ? '<p class="pt-p">主题：' + ST.push.themes.map(function (c) { var t = topicByCode(c); return esc(t ? t.name : c); }).join("、") + '</p>' +
              '<p class="pt-tiny">地区：' + (ST.push.regions.join("、") || "未选") + ' ｜ 频次：' + (FREQ_LABEL[ST.push.freq] || "周报") + '</p>'
            : '<p class="pt-p">还没订阅主题。选 1 个主题就能收到对应政策的推送。</p>' +
              '<a class="pt-btn ghost" href="push.html">去设置</a>') +
        '</div>' +
        '<div class="pt-panel">' +
          '<div class="pt-ph"><p class="pt-h4">我的专题解答</p><a class="pt-link" href="tickets.html">全部 ›</a></div>' +
          (ST.tickets.length
            ? '<ul class="pt-list">' + ST.tickets.slice(0, 3).map(function (t) {
                return '<li><a href="tickets.html?id=' + t.id + '">' + esc(clip(t.question, 26)) + '</a>' +
                  '<span class="pt-tiny">' + esc(ticketStatusText(t.status)) + '</span></li>';
              }).join("") + '</ul>'
            : '<p class="pt-p">还没有提问记录。</p><a class="pt-btn ghost" href="tickets.html">去提问</a>') +
        '</div>' +
      '</div>' +

      '<div class="pt-panel" style="margin-top:16px">' +
        '<div class="pt-ph"><p class="pt-h4">我的申报服务</p><a class="pt-link" href="apply.html">申报入口 ›</a></div>' +
        (ST.applies.length
          ? '<ul class="pt-list">' + ST.applies.slice(0, 3).map(function (a) {
              return '<li><a href="apply.html?id=' + a.id + '">' + esc(a.programName) + '</a>' +
                '<span class="pt-tiny">' + esc(APPLY_STEPS[a.step]) + '</span></li>';
            }).join("") + '</ul>'
          : '<p class="pt-p">还没有申报服务单。可先做一次免费资格诊断。</p>' +
            '<a class="pt-btn ghost" href="apply.html">去做诊断</a>') +
      '</div>' +

      '<div class="pt-panel" style="margin-top:16px">' +
        '<div class="pt-ph"><p class="pt-h4">站内消息</p>' +
          (unread() ? '<button type="button" class="pt-link" id="ac-read">全部标记已读</button>' : "") + '</div>' +
        (ST.inbox.length
          ? '<ul class="pt-list">' + ST.inbox.slice(0, 5).map(function (m) {
              return '<li class="' + (m.read ? "" : "unread") + '"><b>' + esc(m.title) + '</b>' +
                '<span class="pt-tiny">' + esc(m.at) + '</span><p class="pt-tiny">' + esc(clip(m.body, 60)) + '</p></li>';
            }).join("") + '</ul>'
          : '<p class="pt-p">暂无消息。</p>') +
      '</div>';

    var lo = $("#ac-logout");
    if (lo) lo.addEventListener("click", function () { logout(); location.href = "index.html"; });
    var rd = $("#ac-read");
    if (rd) rd.addEventListener("click", function () { markRead(); location.reload(); });
  }

  function ticketStatusText(s) {
    return {
      ai_answered: "AI 已答", pending_assign: "待分派专家", in_progress: "专家处理中",
      answered: "专家已答", closed: "已关闭",
    }[s] || s;
  }

  /* ---------- 页面：推送 ---------- */

  function initPush() {
    var root = $("#pu-root");
    if (!root) return;
    if (!ST.user) return needLogin("push.html");

    var maxThemes = limits().pushThemes === -1 ? 99 : (limits().pushThemes || 1);
    var maxRegions = limits().pushRegions === -1 ? 99 : (limits().pushRegions || 1);
    var maxFreq = FREQ_LEVEL[limits().pushFreq || "weekly"];

    function renderThemes() {
      var box = $("#pu-themes");
      box.innerHTML = S.topics.map(function (t) {
        var on = ST.push.themes.indexOf(t.code) >= 0;
        return '<button type="button" class="pill' + (on ? " on" : "") + '" data-theme="' + t.code + '" aria-pressed="' + on + '">' +
          esc(t.name) + '</button>';
      }).join("");
      $$("[data-theme]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          var code = b.getAttribute("data-theme");
          var i = ST.push.themes.indexOf(code);
          if (i >= 0) ST.push.themes.splice(i, 1);
          else {
            if (ST.push.themes.length >= maxThemes) {
              toast("当前档位最多选 " + maxThemes + " 个主题，升级可放宽");
              return;
            }
            ST.push.themes.push(code);
          }
          save(); renderThemes(); renderPreview();
        });
      });
      $("#pu-theme-count").textContent = ST.push.themes.length + " / " + (maxThemes === 99 ? "不限" : maxThemes);
    }

    function renderRegions() {
      var box = $("#pu-regions");
      var list = ["全国", "湖南省"].concat(CITIES);
      box.innerHTML = list.map(function (r) {
        var on = ST.push.regions.indexOf(r) >= 0;
        return '<button type="button" class="pill' + (on ? " on" : "") + '" data-region="' + r + '" aria-pressed="' + on + '">' + esc(r) + '</button>';
      }).join("");
      $$("[data-region]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          var r = b.getAttribute("data-region");
          var i = ST.push.regions.indexOf(r);
          if (i >= 0) ST.push.regions.splice(i, 1);
          else {
            if (ST.push.regions.length >= maxRegions) {
              toast("当前档位最多选 " + maxRegions + " 个地区，升级可放宽");
              return;
            }
            ST.push.regions.push(r);
          }
          save(); renderRegions(); renderPreview();
        });
      });
      $("#pu-region-count").textContent = ST.push.regions.length + " / " + (maxRegions === 99 ? "不限" : maxRegions);
    }

    function renderFreq() {
      var box = $("#pu-freq");
      box.innerHTML = ["weekly", "daily", "instant"].map(function (f) {
        var locked = FREQ_LEVEL[f] > maxFreq;
        var on = ST.push.freq === f;
        return '<button type="button" class="pill' + (on ? " on" : "") + (locked ? " lock" : "") + '" data-freq="' + f + '" aria-pressed="' + on + '"' +
          (locked ? ' title="当前档位不可用"' : "") + '>' + FREQ_LABEL[f] + (locked ? " · 需升级" : "") + '</button>';
      }).join("");
      $$("[data-freq]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          var f = b.getAttribute("data-freq");
          if (FREQ_LEVEL[f] > maxFreq) { toast("当前档位不支持该频次，升级后可开启"); return; }
          ST.push.freq = f; save(); renderFreq(); renderPreview();
        });
      });
    }

    function renderChannels() {
      var box = $("#pu-channels");
      var list = [["inbox", "站内消息"], ["email", "邮件"], ["wechat", "微信服务号"]];
      box.innerHTML = list.map(function (c) {
        var on = ST.push.channels.indexOf(c[0]) >= 0;
        var soon = c[0] === "wechat";
        return '<label class="pt-chk"><input type="checkbox" data-ch="' + c[0] + '"' + (on ? " checked" : "") + (soon ? " disabled" : "") + " /> " +
          c[1] + (soon ? ' <span class="pt-tiny">（需认证服务号，P3 上线）</span>' : "") + "</label>";
      }).join("");
      $$("[data-ch]", box).forEach(function (c) {
        c.addEventListener("change", function () {
          var key = c.getAttribute("data-ch");
          var i = ST.push.channels.indexOf(key);
          if (c.checked && i < 0) ST.push.channels.push(key);
          if (!c.checked && i >= 0) ST.push.channels.splice(i, 1);
          save();
        });
      });
    }

    function renderPreview() {
      var hits = matchPush(ST.push);
      var box = $("#pu-preview");
      var head = '<div class="pt-ph"><p class="pt-h4">按当前设置，已收录政策中有 ' + hits.length + " 条</p>" +
        '<span class="pt-tiny">' + (ST.push.themes.length ? FREQ_LABEL[ST.push.freq] : "还没选主题") + "</span></div>";
      if (!ST.push.themes.length) {
        box.innerHTML = head + '<p class="pt-p">先在上面选至少 1 个主题，这里会立刻列出会被推送到的政策。</p>';
        return;
      }
      box.innerHTML = head + (hits.length
        ? '<ul class="pt-list">' + hits.slice(0, 8).map(function (p) {
            return '<li><a href="policy-' + esc(p.id) + '.html">' + esc(clip(p.title, 30)) + '</a>' +
              '<span class="pt-tiny">' + esc(p.region) + " · " + esc(p.publishedAt) + "</span></li>";
          }).join("") + "</ul>" +
          (hits.length > 8 ? '<p class="pt-tiny">另有 ' + (hits.length - 8) + " 条未展示</p>" : "")
        : '<p class="pt-p">当前主题与地区组合下没有匹配到政策。换个更大的地区范围（如「湖南省」）试试。</p>');

      var inboxBox = $("#pu-inbox");
      if (inboxBox) {
        if (!hits.length) {
          inboxBox.innerHTML = '<p class="pt-p">暂无可推送的内容。选了主题和地区后，这里会生成一条本周摘要。</p>';
        } else {
          var names = ST.push.themes.map(function (c) { var t = topicByCode(c); return t ? t.name : c; }).join(" / ");
          var digest = '<div class="pt-digest">' +
            '<p class="pt-h4">本周政策速递</p>' +
            '<p class="pt-tiny">' + esc(names || "未选主题") + " · " + esc(ST.push.regions.join("、") || "未选地区") + " · " + FREQ_LABEL[ST.push.freq] + "</p>" +
            '<p class="pt-p">新增 ' + hits.length + " 条与你订阅的主题和地区匹配，摘要如下：</p>" +
            '<ol class="pt-rank">' + hits.slice(0, 3).map(function (p) {
              return '<li><a href="policy-' + esc(p.id) + '.html">' + esc(clip(p.title, 34)) + "</a>" +
                '<span class="pt-tiny">' + esc(p.region) + " · " + esc(p.publishedAt) + "</span></li>";
            }).join("") + "</ol>" +
            '<a class="pt-btn ghost" href="policies.html">查看全部 ' + hits.length + " 条</a></div>";
          inboxBox.innerHTML = digest;
        }
      }
    }

    renderThemes(); renderRegions(); renderFreq(); renderChannels(); renderPreview();

    var btn = $("#pu-save");
    if (btn) btn.addEventListener("click", function () {
      savePush(ST.push);
      ST.inbox.unshift({
        id: uid("msg"), at: nowText(), kind: "push",
        title: "推送设置已保存",
        body: "主题 " + ST.push.themes.length + " 个 · 地区 " + ST.push.regions.length + " 个 · " + (FREQ_LABEL[ST.push.freq] || ""),
        read: false,
      });
      save();
      toast("已保存，下次发布政策时按新设置推送");
    });
  }

  /* ---------- 页面：专题解答 ---------- */

  function initTickets() {
    var root = $("#tk-root");
    if (!root) return;
    if (!ST.user) return needLogin("tickets.html");

    var form = $("#tk-form");
    var listBox = $("#tk-list");
    var detailBox = $("#tk-detail");

    function renderList() {
      if (!ST.tickets.length) {
        listBox.innerHTML = '<p class="pt-p">还没有工单。左边提一个问题，系统会先用条款给你一个带出处的答案。</p>';
        return;
      }
      listBox.innerHTML = '<ul class="pt-list">' + ST.tickets.map(function (t) {
        var active = currentId === t.id ? " class='on'" : "";
        return "<li" + active + '><a href="tickets.html?id=' + t.id + '">' + esc(clip(t.question, 24)) + '</a>' +
          '<span class="pt-badge ' + (t.status === "answered" ? "ok" : "") + '">' + esc(ticketStatusText(t.status)) + "</span></li>";
      }).join("") + "</ul>";
    }

    var currentId = new URLSearchParams(location.search).get("id") || (ST.tickets[0] && ST.tickets[0].id) || "";

    function renderDetail() {
      var tk = findTicket(currentId);
      if (!tk) {
        detailBox.innerHTML = '<p class="pt-p">选择左侧工单查看详情，或先提一个新问题。</p>';
        return;
      }
      var html = '<div class="pt-ph"><p class="pt-h4">' + esc(tk.question) + '</p>' +
        '<span class="pt-badge">' + esc(ticketStatusText(tk.status)) + "</span></div>" +
        '<p class="pt-tiny">工单号 ' + esc(tk.no) + " · 提交于 " + esc(tk.createdAt) + " · 分类 " + esc(CATEGORY_LABEL[tk.category] || "其他") + "</p>" +
        '<div class="pt-thread">' + tk.messages.map(function (m) {
          var who = m.role === "user" ? "我" : m.role === "ai" ? "AI 一般解答" : (m.by || "专家") + " · " + (m.level || "");
          return '<div class="pt-msg ' + m.role + '"><p class="pt-who">' + esc(who) + '<span class="pt-tiny">' + esc(m.at) + "</span></p>" +
            '<div class="pt-text">' + esc(m.text).replace(/\n/g, "<br />") + "</div>" +
            (m.cites && m.cites.length ? '<div class="pt-cites"><p class="pt-label" style="margin:0 0 4px">依据条款</p>' + m.cites.map(function (c) {
              return '<a class="pt-cite" href="policy-' + esc(c.policyId) + ".html#sec-" + encodeURIComponent(c.sectionNo) + '">' +
                "《" + esc(clip(c.policyTitle, 20)) + "》第" + esc(c.sectionNo) + "条 · " + esc(clip(c.sectionTitle || "", 14)) + "</a>";
            }).join("") + "</div>" : "") + "</div>";
        }).join("") + "</div>";

      // 操作区
      if (tk.status === "ai_answered") {
        html += '<div class="pt-actions"><button type="button" class="pt-btn primary" data-act="toexpert">这答案没解决，转专家</button>' +
          '<button type="button" class="pt-btn ghost" data-act="close">问题解决了</button></div>' +
          '<p class="pt-tiny">转专家需要选择专家等级并支付服务费；专家会在 SLA 时间内给出结论、依据条款、材料清单与办理路径。</p>';
      } else if (tk.status === "pending_assign") {
        html += '<div class="pt-box"><p class="pt-h4">已支付 ' + money(tk.price) + '，等待分派</p>' +
          '<p class="pt-p">演示态：点击下方按钮模拟专家接单并给出答复。</p>' +
          '<button type="button" class="pt-btn primary" data-act="mocktake">模拟专家接单</button></div>';
      } else if (tk.status === "in_progress") {
        html += '<div class="pt-box"><p class="pt-h4">专家处理中</p><p class="pt-p">按 SLA 约定时间交付。</p>' +
          '<button type="button" class="pt-btn primary" data-act="mockreply">模拟专家提交答复</button></div>';
      } else if (tk.status === "answered") {
        html += '<div class="pt-actions"><button type="button" class="pt-btn ghost" data-act="close">标记已解决</button></div>' +
          '<div class="pt-rate"><p class="pt-label">这次答复有帮助吗</p>' +
          [5, 4, 3].map(function (n) { return '<button type="button" class="pt-btn ghost" data-rate="' + n + '">' + n + " 分</button>"; }).join("") +
          (tk.rating ? '<span class="pt-tiny" style="margin-left:8px">已评 ' + tk.rating + " 分</span>" : "") + "</div>";
      }

      detailBox.innerHTML = html;

      $$("[data-act]", detailBox).forEach(function (b) {
        b.addEventListener("click", function () {
          var act = b.getAttribute("data-act");
          if (act === "toexpert") openExperts(tk);
          if (act === "close") { tk.status = "closed"; save(); renderAll(); toast("已标记解决"); }
          if (act === "mocktake") { expertTake(tk.id); renderAll(); }
          if (act === "mockreply") { expertReply(tk.id); renderAll(); toast("专家已提交答复"); }
        });
      });
      $$("[data-rate]", detailBox).forEach(function (b) {
        b.addEventListener("click", function () {
          tk.rating = Number(b.getAttribute("data-rate"));
          save(); renderAll();
        });
      });
    }

    function openExperts(tk) {
      var list = recommendExperts(tk.category);
      var mask = document.createElement("div");
      mask.className = "pt-mask";
      mask.innerHTML = '<div class="pt-modal wide" role="dialog" aria-modal="true" aria-label="选择专家">' +
        '<div class="pt-modal-head"><b>选择专家解答</b><button type="button" class="pt-x" data-close aria-label="关闭">×</button></div>' +
        '<div class="pt-modal-body"><p class="pt-p">按你的问题分类推荐。等级越高、SLA 越短、价格越高。</p>' +
        list.map(function (e) {
          return '<div class="pt-expert"><span class="pt-avatar">' + esc(e.initial) + "</span>" +
            '<div class="pt-ex-main"><p class="pt-h4">' + esc(e.name) + ' <span class="pt-badge">' + esc(e.level) + "</span></p>" +
            '<p class="pt-tiny">' + esc(e.title) + " · " + esc(e.org) + "</p>" +
            '<p class="pt-tiny">擅长：' + esc(e.domains.join("、")) + " ｜ 评分 " + e.rating + " ｜ 已答 " + e.cases + " 单</p>" +
            '<p class="pt-tiny">交付：' + esc(e.deliverable) + "</p></div>" +
            '<div class="pt-ex-buy"><b>' + money(e.price) + "</b><p class='pt-tiny'>" + e.slaHours + " 小时内答复</p>" +
            '<button type="button" class="pt-btn primary" data-pick="' + e.id + '">选择</button></div></div>';
        }).join("") + "</div></div>";
      document.body.appendChild(mask);
      document.body.classList.add("pt-lock");
      function close() { mask.remove(); document.body.classList.remove("pt-lock"); }
      mask.addEventListener("click", function (e) {
        if (e.target === mask || e.target.hasAttribute("data-close")) close();
      });
      $$("[data-pick]", mask).forEach(function (b) {
        b.addEventListener("click", function () {
          var e = pickExpert(b.getAttribute("data-pick"));
          tk.expertId = e.id;
          var o = createOrder({
            type: "ticket", refId: tk.id, title: "专家解答：" + e.name + "（" + e.level + "）",
            amount: e.price, meta: { expertId: e.id },
          });
          close();
          payModal(o, function () { save(); renderAll(); toast("已支付，等待专家接单"); });
        });
      });
    }

    function renderAll() { renderList(); renderDetail(); currentId = currentId || (ST.tickets[0] && ST.tickets[0].id) || ""; }

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var q = $("#tk-q").value.trim();
        if (q.length < 6) { toast("把问题写清楚一点，至少 6 个字"); return; }
        var cat = $("#tk-cat").value;
        var tk = createTicket({ category: cat, question: q, policyId: $("#tk-policy") ? $("#tk-policy").value : "" });
        currentId = tk.id;
        try { history.replaceState(null, "", "tickets.html?id=" + tk.id); } catch (e) {}
        $("#tk-q").value = "";
        renderAll();
        toast("已生成 AI 解答");
      });
    }

    renderAll();
  }

  /* ---------- 页面：项目申报 ---------- */

  var FIELDS = {
    region: { label: "注册 / 经营地区", type: "select", options: ["湖南省"].concat(CITIES).concat(["湖南省外"]) },
    years: { label: "成立年限（年）", type: "number", min: 0, step: 1 },
    employees: { label: "从业人数（人）", type: "number", min: 0, step: 1 },
    revenue: { label: "上年度营业收入（万元）", type: "number", min: 0, step: 1 },
    industry: { label: "所属行业", type: "select", options: ["制造业", "科技服务", "商贸", "餐饮", "农业", "其他"] },
    category: {
      label: "人员类别", type: "select",
      options: ["离校2年内高校毕业生", "院校在校学生", "就业困难人员", "返乡入乡农民工", "毕业5年内高校毕业生", "退役军人", "其他"],
    },
    firstStartup: { label: "是否省内首次创业", type: "bool" },
    innovative: { label: "是否有效期内的创新型中小企业", type: "bool" },
    rdRatio: { label: "研发费用占营收比重（%）", type: "number", min: 0, step: 0.1 },
    invest: { label: "项目总投资（万元）", type: "number", min: 0, step: 1 },
    loanYears: { label: "项目贷款已满（年）", type: "number", min: 0, step: 0.5 },
    insuredMonths: { label: "失业保险足额缴纳（月）", type: "number", min: 0, step: 1 },
    layoffRate: { label: "上年度裁员率（%）", type: "number", min: 0, step: 0.1 },
  };


  /** 条件分组：同一法条只展示一次原文，避免同一段证据重复四遍 */
  function condGroup(title, items, tone) {
    var head = '<p class="pt-h4 ' + tone + '">' + title + "（" + items.length + "）</p>";
    if (!items.length) {
      return '<div class="pt-panel">' + head + '<p class="pt-p">' + (tone === "ok" ? "暂无" : "全部满足。") + "</p></div>";
    }
    var bySec = {}, order = [];
    items.forEach(function (it) {
      var k = String(it.section || "-");
      if (!bySec[k]) { bySec[k] = { title: it.sectionTitle || "", ev: it.evidence || "", n: 0 }; order.push(k); }
      bySec[k].n++;
    });
    var lis = items.map(function (it) {
      return "<li>" + (it.ok ? "✓ " : "! ") + esc(it.label) + "</li>";
    }).join("");
    var evs = order.map(function (k) {
      return '<p class="pt-label">依据 · 第' + esc(k) + "条 " + esc(bySec[k].title) + "</p>" +
        '<p class="pt-tiny">' + esc(bySec[k].ev) + "</p>";
    }).join("");
    return '<div class="pt-panel">' + head + '<ul class="pt-checks">' + lis + "</ul>" + evs + "</div>";
  }

  function initApply() {
    var root = $("#ap-root");
    if (!root) return;

    var state = { programId: "", diagnosis: null, form: {}, amount: 0, applyId: "" };
    var qid = new URLSearchParams(location.search).get("id");
    if (qid && findApply(qid)) {
      var ap = findApply(qid);
      state.programId = ap.programId;
      state.form = ap.form;
      state.diagnosis = ap.diagnosis;
      state.applyId = ap.id;
      state.amount = ap.quote ? ap.form.expectAmount || 0 : 0;
      renderDetail(ap);
      return;
    }

    renderPicker();

    function renderPicker() {
      root.innerHTML = '<div class="pt-ph"><p class="pt-h4">选择要申报的项目</p>' +
        '<span class="pt-tiny">按项目类型自动生成对应问卷，只问这个项目真正用得到的条件</span></div>' +
        '<div class="pt-progs">' + S.programs.map(function (p) {
          var left = daysFromToday(p.deadline);
          return '<button type="button" class="pt-prog" data-prog="' + p.id + '">' +
            '<div class="pt-prog-top"><span class="pt-badge">' + esc(p.level) + "</span>" +
            (p.feeModel.type === "ratio" ? '<span class="pt-badge gold">比例制</span>' : '<span class="pt-badge">固定制</span>') + "</div>" +
            '<p class="pt-h4">' + esc(p.name) + "</p>" +
            '<p class="pt-tiny">' + esc(p.agency) + "</p>" +
            '<p class="pt-p">' + esc(p.summary) + "</p>" +
            '<div class="pt-prog-foot"><span>' + esc(p.amountText) + "</span>" +
            '<span class="' + (left !== null && left < 30 ? "pt-warn" : "") + '">' + (left === null ? "" : left > 0 ? "截止还剩 " + left + " 天" : "已截止") + "</span></div>" +
            "</button>";
        }).join("") + "</div>";

      $$("[data-prog]", root).forEach(function (b) {
        b.addEventListener("click", function () {
          state.programId = b.getAttribute("data-prog");
          renderForm();
        });
      });
    }

    function renderForm() {
      var p = programById(state.programId);
      var keys = [];
      p.rules.forEach(function (r) { if (keys.indexOf(r.key) < 0) keys.push(r.key); });
      if (p.feeModel.type === "ratio") keys.push("expectAmount");

      root.innerHTML = '<p class="pt-back"><button type="button" class="pt-link" id="ap-back">‹ 换一个项目</button></p>' +
        '<div class="pt-ph">' +
        '<p class="pt-h4">' + esc(p.name) + '</p></div>' +
        '<p class="pt-p">' + esc(p.summary) + '</p>' +
        '<p class="pt-tiny">依据政策：<a href="policy-' + esc(p.policyId) + '.html">' + esc(clip((policyById(p.policyId) || {}).title || p.name, 40)) + "</a></p>" +
        '<form id="ap-form" class="pt-form">' + keys.map(function (k) {
          if (k === "expectAmount") {
            return '<label class="pt-field"><span>' + "预计获批金额（元）" + '</span>' +
              '<input type="number" name="expectAmount" min="0" step="1000" value="' + (p.amountMin || 0) + '" /></label>';
          }
          var f = FIELDS[k];
          if (!f) return "";
          var input;
          if (f.type === "select") {
            input = '<select name="' + k + '">' + f.options.map(function (o) {
              return '<option value="' + esc(o) + '">' + esc(o) + "</option>";
            }).join("") + "</select>";
          } else if (f.type === "bool") {
            input = '<select name="' + k + '"><option value="true">是</option><option value="false">否</option></select>';
          } else {
            input = '<input type="number" name="' + k + '" min="' + (f.min || 0) + '" step="' + (f.step || 1) + '" value="' + (f.min || 0) + '" />';
          }
          return '<label class="pt-field"><span>' + esc(f.label) + "</span>" + input + "</label>";
        }).join("") + '<div class="pt-row"><button type="submit" class="pt-btn primary">生成诊断报告</button>' +
          '<span class="pt-tiny">诊断免费；需要代办时再签服务单</span></div></form>';

      $("#ap-back").addEventListener("click", renderPicker);
      $("#ap-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var form = {};
        fd.forEach(function (v, k) {
          if (v === "true") form[k] = true;
          else if (v === "false") form[k] = false;
          else form[k] = isNaN(Number(v)) || v === "" ? v : Number(v);
        });
        state.form = form;
        state.amount = Number(form.expectAmount || p.amountMin || 0);
        state.diagnosis = diagnose(p, form);
        renderResult(p);
      });
    }

    function renderResult(p) {
      var d = state.diagnosis;
      var q = quote(p, state.amount);
      var discBp = limits().applyDiscount || 100;
      var feeNow = Math.round((q.diagnosis * discBp) / 100);
      var ctaText = !ST.user
        ? "登录后提交服务单"
        : (isMember()
            ? "提交并支付诊断费 " + money(feeNow) + "（" + discBp / 10 + " 折）"
            : "提交并支付诊断费 " + money(feeNow));
      var ratioBlock = '<div class="pt-quote"><p class="pt-label">比例制（按申报资金）</p>' +
        '<p class="pt-quote-n">' + money(q.ratioMin) + " – " + money(q.ratioMax) + "</p>" +
        '<p class="pt-tiny">申报资金 ' + money(state.amount) + " × 10%–20%；按实际到账金额结算，不代领资金</p></div>";
      var fixedBlock = '<div class="pt-quote"><p class="pt-label">固定制（明码标价）</p>' +
        '<p class="pt-quote-n">' + money(q.fixedTotal) + "</p>" +
        '<p class="pt-tiny">诊断 ' + money(q.diagnosis) + "（可抵）+ 代办 " + money(q.agency) + " + 全程 " + money(q.full) + "</p></div>";

      root.innerHTML = '<p class="pt-back"><button type="button" class="pt-link" id="ap-back">‹ 换一个项目</button></p>' +
        '<div class="pt-ph">' +
        '<p class="pt-h4">诊断报告 · ' + esc(p.name) + "</p></div>" +

        '<div class="pt-score"><div class="pt-score-n">' + d.score + '<small>分</small></div>' +
        '<div><p class="pt-h4">' + (d.pass ? "条件全部命中，可以准备材料" : "有 " + d.misses.length + " 项条件未满足") + "</p>" +
        '<p class="pt-tiny">共 ' + d.total + " 项条件，命中 " + d.hits.length + " 项；每项都对应到政策条款</p></div></div>" +

        '<div class="pt-grid-2" style="margin-top:14px">' +
          condGroup("✓ 已满足", d.hits, "ok") +
          condGroup("! 待补足", d.misses, "bad") +
        "</div>" +

        '<div class="pt-panel" style="margin-top:16px"><p class="pt-h4">服务报价</p>' +
        '<div class="pt-grid-2">' + (p.feeModel.type === "ratio" ? ratioBlock + fixedBlock : fixedBlock + ratioBlock) + "</div>" +
        '<p class="pt-tiny">两种计价口径并存：比例制按文档口径实现，固定制为替代方案。签合同前以书面报价为准，均不承诺获批。</p></div>' +

        '<div class="pt-panel" style="margin-top:16px"><div class="pt-ph"><p class="pt-h4">提交服务单</p>' +
        '<span class="pt-tiny">提交后进入「材料清单确认」，可随时在账户页查看进度</span></div>' +
        '<div class="pt-row"><button type="button" class="pt-btn primary" id="ap-submit">' + ctaText + "</button>" +
        '<button type="button" class="pt-btn ghost" id="ap-again">改一改条件</button></div>' +
        '<p class="pt-tiny">材料清单：' + esc(p.materials.slice(0, 4).join("、")) + " 等 " + p.materials.length + " 项</p></div>";

      $("#ap-back").addEventListener("click", renderPicker);
      $("#ap-again").addEventListener("click", renderForm);
      $("#ap-submit").addEventListener("click", function () {
        if (!ST.user) return needLogin("apply.html");
        var ap = createApply(p, state.form);
        state.applyId = ap.id;
        var o = createOrder({ type: "apply", refId: ap.id, title: "申报诊断与代办：" + p.name, amount: feeNow, meta: { programId: p.id } });
        payModal(o, function () {
          // file:// 下 origin 为 null，replaceState 会抛错，包一层；失败也不影响渲染
          try { history.replaceState(null, "", "apply.html?id=" + ap.id); } catch (e) {}
          renderDetail(findApply(ap.id));
        });
      });
    }

    function renderDetail(ap) {
      if (!ap) return renderPicker();
      var p = programById(ap.programId) || { materials: [], steps: [] };
      var html = '<div class="pt-ph"><p class="pt-h4">' + esc(ap.programName) + '</p>' +
        '<span class="pt-badge ' + (ap.paid ? "ok" : "") + '">' + (ap.paid ? "服务单已生效" : "待支付") + "</span></div>" +
        '<p class="pt-tiny">服务单号 ' + esc(ap.no) + " · 提交于 " + esc(ap.createdAt) + " · 诊断得分 " + ap.diagnosis.score + "</p>" +
        '<div class="pt-steps">' + APPLY_STEPS.map(function (s, i) {
          return '<div class="pt-step' + (i <= ap.step ? " done" : "") + (i === ap.step ? " cur" : "") + '"><i>' + (i + 1) + "</i><span>" + esc(s) + "</span></div>";
        }).join("") + "</div>" +
        '<div class="pt-grid-2" style="margin-top:16px">' +
          '<div class="pt-panel"><p class="pt-h4">进度记录</p><ul class="pt-list">' +
            ap.timeline.map(function (t) { return "<li><b>" + esc(t.text) + '</b><span class="pt-tiny">' + esc(t.at) + "</span></li>"; }).join("") +
          "</ul>" + (ap.step < APPLY_STEPS.length - 1 ? '<button type="button" class="pt-btn ghost" id="ap-next">模拟推进下一步</button>' : "") + "</div>" +
          '<div class="pt-panel"><p class="pt-h4">材料清单</p><ul class="pt-checks">' +
            (p.materials || []).map(function (m) { return "<li>" + esc(m) + '</li>'; }).join("") + "</ul></div>" +
        "</div>" +
        '<div class="pt-grid-2" style="margin-top:16px">' +
          condGroup("✓ 已满足", ap.diagnosis.hits, "ok") +
          condGroup("! 待补足", ap.diagnosis.misses, "bad") +
        "</div>" +
        '<p class="pt-tiny" style="margin-top:12px">审批结果以主管部门认定为准。本服务为咨询与代办，不作为申报主体、不代领资金、不承诺获批。</p>';

      root.innerHTML = html;
      var nx = $("#ap-next");
      if (nx) nx.addEventListener("click", function () {
        var next = advanceApply(ap.id);
        renderDetail(next);
      });
    }
  }

  /* ---------- 启动 ---------- */

  /** 政策详情页：会员解锁全部解读 */
  function unlockDetail() {
    var lock = document.getElementById("member-lock");
    if (lock && isMember()) lock.classList.add("unlocked");
  }

  document.addEventListener("DOMContentLoaded", function () {
    syncHeader();
    var page = document.body.getAttribute("data-page");
    if (page === "policy") unlockDetail();
    try {
      if (page === "login") initLogin();
      else if (page === "pricing") initPricing();
      else if (page === "account") initAccount();
      else if (page === "push") initPush();
      else if (page === "tickets") initTickets();
      else if (page === "apply") initApply();
    } catch (err) {
      if (window.console) console.error("[member]", err);
    }
  });

  /* 给其他页面用 */
  window.PT = {
    state: ST, save: save, plan: plan, isMember: isMember, limits: limits,
    quota: quota, consume: consume, user: function () { return ST.user; },
    tickets: function () { return ST.tickets; }, applies: function () { return ST.applies; },
    createTicket: createTicket, aiAnswer: aiAnswer, login: login, logout: logout,
    programs: function () { return S.programs; }, diagnose: diagnose, quote: quote,
  };
})();
