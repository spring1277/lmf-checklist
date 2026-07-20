# -*- coding: utf-8 -*-
"""LMF 심사점검표 PDF -> 문항 구조 추출 (좌표 기반).

레이아웃 규칙 (2025·2026 공통):
  x0 <  128 : 좌측 라벨(문항/설명 @86), 섹션 안내문(@72), 소/대분류 제목(@65, size>=11)
  x0 >= 128 : 문항 본문 (question 129~, guidance 불릿 130 / 텍스트 140~)
  question 밴드에 한해 우측 x0>=355 는 배점/예/아니오/해당없음 칼럼
  Wingdings 불릿()이 guidance 시작점
"""
import json, re, sys
from pathlib import Path
import pdfplumber

ROOT = Path(r"C:\Users\ajlee\apps\lmf-checklist")
FIELDS = ["검사실운영", "종합검증", "현장검사", "수탁검사", "진단혈액", "임상화학",
          "요경검학", "임상미생물", "수혈의학", "진단면역", "유세포검사",
          "조직적합성검사", "세포유전검사", "분자진단검사"]

BADGE_CODE = re.compile(r"(핵심|필요|기본)([CRB])\s+((?:\d\d)\.\d{3}\.\d{3})")
BODY_X = 128.0
RIGHT_X = 355.0
RIGHT_LABELS = {"예", "아니오", "배점", "해당", "없음", "해당없음", "(필수)", "필수"}
PTS = re.compile(r"^\((\d+)\)$")


def is_bullet(w):
    return "Wingdings" in w.get("fontname", "") or w["text"] == ""


PROSE_X = 80.0     # 이보다 왼쪽에서 시작하는 행 = 섹션 안내문(@72)·소대분류 제목(@65)
FOOTER_TOP = 795.0  # 페이지 번호
HEADER_TOP = 100.0  # 페이지 머리말(분야명)


def vrules(page):
    """세로 괘선: (x, top, bottom). 문항 표의 칸 경계 = 정확한 칼럼 분리자."""
    out = []
    for e in page.edges:
        if e["orientation"] == "v":
            out.append((e["x0"], min(e["top"], e["bottom"]), max(e["top"], e["bottom"])))
    return out


def in_table(rules, y):
    """해당 y가 '문항 표' 안인가 = 라벨칸(문항/설명)과 본문칸을 가르는
    x≈129 괘선이 그 높이를 지나는가.
    섹션 안내문도 테두리 박스(x=65)를 갖기 때문에 바깥 테두리로는 구분되지
    않는다. 라벨칸 괘선은 문항 표에만 있다."""
    return any(115 < x < 140 and t - 2 <= y <= b + 2 for x, t, b in rules)


def right_rule(rules, y):
    """해당 y에서 문항칸과 배점칸을 가르는 괘선 x."""
    xs = [x for x, t, b in rules if 200 < x < 500 and t - 2 <= y <= b + 2]
    return min(xs) if xs else None


def page_rows(page, field=None):
    """문항 본문 행만 반환. 행 전체를 '가장 왼쪽 단어'로 분류해야
    안내문의 꼬리(x0>128로 넘어오는 부분)까지 함께 걸러진다."""
    words = [w for w in page.extract_words(extra_attrs=["size", "fontname"])
             if w["top"] < FOOTER_TOP]
    words.sort(key=lambda w: (w["top"], w["x0"]))
    rows = []
    for w in words:
        if rows and abs(w["top"] - rows[-1]["top"]) <= 5:
            rows[-1]["words"].append(w)
        else:
            rows.append({"top": w["top"], "words": [w]})

    rules = vrules(page)
    out = []
    for r in rows:
        r["words"].sort(key=lambda w: w["x0"])
        # 표 밖의 행(섹션 안내문·소대분류 제목·머리말) 통째로 제외
        if not in_table(rules, r["top"]):
            continue
        if r["words"][0]["x0"] < PROSE_X:
            continue
        body = [w for w in r["words"] if w["x0"] >= BODY_X]
        if body:
            out.append({"top": r["top"], "words": body,
                        "right": right_rule(rules, r["top"])})
    return out


COL_MARKERS = {"배점", "아니오", "해당없음"}


