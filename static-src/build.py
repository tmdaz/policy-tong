#!/usr/bin/env python3
"""政策通静态站点生成器：src/data/policies/*.json -> 站点产物。

用法：python3 static-src/build.py [--repo .]
产物：assets/data.js、policies.html、index.html（统计/热门）、policy-<id>.html

说明：本文件由 DSH skill `policy-tong` 提供，部署时放在 <repo>/static-src/build.py。
纯标准库，任何平台可直接运行；不含业务判断，只做确定性渲染。
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

LEVEL_CN = {"national": "国家级", "provincial": "省级", "city": "市级"}
STATUS_CN = {"active": "有效", "expiring": "即将到期", "expired": "已失效"}

HEAD = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<meta name="description" content="{desc}" />
<meta name="theme-color" content="#123c69" />
<link rel="stylesheet" href="assets/style.css" />

</head>
<body data-page="{page}">
"""

SITE_HEADER = """<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="index.html">
      <span class="mark">湘</span>
      <span>
        <span class="name" style="display:block">政策通 · 湖南</span>
        <span class="tagline">小微企业政策助手</span>
      </span>
    </a>
    <nav class="nav">{nav}</nav>
    <div class="header-cta">
      <span class="hint">参赛演示版</span>
      <a class="btn btn-primary" href="chat.html">问一个政策问题</a>
    </div>
  </div>
</header>
"""

NAV_ITEMS = [("index.html", "首页"), ("policies.html", "政策库"),
             ("chat.html", "智能问答"), ("plan.html", "路径规划")]
BOTTOM_LABELS = {"index.html": "首页", "policies.html": "政策库",
                 "chat.html": "问答", "plan.html": "规划"}

BOTTOM_NAV = """<nav class="bottom-nav">{items}</nav>
"""

BOTTOM_ICONS = {
    "index.html": '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-6h5v6"/></svg>',
    "policies.html": '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    "chat.html": '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a7 7 0 0 1-7 7H8l-4 3V12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z"/><path d="M9 12h6"/></svg>',
    "plan.html": '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8.2 6H14a3 3 0 0 1 3 3v6.2"/><path d="M8 8v6a3 3 0 0 0 3 3h4.8"/></svg>',
}

FOOTER = """<footer class="site-foot">
  <span>政策通 · 湖南小微创业者政策助手</span>
  <span class="dot">·</span>
  <a href="dev.html">开发者模式</a>
  <span class="dot">·</span>
  <a href="README.md">项目说明</a>
</footer>
"""

SCRIPTS = """<script src="assets/splitter.js"></script>
<script src="assets/data.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
"""

CARD = """<a class="policy-card" href="policy-{id}.html">
  <div class="top">
    <span class="badge">{level}</span>
    <span class="status {status}"><i></i>{status_cn}</span>
    {sample}<span class="chip-flag">原文待核对</span>
    <span class="region">{region}</span>
  </div>
  <h3>{title}</h3>
  <p class="summary">{summary}</p>
  <div class="tags">{tags}</div>
  <div class="meta">
    <span>{issuer}</span>
    {doc_no}
    <span>发布 {published}</span>
    {expires}
  </div>
</a>"""

INTERP = """<section class="interp">
    <div class="top">
      <span class="sec">{sec_label}</span>
      <span class="tiny muted">{sec_title}</span>
      <button type="button" class="jump" data-jump="{no}">看原文 →</button>
    </div>
    <h2>{headline}</h2>
    <div class="block">
      <p class="label">谁能享受</p>
      <p>{who}</p>
    </div>
    <div class="block">
      <p class="label">要准备什么</p>
      <ul>{materials}</ul>
    </div>
    <div class="two-col" style="margin-top:1rem">
      <div class="block" style="margin-top:0">
        <p class="label">什么时候办</p>
        <p>{window}</p>
      </div>
      <div class="block" style="margin-top:0">
        <p class="label">去哪儿办</p>
        <p>{where}</p>
      </div>
    </div>
    <div class="tip"><p class="label">容易踩的坑</p><p>{tip}</p></div>
  </section>"""

CLAUSE = """<section class="clause" id="sec-{no}">
    <div><span class="no">{sec_label}</span><span class="name">{title}</span></div>
    <p>{text}</p>
  </section>"""

CN_DIGITS = "零一二三四五六七八九"


def cn_number(n: int) -> str:
    if n <= 0:
        return str(n)
    if n < 10:
        return CN_DIGITS[n]
    if n < 20:
        return "十" + (CN_DIGITS[n % 10] if n % 10 else "")
    if n < 100:
        tens, ones = divmod(n, 10)
        return CN_DIGITS[tens] + "十" + (CN_DIGITS[ones] if ones else "")
    hundreds, rest = divmod(n, 100)
    out = CN_DIGITS[hundreds] + "百"
    if rest == 0:
        return out
    return out + ("零" + CN_DIGITS[rest] if rest < 10 else cn_number(rest))


