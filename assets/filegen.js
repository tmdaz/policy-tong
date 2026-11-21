/**
 * 政策通 · 文件生成引擎（浏览器与 Node 共用，唯一实现）
 *
 * 浏览器：<script src="assets/filegen.js"> → window.PT_FILES
 * Node   ：require("./static-src/filegen.js")
 *
 * 零依赖、离线可用：
 *   .docx / .xlsx 本质是一个 ZIP，这里只用 STORE（不压缩，method=0），
 *   省掉 deflate 实现，Word / Excel / WPS 完全接受。
 *
 * 排版参数按 A4 写死（见 toDocx 里的注释），这是能不能打印对的关键。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PT_FILES = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- 字节工具 ---------- */

  var TE = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  var TD = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

  function utf8(str) {
    if (TE) return TE.encode(String(str));
    // 极老环境兜底
    var s = unescape(encodeURIComponent(String(str)));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function utf8Decode(bytes) {
    if (TD) return TD.decode(bytes);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  function concat(chunks) {
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var at = 0;
    for (var j = 0; j < chunks.length; j++) {
      out.set(chunks[j], at);
      at += chunks[j].length;
    }
    return out;
  }

  /* ---------- CRC32（多项式 0xEDB88320 查表法） ---------- */

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---------- ZIP ---------- */

  /** DOS 时间：ZIP 头里只能存 1980–2107 的本地时间 */
  function dosDateTime(d) {
    d = d || new Date();
    var y = d.getFullYear();
    if (y < 1980) y = 1980;
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
    var date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xffff, date: date & 0xffff };
  }

  function u16(v) {
    return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  }
  function u32(v) {
    return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  }

  /**
   * @param {Array<{name:string, data:Uint8Array|string}>} files
   * @returns {Uint8Array}
   */
  function zip(files) {
    var now = dosDateTime(new Date());
    // bit 11（0x0800）= 文件名按 UTF-8 编码，否则中文名在 WinRAR/资源管理器里乱码
    var FLAG = 0x0800;
    var locals = [];
    var centrals = [];
    var offset = 0;

    for (var i = 0; i < files.length; i++) {
      var name = utf8(files[i].name);
      var data = typeof files[i].data === "string" ? utf8(files[i].data) : files[i].data;
      var crc = crc32(data);

      var local = concat([
        u32(0x04034b50),
        u16(20), // version needed
        u16(FLAG),
        u16(0), // method = STORE
        u16(now.time),
        u16(now.date),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0), // extra
        name,
        data,
      ]);
      locals.push(local);

      centrals.push(
        concat([
          u32(0x02014b50),
          u16(20), // version made by
          u16(20), // version needed
          u16(FLAG),
          u16(0),
          u16(now.time),
          u16(now.date),
          u32(crc),
          u32(data.length),
          u32(data.length),
          u16(name.length),
          u16(0), // extra
          u16(0), // comment
          u16(0), // disk number
          u16(0), // internal attrs
          u32(0), // external attrs
          u32(offset),
          name,
        ]),
      );

      offset += local.length;
    }

    var cd = concat(centrals);
    var eocd = concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(cd.length),
      u32(offset),
      u16(0),
    ]);

    return concat(locals.concat([cd, eocd]));
  }

  /* ---------- XML 工具 ---------- */

  function xml(v) {
    return String(v == null ? "" : v)
      // XML 1.0 不接受的控制字符会让 Word 直接报「文件已损坏」
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    // 单引号不转义：本引擎的属性一律用双引号定界，正文里的 ' 留着更易读
  }

  function blobOf(bytes, type) {
    return new Blob([bytes], { type: type });
  }

  /* ---------- DOCX ---------- */

  /**
   * 这几条是打印成败的关键，不要改：
   *   pgSz    A4 11906×16838 twip —— 不写 Word 按 Letter 出纸，A4 打印会多空白页
   *   pgMar   上下 2.54cm / 左右 3.18cm
   *   rFonts  ascii + hAnsi + eastAsia 三件套 —— 只写 ascii 时 WPS 把中文渲染成西文字形
   *   sz      24 半磅 = 12pt（小四）
   *   spacing line=360 lineRule=auto = 1.5 倍行距 —— 用 exact 会裁掉稍大的字
   */
  var DOC_FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="Times New Roman"/>';

  /**
   * 必须带 styles.xml 的 docDefaults：不带的话 Word 用自身模板兜底（不同机器行距不同，
   * 同名文件在评审电脑和用户电脑上排出来不一样），WPS 还可能套用自己的 Normal。
   * 这里把默认字体/字号/行距/段间距一次定死，正文排版就不再依赖打开它的软件。
   */
  var DOC_STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:docDefaults>" +
    "<w:rPrDefault><w:rPr>" +
    DOC_FONT +
    '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
    '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>' +
    "</w:rPr></w:rPrDefault>" +
    "<w:pPrDefault><w:pPr>" +
    '<w:spacing w:line="360" w:lineRule="auto" w:before="0" w:after="0"/>' +
    "</w:pPr></w:pPrDefault>" +
    "</w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
    '<w:name w:val="Normal"/><w:qFormat/>' +
    "</w:style>" +
    "</w:styles>";

  function runProps(sizeHalfPt, bold) {
    return (
      "<w:rPr>" +
      DOC_FONT +
      (bold ? "<w:b/>" : "") +
      '<w:sz w:val="' + sizeHalfPt + '"/>' +
      '<w:szCs w:val="' + sizeHalfPt + '"/>' +
      "</w:rPr>"
    );
  }

  /** 段落里的换行必须变成 <w:br/>，直接塞 \n 会在 Word 里消失 */
  function runs(text, sizeHalfPt, bold) {
    var parts = String(text == null ? "" : text).split("\n");
    var rPr = runProps(sizeHalfPt, bold);
    var out = "";
    for (var i = 0; i < parts.length; i++) {
      if (i) out += "<w:r>" + rPr + "<w:br/></w:r>";
      if (parts[i] !== "") out += '<w:r>' + rPr + '<w:t xml:space="preserve">' + xml(parts[i]) + "</w:t></w:r>";
    }
    if (!out) out = "<w:r>" + rPr + "<w:t></w:t></w:r>";
    return out;
  }

  function para(text, opt) {
    opt = opt || {};
    var pPr = "<w:pPr>";
    if (opt.align) pPr += '<w:jc w:val="' + opt.align + '"/>';
    pPr += '<w:spacing w:line="360" w:lineRule="auto"' + (opt.before ? ' w:before="' + opt.before + '"' : "") + (opt.after ? ' w:after="' + opt.after + '"' : "") + "/>";
    if (opt.indent) pPr += '<w:ind w:firstLine="480"/>';
    pPr += "</w:pPr>";
    return "<w:p>" + pPr + runs(text, opt.size || 24, !!opt.bold) + "</w:p>";
  }

  function tableXml(head, rows, widths) {
    var cols = Math.max((head || []).length, 1);
    for (var r = 0; r < (rows || []).length; r++) cols = Math.max(cols, (rows[r] || []).length);
    // A4 去掉左右边距（各 1800）剩 8306 twip；给了 widths（百分比）就按比例分，否则平均
    var usable = 8306;
    var colWs = [];
    var sum = 0;
    if (widths && widths.length) for (var w = 0; w < cols; w++) sum += Number(widths[w] || 0);
    for (var k = 0; k < cols; k++) {
      colWs.push(widths && sum ? Math.floor((usable * Number(widths[k] || 0)) / sum) : Math.floor(usable / cols));
    }
    var colW = colWs[0];
    var grid = "";
    for (var c = 0; c < cols; c++) grid += '<w:gridCol w:w="' + colWs[c] + '"/>';

    function cell(text, isHead, idx) {
      var pPr =
        '<w:pPr><w:spacing w:line="240" w:lineRule="auto" w:before="0" w:after="0"/>' +
        (isHead ? '<w:jc w:val="center"/>' : "") +
        "</w:pPr>";
      return (
        "<w:tc><w:tcPr>" +
        '<w:tcW w:w="' + colWs[idx] + '" w:type="dxa"/>' +
        '<w:vAlign w:val="center"/>' +
        "</w:tcPr>" +
        "<w:p>" +
        pPr +
        runs(text, isHead ? 21 : 20, isHead) +
        "</w:p></w:tc>"
      );
    }

    var out =
      "<w:tbl><w:tblPr>" +
      // 100% 宽度：写绝对 twip 会在不同打印机上超页被裁
      '<w:tblW w:type="pct" w:w="5000"/>' +
      '<w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:space="0" w:color="8C8C8C"/>' +
      '<w:left w:val="single" w:sz="4" w:space="0" w:color="8C8C8C"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="8C8C8C"/>' +
      '<w:right w:val="single" w:sz="4" w:space="0" w:color="8C8C8C"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="8C8C8C"/>' +
      '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="8C8C8C"/>' +
      "</w:tblBorders>" +
      '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>' +
      "</w:tblPr><w:tblGrid>" +
      grid +
      "</w:tblGrid>";

    if (head && head.length) {
      // 表头行：tblHeader 让续页自动重复表头，cantSplit 防单行被拆到两页
      out += '<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>';
      for (var h = 0; h < cols; h++) out += cell(head[h] == null ? "" : head[h], true, h);
      out += "</w:tr>";
    }
    for (var i = 0; i < (rows || []).length; i++) {
      out += "<w:tr><w:trPr><w:cantSplit/></w:trPr>";
      for (var j = 0; j < cols; j++) out += cell(rows[i][j] == null ? "" : rows[i][j], false, j);
      out += "</w:tr>";
    }
    return out + "</w:tbl>" + para("", { size: 12 });
  }

  function footerXml(footerText) {
    var rPr = runProps(18, false);
    var field = function (instr, placeholder) {
      return (
        "<w:r>" + rPr + '<w:fldChar w:fldCharType="begin"/></w:r>' +
        "<w:r>" + rPr + '<w:instrText xml:space="preserve"> ' + instr + " </w:instrText></w:r>" +
        "<w:r>" + rPr + '<w:fldChar w:fldCharType="separate"/></w:r>' +
        "<w:r>" + rPr + "<w:t>" + placeholder + "</w:t></w:r>" +
        "<w:r>" + rPr + '<w:fldChar w:fldCharType="end"/></w:r>'
      );
    };
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      (footerText
        ? "<w:p><w:pPr>" +
          '<w:spacing w:line="240" w:lineRule="auto"/>' +
          '<w:jc w:val="center"/>' +
          '<w:pBdr><w:top w:val="single" w:sz="4" w:space="2" w:color="BFBFBF"/></w:pBdr>' +
          "</w:pPr>" +
          runs(footerText, 16, false) +
          "</w:p>"
        : "") +
      "<w:p><w:pPr>" +
      '<w:spacing w:line="240" w:lineRule="auto"/>' +
      '<w:jc w:val="center"/>' +
      "</w:pPr>" +
      "<w:r>" + rPr + '<w:t xml:space="preserve">第 </w:t></w:r>' +
      field("PAGE", "1") +
      "<w:r>" + rPr + '<w:t xml:space="preserve"> 页 共 </w:t></w:r>' +
      field("NUMPAGES", "1") +
      "<w:r>" + rPr + '<w:t xml:space="preserve"> 页</w:t></w:r>' +
      "</w:p></w:ftr>"
    );
  }

  /**
   * @param {{title?:string, blocks:Array, footer?:string}} opt
   * blocks: {type:"h1"|"h2"|"p"|"table", text?, head?:[], rows?:[]}
   * @returns {Blob}
   */
  function toDocx(opt) {
    opt = opt || {};
    var body = "";
    if (opt.title) {
      body += '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:line="360" w:lineRule="auto" w:after="240"/></w:pPr>' + runs(opt.title, 44, true) + "</w:p>";
    }

    var blocks = opt.blocks || [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i] || {};
      if (b.type === "h1") body += para(b.text, { size: 32, bold: true, before: 160, after: 80 });
      else if (b.type === "h2") body += para(b.text, { size: 28, bold: true, before: 120, after: 60 });
      else if (b.type === "table") body += tableXml(b.head, b.rows, b.widths);
      else body += para(b.text, { indent: true, after: 40 });
    }

    var documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<w:body>" +
      body +
      "<w:sectPr>" +
      '<w:footerReference w:type="default" r:id="rId1"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/>' +
      '<w:cols w:space="425"/>' +
      // 不写 docGrid：写了会按 15.6pt 网格吸附行高，表格每行被撑到 31pt，白烧纸
      '<w:docGrid w:linePitch="240" w:type="default"/>' +
      "</w:sectPr>" +
      "</w:body></w:document>";

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>";

    var rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";

    var docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";

    var bytes = zip([
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rels },
      { name: "word/document.xml", data: documentXml },
      { name: "word/_rels/document.xml.rels", data: docRels },
      { name: "word/styles.xml", data: DOC_STYLES },
      { name: "word/footer1.xml", data: footerXml(opt.footer || "") },
    ]);

    return blobOf(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  /* ---------- XLSX ---------- */

  function colName(n) {
    var s = "";
    n = Number(n);
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s || "A";
  }

  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
    '<font><sz val="11"/><name val="宋体"/><charset val="134"/></font>' +
    '<font><b/><sz val="11"/><name val="宋体"/><charset val="134"/></font>' +
    '<font><b/><sz val="14"/><name val="宋体"/><charset val="134"/></font>' +
    "</fonts>" +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF3F8"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="2">' +
    "<border><left/><right/><top/><bottom/><diagonal/></border>" +
    '<border><left style="thin"><color rgb="FF9AA7B4"/></left><right style="thin"><color rgb="FF9AA7B4"/></right><top style="thin"><color rgb="FF9AA7B4"/></top><bottom style="thin"><color rgb="FF9AA7B4"/></bottom><diagonal/></border>' +
    "</borders>" +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  function cellXml(ref, value, style) {
    if (value == null || value === "") return '<c r="' + ref + '" s="' + style + '"/>';
    if (typeof value === "number" && isFinite(value)) return '<c r="' + ref + '" s="' + style + '"><v>' + value + "</v></c>";
    // inlineStr：省掉 sharedStrings 那一套，字符串直接写在单元格里
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xml(value) + "</t></is></c>";
  }

  function sheetXml(sheet) {
    var rows = sheet.rows || [];
    var maxCols = 1;
    for (var i = 0; i < rows.length; i++) maxCols = Math.max(maxCols, (rows[i] || []).length);

    var lastRef = colName(maxCols) + Math.max(rows.length, 1);
    var absRef = "$" + colName(maxCols) + "$" + Math.max(rows.length, 1);
    var out =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      // fitToPage 不写，打印预览会把宽表横向切成两页
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<dimension ref="A1:' + lastRef + '"/>' +
      // pane 只在真的冻结表头时才写；ySplit="0" 是非法值，Excel 会直接报「需要修复」
      "<sheetViews><sheetView workbookViewId=\"0\">" +
      (sheet.headerRows > 0
        ? '<pane ySplit="' + sheet.headerRows + '" topLeftCell="A' + (sheet.headerRows + 1) + '" activePane="bottomLeft" state="frozen"/>'
        : "") +
      "</sheetView></sheetViews>" +
      '<sheetFormatPr defaultColWidth="16" defaultRowHeight="20"/>' +
      // 空的 <cols> 是非法 schema（必须至少一个 col），没有列宽就整段不写
      ((sheet.cols || []).length
        ? "<cols>" +
          sheet.cols.map(function (w, idx) {
            return '<col min="' + (idx + 1) + '" max="' + (idx + 1) + '" width="' + w + '" customWidth="1"/>';
          }).join("") +
          "</cols>"
        : "") +
      "<sheetData>";

    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r] || [];
      out += '<row r="' + (r + 1) + '"' + (r === 0 && sheet.title ? ' ht="26" customHeight="1"' : "") + ">";
      for (var c = 0; c < maxCols; c++) {
        var style = sheet.styles && sheet.styles[r] != null ? sheet.styles[r] : r === 0 ? 1 : 2;
        out += cellXml(colName(c + 1) + (r + 1), cells[c] == null ? "" : cells[c], style);
      }
      out += "</row>";
    }

    out +=
      "</sheetData>" +
      // paperSize 9 = A4；fitToWidth 1 让宽表压进一页
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' +
      "</worksheet>";
    return { xml: out, lastRef: lastRef, absRef: absRef, sheetName: sheet.name || "Sheet1" };
  }

  /**
   * @param {{sheets:Array<{name:string, rows:Array<Array>, cols?:number[], headerRows?:number}>}} opt
   * @returns {Blob}
   */
  function toXlsx(opt) {
    opt = opt || {};
    var sheets = (opt.sheets || []).filter(Boolean);
    if (!sheets.length) sheets = [{ name: "Sheet1", rows: [] }];

    var parts = [];
    var contentTypeOverrides = [];
    var workbookSheets = [];
    var workbookRels = [];
    var definedNames = [];

    for (var i = 0; i < sheets.length; i++) {
      var built = sheetXml(sheets[i]);
      var n = i + 1;
      parts.push({ name: "xl/worksheets/sheet" + n + ".xml", data: built.xml });
      contentTypeOverrides.push(
        '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      );
      // sheet 名里的 & < > 必须转义，且 Excel 限制 31 字符、不许出现 : \ / ? * [ ]
      var safeName = String(built.sheetName).replace(/[:\\\/\?\*\[\]]/g, " ").slice(0, 31);
      workbookSheets.push('<sheet name="' + xml(safeName) + '" sheetId="' + n + '" r:id="rId' + n + '"/>');
      workbookRels.push(
        '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>',
      );
      // localSheetId 必须等于工作表序号，否则打印区域不生效
      definedNames.push(
        '<definedName name="_xlnm.Print_Area" localSheetId="' + i + '">' +
          xml("'" + safeName + "'!$A$1:" + built.absRef) +
          "</definedName>",
      );
    }

    var stylesRelId = sheets.length + 1;
    workbookRels.push(
      '<Relationship Id="rId' + stylesRelId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    );

    var workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<sheets>" + workbookSheets.join("") + "</sheets>" +
      "<definedNames>" + definedNames.join("") + "</definedNames>" +
      "</workbook>";

    var workbookRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      workbookRels.join("") +
      "</Relationships>";

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      contentTypeOverrides.join("") +
      "</Types>";

    var rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>";

    var files = [
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rels },
      { name: "xl/workbook.xml", data: workbookXml },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml },
      { name: "xl/styles.xml", data: STYLES_XML },
    ].concat(parts);

    return blobOf(zip(files), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  /* ---------- CSV ---------- */

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** @param {Array<Array>} rows @returns {Blob} */
  function toCsv(rows) {
    var text = (rows || []).map(function (r) { return (r || []).map(csvCell).join(","); }).join("\r\n");
    // BOM：不加的话 Excel 双击打开中文全是乱码
    return blobOf(utf8("\ufeff" + text), "text/csv;charset=utf-8");
  }

  /* ---------- 下载 ---------- */

  /** 触发浏览器下载；返回 false 表示环境不支持（微信 / iOS Safari） */
  function download(blob, filename) {
    if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return false;
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      a.remove();
    }, 4000);
    return true;
  }

  return {
    crc32: crc32,
    zip: zip,
    toDocx: toDocx,
    toXlsx: toXlsx,
    toCsv: toCsv,
    download: download,
    // 测试与调试用
    _utf8: utf8,
    _utf8Decode: utf8Decode,
  };
});
