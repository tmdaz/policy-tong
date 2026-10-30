/**
 * 政策文本解析核心（浏览器与命令行共用，唯一实现）。
 *
 * 浏览器：<script src="assets/splitter.js"></script> → window.PolicySplitter
 * Node   ：createRequire(...).require("./static-src/splitter.js")
 *
 * 只做三件事：切条款、猜元信息、校验草稿。不做解读、不编造字段。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PolicySplitter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CN_NUM = "一二三四五六七八九十百零〇";

  /** 按「第X条」切分；识别不到条号时整体作为一条。 */
  function splitSections(text) {
    var src = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!src) return [];

    var re = new RegExp("(?:^|\\n)\\s*(第[" + CN_NUM + "\\d]+条)", "g");
    var hits = [];
    var m;
    while ((m = re.exec(src))) {
      hits.push({ index: m.index + (m[0].length - m[1].length), label: m[1] });
    }

    if (!hits.length) {
      var firstLine = (src.split("\n")[0] || "").trim();
      return [{ no: "一", title: firstLine.slice(0, 20) || "正文", text: src }];
    }

    var out = [];
    for (var i = 0; i < hits.length; i++) {
      var start = hits[i].index;
      var end = i + 1 < hits.length ? hits[i + 1].index : src.length;
      var chunk = src.slice(start, end).trim();
      var no = hits[i].label.replace(/^第/, "").replace(/条$/, "");
      var body = chunk
        .replace(new RegExp("^第[" + CN_NUM + "\\d]+条\\s*"), "")
        .trim();
      // 标题取首句：太长的截断没意义，直接退回「第X条」
      var firstSentence = (body.split(/[。；\n]/)[0] || "").trim();
      var title =
        firstSentence && firstSentence.length <= 24
          ? firstSentence
          : "第" + no + "条";
      out.push({
        no: no,
        title: title,
        text: body,
      });
    }
    return out;
  }

  /** 从全文里猜标题、文号、发文机关、发布日期；猜不到就返回空串。 */
  function guessMeta(text, fallbackTitle) {
    var src = String(text || "");
    var lines = src
      .split("\n")
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);

    var title =
      lines.filter(function (l) {
        return /关于.{2,60}(通知|意见|办法|规定|公告|方案|细则)/.test(l);
      })[0] ||
      lines.filter(function (l) {
        return l.length >= 10 && l.length <= 60;
      })[0] ||
      fallbackTitle ||
      "";

    var docNo = (src.match(/[\u4e00-\u9fa5]{1,12}〔\d{4}〕\d{1,4}号/) || [])[0] || "";

    var issuer =
      lines.filter(function (l) {
        return (
          l.length <= 30 &&
          /(人民政府|办公厅|税务局|财政厅|人力资源和社会保障厅|工业和信息化厅|发展和改革委员会|市场监督管理局)/.test(
            l,
          )
        );
      })[0] || "";

    var dateMatch = src.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    var publishedAt = dateMatch
      ? dateMatch[1] +
        "-" +
        String(dateMatch[2]).padStart(2, "0") +
        "-" +
        String(dateMatch[3]).padStart(2, "0")
      : "";

    return {
      title: title.trim(),
      documentNo: docNo,
      issuer: issuer,
      publishedAt: publishedAt,
    };
  }

  function isKebab(value) {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(value || ""));
  }

  /** 校验草稿，返回错误列表（空数组 = 可以发布）。 */
  function validateDraft(draft) {
    var errors = [];
    if (!draft) return ["草稿为空"];
    if (!isKebab(draft.id)) errors.push("id 必须是 kebab-case（小写字母/数字/连字符）");
    if (!draft.title) errors.push("标题不能为空");
    if (!draft.issuer) errors.push("发文机关不能为空");
    if (!draft.publishedAt || draft.publishedAt === "1970-01-01")
      errors.push("发布日期必填");
    if (!draft.sourceUrl) errors.push("官方原文链接必填（政策必须可核验）");
    if (!draft.sections || !draft.sections.length) errors.push("至少需要一条条款");

    var nos = {};
    (draft.sections || []).forEach(function (s) {
      if (nos[s.no]) errors.push("条号重复：第" + s.no + "条");
      nos[s.no] = true;
      if (!s.text) errors.push("第" + s.no + "条正文为空");
    });

    (draft.interpretations || []).forEach(function (it) {
      if (!nos[it.sectionNo])
        errors.push("解读指向了不存在的条号：" + it.sectionNo);
    });

    return errors;
  }

  /** 由表单/命令行字段 + 条款拼出标准草稿对象。 */
  function buildDraft(fields, sections) {
    var split = function (value) {
      return String(value || "")
        .split(/[,，、]/)
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    };
    return {
      id: fields.id || "",
      title: fields.title || "",
      level: fields.level || "provincial",
      region: fields.region || "湖南省",
      issuer: fields.issuer || "",
      documentNo: fields.documentNo || "",
      publishedAt: fields.publishedAt || "",
      expiresAt: fields.expiresAt || undefined,
      status: "active",
      tags: Array.isArray(fields.tags) ? fields.tags : split(fields.tags),
      audience: Array.isArray(fields.audience) ? fields.audience : split(fields.audience),
      summary: fields.summary || "",
      sections: sections || [],
      interpretations: fields.interpretations || [],
      sourceUrl: fields.sourceUrl || "",
      sourceNote:
        fields.sourceNote ||
        "原文由人工检索获取，条款未逐字复核前请保持 verified: false",
      verified: fields.verified === true,
      isSample: fields.isSample === true,
    };
  }

  function slugify(name) {
    return String(name || "")
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  return {
    splitSections: splitSections,
    guessMeta: guessMeta,
    validateDraft: validateDraft,
    buildDraft: buildDraft,
    slugify: slugify,
    isKebab: isKebab,
  };
});
