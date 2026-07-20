# -*- coding: utf-8 -*-
"""띄어쓰기 이식: 내용은 new(PDF 정확), 공백 위치는 old(사람이 읽기 좋은 기존본)에서.

new/old의 공백 제거 문자열을 정렬해 old의 공백을 new에 되붙인다.
정렬되지 않는 구간(new에만 있는 내용)은 공백 없이 둔다 — PDF 줄바꿈의
60%가 어절 중간이므로 무공백이 더 안전한 기본값.
"""
import re, unicodedata
from difflib import SequenceMatcher


def _norm(s):
    return unicodedata.normalize("NFKC", s or "")


def strip_spaces(s):
    """공백 제거 문자열과, '이 문자 뒤에 공백이 있었는지' 플래그 배열."""
    s = _norm(s)
    chars, after = [], []
    for ch in s:
        if ch.isspace():
            if after:
                after[-1] = True
            continue
        chars.append(ch)
        after.append(False)
    return "".join(chars), after


def transfer(new_text, *oracles):
    """new의 내용 + 여러 oracle의 띄어쓰기를 합집합으로 이식.

    PDF 줄바꿈은 공백을 남기지 않으므로 추출본에는 줄이 끊긴 자리마다
    공백이 빠져 있다. 그런데 2025판과 2026판은 줄바꿈 위치가 서로 달라,
    두 해의 추출본을 겹치면 빠진 공백이 대부분 메워진다.
    """
    n, n_after = strip_spaces(new_text)
    if not n:
        return ""
    space_after = list(n_after)  # new 자체의 (행 내부) 공백은 이미 정확
    for old_text in oracles:
        o, o_after = strip_spaces(old_text)
        if not o:
            continue
        for tag, i1, i2, j1, j2 in SequenceMatcher(None, n, o, autojunk=False).get_opcodes():
            if tag != "equal":
                continue
            for k in range(i2 - i1):
                if o_after[j1 + k]:
                    space_after[i1 + k] = True
    out = []
    for i, ch in enumerate(n):
        out.append(ch)
        if space_after[i]:
            out.append(" ")
    return re.sub(r" {2,}", " ", "".join(out)).strip()


def transfer_multiline(new_text, *oracles):
    """guidance: 줄바꿈 위치를 기억해 두고 '전체 문자열'을 통으로 정렬한다.

    줄 단위로 짝을 지으면 두 해의 불릿 구성이 다를 때 정렬이 깨져
    띄어쓰기가 대량으로 유실된다(2025 기준 19% -> 문제).
    """
    new_lines = [l for l in (new_text or "").split("\n") if l.strip()]
    if not new_lines:
        return ""
    oracles = [o.replace("\n", " ") for o in oracles if (o or "").strip()]
    if not oracles:
        return "\n".join(new_lines)

    # 공백 제거 기준으로 각 줄이 끝나는 위치 기록
    breaks, acc = [], 0
    for l in new_lines[:-1]:
        acc += len(strip_spaces(l)[0])
        breaks.append(acc)

    merged = transfer(" ".join(new_lines), *oracles)

    # 이식된 문자열에서 원래 줄바꿈 위치를 되찾아 다시 나눈다
    out, cnt, cur, bi = [], 0, [], 0
    for ch in merged:
        if bi < len(breaks) and cnt == breaks[bi]:
            out.append("".join(cur).strip())
            cur, bi = [], bi + 1
        cur.append(ch)
        if not ch.isspace():
            cnt += 1
    out.append("".join(cur).strip())
    return "\n".join(x for x in out if x)
