/**
 * 政策通 · 税费计算器（浏览器与 Node 共用，唯一实现）
 *
 * 只覆盖两类规则明确、演示高频的情形：
 *   1. 小型微利企业所得税
 *   2. 小规模纳税人月销售额增值税
 *
 * 计算口径全部来自库内条款：
 *   - 财政部 税务总局公告 2023 年第 12 号：应纳税所得额不超过 300 万元的部分，
 *     减按 25% 计入应纳税所得额，按 20% 税率缴纳；条件为从业人数≤300、
 *     资产总额≤5000 万、从事国家非限制和禁止行业。
 *   - 财政部 税务总局公告 2023 年第 19 号：小规模纳税人月销售额 10 万元以下免征增值税，
 *     3% 征收率减按 1% 征收。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TaxCalc = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LIMIT_WAN = 300; // 小型微利企业年应纳税所得额上限（万元）
  var VAT_FREE_WAN = 10; // 小规模纳税人月销售额免征上限（万元）

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function fmt(n) {
    if (!isFinite(n)) return "—";
    var r = round2(n);
    return String(r).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
  }

  /**
   * 小型微利企业所得税
   * @param {number} profitWan 年应纳税所得额（万元）
   * @returns {{ok:boolean, tax?:number, steps?:string[], summary?:string, risk?:string, reason?:string}}
   */
  function smallBusinessIncomeTax(profitWan) {
    var p = Number(profitWan);
    if (!isFinite(p)) return { ok: false, reason: "金额无法识别" };
    if (p <= 0) {
      return {
        ok: true,
        tax: 0,
        steps: ["利润为 0 或亏损，当年不产生企业所得税"],
        summary: "当年不需要缴纳企业所得税",
        risk: "亏损可结转以后年度弥补，具体以申报表为准。",
      };
    }

    if (p <= LIMIT_WAN) {
      var base = p * 0.25;
      var tax = base * 0.2;
      return {
        ok: true,
        tax: round2(tax),
        steps: [
          fmt(p) + " 万元 ≤ 300 万元，符合小型微利企业条件",
          fmt(p) + " × 25% = " + fmt(base) + " 万元（计入应纳税所得额）",
          fmt(base) + " × 20% = " + fmt(tax) + " 万元（实际税负 5%）",
        ],
        summary: "应缴企业所得税约 " + fmt(tax) + " 万元",
        risk: "需同时满足：从业人数不超过 300 人、资产总额不超过 5000 万元、从事国家非限制和禁止行业；最终以主管税务机关核定为准。",
      };
    }

    var full = p * 0.25;
    return {
      ok: true,
      tax: round2(full),
      steps: [
        fmt(p) + " 万元 > 300 万元，已不符合小型微利企业条件",
        fmt(p) + " × 25% = " + fmt(full) + " 万元（按法定税率 25% 全额计）",
      ],
      summary: "不再适用小微优惠，应缴企业所得税约 " + fmt(full) + " 万元",
      risk: "若符合高新技术企业（15%）等其他优惠条件，需另行申请认定；以主管税务机关核定为准。",
    };
  }

  /**
   * 小规模纳税人增值税（按月度销售额）
   * @param {number} monthWan 月销售额（万元）
   */
  function vatSmallScale(monthWan) {
    var v = Number(monthWan);
    if (!isFinite(v)) return { ok: false, reason: "金额无法识别" };
    if (v < 0) return { ok: false, reason: "金额不能为负" };

    if (v <= VAT_FREE_WAN) {
      return {
        ok: true,
        tax: 0,
        steps: [
          fmt(v) + " 万元 ≤ 10 万元（月销售额）",
          "符合小规模纳税人免征增值税条件，应纳增值税为 0",
        ],
        summary: "月销售额未超过 10 万元，免征增值税",
        risk: "按季申报的，季度销售额不超过 30 万元同样免征；开具增值税专用发票的部分不适用免税。",
      };
    }

    var tax = v * 0.01;
    return {
      ok: true,
      tax: round2(tax),
      steps: [
        fmt(v) + " 万元 > 10 万元，不适用免征",
        fmt(v) + " × 1% = " + fmt(tax) + " 万元（3% 征收率减按 1%）",
      ],
      summary: "应缴增值税约 " + fmt(tax) + " 万元",
      risk: "减按 1% 征收需符合当期政策口径；开具专用发票部分按适用税率计算，以主管税务机关口径为准。",
    };
  }

  /**
   * 从自然语言里抽取金额（万元）
   * 支持：80万 / 80 万元 / 800000 元 / 0.8 亿
   */
  function extractWan(text) {
    var s = String(text || "").replace(/,/g, "");
    var m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*(亿|万|千)?\s*元?/);
    if (!m) return null;
    var n = Number(m[1]);
    if (!isFinite(n)) return null;
    if (m[2] === "亿") return n * 10000;
    if (m[2] === "万") return n;
    if (m[2] === "千") return n / 10;
    // 纯数字：超过 10000 视为「元」，否则按「万元」理解
    return n >= 10000 ? n / 10000 : n;
  }

  /**
   * 判断问题是否属于「可计算」的税费题，并给出计算器结果
   * @returns {{type: "income-tax"|"vat"|"", result?: object, amountWan?: number}}
   */
  function tryCompute(question) {
    var q = String(question || "");
    var amount = extractWan(q);
    if (amount === null) return { type: "" };
    // 「亏损 20 万」应视为 -20，而不是盈利 20
    if (/(亏损|亏了|亏本|负利润|赔了)/.test(q)) amount = -Math.abs(amount);

    var asksHowMuch = /(多少|怎么算|要交|应交|缴纳|交多少|税负|算一下|合计|一共)/.test(q);
    if (!asksHowMuch) return { type: "" };

    var isIncomeTax = /(企业所得税|所得税)/.test(q) && !/个人所得税/.test(q);
    var isVat = /(增值税)/.test(q);

    if (isIncomeTax && /(利润|应纳税所得额|所得)/.test(q)) {
      return { type: "income-tax", amountWan: amount, result: smallBusinessIncomeTax(amount) };
    }
    if (isVat && /(销售额|营业额|收入)/.test(q)) {
      return { type: "vat", amountWan: amount, result: vatSmallScale(amount) };
    }
    return { type: "" };
  }

  return {
    smallBusinessIncomeTax: smallBusinessIncomeTax,
    vatSmallScale: vatSmallScale,
    extractWan: extractWan,
    tryCompute: tryCompute,
    LIMIT_WAN: LIMIT_WAN,
    VAT_FREE_WAN: VAT_FREE_WAN,
  };
});
