/**
 * 政策检索核心（浏览器与命令行共用，唯一实现）。
 *
 * 浏览器：<script src="assets/retrieval.js"> → window.PolicyRetrieval
 * Node   ：require("./static-src/core/retrieval.js")
 *
 * 只做检索与打分，不做解读、不发网络请求。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PolicyRetrieval = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CITIES = [
    "长沙市", "株洲市", "湘潭市", "衡阳市", "邵阳市", "岳阳市", "常德市",
    "张家界市", "益阳市", "郴州市", "永州市", "怀化市", "娄底市", "湘西土家族苗族自治州",
  ];

  /** 口语 → 公文用语。命中左边的词，就把右边的词也加进检索词。 */
  var SYNONYMS = {
    补贴: ["奖补", "补助", "扶持", "资金", "贴息"],
    补助: ["补贴", "奖补", "扶持"],
    奖补: ["补贴", "补助", "奖励"],
    减税: ["税收优惠", "减免"],
    免税: ["免征", "增值税"],
    所得税: ["企业所得税", "个人所得税"],
    小规模: ["小规模纳税人"],
    一般纳税人: ["增值税"],
    招用: ["吸纳", "就业", "用工"],
    招人: ["吸纳", "就业"],
    员工: ["从业人数", "职工"],
    场地: ["租金", "孵化", "基地", "用房"],
    办公室: ["租金", "孵化", "场地"],
    贷款: ["融资", "贴息", "担保"],
    借钱: ["贷款", "融资"],
    研发: ["加计扣除", "科技", "技术创新"],
    创新: ["研发", "科技", "专精特新"],
    专精特新: ["创新型中小企业", "认定"],
    申报: ["申请", "材料", "受理"],
    申请: ["申报", "材料"],
    材料: ["申报", "证明"],
    多久: ["期限", "时限", "工作日"],
    什么时候: ["时间", "期限", "截止"],
    截止: ["期限", "申报期"],
    毕业: ["大学生", "高校毕业生"],
    学生: ["大学生", "高校毕业生"],
    失业: ["失业人员", "稳岗", "就业"],
    社保: ["社会保险", "社保补贴"],
    裁员: ["稳岗", "裁员率"],
  };

  /** 追问特征词：出现这些且句子短，就判定为承接上一轮 */
  var FOLLOW_UP = /^(那|那么|这个|这项|这条|它|还有|另外|上面|刚才)/;

  function tokenize(input) {
    var text = String(input == null ? "" : input).toLowerCase();
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

  function unique(list) {
    var seen = {};
    return list.filter(function (v) {
      if (seen[v]) return false;
      seen[v] = 1;
      return true;
    });
  }

  function expandTokens(query) {
    var extra = [];
    Object.keys(SYNONYMS).forEach(function (word) {
      if (query.indexOf(word) === -1) return;
      SYNONYMS[word].forEach(function (syn) {
        extra = extra.concat(tokenize(syn));
      });
    });
    return extra;
  }

  function detectCity(query) {
    for (var i = 0; i < CITIES.length; i++) {
      if (query.indexOf(CITIES[i]) !== -1) return CITIES[i];
    }
    if (query.indexOf("湖南") !== -1) return "湖南";
    return "";
  }

  /** 明确不在湖南的地名：命中就直说「只覆盖湖南」，避免硬套湖南政策 */
  var OTHER_PLACES = [
    "北京", "上海", "深圳", "广州", "杭州", "成都", "南京", "武汉", "西安", "重庆", "天津",
    "苏州", "东莞", "佛山", "郑州", "青岛", "厦门", "宁波", "合肥", "济南", "沈阳", "大连",
    "昆明", "贵阳", "南宁", "海口", "三亚", "拉萨", "乌鲁木齐", "兰州", "银川", "西宁",
    "呼和浩特", "哈尔滨", "长春", "石家庄", "太原", "南昌", "福州", "外省", "其他省",
  ];

  /** 政策领域的必备词：一个都没有，基本是泛问 */
  var DOMAIN_WORDS = [
    "税", "补贴", "补助", "奖补", "贷款", "融资", "贴息", "社保", "保险", "就业", "创业",
    "研发", "加计", "专精特新", "申报", "申请", "认定", "孵化", "场地", "租金", "稳岗",
    "数字化", "设备", "专项资金", "营商", "工资", "注册", "个体", "小微", "企业",
  ];

  function outOfScope(query) {
    var q = String(query || "");
    for (var i = 0; i < OTHER_PLACES.length; i++) {
      if (q.indexOf(OTHER_PLACES[i]) !== -1) return OTHER_PLACES[i];
    }
    return "";
  }

  function hasDomainWord(query) {
    var q = String(query || "");
    for (var i = 0; i < DOMAIN_WORDS.length; i++) {
      if (q.indexOf(DOMAIN_WORDS[i]) !== -1) return true;
    }
    return false;
  }

  function isExpired(policy, now) {
    if (!policy) return false;
    if (policy.status === "expired") return true;
    if (policy.expiresAt) {
      var end = new Date(policy.expiresAt);
      if (!isNaN(end.getTime()) && end.getTime() < (now || Date.now())) return true;
    }
    return false;
  }

  /**
   * 统一判定：能不能基于库里的条款回答。
   * 返回 { docs, uncovered, reason, place }
   */
  function decide(index, query, opts) {
    opts = opts || {};
    var place = outOfScope(query);
    if (place) {
      return { docs: [], uncovered: true, reason: "out-of-scope", place: place };
    }
    var docs = retrieve(index, query, opts);
    if (!docs.length) {
      return { docs: [], uncovered: true, reason: "empty" };
    }
    var minScore = opts.minScore == null ? 10 : opts.minScore;
    var hasHistory = !!(opts.history && String(opts.history).trim());
    if (!hasDomainWord(query) && docs[0].score < minScore) {
      return { docs: docs, uncovered: true, reason: "vague" };
    }
    if (!hasHistory && docs[0].score < minScore) {
      return { docs: docs, uncovered: true, reason: "low-score" };
    }
    return { docs: docs, uncovered: false };
  }

  function createIndex(policies) {
    var docs = [];
    (policies || []).forEach(function (p) {
      (p.sections || []).forEach(function (s) {
        docs.push({
          policyId: p.id,
          policyTitle: p.title,
          sectionNo: s.no,
          sectionTitle: s.title,
          kind: "section",
          level: p.level,
          region: p.region,
          tags: p.tags || [],
          expired: isExpired(p),
          text: s.title + " " + s.text + " " + p.title + " " + (p.tags || []).join(" "),
        });
      });
      (p.interpretations || []).forEach(function (it) {
        docs.push({
          policyId: p.id,
          policyTitle: p.title,
          sectionNo: it.sectionNo,
          sectionTitle: it.headline,
          kind: "interpretation",
          level: p.level,
          region: p.region,
          tags: p.tags || [],
          expired: isExpired(p),
          text: [it.headline, it.who, it.window, it.where, it.tip || "", (it.materials || []).join(" ")]
            .join(" ") + " " + p.title + " " + (p.tags || []).join(" "),
        });
      });
    });

    var docTokens = docs.map(function (d) {
      return tokenize(d.text);
    });
    var avgLen =
      docTokens.reduce(function (n, t) {
        return n + t.length;
      }, 0) / (docTokens.length || 1);

    var df = {};
    docTokens.forEach(function (tokens) {
      var seen = {};
      tokens.forEach(function (t) {
        if (seen[t]) return;
        seen[t] = 1;
        df[t] = (df[t] || 0) + 1;
      });
    });

    return { docs: docs, docTokens: docTokens, df: df, avgLen: avgLen, N: docs.length };
  }

  /** 判断是否是追问（短句 + 代词/省略） */
  function isFollowUp(query) {
    var q = String(query || "").trim();
    if (!q) return false;
    if (FOLLOW_UP.test(q)) return true;
    // 只有很短且带疑问语气的省略句才算追问（如「多久能下来」）
    return q.length <= 6 && /[吗呢啊吧？?]$|多久|多少钱|在哪/.test(q);
  }

  /**
   * @param {object} index  createIndex 的返回值
   * @param {string} query  当前问题
   * @param {object} opts   { k, history, expand }
   * @returns {Array} 按分数降序的条款，元素带 score
   */
  function retrieve(index, query, opts) {
    opts = opts || {};
    var k = opts.k || 8;
    var raw = String(query || "");
    var history = String(opts.history || "");
    var useHistory = opts.useHistory !== false && history && isFollowUp(raw);

    var queryText = useHistory ? raw + " " + history : raw;
    var q = unique(tokenize(queryText));
    if (opts.expand !== false) q = unique(q.concat(expandTokens(queryText)));
    if (!q.length) return [];

    var city = detectCity(raw);
    var qSet = {};
    q.forEach(function (t) {
      qSet[t] = 1;
    });

    var scored = index.docs.map(function (doc, idx) {
      var tokens = index.docTokens[idx];
      var tf = {};
      tokens.forEach(function (t) {
        tf[t] = (tf[t] || 0) + 1;
      });

      var score = 0;
      q.forEach(function (term) {
        var f = tf[term];
        if (!f) return;
        var n = index.df[term] || 0;
        var idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
        var K1 = 1.2;
        var B = 0.75;
        var denom = f + K1 * (1 - B + (B * tokens.length) / index.avgLen);
        score += idf * ((f * (K1 + 1)) / denom);
      });
      if (!score) return { doc: doc, score: 0 };

      // 结构化加权
      // 解读文档是某条条款的一种说法，不是独立政策，不额外提权也不降权。
      // 早先全库只有百来条解读时曾给 1.15 提权，如今近八百条，
      // 提权会让解读挤掉条款原文（实测 1.15 → 23/25，1.0 → 25/25），
      // 等于拿二手话术替换一手依据；降权同样会丢命中（0.92 → 24/25），故保持中性。


      var titleTokens = tokenize(doc.policyTitle);
      var overlap = 0;
      for (var i = 0; i < titleTokens.length; i++) if (qSet[titleTokens[i]]) overlap++;
      if (overlap) score *= 1 + Math.min(0.25, overlap * 0.02);

      if (doc.tags && doc.tags.length) {
        for (var t = 0; t < doc.tags.length; t++) {
          if (raw.indexOf(doc.tags[t]) !== -1) {
            score *= 1.15;
            break;
          }
        }
      }

      if (city === "湖南") {
        if (doc.level !== "national") score *= 1.1;
      } else if (city) {
        if (String(doc.region || "").indexOf(city) !== -1) score *= 1.1;
        else if (doc.level === "city") score *= 0.85;
      }

      if (doc.expired) score *= 0.4;

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
    for (var j = 0; j < scored.length && out.length < k; j++) {
      var key = scored[j].doc.policyId + "#" + scored[j].doc.sectionNo;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({
        policyId: scored[j].doc.policyId,
        policyTitle: scored[j].doc.policyTitle,
        sectionNo: scored[j].doc.sectionNo,
        sectionTitle: scored[j].doc.sectionTitle,
        kind: scored[j].doc.kind,
        level: scored[j].doc.level,
        region: scored[j].doc.region,
        expired: scored[j].doc.expired,
        text: scored[j].doc.text,
        score: scored[j].score,
      });
    }
    return out;
  }

  return {
    tokenize: tokenize,
    createIndex: createIndex,
    retrieve: retrieve,
    isFollowUp: isFollowUp,
    decide: decide,
    outOfScope: outOfScope,
    hasDomainWord: hasDomainWord,
    detectCity: detectCity,
    isExpired: isExpired,
    SYNONYMS: SYNONYMS,
    CITIES: CITIES,
  };
});