def detect_right_x(rows):
    """문항칸/배점칸 경계. 괘선이 최우선, 없으면 칼럼 머리글로 추정."""
    rx = [r["right"] for r in rows if r.get("right")]
    if rx:
        return min(rx)
    xs = [w["x0"] for r in rows for w in r["words"] if w["text"] in COL_MARKERS]
    return (min(xs) - 3.0) if xs else RIGHT_X


def row_text(words, right_x=None):
    """right_x가 주어지면 그 오른쪽(배점 칼럼)은 라벨이든 아니든 전부 제거."""
    out = []
    for w in words:
        if right_x is not None and w["x0"] >= right_x:
            continue
        if is_bullet(w):
            continue
        out.append(w["text"])
    return " ".join(out)


def join_wrapped(parts):
    """PDF 줄바꿈은 단어 중간에서도 일어나고 공백을 남기지 않는다.
    → 행끼리는 공백 없이 이어붙이고, 영문 하이픈 분철은 하이픈을 제거."""
    out = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if out.endswith("-"):
            out = out[:-1] + p
        else:
            out += p
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def extract_field(year, field):
    pdf_path = ROOT / "data" / "checklists" / str(year) / f"{field}.pdf"
    flat = []  # (page, row)
    with pdfplumber.open(pdf_path) as pdf:
        for pno, pg in enumerate(pdf.pages, 1):
            for r in page_rows(pg, field):
                flat.append((pno, r))

    # 문항 시작 행 찾기
    starts = []
    for i, (pno, r) in enumerate(flat):
        txt = " ".join(w["text"] for w in r["words"])
        m = BADGE_CODE.search(txt)
        if m:
            starts.append((i, m.group(2), m.group(3), pno))

    items = []
    for k, (i, typ, code, pno) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(flat)
        rows = [flat[j][1] for j in range(i, end)]
        # guidance 시작 = 첫 불릿 행
        gi = None
        for ri, r in enumerate(rows):
            if any(is_bullet(w) for w in r["words"]):
                gi = ri
                break
        if gi is None:
            gi = len(rows)

        right_x = detect_right_x(rows[:gi] or rows)

        # 배점 / 해당없음
        points, has_na = None, False
        for r in rows[:gi]:
            for w in r["words"]:
                if w["x0"] >= right_x:
                    m = PTS.match(w["text"])
                    if m:
                        points = int(m.group(1))
                    if w["text"] in ("해당", "해당없음"):
                        has_na = True

        qparts = []
        for ri, r in enumerate(rows[:gi]):
            t = row_text(r["words"], right_x=right_x)
            if ri == 0:
                t = BADGE_CODE.sub("", t, count=1).strip()
            if t.strip():
                qparts.append(t.strip())

        # guidance: 불릿으로 시작하는 행이 새 줄, 나머지는 앞줄에 이어붙임
        gparts = []
        for r in rows[gi:]:
            t = row_text(r["words"]).strip()
            if not t:
                continue
            if any(is_bullet(w) for w in r["words"]) or not gparts:
                gparts.append([t])
            else:
                gparts[-1].append(t)

        q = join_wrapped(qparts)
        g = "\n".join(join_wrapped(x) for x in gparts).strip()
        # 문항 칸 안에 체크리스트 표가 들어간 경우 표는 guidance 쪽으로
        m = re.search(r"(평가\(점검\)항목|평가항목)", q)
        if m:
            tail = q[m.start():].strip()
            q = q[:m.start()].strip()
            g = (tail + ("\n" + g if g else "")).strip()

        items.append({
            "code": code, "type": typ,
            "question": q, "guidance": g,
            "points": points, "hasNA": has_na, "page": pno,
        })

    # 코드 중복 제거 (첫 등장 유지)
    seen, uniq = set(), []
    for it in items:
        if it["code"] in seen:
            continue
        seen.add(it["code"]); uniq.append(it)
    return uniq


if __name__ == "__main__":
    year = int(sys.argv[1]); out = Path(sys.argv[2])
    res = {}
    for f in FIELDS:
        res[f] = extract_field(year, f)
        print(f"{f:8s} {len(res[f]):4d}")
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print("TOTAL", sum(len(v) for v in res.values()))
