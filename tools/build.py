# -*- coding: utf-8 -*-
"""2026 JSON 교정 + 2025 JSON 생성.

- 내용(question/guidance/points/type)은 PDF 추출본이 정답
- 띄어쓰기는 기존 2026 JSON에서 이식 (PDF 줄바꿈엔 공백 정보가 없음)
- 구조(대/소분류)는 기존 2026 JSON 유지, 2025는 그 구조를 물려받음
- code=null 문항(수혈의학 현황조사)·커스텀 별첨(XX.A01.xxx)은 2026에서 그대로 보존
"""
import json, re, shutil, unicodedata
from pathlib import Path
from spacing import transfer, transfer_multiline


def nz(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or ""))

ROOT = Path(r"C:\Users\ajlee\apps\lmf-checklist")
JD = ROOT / "app" / "data" / "checklists"
EX26 = json.loads(Path("ex2026.json").read_text(encoding="utf-8"))
EX25 = json.loads(Path("ex2025.json").read_text(encoding="utf-8"))
FIELDS = list(EX26.keys())

report = {"fixed26": 0, "meta26": 0, "new25": 0,
          "only25": [], "dropped26": [], "review": []}


def apply(item, ext, *oracles):
    """추출본 내용 + oracle들의 띄어쓰기 합집합."""
    qs = [o.get("question") or "" for o in oracles if o]
    gs = [o.get("guidance") or "" for o in oracles if o]
    item["question"] = transfer(ext["question"], *qs)
    item["guidance"] = transfer_multiline(ext["guidance"], *gs)
    item["type"] = ext["type"]
    item["points"] = ext["points"]
    item["page"] = ext["page"]
    return item


for field in FIELDS:
    path = JD / f"2026_{field}.json"
    j26 = json.loads(path.read_text(encoding="utf-8"))
    e26 = {x["code"]: x for x in EX26[field]}
    e25 = {x["code"]: x for x in EX25[field]}

    # ---------- 2026 교정 ----------
    # 기존본은 사람이 읽기 좋게 다듬어져 있으므로 전면 교체하지 않는다.
    # '명백히 깨진 것'만 고치고, 나머지 문구 차이는 report에 남겨 검토받는다.
    for s in j26["sections"]:
        for ss in s.get("subsections", []):
            for it in ss.get("items", []):
                c = it.get("code")
                if not c or c not in e26:
                    continue  # code=null 현황조사, A01 커스텀 별첨은 손대지 않음
                ext = e26[c]
                oq, nq = nz(it.get("question")), nz(ext["question"])
                og, ng = nz(it.get("guidance")), nz(ext["guidance"])
                # 오염 = 기존 question이 올바른 question을 통째로 포함하면서 훨씬 길다
                # 문항에 불릿()이 들어갔다면 설명/다음 섹션이 새어든 것 — 확정 오염
                contaminated = "" in (it.get("question") or "") or (
                    bool(nq) and len(oq) > len(nq) * 1.15 and (
                        nq in oq or oq.startswith(nq[:max(12, len(nq) // 2)])))
                if contaminated:
                    apply(it, ext, dict(it), e25.get(c))
                    report["fixed26"] += 1
                else:
                    if it.get("points") != ext["points"] or it.get("type") != ext["type"]:
                        it["points"], it["type"] = ext["points"], ext["type"]
                        report["meta26"] += 1
                    if oq != nq or og != ng:
                        report["review"].append({
                            "field": field, "code": c,
                            "q_old": it.get("question"), "q_new": ext["question"],
                            "g_old": it.get("guidance"), "g_new": ext["guidance"],
                        })
    if not path.with_suffix(".json.orig").exists():
        shutil.copy(path, path.with_suffix(".json.orig"))
    path.write_text(json.dumps(j26, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # ---------- 2025 생성 ----------
    fixed26 = {}
    for s in j26["sections"]:
        for ss in s.get("subsections", []):
            for it in ss.get("items", []):
                if it.get("code"):
                    fixed26[it["code"]] = it

    j25 = {"field": field, "year": 2025,
           "source": f"data/pdf/2025/{field}.pdf", "sections": []}
    placed = set()
    for s in j26["sections"]:
        ns = {"no": s.get("no"), "title": s.get("title"), "subsections": []}
        for ss in s.get("subsections", []):
            items = []
            for it in ss.get("items", []):
                c = it.get("code")
                if c is None:
                    items.append(json.loads(json.dumps(it)))  # 현황조사 문항 승계
                    continue
                if c.split(".")[1].startswith("A"):
                    continue  # 커스텀 별첨은 2026 전용
                if c not in e25:
                    report["dropped26"].append(f"{field}/{c}")
                    continue
                ni = json.loads(json.dumps(it))
                apply(ni, e25[c], fixed26.get(c), e26.get(c))
                items.append(ni)
                placed.add(c)
            if items:
                ns["subsections"].append({"no": ss.get("no"), "title": ss.get("title"),
                                          "items": items})
        if ns["subsections"]:
            j25["sections"].append(ns)

    # 2025 전용 문항: 코드가 가장 가까운 소분류에 코드순 삽입
    for c in sorted(set(e25) - placed):
        report["only25"].append(f"{field}/{c}")
        best, bd = None, None
        for s in j25["sections"]:
            for ss in s["subsections"]:
                for it in ss["items"]:
                    if not it.get("code"):
                        continue
                    d = abs(int(it["code"].replace(".", "")) - int(c.replace(".", "")))
                    if bd is None or d < bd:
                        bd, best = d, ss
        if best is None:
            continue
        ni = apply({"code": c}, e25[c])
        ni["code"] = c
        best["items"].append(ni)
        best["items"].sort(key=lambda x: x.get("code") or "")

    n = sum(len(ss["items"]) for s in j25["sections"] for ss in s["subsections"])
    report["new25"] += n
    (JD / f"2025_{field}.json").write_text(
        json.dumps(j25, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{field:8s} 2026교정={report['fixed26']:4d}(누적) 2025문항={n:4d}")

Path("review26.json").write_text(
    json.dumps(report["review"], ensure_ascii=False, indent=1), encoding="utf-8")
print("\n2026 오염 교정:", report["fixed26"], "| 배점/유형 교정:", report["meta26"])
print("2026 문구차이(미적용, 검토대상):", len(report["review"]), "-> review26.json")
print("2025 총 문항:", report["new25"])
print("2025 전용(2026에 없음):", report["only25"])
print("2026 전용(2025에서 제외):", report["dropped26"])