def sec_label(no: str) -> str:
    no = str(no)
    return "第" + (cn_number(int(no)) if no.isdigit() else no) + "条"


def esc(value) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def nav_html(active: str) -> str:
    parts = []
    for href, text in NAV_ITEMS:
        current = ' aria-current="page"' if href == active else ""
        parts.append(f'<a href="{href}"{current}>{text}</a>')
    return "".join(parts)


def bottom_nav(active: str) -> str:
    parts = []
    for href, _ in NAV_ITEMS:
        current = ' aria-current="page"' if href == active else ""
        parts.append(f'<a href="{href}"{current}>{BOTTOM_ICONS[href]}{BOTTOM_LABELS[href]}</a>')
    return BOTTOM_NAV.format(items="".join(parts))


def method_sorted(policies: list[dict]) -> list[dict]:
    """热门的排前面（hot 降序），其余按 id 升序 —— 与既有站点顺序一致。"""
    hot = [p for p in policies if p.get("hot")]
    rest = [p for p in policies if not p.get("hot")]
    hot.sort(key=lambda p: -int(p["hot"]))
    rest.sort(key=lambda p: p["id"])
    return hot + rest


def tags_html(tags) -> str:
    return "".join(f'<span class="tag">{esc(t)}</span>' for t in tags or [])


def card_html(p: dict) -> str:
    sample = '<span class="chip-flag sample">示例数据</span>' if p.get("isSample") else ""
    return CARD.format(
        id=esc(p["id"]),
        level=LEVEL_CN.get(p.get("level", ""), esc(p.get("level", ""))),
        status=esc(p.get("status", "active")),
        status_cn=STATUS_CN.get(p.get("status", ""), esc(p.get("status", ""))),
        sample=sample,
        region=esc(p.get("region", "")),
        title=esc(p.get("title", "")),
        summary=esc(p.get("summary", "")),
        tags=tags_html(p.get("tags")),
        issuer=esc(p.get("issuer", "")),
        doc_no=(f'<span>{esc(p["documentNo"])}</span>' if p.get("documentNo") else ""),
        published=esc(p.get("publishedAt", "")),
        expires=(f'<span>截止 {esc(p["expiresAt"])}</span>' if p.get("expiresAt") else ""),
    )


def head(title: str, desc: str, page: str) -> str:
    return HEAD.format(title=esc(title), desc=esc(desc), page=page)


def render_data_js(policies: list[dict]) -> str:
    body = json.dumps(policies, ensure_ascii=False, separators=(",", ":"))
    return ("/* 由 static-src/build.py 生成，请勿手改；改数据请编辑 src/data/policies/*.json */\n"
            f"window.POLICIES = {body};\n")


def render_policies_page(policies: list[dict], tags: list[str], hunan_count: int) -> str:
    pills = "".join(
        f'<button type="button" class="pill" data-tag="{esc(t)}" aria-pressed="false">{esc(t)}</button>'
        for t in tags)
    cards = "\n".join(card_html(p) for p in policies)
    total = len(policies)
    return (
        head("政策库 · 政策通（湖南）", "按地区、层级、主题筛选湖南与全国的小微企业扶持政策。", "policies")
        + SITE_HEADER.format(nav=nav_html("policies.html"))
        + """<main class="wrap">
<header>
  <p class="kicker plain">POLICIES</p>
  <h1 class="h2" style="font-size:32px;margin-top:.5rem">政策库</h1>
  <p class="lead" style="max-width:42em">
    先按地区收窄：湖南本地的产业专项、创业补贴、专精特新，与全国层面的税收减免分开看。
    也可以直接搜条款正文——「补贴」「增值税」「研发费用」都能命中。
  </p>
</header>

<div class="filters" style="margin-top:1.5rem">
  <div class="search">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6" stroke-linecap="round"/></svg>
    <input id="q" type="search" placeholder="搜索政策主题、发文机关或条款内容" aria-label="搜索政策" />
  </div>
  <div class="filter-row"><span class="label">地区</span><button type="button" class="pill" data-region="all" aria-pressed="true">全部</button><button type="button" class="pill" data-region="hunan" aria-pressed="false">湖南（{hunan}）</button><button type="button" class="pill" data-region="national" aria-pressed="false">全国</button></div>
  <div class="filter-row"><span class="label">层级</span><button type="button" class="pill" data-level="all" aria-pressed="true">全部</button><button type="button" class="pill" data-level="national" aria-pressed="false">国家级</button><button type="button" class="pill" data-level="provincial" aria-pressed="false">省级</button><button type="button" class="pill" data-level="city" aria-pressed="false">市级</button></div>
  <div class="filter-row"><span class="label">主题</span><button type="button" class="pill" data-tag="" aria-pressed="true">全部</button>{pills}</div>
  <div class="filter-foot">
    <label><input id="activeOnly" type="checkbox" checked /> 只看仍可申报的</label>
    <p style="margin:0">找到 <span id="count">{total}</span> 条 / 共 {total} 条</p>
  </div>
</div>

<div id="empty" class="empty" hidden style="margin-top:1.5rem">
  <h3 id="empty-title">没有匹配的政策</h3>
  <p id="empty-hint">试试更短的关键词，或清空筛选条件。也可以直接去问答页用一句话描述你的情况。</p>
  <div style="display:flex;gap:.5rem;justify-content:center;margin-top:1.25rem">
    <button type="button" class="btn btn-ghost" id="reset">重置筛选</button>
    <a class="btn btn-primary" href="chat.html">去问 AI</a>
    <a class="btn btn-ghost" href="dev.html">导入湖南政策</a>
  </div>
</div>

<div id="results" class="grid-2" style="margin-top:1.5rem">{cards}</div>

<p class="tiny muted" style="margin-top:1rem">
  地区口径：湖南 = 湖南省本级及 14 个市州；其余按全国口径。
  条款级检索支持正文匹配，搜「300万」「10万」这类数字也能命中。
</p>
</main>
""".format(hunan=hunan_count, pills=pills, total=total, cards=cards)
        + bottom_nav("policies.html")
        + FOOTER
        + SCRIPTS
    )


