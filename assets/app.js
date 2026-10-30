/* 政策通 · 静态站点交互
   没有构建步骤、没有依赖：数据来自 assets/data.js（由 build.mjs 从 JSON 生成）。 */
(function () {
  "use strict";

  var POLICIES = window.POLICIES || [];
  var LEVEL_LABEL = {
    national: "国家级",
    provincial: "省级",
    city: "市级",
    district: "区县级",
  };
  var STATUS_LABEL = { active: "有效", expiring: "即将到期", expired: "已过期" };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
          c
        ] || c
      );
    });
  }
  function statusOf(policy) {
    if (!policy.expiresAt) return "active";
    var left = new Date(policy.expiresAt + "T23:59:59").getTime() - Date.now();
    if (left < 0) return "expired";
    if (left < 90 * 86400000) return "expiring";
    return "active";
  }
  function shortTitle(title) {
    return String(title)
      .replace(/^关于/, "")
      .replace(/的(公告|通知|办法|实施意见)$/, "")
      .slice(0, 18);
  }

  /* ---------- 政策卡 ---------- */

  function cardHTML(policy) {
    var status = statusOf(policy);
    var tags = policy.tags
      .slice(0, 3)
      .map(function (t) {
        return '<span class="tag">' + esc(t) + "</span>";
      })
      .join("");
    var flags =
      (policy.isSample
        ? '<span class="chip-flag sample">示例数据</span>'
        : "") +
      (!policy.verified
        ? '<span class="chip-flag">原文待核对</span>'
        : "");
    return (
      '<a class="policy-card' +
      (status === "expired" ? " expired" : "") +
      '" href="policy-' +
      esc(policy.id) +
      '.html">' +
      '<div class="top">' +
      '<span class="badge">' +
      esc(LEVEL_LABEL[policy.level] || policy.level) +
      "</span>" +
      '<span class="status ' +
      status +
      '"><i></i>' +
      STATUS_LABEL[status] +
      "</span>" +
      flags +
      '<span class="region">' +
      esc(policy.region) +
      "</span>" +
      "</div>" +
      "<h3>" +
      esc(policy.title) +
      "</h3>" +
      '<p class="summary">' +
      esc(policy.summary) +
      "</p>" +
      '<div class="tags">' +
      tags +
      "</div>" +
      '<div class="meta">' +
      "<span>" +
      esc(policy.issuer) +
      "</span>" +
      (policy.documentNo ? "<span>" + esc(policy.documentNo) + "</span>" : "") +
      "<span>发布 " +
      esc(policy.publishedAt) +
      "</span>" +
      (policy.expiresAt ? "<span>截止 " + esc(policy.expiresAt) + "</span>" : "") +
      "</div>" +
      "</a>"
    );
  }

  /* ---------- 政策库 ---------- */

  function initList() {
    var qInput = $("#q");
    var results = $("#results");
    var count = $("#count");
    var empty = $("#empty");
    var activeOnly = $("#activeOnly");
    var level = "all";
    var tag = null;

    function haystack(policy) {
      var parts = [
        policy.title,
        policy.summary,
        policy.issuer,
        policy.documentNo,
        policy.region,
        policy.tags.join(" "),
        policy.audience.join(" "),
      ];
      policy.sections.forEach(function (s) {
        parts.push(s.title + s.text);
      });
      policy.interpretations.forEach(function (i) {
        parts.push(i.headline + i.who);
      });
      return parts.join(" ").toLowerCase();
    }

    function render() {
      var keyword = (qInput.value || "").trim().toLowerCase();
      var list = POLICIES.filter(function (p) {
        if (level !== "all" && p.level !== level) return false;
        if (tag && p.tags.indexOf(tag) === -1) return false;
        if (activeOnly.checked && statusOf(p) === "expired") return false;
        if (!keyword) return true;
        return haystack(p).indexOf(keyword) !== -1;
      });

      results.innerHTML = list.map(cardHTML).join("");
      count.textContent = String(list.length);
      empty.hidden = list.length !== 0;
      results.hidden = list.length === 0;
    }

    $$("[data-level]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        level = btn.getAttribute("data-level");
        $$("[data-level]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        render();
      });
    });

    $$("[data-tag]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var value = btn.getAttribute("data-tag");
        tag = tag === value ? null : value;
        $$("[data-tag]").forEach(function (b) {
          b.setAttribute(
            "aria-pressed",
            String(tag === null ? b.getAttribute("data-tag") === "" : b === btn),
          );
        });
        render();
      });
    });

    qInput.addEventListener("input", render);
    activeOnly.addEventListener("change", render);
    $("#reset").addEventListener("click", function () {
      qInput.value = "";
      level = "all";
      tag = null;
      activeOnly.checked = true;
      $$("[data-level]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-level") === "all"));
      });
      $$("[data-tag]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-tag") === ""));
      });
      render();
    });

    // 支持 policies.html?q=增值税&tag=税收优惠 这类可分享链接
    var params = new URLSearchParams(location.search);
    if (params.get("q")) qInput.value = params.get("q");
    var initialTag = params.get("tag");
    if (initialTag) {
      tag = initialTag;
      $$("[data-tag]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-tag") === initialTag));
      });
    }

    render();
  }

  /* ---------- 详情页 ---------- */

  function initDetail() {
    var tabs = $$("[data-tab]");
    var panels = { interpretation: $("#panel-interp"), original: $("#panel-original") };

    function show(name) {
      tabs.forEach(function (t) {
        t.setAttribute("aria-selected", String(t.getAttribute("data-tab") === name));
      });
      Object.keys(panels).forEach(function (key) {
        if (panels[key]) panels[key].hidden = key !== name;
      });
    }

    function flash(no) {
      var el = document.getElementById("sec-" + no);
      if (!el) return;
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        show(t.getAttribute("data-tab"));
      });
    });

    $$("[data-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var no = btn.getAttribute("data-jump");
        show("original");
        setTimeout(function () {
          flash(no);
        }, 60);
      });
    });

    if (location.hash.indexOf("#sec-") === 0) {
      var no = decodeURIComponent(location.hash.slice(5));
      show("original");
      setTimeout(function () {
        flash(no);
      }, 120);
    }
  }

  /* ---------- 检索（与 Next 版同一套 BM25 口径） ---------- */

  function tokenize(input) {
    var text = String(input).toLowerCase();
    var tokens = text.match(/[a-z0-9%]+/g) || [];
    text
      .replace(/[^\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .forEach(function (seg) {
        if (!seg) return;
        if (seg.length === 1) tokens.push(seg);
        for (var i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
      });
    return tokens;
  }

  function buildDocs() {
    var docs = [];
    POLICIES.forEach(function (p) {
      p.sections.forEach(function (s) {
        docs.push({
          policyId: p.id,
          policyTitle: p.title,
          sectionNo: s.no,
          sectionTitle: s.title,
          kind: "section",
          text: s.title + " " + s.text + " " + p.title,
        });
      });
      p.interpretations.forEach(function (it) {
        docs.push({
          policyId: p.id,
          policyTitle: p.title,
          sectionNo: it.sectionNo,
          sectionTitle: it.headline,
          kind: "interpretation",
          text: [
            it.headline,
            it.who,
            it.window,
            it.where,
            it.tip || "",
            it.materials.join(" "),
          ].join(" "),
        });
      });
    });
    return docs;
  }

  var DOCS = buildDocs();

  function retrieve(query, k) {
    k = k || 5;
    var q = tokenize(query).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    });
    if (!q.length) return [];

    var docTokens = DOCS.map(function (d) {
      return tokenize(d.text);
    });
    var avgLen =
      docTokens.reduce(function (n, t) {
        return n + t.length;
      }, 0) / docTokens.length || 1;

    var df = {};
    docTokens.forEach(function (tokens) {
      var seen = {};
      tokens.forEach(function (t) {
        if (seen[t]) return;
        seen[t] = 1;
        df[t] = (df[t] || 0) + 1;
      });
    });

    var N = DOCS.length;
    var scored = DOCS.map(function (doc, idx) {
      var tokens = docTokens[idx];
      var tf = {};
      tokens.forEach(function (t) {
        tf[t] = (tf[t] || 0) + 1;
      });
      var score = 0;
      q.forEach(function (term) {
        var f = tf[term];
        if (!f) return;
        var n = df[term] || 0;
        var idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        var K1 = 1.2;
        var B = 0.75;
        var denom = f + K1 * (1 - B + (B * tokens.length) / avgLen);
        score += idf * ((f * (K1 + 1)) / denom);
      });
      if (doc.kind === "interpretation") score *= 1.15;
      return { doc: doc, score: score };
    });

    scored = scored
      .filter(function (s) {
        return s.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });

    var seen = {};
    var out = [];
    for (var i = 0; i < scored.length && out.length < k; i++) {
      var key = scored[i].doc.policyId + "#" + scored[i].doc.sectionNo;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(scored[i].doc);
    }
    return out;
  }

  function answerFor(question) {
    var docs = retrieve(question, 5);
    if (!docs.length) {
      return {
        answer:
          "现有政策库里没有检索到与「" +
          question +
          "」直接相关的条款。\n\n可以换个说法再问一次（比如提到「企业所得税」「补贴」「贷款」「研发费用」），或者先到政策库按主题浏览。",
        citations: [],
      };
    }
    var lines = docs.slice(0, 3).map(function (d) {
      var policy = POLICIES.filter(function (p) {
        return p.id === d.policyId;
      })[0];
      var section = policy.sections.filter(function (s) {
        return s.no === d.sectionNo;
      })[0];
      return (
        "· " +
        (section ? section.text : d.text) +
        "\n  ——〔" +
        shortTitle(d.policyTitle) +
        "·第" +
        d.sectionNo +
        "条〕"
      );
    });
    return {
      answer:
        "根据现有政策库，这个问题最相关的是：\n\n" +
        lines.join("\n\n") +
        "\n\n以上为条款原文摘录，具体的适用条件与材料清单见下方引用卡片。",
      citations: docs,
    };
  }

  /* ---------- 问答页 ---------- */

  function initChat() {
    var log = $("#log");
    var endEl = $("#log-end");
    var form = $("#ask-form");
    var input = $("#question");
    var presets = $("#presets");
    var started = false;

    function scrollDown() {
      if (endEl) endEl.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    function append(html) {
      endEl.insertAdjacentHTML("beforebegin", html);
    }

    function citationsHTML(docs) {
      if (!docs.length) return "";
      var cards = docs
        .map(function (d) {
          var policy = POLICIES.filter(function (p) {
            return p.id === d.policyId;
          })[0];
          var section = policy
            ? policy.sections.filter(function (s) {
                return s.no === d.sectionNo;
              })[0]
            : null;
          var snippet = String(section ? section.text : d.text).slice(0, 96);
          return (
            '<a class="cite-card" href="policy-' +
            esc(d.policyId) +
            ".html#sec-" +
            encodeURIComponent(d.sectionNo) +
            '">' +
            '<p class="no">第' +
            esc(d.sectionNo) +
            "条</p>" +
            '<p class="title">' +
            esc(d.policyTitle) +
            "</p>" +
            '<p class="snippet">' +
            esc(snippet) +
            "…</p>" +
            "</a>"
          );
        })
        .join("");
      return (
        '<div class="cites"><p>出处（点击回到原文条款）</p><div class="grid">' +
        cards +
        "</div></div>"
      );
    }

    function ask(question) {
      var text = String(question || "").trim();
      if (!text) return;

      if (!started) {
        Array.prototype.forEach.call(
          log.querySelectorAll(".presets, .chat-note"),
          function (node) {
            node.remove();
          },
        );
        started = true;
      }

      append('<div class="msg-user"><div class="bubble">' + esc(text) + "</div></div>");
      scrollDown();

      var thinking = document.createElement("div");
      thinking.className = "msg-bot";
      thinking.innerHTML = '<div class="who">正在检索条款并组织回答…</div>';
      log.insertBefore(thinking, endEl);
      scrollDown();

      var result = answerFor(text);
      setTimeout(function () {
        thinking.innerHTML =
          '<div class="who"><span class="dot dot-a">答</span>政策通' +
          '<span class="flag">检索模式</span></div>' +
          '<div class="bubble">' +
          esc(result.answer) +
          "</div>" +
          citationsHTML(result.citations) +
          '<p class="tiny muted" style="margin:.5rem 0 0">离线演示版：未调用大模型，答案由浏览器内的条款检索引擎生成，可直接引用。</p>';
        scrollDown();
      }, 220);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = input.value;
      input.value = "";
      input.style.height = "auto";
      ask(value);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    presets.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-q]");
      if (!btn) return;
      ask(btn.getAttribute("data-q"));
    });

    var demo = new URLSearchParams(location.search).get("demo");
    var initial = new URLSearchParams(location.search).get("q");
    if (initial) ask(initial);
    else if (demo) ask("小规模纳税人月销售额10万以下免增值税吗？要怎么申报？");
  }

  /* ---------- 规划页 ---------- */

  function scorePolicy(policy, profile) {
    var score = (policy.hot || 0) / 10;
    var tags = policy.tags.join(" ");
    if (profile.rd && /研发|科技/.test(tags)) score += 8;
    if (profile.stage === "idea" && /创业|贷款|补贴/.test(tags)) score += 6;
    if (profile.stage === "registered" && /税|增值税|企业所得/.test(tags)) score += 6;
    if (profile.staff <= 20 && /小微企业|小规模/.test(tags)) score += 4;
    if (profile.revenue > 0 && profile.revenue <= 500 && /税/.test(tags)) score += 3;
    if (profile.industry === "科技" && /科技|研发|专精特新/.test(tags)) score += 5;
    if (profile.industry === "制造" && /专精特新|研发/.test(tags)) score += 4;
    if (profile.years <= 2 && /创业|补贴/.test(tags)) score += 3;
    if (statusOf(policy) === "expired") score -= 20;
    if (policy.isSample) score -= 2;
    return score;
  }

  function timeline(profile) {
    var steps = [];
    if (profile.stage === "idea") {
      steps.push({
        when: "第 1 个月",
        title: "先把主体办下来",
        detail:
          "注册小微企业或个体工商户，同时完成税务登记与社保开户——多数创业补贴、贷款贴息都以「已注册且正常经营」为前提。",
      });
      steps.push({
        when: "第 1—2 个月",
        title: "先确认能贷多少、能补多少",
        detail:
          "带着身份材料到创业地人社部门做创业担保贷款资格审查，同时问清当地一次性创业补贴的申报窗口。",
        policyId: "startup-guarantee-loan",
      });
    } else {
      steps.push({
        when: "本季度申报期",
        title: "把小规模免税额度用干净",
        detail:
          "按月或按季申报增值税，确认销售额是否仍在 10 万元 / 30 万元以内；开专票的部分要正常缴税。",
        policyId: "vat-small-scale",
      });
      steps.push({
        when: "本季度预缴",
        title: "企业所得税按小微口径预缴",
        detail:
          "从业人数、资产总额、应纳税所得额三项都要满足，申报表里勾选小型微利企业即可，无需备案。",
        policyId: "small-business-income-tax",
      });
    }

    if (profile.rd || profile.industry === "科技" || profile.industry === "制造") {
      steps.push({
        when: "每年 10 月前",
        title: "研发费用辅助账补齐",
        detail:
          "立项决议、工时分配、领料记录三样能对上，前三季度预缴时就能享受 100% 加计扣除，不必等到汇算清缴。",
        policyId: "rd-super-deduction",
      });
    }

    if (profile.industry === "科技" || profile.industry === "制造") {
      steps.push({
        when: "每年上半年",
        title: "冲一次「创新型中小企业」",
        detail:
          "先把研发费用占比、知识产权数量两项硬指标补齐，拿到省级评价后，再准备专精特新中小企业的材料。",
        policyId: "sme-gradient-cultivation",
      });
    }

    steps.push({
      when: "次年 5 月 31 日前",
      title: "汇算清缴：把优惠一次性用足",
      detail:
        "企业所得税年度申报时，叠加小微优惠与研发加计扣除，核对全年实际税负是否落在 5% 附近。",
      policyId: "small-business-income-tax",
    });
    return steps;
  }

  function initPlan() {
    var form = $("#plan-form");
    var result = $("#plan-result");
    var profile = { industry: "科技", stage: "registered", years: 1, staff: 8, revenue: 120, rd: true };

    $$("[data-industry]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        profile.industry = btn.getAttribute("data-industry");
        $$("[data-industry]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
      });
    });
    $$("[data-stage]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        profile.stage = btn.getAttribute("data-stage");
        $$("[data-stage]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
      });
    });
    $$("[data-rd]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        profile.rd = btn.getAttribute("data-rd") === "1";
        $$("[data-rd]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      profile.years = Number($("#years").value) || 0;
      profile.staff = Number($("#staff").value) || 1;
      profile.revenue = Number($("#revenue").value) || 0;

      var matched = POLICIES.slice()
        .sort(function (a, b) {
          return scorePolicy(b, profile) - scorePolicy(a, profile);
        })
        .slice(0, 4);

      var steps = timeline(profile);
      var chips =
        '<span class="tag">' +
        esc(profile.industry) +
        "</span>" +
        '<span class="tag">' +
        (profile.stage === "idea" ? "筹备中" : "已注册") +
        "</span>" +
        '<span class="tag">' +
        profile.staff +
        " 人</span>" +
        '<span class="tag">' +
        profile.revenue +
        " 万营收</span>" +
        (profile.rd ? '<span class="tag">有研发</span>' : "");

      result.innerHTML =
        '<section class="section" style="margin-top:0">' +
        '<div class="section-head"><div><p class="kicker plain">匹配结果</p>' +
        '<h2 class="h2">你大概率能对上的政策</h2></div><div class="chips" style="margin:0">' +
        chips +
        "</div></div>" +
        '<div class="grid-2">' +
        matched.map(cardHTML).join("") +
        "</div></section>" +
        '<section class="section"><div class="section-head"><div><p class="kicker plain">时间轴</p>' +
        '<h2 class="h2">接下来 12 个月，按这个顺序办</h2></div>' +
        '<button type="button" class="btn btn-ghost no-print" onclick="window.print()">打印 / 存为 PDF</button></div>' +
        '<ol class="timeline">' +
        steps
          .map(function (s, i) {
            return (
              '<li data-step="' +
              (i + 1) +
              '"><div class="box"><div><span class="when">' +
              esc(s.when) +
              "</span><h3>" +
              esc(s.title) +
              "</h3></div><p>" +
              esc(s.detail) +
              "</p>" +
              (s.policyId
                ? '<a class="link" href="policy-' +
                  esc(s.policyId) +
                  '.html">查看依据的政策 →</a>'
                : "") +
              "</div></li>"
            );
          })
          .join("") +
        "</ol></section>" +
        '<p class="note"><b>关于这份清单</b>结果由规则引擎根据 ' +
        POLICIES.length +
        " 条政策库计算，用于演示「画像 → 政策 → 行动」的匹配逻辑；实际可享受的政策以主管部门审核为准，地区差异请咨询当地窗口。</p>";

      result.hidden = false;
      result.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  /* ---------- 启动 ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    try {
      if (page === "policies") initList();
      else if (page === "policy") initDetail();
      else if (page === "chat") initChat();
      else if (page === "plan") initPlan();
    } catch (err) {
      if (window.console) console.error("[policy-app]", err);
    }
  });
})();
