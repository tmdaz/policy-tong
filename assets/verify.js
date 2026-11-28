/* 原文核对台：逐条比对官方原文与本站条款，进度共享（本机台账 + 隧道）。
 * 页面本身只读；所有写操作都是「申请」，真正改数据要负责人在本机跑
 * node scripts/apply-verify-changes.mjs 落盘。 */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var STORE = "pt-verify-v1";

  var S = {
    base: "",
    name: "",
    key: "",
    connected: false,
    index: null,
    state: null,
    policies: window.POLICIES || [],
    tab: "list",
    tier: "all",
    onlyTodo: false,
    q: "",
    cur: { policyId: "", idx: 0 },
    archive: null,
    archiveCache: {},
    modalKey: "",
  };

  /* ---------------- 基础 ---------------- */

  function apiBase() {
    var configured = String(window.CHAT_API || "");
    var host = location.hostname;
    var isLocal = location.protocol === "file:" || host === "127.0.0.1" || host === "localhost";
    if (isLocal) {
      // 本机打开时优先连本机服务：隧道在本地反而绕远，还依赖外网
      return configured && configured.indexOf("127.0.0.1") >= 0
        ? configured.replace(/\/api\/chat.*$/, "")
        : "http://127.0.0.1:8787";
    }
    return configured ? configured.replace(/\/api\/chat.*$/, "") : "";
  }

  function api(path, opt) {
    opt = opt || {};
    var headers = {};
    if (opt.body) headers["Content-Type"] = "application/json";
    if (S.key) headers["x-verify-key"] = S.key;
    return fetch(S.base + path, {
      method: opt.method || "GET",
      headers: headers,
      body: opt.body || undefined,
      cache: "no-store",
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) {
          var err = new Error((body && body.error) || "HTTP " + r.status);
          err.status = r.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  function post(path, payload) {
    var data = {};
    Object.keys(payload || {}).forEach(function (k) { data[k] = payload[k]; });
    data.by = S.name;
    return api(path, { method: "POST", body: JSON.stringify(data) });
  }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE) || "{}");
      S.name = saved.name || "";
      S.key = saved.key || "";
    } catch (e) { /* 存档坏了就当没存过 */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ name: S.name, key: S.key }));
    } catch (e) { /* 隐私模式写不进去，不影响核对 */ }
  }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg, kind) {
    var el = $("#vs-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "vs-toast";
      el.className = "vs-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "vs-toast show" + (kind ? " vs-toast-" + kind : "");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = "vs-toast"; }, 2600);
  }

  /* ---------------- 索引与台账 ---------------- */

  function loadIndex() {
    if (window.PT_VERIFY && window.PT_VERIFY.policies) {
      S.index = window.PT_VERIFY;
      return Promise.resolve(S.index);
    }
    return api("/api/verify/index").then(function (data) {
      S.index = data;
      return data;
    });
  }

  function policyById(id) {
    return (S.index && S.index.policies || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function policyTitle(id) {
    var p = policyById(id);
    if (p) return p.title;
    var raw = S.policies.filter(function (x) { return x.id === id; })[0];
    return raw ? raw.title : id;
  }

  function sectionsOf(id) {
    var raw = S.policies.filter(function (x) { return x.id === id; })[0];
    return (raw && raw.sections) || [];
  }

  function keyOf(id, sec) {
    return id + "#" + sec.no + "#" + sec.idx;
  }

  function stateOf(key) {
    if (!S.state) return { status: "todo" };
    if (S.state.done[key]) {
      var d = S.state.done[key];
      return { status: "done", result: d.result, by: d.by, at: d.at, note: d.note };
    }
    if (S.state.claimed[key]) return { status: "claimed", by: S.state.claimed[key].by, at: S.state.claimed[key].at };
    return { status: "todo" };
  }

  function remainingOf(policy) {
    var done = S.state ? S.state.done : {};
    var left = 0;
    (policy.sections || []).forEach(function (sec) {
      if (!done[keyOf(policy.id, sec)]) left++;
    });
    return left;
  }

  function refresh() {
    return api("/api/verify/state").then(function (st) {
      S.state = st;
      S.connected = true;
      paintStatus();
      paintProgress();
      paintList();
      if (S.tab === "work") paintClaim();
      if (S.tab === "board") paintBoard();
    }).catch(function (err) {
      S.connected = false;
      paintStatus(err.message);
      paintProgress();
      paintList();
    });
  }

  /* ---------------- 顶部 ---------------- */

  function paintStatus(err) {
    var el = $("#vs-status");
    if (S.connected) {
      el.className = "vs-status on";
      el.textContent = "已连接 · 进度实时同步";
    } else {
      el.className = "vs-status off";
      el.textContent = err ? "未连接：" + err : "未连接（只能浏览，不能记录）";
    }
  }

  function paintProgress() {
    var fill = $("#vs-prog-fill");
    var text = $("#vs-prog-text");
    if (!S.state) {
      fill.style.width = "0%";
      text.textContent = "正在读台账…";
      return;
    }
    var total = S.state.total || 1;
    var done = Object.keys(S.state.done || {}).length;
    var pct = Math.round((done / total) * 1000) / 10;
    fill.style.width = pct + "%";
    text.innerHTML = "进度 " + done + " / " + total + " 条（" + pct + "%）" +
      (S.state.todo ? ' · <b>' + S.state.todo + " 条待核</b>" : " · 全部核完");
  }

  /* ---------------- 列表 ---------------- */

  function paintList() {
    var box = $("#vs-policy-list");
    var hint = $("#vs-list-hint");
    if (!S.index) return;

    var rows = (S.index.policies || []).filter(function (p) {
      if (S.tier !== "all" && p.tier !== S.tier) return false;
      if (S.q) {
        var hay = (p.title + " " + (p.documentNo || "") + " " + (p.region || "")).toLowerCase();
        if (hay.indexOf(S.q.toLowerCase()) < 0) return false;
      }
      if (S.onlyTodo && S.state && remainingOf(p) === 0) return false;
      return true;
    });

    rows.sort(function (a, b) {
      var order = { T1: 0, T2: 1, T3: 2, T4: 3 };
      var ta = order[a.tier], tb = order[b.tier];
      if (ta !== tb) return ta - tb;
      return remainingOf(b) - remainingOf(a);
    });

    var tierNote = { T1: "抓不到原文或扫描件，最容易出错", T2: "是 OCR 转录，数字要盯", T3: "机器只判了「部分一致」", T4: "机器判过一致，抽核即可" };
    hint.innerHTML = "共 " + rows.length + " 条政策。" +
      (S.tier !== "all" ? "<b>" + S.tier + "：</b>" + tierNote[S.tier] + "。" : "T1 风险最高，建议从 T1 开始。") +
      (S.connected ? "" : " <b>未连接服务</b>，下面的剩余条数不会更新。");

    box.innerHTML = rows.map(function (p) {
      var total = (p.sections || []).length;
      var left = S.connected ? remainingOf(p) : total;
      var donePct = total ? Math.round(((total - left) / total) * 100) : 0;
      var arch = p.archive && p.archive.hasText ? "" : '<span class="vs-badge vs-badge-warn">无存档</span>';
      var ocr = p.bodyVerified === "ocr" ? '<span class="vs-badge vs-badge-ocr">OCR</span>' : "";
      return '' +
        '<article class="vs-policy" data-id="' + esc(p.id) + '">' +
          '<div class="vs-policy-top">' +
            '<span class="vs-tier vs-tier-' + esc(p.tier) + '">' + esc(p.tier) + "</span>" +
            '<h3 class="vs-policy-title">' + esc(p.title) + "</h3>" +
            arch + ocr +
          "</div>" +
          '<p class="vs-policy-meta">' + esc(p.region || "") + " · " + esc(p.documentNo || "无文号") +
            " · " + total + " 条条款 · 剩 <b>" + left + "</b> 条</p>" +
          '<div class="vs-mini"><i style="width:' + donePct + '%"></i></div>' +
          '<div class="vs-policy-foot">' +
            '<button type="button" class="vs-btn vs-btn-main" data-open="' + esc(p.id) + '">' +
              (left === 0 ? "已核完，再看一遍" : "去核") + "</button>" +
          "</div>" +
        "</article>";
    }).join("") || '<p class="vs-hint">没有符合条件的政策。</p>';
  }

  /* ---------------- 核对视图 ---------------- */

  function openWork(id, idx) {
    S.cur.policyId = id;
    S.cur.idx = idx || 0;
    switchTab("work");
    paintWork(true);
  }

  function paintWork(scrollToClause) {
    var p = policyById(S.cur.policyId);
    if (!p) return;
    var secs = sectionsOf(S.cur.policyId);
    var total = p.sections.length || secs.length;
    var idx = Math.max(0, Math.min(S.cur.idx, total - 1));
    S.cur.idx = idx;
    var meta = p.sections[idx];
    var sec = secs.filter(function (s) { return s.no === meta.no && (s.idx == null || s.idx === meta.idx); })[0] || secs[idx] || {};

    $("#vs-policy-title").textContent = p.title;
    $("#vs-pos").textContent = "第 " + (idx + 1) + " / " + total + " 条";
    var src = $("#vs-source");
    if (p.sourceUrl) {
      src.href = p.sourceUrl;
      src.style.display = "";
    } else {
      src.style.display = "none";
    }
    $("#vs-clause-no").textContent = "第" + String(meta.no).replace(/条$/, "") + "条";
    $("#vs-clause").innerHTML = '<div class="vs-clause-text">' + esc(sec.text || "（这条在本站没有正文，可能是空条款）") + "</div>";

    paintArchive(p, sec.text || "");
    paintClaim();
    fitSplit();
    if (scrollToClause) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  var splitHooked = false;

  /** 让分屏正好占满剩余视口：从分屏顶部到底部工具栏之间全部给正文。 */
  function fitSplit() {
    var split = document.querySelector(".vs-split");
    if (!split) return;
    var top = split.getBoundingClientRect().top + window.scrollY;
    var actions = document.querySelector(".vs-actions");
    var actH = actions ? actions.offsetHeight + 24 : 84;
    var h = Math.round(window.innerHeight - top - actH - 16);
    if (h < 320) h = 320;
    split.style.setProperty("--vs-pane-h", h + "px");
    if (!splitHooked) {
      splitHooked = true;
      window.addEventListener("resize", fitSplit);
    }
  }

  function looseFind(hay, needle) {
    if (!hay || !needle) return -1;
    var direct = hay.indexOf(needle);
    if (direct >= 0) return direct;
    var map = [];
    var stripped = "";
    for (var i = 0; i < hay.length; i++) {
      if (!/\s/.test(hay.charAt(i))) {
        stripped += hay.charAt(i);
        map.push(i);
      }
    }
    var j = stripped.indexOf(needle);
    return j < 0 ? -1 : map[j];
  }

  function paintArchive(policy, clauseText) {
    var box = $("#vs-archive");
    var note = $("#vs-archive-note");
    box.innerHTML = '<p class="vs-hint">正在取原文…</p>';

    var render = function (data) {
      S.archive = data;
      var text = (data && data.text) || "";
      var from = (data && data.meta && data.meta.from) || "未知";
      var label = { "manual-paste": "人工粘贴", "ocr-fixed": "人工校对 OCR", "ocr-clean": "OCR 清理稿", "ocr-checked": "OCR 校对稿", "ocr": "OCR 识别", "seed-pdf": "本地 PDF", network: "现场抓取" }[from] || from;
      note.textContent = "来源：" + label + (data && data.meta && data.meta.chars ? " · " + data.meta.chars + " 字" : "");

      if (!text) {
        box.innerHTML = '<p class="vs-empty">这条政策还没有原文存档：源站拒绝抓取（412/403），或者当时没存下来。</p>' +
          '<p class="vs-hint">办法：点右上「官方原文 ↗」在浏览器里打开，把正文粘进来存成存档（一次性，存完所有人可用）。</p>' +
          '<textarea id="vs-paste" class="vs-paste" rows="8" placeholder="把官方原文整段粘在这里（至少 200 字）…"></textarea>' +
          '<div class="vs-paste-foot"><button type="button" class="vs-btn vs-btn-main" id="vs-paste-send">存成存档</button>' +
          '<span class="vs-hint">只存文本，不改站点内容。</span></div>';
        var send = $("#vs-paste-send");
        send.addEventListener("click", function () {
          var value = $("#vs-paste").value.trim();
          if (value.length < 200) return toast("太短了，至少 200 字", "warn");
          send.disabled = true;
          post("/api/verify/paste", { id: policy.id, text: value, sourceUrl: policy.sourceUrl || "" })
            .then(function () {
              toast("已存成存档，队友现在也能看到");
              S.archiveCache[policy.id] = null;
              paintArchive(policy, clauseText);
            })
            .catch(function (err) { send.disabled = false; toast("存不进去：" + err.message, "warn"); });
        });
        return;
      }

      var hit = looseFind(text, String(clauseText || "").replace(/\s+/g, "").slice(0, 16));
      var parts = text.split(/(?<=[。；！？\n])/);
      var offset = 0;
      var html = parts.map(function (part) {
        var start = offset;
        offset += part.length;
        var isHit = hit >= start && hit < offset;
        return '<span class="vs-sent' + (isHit ? " hit" : "") + '">' + esc(part) + "</span>";
      }).join("");
      box.innerHTML = '<div class="vs-archive-text">' + html + "</div>";
      var node = box.querySelector(".vs-sent.hit");
      if (node) {
        var top = node.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
        box.scrollTop = Math.max(0, top - box.clientHeight / 3);
      }
    };

    if (S.archiveCache[policy.id] != null) {
      render(S.archiveCache[policy.id]);
      return;
    }
    api("/api/verify/archive?id=" + encodeURIComponent(policy.id))
      .then(function (data) {
        S.archiveCache[policy.id] = data;
        if (S.cur.policyId === policy.id) render(data);
      })
      .catch(function (err) {
        if (err.status === 404) {
          S.archiveCache[policy.id] = { text: "", meta: null };
          if (S.cur.policyId === policy.id) render(S.archiveCache[policy.id]);
          return;
        }
        box.innerHTML = '<p class="vs-empty">取不到存档（' + esc(err.message) + "）。服务连上了吗？</p>";
      });
  }

  function paintClaim() {
    var p = policyById(S.cur.policyId);
    if (!p) return;
    var sec = p.sections[S.cur.idx];
    if (!sec) return;
    var key = keyOf(p.id, sec);
    var st = stateOf(key);
    var box = $("#vs-claim");
    var resultLabel = { ok: "一致", fixed: "已提交改正", flagged: "存疑", unverifiable: "拿不到原文" };

    if (st.status === "done") {
      box.className = "vs-claim done";
      box.innerHTML = "<b>" + esc(st.by) + "</b> 已核：" + esc(resultLabel[st.result] || st.result) +
        (st.note ? " · " + esc(st.note) : "") +
        '<span class="vs-claim-time">' + esc(String(st.at || "").slice(5, 16).replace("T", " ")) + "</span>";
    } else if (st.status === "claimed" && st.by !== S.name) {
      box.className = "vs-claim busy";
      box.innerHTML = "<b>" + esc(st.by) + "</b> 正在核这一条（15 分钟内有效）。换一条，或者等租约过期。";
    } else if (!S.connected) {
      box.className = "vs-claim off";
      box.textContent = "未连接服务：可以对照原文看，但不能记录进度。";
    } else {
      box.className = "vs-claim mine";
      box.textContent = "这一条还没人核，点下面的按钮记录结果。";
    }
    $$(".vs-actions .vs-btn").forEach(function (b) {
      b.disabled = !S.connected;
    });
  }

  /* ---------------- 写操作 ---------------- */

  function requireName() {
    if (!S.name) {
      toast("先在上面填「我的名字」，别人才能看出是谁核的", "warn");
      $("#vs-name").focus();
      return false;
    }
    return true;
  }

  function currentKeyAndText() {
    var p = policyById(S.cur.policyId);
    if (!p) return null;
    var sec = p.sections[S.cur.idx];
    var secs = sectionsOf(S.cur.policyId);
    var real = secs[S.cur.idx] || {};
    return { policy: p, sec: sec, key: keyOf(p.id, sec), text: real.text || "" };
  }

  function mark(result, note) {
    if (!requireName()) return;
    var cur = currentKeyAndText();
    if (!cur) return;
    post("/api/verify/done", { key: cur.key, result: result, note: note || "" })
      .then(function () {
        toast("已记下：" + ({ ok: "一致", flagged: "存疑", unverifiable: "拿不到原文" }[result] || result));
        return refresh().then(function () { next(); });
      })
      .catch(function (err) {
        if (err.status === 409 && err.body && err.body.reason === "claimed") {
          toast("刚被 " + err.body.by + " 占了，换一条吧", "warn");
          return refresh();
        }
        if (err.status === 409 && err.body && err.body.reason === "done") {
          toast(err.body.by + " 已经核过这条了", "warn");
          return refresh().then(function () { next(); });
        }
        toast("没记上：" + err.message, "warn");
      });
  }

  function next() {
    var p = policyById(S.cur.policyId);
    if (!p) return;
    if (S.cur.idx + 1 < p.sections.length) {
      S.cur.idx += 1;
      paintWork(true);
    } else {
      toast("这条政策核完了，回清单挑下一条");
      switchTab("list");
    }
  }

  function prev() {
    if (S.cur.idx > 0) {
      S.cur.idx -= 1;
      paintWork(true);
    }
  }

  /* ---------------- 改正弹窗 ---------------- */

  function openFix() {
    if (!requireName()) return;
    var cur = currentKeyAndText();
    if (!cur) return;
    S.modalKey = cur.key;
    $("#vs-modal-sub").textContent = cur.policy.title + " · " + cur.sec.no + " 条";
    $("#vs-modal-before").value = cur.text;
    $("#vs-modal-after").value = "";
    $("#vs-modal-reason").value = "";
    $("#vs-modal-shot").value = "";
    $("#vs-modal-page").value = "";
    $("#vs-modal-tip").textContent = "";
    $("#vs-modal").hidden = false;
    setTimeout(function () { $("#vs-modal-after").focus(); }, 30);
  }

  function closeFix() {
    $("#vs-modal").hidden = true;
  }

  function sendFix() {
    var after = $("#vs-modal-after").value.trim();
    var reason = $("#vs-modal-reason").value.trim();
    if (!after) return toast("「应该改成」不能空着", "warn");
    if (!reason) return toast("「为什么改」必须写，否则没法核对", "warn");
    var evidence = {};
    var shot = $("#vs-modal-shot").value.trim();
    var page = $("#vs-modal-page").value.trim();
    if (shot) evidence.screenshot = shot;
    if (page) evidence.pdfPage = Number(page) || page;
    $("#vs-modal-send").disabled = true;
    post("/api/verify/change", {
      key: S.modalKey,
      before: $("#vs-modal-before").value,
      after: after,
      reason: reason,
      evidence: evidence,
    })
      .then(function (res) {
        $("#vs-modal-send").disabled = false;
        closeFix();
        toast(res.needsEvidence ? "已提交（涉及金额但没附证据，负责人落盘前会要）" : "已提交改正申请：" + res.changeId);
        return refresh().then(function () { next(); });
      })
      .catch(function (err) {
        $("#vs-modal-send").disabled = false;
        toast("提交失败：" + err.message, "warn");
      });
  }

  /* ---------------- 看板 ---------------- */

  function paintBoard() {
    var box = $("#vs-board-body");
    if (!S.state) {
      box.innerHTML = '<p class="vs-hint">还没有连上台账。</p>';
      return;
    }
    var byUser = {};
    var byResult = { ok: 0, fixed: 0, flagged: 0, unverifiable: 0 };
    Object.keys(S.state.done).forEach(function (key) {
      var d = S.state.done[key];
      byUser[d.by] = (byUser[d.by] || 0) + 1;
      if (byResult[d.result] != null) byResult[d.result] += 1;
    });
    var users = Object.keys(byUser).sort(function (a, b) { return byUser[b] - byUser[a]; });
    var claimed = Object.keys(S.state.claimed);

    box.innerHTML = '' +
      '<div class="vs-cards">' +
        '<div class="vs-card"><span>已核</span><b>' + Object.keys(S.state.done).length + "</b></div>" +
        '<div class="vs-card"><span>待核</span><b>' + S.state.todo + "</b></div>" +
        '<div class="vs-card"><span>正在核</span><b>' + claimed.length + "</b></div>" +
        '<div class="vs-card"><span>有问题</span><b>' + (byResult.flagged + byResult.fixed) + "</b></div>" +
      "</div>" +
      "<h3>谁核了多少</h3>" +
      (users.length
        ? '<table class="vs-table"><thead><tr><th>核对人</th><th>条数</th><th>占比</th></tr></thead><tbody>' +
          users.map(function (u) {
            var n = byUser[u];
            var pct = Math.round((n / (Object.keys(S.state.done).length || 1)) * 100);
            return "<tr><td>" + esc(u) + "</td><td>" + n + '</td><td><span class="vs-mini vs-mini-inline"><i style="width:' + pct + '%"></i></span> ' + pct + "%</td></tr>";
          }).join("") +
          "</tbody></table>"
        : '<p class="vs-hint">还没有人开始。</p>') +
      "<h3>结论分布</h3>" +
      '<p class="vs-hint">一致 ' + byResult.ok + " · 已改正 " + byResult.fixed + " · 存疑 " + byResult.flagged + " · 拿不到原文 " + byResult.unverifiable + "</p>" +
      (claimed.length ? "<h3>正在核（15 分钟租约）</h3><p class=\"vs-hint\">" + claimed.map(function (k) {
        return esc(S.state.claimed[k].by) + " → " + esc(k);
      }).join("<br>") + "</p>" : "");
  }

  /* ---------------- 改动申请 ---------------- */

  function paintChanges() {
    var box = $("#vs-changes-body");
    box.innerHTML = '<p class="vs-hint">正在读…</p>';
    api("/api/verify/changes")
      .then(function (data) {
        if (!data.items.length) {
          box.innerHTML = '<p class="vs-hint">还没有改动申请。</p>';
          return;
        }
        box.innerHTML = data.items.map(function (c) {
          return '<article class="vs-change' + (c.needsEvidence ? " need-evi" : "") + '">' +
            '<div class="vs-change-top"><b>' + esc(c.change_id) + "</b><span>" + esc(c.by) + " · " + esc(String(c.at).slice(0, 16).replace("T", " ")) + "</span></div>" +
            "<p class=\"vs-change-key\">" + esc(policyTitle(c.policy_id)) + " · " + esc(c.section_no) + " 条</p>" +
            '<p class="vs-change-line"><span>现在</span>' + esc(c.before || "（空）") + "</p>" +
            '<p class="vs-change-line"><span>改成</span><b>' + esc(c.after) + "</b></p>" +
            "<p class=\"vs-change-why\">理由：" + esc(c.reason) + "</p>" +
            (c.needsEvidence ? '<p class="vs-change-warn">涉及金额但没有截图/页码证据，落盘前要补</p>' : "") +
            (c.state === "applied" ? '<p class="vs-change-ok">已落盘</p>' : "") +
            "</article>";
        }).join("");
      })
      .catch(function (err) {
        box.innerHTML = '<p class="vs-empty">读不到改动清单：' + esc(err.message) + "</p>";
      });
  }

  /* ---------------- 视图切换 ---------------- */

  /** 没选具体条款就直接进「逐条核对」时，自动打开第一条没核过的（T1 优先）。 */
  function openFirstTodo() {
    if (!S.index || !S.index.policies) return;
    var order = { T1: 0, T2: 1, T3: 2, T4: 3 };
    var pols = S.index.policies.slice().sort(function (a, b) {
      return (order[a.tier] == null ? 9 : order[a.tier]) - (order[b.tier] == null ? 9 : order[b.tier]);
    });
    for (var i = 0; i < pols.length; i++) {
      var secs = pols[i].sections || [];
      for (var j = 0; j < secs.length; j++) {
        if (stateOf(keyOf(pols[i].id, secs[j])).status !== "done") {
          S.cur = { policyId: pols[i].id, idx: j };
          return;
        }
      }
    }
  }

  function switchTab(tab) {
    S.tab = tab;
    if (tab === "work" && !S.cur.policyId) openFirstTodo();
    $$("#vs-tabs button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-vtab") === tab);
    });
    $("#vs-pane-list").hidden = tab !== "list";
    $("#vs-pane-work").hidden = tab !== "work";
    $("#vs-pane-board").hidden = tab !== "board";
    $("#vs-pane-changes").hidden = tab !== "changes";
    document.body.classList.toggle("vs-working", tab === "work");
    if (tab === "board") paintBoard();
    if (tab === "changes") paintChanges();
    if (tab === "list") paintList();
    if (tab === "work") {
      if (S.cur.policyId) paintWork(true);
      fitSplit();
    }
  }

  /* ---------------- 绑定 ---------------- */

  function bind() {
    $("#vs-name").value = S.name;
    $("#vs-key").value = S.key;

    $("#vs-conn").addEventListener("click", function () {
      S.name = $("#vs-name").value.trim();
      S.key = $("#vs-key").value.trim();
      save();
      refresh();
    });

    $("#vs-tabs").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-vtab]");
      if (btn) switchTab(btn.getAttribute("data-vtab"));
    });

    $("#vs-policy-list").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-open]");
      if (!btn) return;
      var id = btn.getAttribute("data-open");
      var p = policyById(id);
      var start = 0;
      if (p && S.connected) {
        for (var i = 0; i < p.sections.length; i++) {
          if (stateOf(keyOf(id, p.sections[i])).status !== "done") { start = i; break; }
        }
      }
      openWork(id, start);
    });

    $$(".vs-filter [data-tier]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        S.tier = btn.getAttribute("data-tier");
        $$(".vs-filter [data-tier]").forEach(function (b) { b.classList.toggle("on", b === btn); });
        paintList();
      });
    });

    var onlyBtn = $('.vs-filter [data-only="todo"]');
    onlyBtn.addEventListener("click", function () {
      S.onlyTodo = !S.onlyTodo;
      onlyBtn.classList.toggle("on", S.onlyTodo);
      paintList();
    });

    $("#vs-search").addEventListener("input", function (e) {
      S.q = e.target.value.trim();
      paintList();
    });

    $("#vs-prev").addEventListener("click", prev);
    $("#vs-next").addEventListener("click", next);

    $$(".vs-actions [data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-act");
        if (act === "ok") mark("ok");
        else if (act === "fix") openFix();
        else if (act === "doubt") {
          var why = window.prompt("哪里拿不准？写一句，队友会看到。", "");
          if (why != null) mark("flagged", why);
        } else if (act === "unverifiable") {
          var note = window.prompt("为什么拿不到原文？", "源站 412 / 需要登录");
          if (note != null) mark("unverifiable", note);
        }
      });
    });

    $("#vs-embed").addEventListener("click", function () {
      var p = policyById(S.cur.policyId);
      if (!p || !p.sourceUrl) return toast("这条没有源地址", "warn");
      var box = $("#vs-archive");
      box.innerHTML = '<iframe class="vs-frame" src="' + esc(p.sourceUrl) + '" referrerpolicy="no-referrer"></iframe>' +
        '<p class="vs-hint">政府站大多禁了嵌入，「白屏」不是你网坏了——点上面「官方原文 ↗」在新窗口看。</p>';
    });

    $("#vs-modal-cancel").addEventListener("click", closeFix);
    $("#vs-modal-send").addEventListener("click", sendFix);
    $("#vs-modal").addEventListener("click", function (e) {
      if (e.target === $("#vs-modal")) closeFix();
    });

    document.addEventListener("keydown", function (e) {
      if (!$("#vs-modal").hidden) return;
      if (S.tab !== "work") return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === "Enter") { e.preventDefault(); mark("ok"); }
      else if (e.key === "e" || e.key === "E") { e.preventDefault(); openFix(); }
      else if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        var why = window.prompt("哪里拿不准？", "");
        if (why != null) mark("flagged", why);
      }
    });
  }

  function boot() {
    S.base = apiBase();
    load();
    bind();
    switchTab("list");

    if (!S.base) {
      paintStatus("这个页面没配接口地址（构建时没设 CHAT_API）");
      return loadIndex().then(function () { S.state = null; paintList(); paintProgress(); }).catch(function () {});
    }

    loadIndex()
      .then(function () {
        paintList();
        return refresh();
      })
      .then(function () {
        var p = new URLSearchParams(location.search);
        if (p.get("policy")) openWork(p.get("policy"), Number(p.get("idx") || 0));
      })
      .catch(function (err) {
        paintStatus(err.message);
        paintList();
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