def render_policy_page(p: dict) -> str:
    sections = p.get("sections") or []
    interps = p.get("interpretations") or []
    chat_q = f"《{p.get('title','')}》我能不能享受？需要什么材料？"
    from urllib.parse import quote
    chat_href = "chat.html?q=" + quote(chat_q, safe="")

    if p.get("isSample"):
        sample_alert = ('<div class="alert-sample"><b>示例数据：</b>本条为演示用的虚构条目，'
                        '文号、金额与期限均非真实政策，请勿据此申领。</div>\n')
    else:
        sample_alert = "\n"

    if p.get("expiresAt"):
        fourth = f'<div><dt>申报 / 有效期至</dt><dd>{esc(p["expiresAt"])}</dd></div>'
    else:
        fourth = f'<div><dt>状态</dt><dd>{STATUS_CN.get(p.get("status",""), "")}</dd></div>'

    if interps:
        tabs = (f'  <button type="button" class="tab" role="tab" data-tab="interpretation" aria-selected="true">'
                f'解读（{len(interps)}）</button>\n'
                f'  <button type="button" class="tab" role="tab" data-tab="original" aria-selected="false">'
                f'原文（{len(sections)} 条）</button>')
    else:
        tabs = (f'  \n  <button type="button" class="tab" role="tab" data-tab="original" aria-selected="true">'
                f'原文（{len(sections)} 条）</button>')

    by_no = {s["no"]: s for s in sections}
    interp_blocks = []
    for it in interps:
        sec = by_no.get(it["sectionNo"], {})
        materials = "".join(f"<li>{esc(m)}</li>" for m in it.get("materials") or [])
        interp_blocks.append(INTERP.format(
            sec_label=sec_label(it["sectionNo"]),
            sec_title=esc(sec.get("title", "")),
            no=esc(it["sectionNo"]),
            headline=esc(it.get("headline", "")),
            who=esc(it.get("who", "")),
            materials=materials,
            window=esc(it.get("window", "")),
            where=esc(it.get("where", "")),
            tip=esc(it.get("tip", "")),
        ))
    clause_blocks = []
    for sec in sections:
        text = esc(sec.get("text", "")).replace("\n", "\n")
        clause_blocks.append(CLAUSE.format(
            no=esc(sec["no"]), sec_label=sec_label(sec["no"]),
            title=esc(sec.get("title", "")), text=text))

    if interps:
        panels = ('    <div id="panel-interp">' + "\n".join(interp_blocks) + "</div>\n"
                  + '    <div id="panel-original" hidden>' + "\n".join(clause_blocks) + "</div>")
    else:
        panels = ("    \n"
                  + '    <div id="panel-original">' + "\n".join(clause_blocks) + "</div>")

    audience = "".join(f"<li>· {esc(a)}</li>" for a in p.get("audience") or [])
    clause_list = "".join(
        f'<li><button type="button" data-jump="{esc(s["no"])}">{sec_label(s["no"])} · {esc(s.get("title",""))}</button></li>'
        for s in sections)

    side = f"""  <aside class="side">
    <div class="side-card soft">
      <p>适用对象</p>
      <ul>{audience}</ul>
    </div>
    <div class="side-card">
      <p>这条政策的条款</p>
      <ol>{clause_list}</ol>
    </div>
    <p class="tiny muted" style="margin:0">解读由政策原文改写而来，不替代主管部门解释。办理前请以官方发布和窗口答复为准。</p>
  </aside>"""

    body = f"""<main class="wrap">
<div class="back-row">
  <a href="policies.html">← 返回政策库</a>
  <a class="btn btn-ghost" style="font-size:12px;padding:.375rem .75rem" href="{chat_href}">就这条政策提问 →</a>
</div>

{sample_alert}
<header class="detail-head">
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem">
    <span class="badge">{LEVEL_CN.get(p.get("level",""), esc(p.get("level","")))}</span>
    <span class="status {esc(p.get("status","active"))}"><i></i>{STATUS_CN.get(p.get("status",""), "")}</span>
    <span class="tag">{esc(p.get("region",""))}</span>
    <span class="chip-flag">原文待核对</span>
  </div>
  <h1>{esc(p.get("title",""))}</h1>
  <p class="summary">{esc(p.get("summary",""))}</p>
  <dl class="meta-grid">
    <div><dt>发文机关</dt><dd>{esc(p.get("issuer",""))}</dd></div>
    <div><dt>文号</dt><dd>{esc(p.get("documentNo", "") or "—")}</dd></div>
    <div><dt>发布日期</dt><dd>{esc(p.get("publishedAt",""))}</dd></div>
    {fourth}
  </dl>
  <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem">{tags_html(p.get("tags"))}</div>
  <div class="source-row">
    <a href="{esc(p.get("sourceUrl",""))}" target="_blank" rel="noopener noreferrer">前往官方来源 ↗</a>
    <span>{esc(p.get("sourceNote",""))}</span>
  </div>
</header>

<div class="tabs" role="tablist">
{tabs}
</div>

<div class="detail-body">
  <div>
{panels}
  </div>
{side}
</div>
</main>
"""
    return (head(p.get("title", "") + " · 政策通（湖南）", p.get("summary", ""), "policy")
            + SITE_HEADER.format(nav=nav_html("")) + body
            + bottom_nav("") + FOOTER + SCRIPTS)


