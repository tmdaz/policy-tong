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
    var region = "all";
    var city = "all";
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
        if (region === "hunan" && !p.hunan) return false;
        if (region === "national" && p.hunan) return false;
        // 地区二级（市州）：省级政策单列成「湖南省」，市/区县用 region 前缀匹配
        if (city !== "all") {
          if (city === "湖南省") {
            if (!(p.hunan && p.level === "provincial")) return false;
          } else if (String(p.region || "").indexOf(city) !== 0) return false;
        }
        if (tag && p.tags.indexOf(tag) === -1) return false;
        if (activeOnly.checked && statusOf(p) === "expired") return false;
        if (!keyword) return true;
        return haystack(p).indexOf(keyword) !== -1;
      });

      results.innerHTML = list.map(cardHTML).join("");
      count.textContent = String(list.length);
      empty.hidden = list.length !== 0;
      results.hidden = list.length === 0;

      // 只在选了「湖南」时才展开市州那一行
      var cityRow = $("#region-city-row");
      if (cityRow) cityRow.hidden = region !== "hunan";

      var titleEl = $("#empty-title");
      var hintEl = $("#empty-hint");
      if (titleEl && hintEl) {
        if (!list.length && region === "hunan" && city === "all") {
          titleEl.textContent = "湖南本地政策还没导入";
          hintEl.textContent =
            "政策原文的检索与下载由人工完成：先从首页官方入口下载文件，再用「开发者模式」导入，条款即可进入政策库并被问答引用。";
        } else {
          titleEl.textContent = "没有匹配的政策";
          hintEl.textContent =
            "试试更短的关键词，或清空筛选条件。也可以直接去问答页用一句话描述你的情况。";
        }
      }
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

    $$("[data-region]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        region = btn.getAttribute("data-region");
        // 离开「湖南」就把市州收回去，避免隐藏条件下仍然过滤
        if (region !== "hunan" && city !== "all") {
          city = "all";
          $$("[data-city]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-city") === "all"));
          });
        }
        $$("[data-region]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        render();
      });
    });

    $$("[data-city]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        city = btn.getAttribute("data-city");
        $$("[data-city]").forEach(function (b) {
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
      region = "all";
      city = "all";
      tag = null;
      activeOnly.checked = true;
      $$("[data-level]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-level") === "all"));
      });
      $$("[data-region]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-region") === "all"));
      });
      $$("[data-city]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-city") === "all"));
      });
      $$("[data-tag]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-tag") === ""));
      });
      render();
    });

    // 支持 policies.html?q=增值税&tag=税收优惠&region=hunan 这类可分享链接
    var params = new URLSearchParams(location.search);
    if (params.get("q")) qInput.value = params.get("q");
    var initialRegion = params.get("region");
    if (initialRegion) {
      region = initialRegion;
      $$("[data-region]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-region") === initialRegion));
      });
    }
    // policies.html?region=hunan&city=长沙市 这类可分享链接
    var initialCity = params.get("city");
    if (initialCity) {
      region = "hunan";
      city = initialCity;
      $$("[data-region]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-region") === "hunan"));
      });
      $$("[data-city]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-city") === initialCity));
      });
    }
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

  /* ---------- 检索：核心算法在 assets/retrieval.js，这里只做适配 ---------- */
  var RETRIEVAL = window.PolicyRetrieval;
  var INDEX = RETRIEVAL.createIndex(POLICIES);
  var MIN_SCORE = 8;

  function retrieve(query, k, history) {
    return RETRIEVAL.retrieve(INDEX, query, {
      k: k || 8,
      history: history || "",
      useHistory: !!history,
    });
  }

  /** 计算器结果 → 与模型回答同构的答案结构 */
  function calcAnswer(question) {
    var calc = window.TaxCalc;
    if (!calc) return null;
    var hit = calc.tryCompute(question);
    if (!hit.type || !hit.result || !hit.result.ok) return null;

    var policyId = hit.type === "income-tax" ? "small-business-income-tax" : "vat-small-scale";
    var policy = POLICIES.filter(function (p) { return p.id === policyId; })[0];
    var cites = [];
    if (policy && policy.sections.length) {
      cites = [{
        policyId: policy.id,
        policyTitle: policy.title,
        sectionNo: policy.sections[0].no,
        sectionTitle: policy.sections[0].title,
        text: policy.sections[0].title + " " + policy.sections[0].text,
      }];
    }

    var citeLabel = policy ? "〔" + shortTitle(policy.title) + "·第" + (cites[0] ? cites[0].sectionNo : "1") + "条〕" : "";
    var lines = [];
    lines.push("结论：" + hit.result.summary + "。");
    lines.push("");
    lines.push("计算步骤：");
    hit.result.steps.forEach(function (s, i) {
      lines.push("①②③④⑤".charAt(i) + " " + s);
    });
    if (citeLabel) {
      lines.push("");
      lines.push("依据：" + citeLabel);
    }
    lines.push("");
    lines.push("前提与风险：" + hit.result.risk);

    return { answer: lines.join("\n"), citations: cites, calc: true };
  }

  function answerFor(question, history) {
    var verdict = RETRIEVAL.decide(INDEX, question, {
      k: 8,
      history: history || "",
      useHistory: !!history,
      minScore: MIN_SCORE,
    });
    var docs = verdict.docs || [];

    if (verdict.uncovered) {
      var why;
      if (verdict.reason === "out-of-scope") {
        why = "本站只收录**湖南**的政策，没有" + verdict.place + "的条款。\n\n想了解湖南的情况，可以把地点换成「长沙」「株洲」等湖南市州再问一次。";
      } else if (verdict.reason === "empty") {
        why = "现有政策库里没有检索到与「" + question + "」相关的条款。";
      } else if (verdict.reason === "vague") {
        why = "这个问题太宽泛，没有对应的具体条款。";
      } else {
        why = "检索到的条款与「" + question + "」相关度太低，不足以作为依据。";
      }
      return {
        uncovered: true,
        answer:
          why.replace(/\*\*/g, "") +
          "\n\n可以换成更具体的问法，比如提到「企业所得税」「创业补贴」「担保贷款」「研发费用」「社保补贴」「专精特新」。",
        citations: [],
      };
    }

    var picked = docs.slice(0, 4);
    var lines = picked.slice(0, 3).map(function (d) {
      var policy = POLICIES.filter(function (p) { return p.id === d.policyId; })[0];
      var section = policy ? policy.sections.filter(function (s) { return s.no === d.sectionNo; })[0] : null;
      return "· " + (section ? section.text : d.text) + "\n  ——〔" + shortTitle(d.policyTitle) + "·第" + d.sectionNo + "条〕";
    });
    return {
      answer:
        "根据现有政策库，这个问题最相关的是：\n\n" + lines.join("\n\n") +
        "\n\n以上为条款原文摘录，具体的适用条件与材料清单见下方引用卡片。",
      citations: picked,
    };
  }

  /* ---------- 问答页 ---------- */

  function initChat() {
    var log = $("#log");
    var endEl = $("#log-end");
    var form = $("#ask-form");
    var input = $("#question");
    var presets = $("#presets");
    var clearBtn = $("#chat-clear");
    var started = false;
    var inFlight = false;
    var pendingText = "";
    var CAP = 50;
    var STORE_KEY = "pt-chat-v1";
    var lastTurn = null;
    /* 探活状态：unknown / online / offline。只有确定离线才用预生成答案，避免探活那 3 秒里误判。 */
    var aiState = "unknown";

    function normQuestion(s) {
      return String(s || "")
        .replace(/[\s，。？！、；：""''（）()《》?？!.,;:]/g, "")
        .toLowerCase();
    }

    function offlineAnswerFor(text) {
      var list = window.QA_OFFLINE;
      if (!list || !list.length) return null;
      var want = normQuestion(text);
      for (var i = 0; i < list.length; i++) {
        if (list[i] && normQuestion(list[i].q) === want) return list[i];
      }
      return null;
    }

    function showOfflineNotice() {
      if (document.getElementById("ai-offline-note")) return;
      var head = document.querySelector(".chat-head");
      if (!head || !head.parentNode) return;
      var box = document.createElement("div");
      box.id = "ai-offline-note";
      box.className = "note-box";
      box.innerHTML =
        "<b>AI 服务未连接</b>（本机服务或隧道未开），当前回答来自本地条款检索" +
        (window.QA_OFFLINE && window.QA_OFFLINE.length ? "，评测题会优先给出离线预生成答案" : "") +
        "，内容仍然逐条可溯源。";
      head.parentNode.insertBefore(box, head.nextSibling);
    }

    /** 3 秒超时探活：只认 { ok:true, hasKey:true }，其余都按离线处理。 */
    function probeAI() {
      var apiUrl = window.CHAT_API;
      if (!apiUrl) {
        aiState = "offline";
        showOfflineNotice();
        return;
      }
      var origin;
      try {
        origin = new URL(apiUrl, location.href).origin;
      } catch (err) {
        aiState = "offline";
        showOfflineNotice();
        return;
      }
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
      }, 3000);
      fetch(origin + "/api/health", { method: "GET", cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          clearTimeout(timer);
          if (data && data.ok && data.hasKey) {
            aiState = "online";
          } else {
            aiState = "offline";
            showOfflineNotice();
          }
        })
        .catch(function () {
          clearTimeout(timer);
          aiState = "offline";
          showOfflineNotice();
        });
    }

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

    /* ---------- 本地持久化：记录只存本机浏览器 ---------- */
    var chatStore = {
      load: function () {
        try {
          var raw = window.localStorage.getItem(STORE_KEY);
          if (!raw) return [];
          var obj = JSON.parse(raw);
          if (!obj || obj.v !== 1 || !Array.isArray(obj.items)) {
            window.localStorage.removeItem(STORE_KEY);
            return [];
          }
          return obj.items.filter(function (it) {
            return it && it.q && it.a;
          });
        } catch (err) {
          try { window.localStorage.removeItem(STORE_KEY); } catch (e2) {}
          return [];
        }
      },
      save: function (items) {
        try {
          var payload = JSON.stringify({ v: 1, items: items, savedAt: Date.now() });
          if (payload.length > 800000) {
            items = items.slice(Math.ceil(items.length / 2));
            payload = JSON.stringify({ v: 1, items: items, savedAt: Date.now() });
          }
          window.localStorage.setItem(STORE_KEY, payload);
        } catch (err) {
          try { window.localStorage.removeItem(STORE_KEY); } catch (e2) {}
        }
      },
      push: function (item) {
        var items = chatStore.load();
        items.push(item);
        if (items.length > CAP) items = items.slice(items.length - CAP);
        chatStore.save(items);
        if (clearBtn) clearBtn.hidden = false;
        return items.length;
      },
      count: function () { return chatStore.load().length; },
      isFull: function () { return chatStore.count() >= CAP; },
      clear: function () { try { window.localStorage.removeItem(STORE_KEY); } catch (err) {} }
    };

    function fmtTime(ts) {
      try {
        var d = new Date(ts);
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
          " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      } catch (err) { return ""; }
    }

    function citeRefs(docs) {
      return (docs || []).map(function (d) {
        return {
          policyId: d.policyId,
          sectionNo: d.sectionNo,
          policyTitle: d.policyTitle,
          text: String(d.text || "").slice(0, 300),
        };
      });
    }

    function userBubbleHTML(q) {
      return '<div class="msg-user"><div class="bubble">' + esc(q) + "</div></div>";
    }

    function botInnerHTML(o) {
      var isModel = o.mode === "model";
      var isCalc = o.mode === "calc";
      var isOffline = o.mode === "offline";
      var flag = isOffline
        ? '<span class="flag">离线答案</span>'
        : isModel
          ? '<span class="flag flag-model">模型生成</span>'
          : isCalc
            ? '<span class="flag flag-calc">本地计算</span>'
            : '<span class="flag">检索模式</span>';
      var notice = o.notice || (isModel
        ? "回答由 DeepSeek 依据上方条款生成，条款可点开原文核对。"
        : "离线演示版：未调用大模型，答案由浏览器内的条款检索引擎生成，可直接引用。");
      var time = o.restored && o.ts ? '<p class="msg-time">' + esc(fmtTime(o.ts)) + " 的回答</p>" : "";
      return '<div class="who"><span class="dot dot-a">答</span>政策通' + flag + "</div>" +
        '<div class="bubble">' + esc(o.answer || "").replace(/\n/g, "<br>") + "</div>" +
        citationsHTML(o.cites || []) +
        '<p class="tiny muted" style="margin:.5rem 0 0">' + esc(notice) + "</p>" +
        time;
    }

    function ask(question, opts) {
      var text = String(question || "").trim();
      if (!text) return false;
      if (!(opts && opts.force) && chatStore.isFull()) {
        openCap(text);
        return false;
      }
      inFlight = true;

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

      var willCompute = !!(window.TaxCalc && window.TaxCalc.tryCompute(text).type);
      var thinking = document.createElement("div");
      thinking.className = "msg-bot";
      thinking.innerHTML =
        '<div class="who">' + (willCompute ? "正在按条款计算…" : "正在检索条款并调用模型…") + "</div>";
      log.insertBefore(thinking, endEl);
      scrollDown();

      var computed = calcAnswer(text);
      var intent = computed ? "calc" : "general";
      if (!computed && /[0-9]/.test(text) && /(多少|怎么算|要交|应交|缴纳|合计|一共|税负|算一下)/.test(text)) {
        intent = "calc";
      }
      var result = computed || answerFor(text, lastTurn ? lastTurn.question : "");

      function rememberTurn(answerText) {
        if (result.uncovered) {
          lastTurn = null;
          return;
        }
        lastTurn = {
          question: text,
          answerHead: String(answerText || "").slice(0, 120),
          policyIds: (result.citations || []).map(function (c) { return c.policyId; }),
        };
      }

      function renderUncovered() {
        var tips = ["小微企业所得税实际税负是多少", "长沙的一次性创业补贴怎么申请", "创业担保贷款能贷多少"];
        thinking.innerHTML =
          '<div class="who"><span class="dot dot-a">答</span>政策通' +
          '<span class="flag">未匹配</span></div>' +
          '<div class="bubble">' + esc(result.answer).replace(/\n/g, "<br>") + "</div>" +
          '<div class="chips" style="margin-top:.6rem">' +
          tips.map(function (t) {
            return '<button type="button" class="pill" data-q="' + esc(t) + '">' + esc(t) + "</button>";
          }).join("") +
          "</div>";
        chatStore.push({
          q: text,
          a: result.answer,
          mode: result.calc ? "calc" : "local",
          notice: "未检索到足够可信的条款，未调用模型。",
          cites: [],
          ts: Date.now(),
        });
        inFlight = false;
        lastTurn = null;
        scrollDown();
      }

      function renderLocal(notice) {
        var note = notice || "离线演示版：未调用大模型，答案由浏览器内的条款检索引擎生成，可直接引用。";
        thinking.innerHTML = botInnerHTML({
          answer: result.answer,
          mode: result.calc ? "calc" : "local",
          notice: note,
          cites: result.citations,
        });
        chatStore.push({
          q: text,
          a: result.answer,
          mode: "local",
          notice: note,
          cites: citeRefs(result.citations),
          ts: Date.now(),
        });
        inFlight = false;
        rememberTurn(result.answer);
        scrollDown();
      }

      function renderOffline(item) {
        var note = "离线预生成答案：本机模型服务在线时依据条款生成并缓存，不是本次实时调用，条款仍可点开核对。";
        thinking.innerHTML = botInnerHTML({
          answer: item.a,
          mode: "offline",
          notice: note,
          cites: result.citations,
        });
        chatStore.push({
          q: text,
          a: item.a,
          mode: "offline",
          notice: note,
          cites: citeRefs(result.citations),
          ts: Date.now(),
        });
        inFlight = false;
        rememberTurn(item.a);
        scrollDown();
      }

      function renderModel(payload) {
        var body = String(payload.answer || "").trim();
        if (!body) return renderLocal();
        var note = payload.notice || "回答由 DeepSeek 依据上方条款生成，条款可点开原文核对。";
        thinking.innerHTML = botInnerHTML({
          answer: body,
          mode: "model",
          notice: note,
          cites: result.citations,
        });
        chatStore.push({
          q: text,
          a: body,
          mode: "model",
          notice: note,
          cites: citeRefs(result.citations),
          ts: Date.now(),
        });
        inFlight = false;
        rememberTurn(body);
        scrollDown();
      }

      /* 确定离线时，评测题直接给预生成答案，比本地检索更完整；未命中再走原有链路。 */
      if (aiState === "offline") {
        var pre = offlineAnswerFor(text);
        if (pre) {
          setTimeout(function () { renderOffline(pre); }, 220);
          return true;
        }
      }

      if (result.uncovered) {
        setTimeout(renderUncovered, 220);
        return true;
      }

      if (result.calc) {
        setTimeout(function () { renderLocal("本地计算：未调用模型，结果由政策条款公式直接算出，可点下方条款核对。"); }, 220);
        return true;
      }

      var apiUrl = window.CHAT_API;
      if (!apiUrl) {
        setTimeout(function () { renderLocal(); }, 220);
        return true;
      }

      var clauses = (result.citations || []).slice(0, 6).map(function (c) {
        return {
          policyTitle: c.policyTitle,
          documentNo: c.documentNo,
          sectionNo: c.sectionNo,
          sectionTitle: c.sectionTitle,
          text: c.text,
        };
      });

      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);

      fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          question: text,
          clauses: clauses,
          intent: intent,
          history: lastTurn ? [{ q: lastTurn.question, a: lastTurn.answerHead }] : [],
        }),
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (res) {
          return res.json().then(function (data) { return { status: res.status, data: data }; });
        })
        .then(function (out) {
          clearTimeout(timer);
          if (!out.data || out.data.error) {
            throw new Error((out.data && out.data.error) || ("接口返回 " + out.status));
          }
          if (out.data.mode === "fallback") {
            var preFallback = offlineAnswerFor(text);
            if (preFallback) return renderOffline(preFallback);
            return renderLocal(out.data.answer || out.data.notice || "模型暂时不可用，已切换为条款原文模式。");
          }
          renderModel(out.data);
        })
        .catch(function (err) {
          clearTimeout(timer);
          inFlight = false;
          var reason = err && err.name === "AbortError" ? "请求超时" : (err && err.message) || "网络错误";
          var preErr = offlineAnswerFor(text);
          if (preErr) return renderOffline(preErr);
          renderLocal("模型接口暂不可用（" + reason + "），已切换为条款原文模式。");
        });

      return true;
    }

    /* ---------- 路径规划小工具：选标签 → 拼成提问 ---------- */
    var planTool = $("#plan-tool");
    var planPop = $("#plan-pop");
    var planGo = $("#plan-pop-go");

    function planOpen() {
      if (!planPop) return;
      planPop.hidden = false;
      if (planTool) planTool.setAttribute("aria-expanded", "true");
    }
    function planClose() {
      if (!planPop) return;
      planPop.hidden = true;
      if (planTool) planTool.setAttribute("aria-expanded", "false");
    }
    function planSelected(group) {
      var el = planPop.querySelector('[data-group="' + group + '"] .pill[aria-pressed="true"]');
      return el ? el.getAttribute("data-value") : "";
    }

    if (planTool && planPop) {
      planTool.addEventListener("click", function () {
        if (planPop.hidden) planOpen();
        else planClose();
      });
      planPop.addEventListener("click", function (e) {
        if (e.target.closest("[data-close]")) {
          planClose();
          return;
        }
        var chip = e.target.closest(".pill");
        if (!chip) return;
        var group = chip.parentNode;
        Array.prototype.forEach.call(group.querySelectorAll(".pill"), function (b) {
          b.setAttribute("aria-pressed", String(b === chip));
        });
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !planPop.hidden) planClose();
      });
    }

    if (planGo && planPop) {
      planGo.addEventListener("click", function () {
        var city = $("#pp-city").value;
        var years = $("#pp-years").value || "1";
        var staff = $("#pp-staff").value || "8";
        var revenue = $("#pp-revenue").value || "0";
        var industry = planSelected("industry");
        var stage = planSelected("stage");
        var rd = planSelected("rd");
        var q =
          "我是" + city + "的" + industry + "行业企业，" + stage + "，" +
          "已经营 " + years + " 年，在职 " + staff + " 人，上年营收 " + revenue + " 万元，" +
          rd + "研发投入。按这些条件我能享受哪些政策？分别要满足什么条件、准备什么材料、什么时候申报、去哪里办？";
        planClose();
        ask(q);
      });
    }

    // ?tool=plan 直接拉开工具窗
    if (new URLSearchParams(location.search).get("tool") === "plan") planOpen();

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = input.value;
      if (ask(value)) {
        input.value = "";
        input.style.height = "auto";
      }
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

    // 「未匹配」回答里给的建议问题
    log.addEventListener("click", function (e) {
      var btn = e.target.closest(".chips [data-q]");
      if (!btn) return;
      ask(btn.getAttribute("data-q"));
    });

    /* ---------- 满额确认弹窗 ---------- */
    var capPop = $("#cap-pop");
    var capOk = $("#cap-ok");
    var capCancel = $("#cap-cancel");
    var submitBtn = $("#ask-submit");

    function openCap(text) {
      pendingText = text;
      if (!capPop) {
        cancelCap();
        return;
      }
      capPop.hidden = false;
      if (submitBtn) submitBtn.disabled = true;
      if (capCancel) capCancel.focus();
    }

    function closeCap() {
      if (capPop) capPop.hidden = true;
      if (submitBtn) submitBtn.disabled = false;
    }

    function cancelCap() {
      closeCap();
      if (input) {
        input.value = pendingText;
        input.focus();
      }
    }

    function confirmCap() {
      var text = pendingText;
      closeCap();
      ask(text, { force: true });
    }

    if (capPop) {
      capPop.addEventListener("click", function (e) {
        if (e.target.closest("[data-cap-close]")) cancelCap();
      });
      if (capOk) capOk.addEventListener("click", confirmCap);
      if (capCancel) capCancel.addEventListener("click", cancelCap);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !capPop.hidden) cancelCap();
      });
    }

    /* ---------- 清空对话 ---------- */
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        chatStore.clear();
        location.replace("chat.html");
      });
    }

    /* ---------- 跨标签页同步 ---------- */
    window.addEventListener("storage", function (e) {
      if (e.key !== STORE_KEY) return;
      if (inFlight) return;
      if (document.activeElement === input) return;
      location.reload();
    });

    /* ---------- 恢复历史记录 ---------- */
    var saved = chatStore.load();
    if (saved.length) {
      Array.prototype.forEach.call(log.querySelectorAll(".presets, .chat-note"), function (node) {
        node.remove();
      });
      started = true;
      saved.forEach(function (it) {
        append(userBubbleHTML(it.q));
        append(
          '<div class="msg-bot">' +
            botInnerHTML({
              answer: it.a,
              mode: it.mode,
              notice: it.notice,
              cites: it.cites,
              ts: it.ts,
              restored: true,
            }) +
            "</div>",
        );
      });
      if (clearBtn) clearBtn.hidden = false;
      scrollDown();
    }

    function stripQ() {
      try {
        var params = new URLSearchParams(location.search);
        params.delete("q");
        var qs = params.toString();
        window.history.replaceState(null, "", "chat.html" + (qs ? "?" + qs : ""));
      } catch (err) {}
    }

    var demo = new URLSearchParams(location.search).get("demo");
    var initial = new URLSearchParams(location.search).get("q");
    if (initial) {
      ask(initial);
      stripQ();
    } else if (demo) {
      ask("小规模纳税人月销售额10万以下免增值税吗？要怎么申报？");
    }

    probeAI();
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
        policyId: "p-2026-63153b",
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
    var profile = { industry: "科技", stage: "registered", city: "长沙市", years: 1, staff: 8, revenue: 120, rd: true };

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

    /* ---------- 路径规划小工具：选标签 → 拼成提问 ---------- */
    var planTool = $("#plan-tool");
    var planPop = $("#plan-pop");
    var planGo = $("#plan-pop-go");

    function planOpen() {
      if (!planPop) return;
      planPop.hidden = false;
      if (planTool) planTool.setAttribute("aria-expanded", "true");
    }
    function planClose() {
      if (!planPop) return;
      planPop.hidden = true;
      if (planTool) planTool.setAttribute("aria-expanded", "false");
    }
    function planSelected(group) {
      var el = planPop.querySelector('[data-group="' + group + '"] .pill[aria-pressed="true"]');
      return el ? el.getAttribute("data-value") : "";
    }

    if (planTool && planPop) {
      planTool.addEventListener("click", function () {
        if (planPop.hidden) planOpen();
        else planClose();
      });
      planPop.addEventListener("click", function (e) {
        if (e.target.closest("[data-close]")) {
          planClose();
          return;
        }
        var chip = e.target.closest(".pill");
        if (!chip) return;
        var group = chip.parentNode;
        Array.prototype.forEach.call(group.querySelectorAll(".pill"), function (b) {
          b.setAttribute("aria-pressed", String(b === chip));
        });
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !planPop.hidden) planClose();
      });
    }

    if (planGo && planPop) {
      planGo.addEventListener("click", function () {
        var city = $("#pp-city").value;
        var years = $("#pp-years").value || "1";
        var staff = $("#pp-staff").value || "8";
        var revenue = $("#pp-revenue").value || "0";
        var industry = planSelected("industry");
        var stage = planSelected("stage");
        var rd = planSelected("rd");
        var q =
          "我是" + city + "的" + industry + "行业企业，" + stage + "，" +
          "已经营 " + years + " 年，在职 " + staff + " 人，上年营收 " + revenue + " 万元，" +
          rd + "研发投入。按这些条件我能享受哪些政策？分别要满足什么条件、准备什么材料、什么时候申报、去哪里办？";
        planClose();
        ask(q);
      });
    }

    // ?tool=plan 直接拉开工具窗
    if (new URLSearchParams(location.search).get("tool") === "plan") planOpen();

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      profile.years = Number($("#years").value) || 0;
      profile.staff = Number($("#staff").value) || 1;
      profile.revenue = Number($("#revenue").value) || 0;
      if ($("#city")) profile.city = $("#city").value || profile.city;

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
        esc(profile.city) +
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

  /* ---------- 开发者模式：长文 → 结构化 ---------- */


  function initDev() {
    var raw = $("#dev-raw");
    var out = $("#dev-out");
    var statusEl = $("#dev-status");
    var btnBuild = $("#dev-build");
    var btnDownload = $("#dev-download");
    var btnCopy = $("#dev-copy");
    var splitInfo = $("#dev-split-info");
    var sections = [];
    var payload = null;

    function field(id) {
      var el = $("#" + id);
      return el ? el.value.trim() : "";
    }

    function setStatus(text, kind) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.style.color = kind === "error" ? "var(--warn)" : "var(--ink-soft)";
    }

    var fileInput = $("#dev-file");
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          raw.value = String(reader.result || "");
          setStatus("已读入 " + file.name + "（" + raw.value.length + " 字符）");
          if (!$("#dev-id").value) {
            $("#dev-id").value = file.name
              .replace(/\.(txt|md|pdf|docx?)$/i, "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 48);
          }
        };
        reader.readAsText(file, "utf-8");
      });
    }

    $("#dev-split").addEventListener("click", function () {
      var P = window.PolicySplitter;
      sections = P.splitSections(raw.value);

      // 顺手把能识别的元信息填进去，空的才填，不覆盖人工输入
      var meta = P.guessMeta(raw.value, "");
      var fill = function (id, value) {
        var el = $("#" + id);
        if (el && !el.value && value) el.value = value;
      };
      fill("dev-title", meta.title);
      fill("dev-issuer", meta.issuer);
      fill("dev-docno", meta.documentNo);
      fill("dev-pub", meta.publishedAt);

      if (splitInfo) {
        splitInfo.textContent = sections.length
          ? "识别到 " + sections.length + " 条" + (meta.documentNo ? "，文号 " + meta.documentNo : "")
          : "没识别到条号，将整体作为一条";
      }
      out.textContent = JSON.stringify(sections, null, 2);
      setStatus("已切分并自动填入可识别的元信息，请核对其余字段");
    });

    function build() {
      var P = window.PolicySplitter;
      var list = sections.length ? sections : P.splitSections(raw.value);

      var draft = P.buildDraft(
        {
          id: field("dev-id"),
          title: field("dev-title"),
          level: field("dev-level"),
          region: field("dev-region"),
          issuer: field("dev-issuer"),
          documentNo: field("dev-docno"),
          publishedAt: field("dev-pub"),
          expiresAt: field("dev-exp"),
          sourceUrl: field("dev-url"),
          tags: field("dev-tags"),
          audience: field("dev-audience"),
          summary: field("dev-summary"),
        },
        list,
      );

      var errors = P.validateDraft(draft);
      payload = draft;
      out.textContent = JSON.stringify(draft, null, 2);

      if (errors.length) {
        setStatus("还有 " + errors.length + " 项待补：" + errors.join("；"), "error");
        btnDownload.disabled = true;
        btnCopy.disabled = true;
      } else {
        setStatus("JSON 已生成（" + list.length + " 条条款，解读待人工补录）");
        btnDownload.disabled = false;
        btnCopy.disabled = false;
      }
    }

    btnBuild.addEventListener("click", build);

    btnDownload.addEventListener("click", function () {
      if (!payload) return;
      var blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], {
        type: "application/json",
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = payload.id + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      setStatus("已下载 " + payload.id + ".json，放进 src/data/policies/ 后重新构建");
    });

    btnCopy.addEventListener("click", function () {
      if (!payload) return;
      var text = JSON.stringify(payload, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            setStatus("已复制到剪贴板");
          },
          function () {
            setStatus("复制失败，请手动选中输出框内容", "error");
          },
        );
      } else {
        setStatus("浏览器不支持剪贴板，请手动选中输出框内容");
      }
    });
  }

  /* ---------- 微信内置浏览器：附件下载会静默失败，提前说清楚 ---------- */

  /** 微信里点 <a download> 毫无反应也不报错。详情页有 19 个官方附件，
   *  用户多半是在微信里打开的，所以进页面就把话说明白。 */
  function initWeChatHint() {
    if (!/MicroMessenger/i.test(navigator.userAgent || "")) return;
    var links = document.querySelectorAll('a[href^="attachments/"]');
    if (!links.length) return;
    if (document.getElementById("wx-dl-hint")) return;
    var host = document.getElementById("attachments") || (links[0].closest && links[0].closest("section")) || links[0].parentNode;
    if (!host || !host.parentNode) return;
    var box = document.createElement("div");
    box.id = "wx-dl-hint";
    box.className = "note-box wx-dl-hint";
    box.innerHTML = "<b>微信里下不了文件 </b>点右上角「…」→「在浏览器打开」，再回来下附件；或者先把页面转发到电脑上打开。";
    host.parentNode.insertBefore(box, host);
  }

  /* ---------- 启动 ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    try {
      if (page === "policies") initList();
      else if (page === "policy") initDetail();
      else if (page === "chat") initChat();
      else if (page === "plan") initPlan();
      else if (page === "dev") initDev();
      initWeChatHint();
    } catch (err) {
      if (window.console) console.error("[policy-app]", err);
    }
  });

  /* 复制按钮：IP + 端口的政务系统不做可点直跳，只让用户复制地址（全站通用） */
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-copy]") : null;
    if (!btn) return;
    var text = btn.getAttribute("data-copy") || "";
    if (!text) return;
    var done = function () {
      var old = btn.getAttribute("data-label") || btn.textContent;
      btn.setAttribute("data-label", old);
      btn.textContent = "已复制";
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { btn.textContent = "请手动复制"; });
    } else {
      // 老浏览器 / file:// 下的兜底
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (err) { btn.textContent = "请手动复制"; }
      ta.remove();
    }
  });
})();