def render_index(policies: list[dict], source_scaffold: str) -> str:
    total = len(policies)
    clauses = sum(len(p.get("sections") or []) for p in policies)
    hunan = sum(1 for p in policies if p.get("hunan"))
    hot = [p for p in policies if p.get("hot")][:3]
    cards = "\n".join(card_html(p) for p in hot)
    page = head("政策通 · 湖南小微企业政策助手",
                "面向湖南小微创业者的政策解读与路径规划：条款级解读、问答带原文引用、官方入口直达，支持 PDF/DOC 政策文件导入。",
                "home")
    page += SITE_HEADER.format(nav=nav_html("index.html"))
    page += source_scaffold.format(
        total=total, clauses=clauses, hunan=hunan,
        cards=cards, hot_count=len(hot),
    )
    page += "\n" + bottom_nav("index.html") + FOOTER + "\n</body>\n</html>\n"
    return page


def load_policies(repo: Path) -> list[dict]:
    folder = repo / "src" / "data" / "policies"
    if not folder.is_dir():
        raise SystemExit(f"缺少数据目录：{folder}")
    out = []
    for path in sorted(folder.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not data.get("id"):
            raise SystemExit(f"{path.name} 缺少 id")
        out.append(data)
    return method_sorted(out)


def collect_tags(policies: list[dict]) -> list[str]:
    seen, out = set(), []
    for p in policies:
        for t in p.get("tags") or []:
            if t not in seen:
                seen.add(t)
                out.append(t)
    return out


def build(repo: Path) -> dict:
    policies = load_policies(repo)
    tags = collect_tags(policies)
    hunan = sum(1 for p in policies if p.get("hunan"))

    (repo / "assets" / "data.js").write_text(render_data_js(policies), encoding="utf-8")
    (repo / "policies.html").write_text(render_policies_page(policies, tags, hunan), encoding="utf-8")
    for p in policies:
        (repo / f"policy-{p['id']}.html").write_text(render_policy_page(p), encoding="utf-8")
    scaffold = (SPEC_DIR / "index_scaffold.html").read_text(encoding="utf-8")
    (repo / "index.html").write_text(render_index(policies, scaffold), encoding="utf-8")

    # 清理已下线的政策页
    keep = {f"policy-{p['id']}.html" for p in policies}
    removed = []
    for path in repo.glob("policy-*.html"):
        if path.name not in keep:
            path.unlink()
            removed.append(path.name)
    return {"policies": len(policies), "clauses": sum(len(p.get("sections") or []) for p in policies),
            "hunan": hunan, "removed": removed}


SPEC_DIR = Path(__file__).resolve().parent


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="政策通静态站点生成器")
    parser.add_argument("--repo", default=".", help="仓库根目录（默认当前目录）")
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    stats = build(repo)
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
