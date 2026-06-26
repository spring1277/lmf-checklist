/* LMF 인증심사 점검표 준비 — main app logic */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const state = {
    catalog: null,
    year: '2026',
    field: null,        // current field name or null (home)
    fieldData: null,    // loaded structured json
    filter: 'ALL',      // ALL | TODO | DONE | C | R | B
    cache: {},          // json cache by path
  };

  const view = $('#view');
  const backBtn = $('#backBtn');
  const appTitle = $('#appTitle');
  const appSub = $('#appSub');

  /* ---------- utils ---------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200);
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  async function loadJson(path) {
    if (state.cache[path]) return state.cache[path];
    const r = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('load fail ' + path);
    const j = await r.json();
    state.cache[path] = j;
    return j;
  }
  function flatItems(data) {
    const out = [];
    data.sections.forEach((s) => (s.subsections || []).forEach((ss) =>
      (ss.items || []).forEach((it) => out.push({ ...it, _section: s, _sub: ss }))));
    return out;
  }

  /* ---------- AI settings (localStorage) ---------- */
  const AI = {
    get() { try { return JSON.parse(localStorage.getItem('lmf-ai') || '{}'); } catch { return {}; } },
    set(o) { localStorage.setItem('lmf-ai', JSON.stringify(o)); },
  };

  /* ---------- routing ---------- */
  function go(field, targetCode) {
    state.field = field;
    state.filter = 'ALL';
    state.targetCode = targetCode || null;
    if (field === '__keypoints__') renderKeypoints();
    else if (field === '__search__') renderSearch();
    else if (field) renderField();
    else renderHome();
    window.scrollTo(0, 0);
  }
  backBtn.addEventListener('click', () => {
    if (state.prevView === 'search') { state.prevView = null; go('__search__'); }
    else go(null);
  });

  /* ---------- HOME ---------- */
  async function renderHome() {
    backBtn.hidden = true;
    appTitle.textContent = '인증심사 점검표';
    appSub.textContent = '진단검사의학재단 · 연차별 지침서 준비';
    view.innerHTML = '<div class="empty"><span class="spinner"></span> 불러오는 중…</div>';

    const cat = state.catalog;
    const records = await DB.byYear(state.year);
    const ansByField = {};
    records.forEach((r) => {
      if (r.code === '_notes') return;
      ansByField[r.field] = ansByField[r.field] || { done: 0, answered: 0 };
      if (r.answer && r.answer.trim()) ansByField[r.field].answered++;
      if (r.done) ansByField[r.field].done++;
    });

    const groups = {};
    cat.fields.forEach((f) => {
      const g = f.group || '기타';
      (groups[g] = groups[g] || []).push(f);
    });
    const order = ['공통', '전문분야', '기타'];

    let html = '';
    order.forEach((g) => {
      if (!groups[g]) return;
      html += `<div class="group-title">${esc(g)}</div><div class="field-grid">`;
      groups[g].forEach((f) => {
        const y = f.years[state.year] || {};
        const struct = y.structured;
        const total = y.itemCount || 0;
        const a = ansByField[f.name] || { answered: 0, done: 0 };
        const pct = total ? Math.round((a.answered / total) * 100) : 0;
        html += `<button class="field-card" data-field="${esc(f.name)}">
          <div class="fname">${esc(f.name)}</div>
          <div class="fmeta">${struct
            ? `<span class="badge struct">점검표</span> ${total}개 기준`
            : `<span class="badge pdf">PDF 보기</span>`}</div>
          ${struct ? `<div class="progress"><i style="width:${pct}%"></i></div>
             <div class="pct">${a.answered}/${total} 작성 · 완료 ${a.done}</div>` : ''}
        </button>`;
      });
      html += '</div>';
    });
    // Keypoints card at bottom
    html += `<div class="group-title">도구</div><div class="field-grid">
      <button class="field-card keypoints-card" data-field="__keypoints__">
        <div class="fname">⭐ 감점 키포인트</div>
        <div class="fmeta"><span class="badge struct">안내</span> 자주 지적되는 항목 모음</div>
      </button>
    </div>`;
    view.innerHTML = html;
    $$('.field-card').forEach((c) => c.addEventListener('click', () => go(c.dataset.field)));
  }

  /* ---------- SEARCH ---------- */
  let searchIndex = null; // flat array of all items across all fields

  async function buildSearchIndex() {
    if (searchIndex) return searchIndex;
    const cat = state.catalog;
    const structured = cat.fields.filter((f) => {
      const y = f.years[state.year] || {};
      return y.structured && y.json;
    });
    const results = await Promise.all(structured.map(async (f) => {
      try {
        const data = await loadJson(f.years[state.year].json);
        return flatItems(data).map((it) => ({ ...it, _field: f.name }));
      } catch { return []; }
    }));
    searchIndex = results.flat();
    return searchIndex;
  }

  function highlight(text, query) {
    if (!query) return esc(text);
    const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return esc(text).replace(re, '<mark>$1</mark>');
  }

  function renderSearch() {
    backBtn.hidden = false;
    state.prevView = null;
    appTitle.textContent = '검색';
    appSub.textContent = '전체 분야 항목 검색';

    view.innerHTML = `
      <div class="srch-wrap">
        <div class="srch-input-wrap">
          <input id="srchInput" type="search" class="srch-input" placeholder="문항 키워드, 코드 번호 입력…" autocomplete="off" />
        </div>
        <div id="srchResults" class="srch-results">
          <div class="empty" style="padding-top:32px">키워드를 입력하면 전체 분야 항목을 검색합니다</div>
        </div>
      </div>`;

    const input = $('#srchInput');
    const results = $('#srchResults');
    input.focus();

    let lastQuery = '';
    const doSearch = debounce(async (q) => {
      q = q.trim();
      if (q === lastQuery) return;
      lastQuery = q;
      if (q.length < 2) {
        results.innerHTML = '<div class="empty" style="padding-top:32px">2글자 이상 입력하세요</div>';
        return;
      }
      results.innerHTML = '<div class="empty"><span class="spinner"></span> 검색 중…</div>';
      const idx = await buildSearchIndex();
      const ql = q.toLowerCase();
      const hits = idx.filter((it) =>
        (it.question || '').toLowerCase().includes(ql) ||
        (it.code || '').toLowerCase().includes(ql) ||
        (it.guidance || '').toLowerCase().includes(ql)
      ).slice(0, 80);

      if (!hits.length) {
        results.innerHTML = `<div class="empty">검색 결과 없음 <br><small>"${esc(q)}"</small></div>`;
        return;
      }

      // Load answer status
      const recs = await DB.byYear(state.year);
      const doneSet = new Set(recs.filter((r) => r.done).map((r) => r.field + '|' + r.code));
      const answeredSet = new Set(recs.filter((r) => r.answer && r.answer.trim()).map((r) => r.field + '|' + r.code));

      // Group by field
      const byField = {};
      hits.forEach((it) => { (byField[it._field] = byField[it._field] || []).push(it); });

      let html = `<div class="srch-count">${hits.length}개 항목 발견</div>`;
      Object.entries(byField).forEach(([field, items]) => {
        html += `<div class="srch-group-title">${esc(field)} <span class="srch-group-cnt">${items.length}</span></div>`;
        items.forEach((it) => {
          const key = it._field + '|' + it.code;
          const done = doneSet.has(key);
          const answered = answeredSet.has(key);
          html += `<button class="srch-item ${done ? 'done' : answered ? 'answered' : ''}" data-field="${esc(it._field)}" data-code="${esc(it.code)}">
            <div class="srch-item-top">
              <span class="code-badge">${esc(it.code)}</span>
              <span class="type-badge type-${esc(it.type)}">${esc(it.type)}</span>
              <span class="srch-field-tag">${esc(it._field)}</span>
              ${done ? '<span class="srch-status done-tag">완료</span>' : answered ? '<span class="srch-status ans-tag">작성</span>' : ''}
            </div>
            <div class="srch-q">${highlight((it.question || '').replace(/\s+/g, ' '), q)}</div>
          </button>`;
        });
      });
      results.innerHTML = html;

      $$('.srch-item').forEach((btn) => btn.addEventListener('click', () => {
        state.prevView = 'search';
        go(btn.dataset.field, btn.dataset.code);
      }));
    }, 250);

    input.addEventListener('input', (e) => doSearch(e.target.value));
  }

  /* ---------- KEYPOINTS ---------- */
  async function renderKeypoints() {
    backBtn.hidden = false;
    appTitle.textContent = '감점 키포인트';
    appSub.textContent = 'LMF 인증심사 자주 지적 항목 · 놓치지 말아야 할 포인트';
    view.innerHTML = '<div class="empty"><span class="spinner"></span> 불러오는 중…</div>';

    const KP = [
      {
        icon: '🔴',
        level: '최고위험',
        title: '당일 즉시 확인 필수',
        items: [
          { q: '유효기간 초과 시약·소모품', hint: '냉장고·시약장 전수 점검 — 심사 전날 필수. 개봉 후 유효기간(in-use date)도 포함.' },
          { q: '냉장·냉동고 온도 기록지 당일 기재', hint: '심사 당일 오전 기록 공백 시 즉시 감점. 자동 기록 장치도 프린트해 비치.' },
          { q: '내부정도관리(IQC) 이탈 시 시정조치 기록', hint: '재측정 후 통과만으로 종료 ✗. 원인 분석 + 조치 + 환자결과 영향 평가까지 한 묶음으로 완결 필수. (24pt 고배점)' },
          { q: '직원 전원 역량평가(competency) 기록', hint: '신규·파트타임 포함 전원. 최초 교육 기록만 있고 연간 정기 역량평가 기록이 없으면 감점.' },
          { q: 'PPE 착용 상태 (검사 구역 근무 중)', hint: '심사원 입실 시 장갑·가운 미착용 즉시 감점. 심사 당일 전 직원 교육·상기 필요.' },
        ],
      },
      {
        icon: '🟠',
        level: '고위험',
        title: '심사 1주 전 점검 항목',
        items: [
          { q: 'SOP 최신 버전 현장 비치 & 구버전 폐기', hint: '서랍·바인더에 구버전 혼재 시 즉시 감점. 개정일·서명·버전번호 확인.' },
          { q: '장비 예방점검(PM) 기록 서명 완비', hint: '"해당없음(N/A)" 공란도 미수행으로 간주. 모든 칸 기재 완료 확인.' },
          { q: '시약 로트번호·개봉일 기재', hint: '개봉 후 사용 시작일 미기재는 ISO 15189 최빈도 부적합. 개봉 즉시 라벨 부착 습관화.' },
          { q: '위험값(critical value) 통보 기록', hint: '수신자 성명·수신 시각·보고자 기재 필수. 구두 통보만으로 종료 시 기록 없음으로 처리.' },
          { q: 'QC 결과 검토 전 환자 결과 발행 여부', hint: 'LIS 타임스탬프로 검증 가능. QC 검토 시각 < 결과 발행 시각 확인.' },
          { q: 'EQA(외부정도관리) 불만족 시 CAPA 파일', hint: '불합격 자체보다 후속 CAPA 기록 부재가 더 큰 감점. 파일 정리해 즉시 제출 가능 상태 유지. (24pt 고배점)' },
        ],
      },
      {
        icon: '🟡',
        level: '중위험',
        title: '심사 2주 전 준비 사항',
        items: [
          { q: 'TAT(검사 소요 시간) 한계 설정 & 정기 검토', hint: '모든 검사 항목에 TAT 상한 설정, 월 또는 분기 검토 기록 필요. (16pt 고배점)' },
          { q: '방법 간·기기 간 결과 비교 평가', hint: '동일 검사를 2대 이상 장비로 수행 시 주기적 비교 기록 필수. (16pt 고배점)' },
          { q: '검체 적합성 기준 절차서', hint: '용혈·황달·지방혈·부족량 등 거부 기준 명문화. 실제 거부 기록과 함께 운영.' },
          { q: '전문의 외부정도관리 분석 결과 적극 검토', hint: '전문의 서명·검토 메모 기록 필요. 결과 수령만으로는 불충분. (16pt 고배점)' },
          { q: 'CQI(지속적 질향상) 프로그램 운영', hint: '연간 질 지표 설정 → 측정 → 검토 → 개선 사이클 문서화. (16pt 고배점)' },
          { q: '내부심사 시정조치 follow-up 기록', hint: '내부심사 수행 기록 있어도 시정조치 이행 확인 기록 없으면 감점.' },
          { q: 'MSDS 현장 비치 & 화학물질 목록 일치', hint: '최신본 + 사용 구역 근처 비치. 목록과 실제 보유량 불일치 주의.' },
          { q: '검체 이중 식별자 원칙', hint: '성명 단독 표기 ✗. 성명 + 등록번호(또는 생년월일) 반드시 2가지 이상.' },
        ],
      },
      {
        icon: '🟢',
        level: '기본 점검',
        title: '전반적으로 확인할 사항',
        items: [
          { q: '직원별 수행 가능 검사 항목 목록(authorization list)', hint: '의료기사·전공의·임상병리사별 인증된 검사 목록 관리.' },
          { q: '역량평가 위임 시 서면 위임장', hint: '타인에게 위임 시 서면 위임 문서 보관 필수.' },
          { q: '안전 교육 이수 기록 최신화', hint: '신규직원 OJT 기록, 위험물·생물안전 교육 이수증 포함.' },
          { q: '장비 오류 코드 발생 기록 & 해결 기록', hint: '알람·오류 발생 이력과 조치 결과를 장비 유지관리 일지에 기재.' },
          { q: '신규 분석기 도입 시 검증(verification) 보고서', hint: '정확도·정밀도·직선성·참고구간 검증 + 전문의 서명 승인.' },
          { q: '수탁기관 선정 기준 & 주기적 평가 기록', hint: '인증/허가 확인, 검체 운반 조건 문서화, 연간 평가 기록.' },
          { q: 'POCT 기기 정도관리 기록', hint: '1일 1회 이상 QC, 결과 기록·검토, 기기 교정·유지보수 기록 일체.' },
          { q: '결과 수정(amendment) 이유 기록', hint: '보고 후 결과 수정 시 이유와 수정자 기재 필수.' },
        ],
      },
      {
        icon: '⚠️',
        level: '분야별 특이사항',
        title: '전문분야별 핵심 주의점',
        items: [
          { q: '[수혈의학] 교차반응 및 비예기항체 검사 기록', hint: '긴급 혈액 공급 절차, 혈액 출납 기록, 폐기 혈액 처리 문서 포함.' },
          { q: '[임상미생물] 동정·감수성 검사 판독 기준 & 세균 보존 기록', hint: '균종별 판독 기준 SOP, 균주 보존 조건·기간·목록 관리.' },
          { q: '[분자진단검사] 위양성/위음성 오염 방지 구역 분리', hint: 'PCR 전처리·증폭·분석 구역 물리적 분리 + 일방향 흐름 확인.' },
          { q: '[세포유전검사] ISCN 명명법 준수 & 최소 분석 세포 수', hint: '핵형분석 최소 20개 중기세포 분석, ISCN 2020 기준 보고서 형식.' },
          { q: '[조직적합성검사] HLA 유형화 방법 검증 & 외부 능숙도 시험', hint: 'EFI 또는 ASHI 기준 QC, 패널 세포 유효기간 관리.' },
          { q: '[유세포검사] 기기 설정 표준화 & 세포 집단 정의 기준', hint: '매 검사 일 QC 비드 사용, 게이팅 전략 문서화, 보고서 형식 표준화.' },
          { q: '[현장검사/POCT] 진단검사의학과 전문의 감독 체계', hint: '감독 절차서 + 수행자 교육·인증 프로그램 문서화 필수.' },
        ],
      },
    ];

    let html = `<div class="kp-page">
      <div class="kp-intro">
        <p>아래 항목은 <strong>LMF 인증심사에서 실제로 자주 감점·지적되는 포인트</strong>입니다.
           ISO 15189, CAP, 국내 우수검사실 인증 문헌 및 점검표 고배점 항목(24pt·16pt)을 종합하여 작성하였습니다.</p>
      </div>`;

    KP.forEach((section) => {
      html += `<div class="kp-section">
        <div class="kp-sec-header">
          <span class="kp-icon">${section.icon}</span>
          <div>
            <div class="kp-level">${esc(section.level)}</div>
            <div class="kp-sec-title">${esc(section.title)}</div>
          </div>
        </div>
        <ul class="kp-list">`;
      section.items.forEach((it) => {
        html += `<li class="kp-item">
          <div class="kp-q">${esc(it.q)}</div>
          <div class="kp-hint">${esc(it.hint)}</div>
        </li>`;
      });
      html += '</ul></div>';
    });

    html += `<div class="kp-footer">
      <p>출처: 진단검사의학재단(LMF) 2026 점검표 분석, ISO 15189 홍콩 연구(PMC4062334), CAP 2022 Top 10 Deficiencies, AACC/CLN 다기관 비교 분석</p>
    </div></div>`;

    view.innerHTML = html;
  }

  /* ---------- FIELD DETAIL ---------- */
  async function renderField() {
    backBtn.hidden = false;
    const cat = state.catalog;
    const f = cat.fields.find((x) => x.name === state.field);
    const y = f.years[state.year] || {};
    appTitle.textContent = state.field;
    appSub.textContent = `${state.year} 심사점검표`;

    if (!y.structured) return renderPdfField(f, y);

    view.innerHTML = '<div class="empty"><span class="spinner"></span> 점검표 불러오는 중…</div>';
    const data = await loadJson(y.json);
    state.fieldData = data;
    const items = flatItems(data);
    const recs = await DB.byYear(state.year, state.field);
    const recMap = {};
    recs.forEach((r) => (recMap[r.code] = r));

    const answered = items.filter((it) => recMap[it.code] && recMap[it.code].answer && recMap[it.code].answer.trim()).length;
    const pct = items.length ? Math.round((answered / items.length) * 100) : 0;

    let html = `
      <div class="fd-head">
        <h2>${esc(state.field)}</h2>
        <div class="fd-sub">${data.sections.length}개 영역 · 총 ${items.length}개 기준</div>
      </div>
      <div class="fd-bar">
        <div class="fd-progress-wrap">
          <div class="progress"><i id="fdBarFill" style="width:${pct}%"></i></div>
          <span class="lbl" id="fdBarLbl">${answered}/${items.length}</span>
        </div>
        <div class="filter-chips" id="chips">
          ${chip('ALL', '전체')}${chip('TODO', '미작성')}${chip('DONE', '완료')}
          ${chip('C', '핵심')}${chip('R', '필요')}${chip('B', '기본')}
        </div>
      </div>
      <div id="sections"></div>`;
    view.innerHTML = html;
    $('#chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      state.filter = c.dataset.f;
      $$('.chip').forEach((x) => x.classList.toggle('active', x.dataset.f === state.filter));
      renderSections(data, recMap);
    });
    renderSections(data, recMap);

    // Scroll to target item if coming from search
    if (state.targetCode) {
      const code = state.targetCode;
      state.targetCode = null;
      setTimeout(() => {
        const el = document.querySelector(`[data-item-code="${CSS.escape(code)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight-target');
          setTimeout(() => el.classList.remove('highlight-target'), 2000);
        }
      }, 100);
    }
  }

  function chip(f, label) {
    return `<button class="chip ${f === 'ALL' ? 'active' : ''}" data-f="${f}">${label}</button>`;
  }

  function passFilter(it, rec) {
    const f = state.filter;
    if (f === 'ALL') return true;
    if (f === 'C' || f === 'R' || f === 'B') return (it.type || 'B') === f;
    const ans = rec && rec.answer && rec.answer.trim();
    if (f === 'TODO') return !ans;
    if (f === 'DONE') return rec && rec.done;
    return true;
  }

  function renderSections(data, recMap) {
    const wrap = $('#sections');
    let html = '';
    data.sections.forEach((s, si) => {
      const subHtml = (s.subsections || []).map((ss) => {
        const its = (ss.items || []).filter((it) => passFilter(it, recMap[it.code]));
        if (!its.length) return '';
        const showSubTitle = ss.title && ss.title !== s.title;
        return `${showSubTitle ? `<div class="sub-title">${esc(ss.no ? ss.no + '. ' : '')}${esc(ss.title)}</div>` : ''}
          ${its.map((it) => itemCard(it, recMap[it.code])).join('')}`;
      }).join('');
      if (!subHtml.trim()) return;
      const cnt = (s.subsections || []).reduce((n, ss) => n + (ss.items || []).filter((it) => passFilter(it, recMap[it.code])).length, 0);
      html += `<div class="section" data-si="${si}">
        <div class="section-h">
          <span class="snum">${esc(s.no)}</span>
          <span class="stit">${esc(s.title)}</span>
          <span class="scount">${cnt}</span>
          <span class="caret">▼</span>
        </div>
        <div class="sub-block">${subHtml}</div>
      </div>`;
    });
    wrap.innerHTML = html || '<div class="empty">해당 조건의 항목이 없습니다.</div>';

    $$('.section-h').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
    $$('.guide-toggle').forEach((b) => b.addEventListener('click', () => {
      const g = b.nextElementSibling; g.hidden = !g.hidden;
      b.textContent = g.hidden ? '기준 설명 보기' : '기준 설명 닫기';
    }));
    wireItems(recMap);
  }

  function itemCard(it, rec) {
    const type = it.type || 'B';
    const typeLabel = { C: '핵심', R: '필요', B: '기본' }[type] || type;
    const ans = rec ? rec.answer || '' : '';
    const done = rec ? !!rec.done : false;
    return `<div class="item ${done ? 'done' : ''}" data-code="${esc(it.code)}" data-item-code="${esc(it.code)}">
      <div class="item-top">
        <span class="code-badge">${esc(it.code)}</span>
        <span class="type-badge type-${type}">${typeLabel}</span>
        ${it.points != null ? `<span class="pts">배점 ${esc(it.points)}</span>` : ''}
      </div>
      <div class="q">${esc(it.question)}</div>
      ${it.guidance ? `<button class="guide-toggle">기준 설명 보기</button>
        <div class="guide" hidden>${esc(it.guidance)}</div>` : ''}
      <div class="answer-wrap">
        <textarea placeholder="이 기준에 대한 우리 검사실의 답안·근거를 작성하세요…">${esc(ans)}</textarea>
        <div class="item-actions">
          <button class="btn ai small" data-act="ai">🤖 AI 초안</button>
          <span class="saved-tick">저장됨 ✓</span>
          <label class="done-toggle"><input type="checkbox" ${done ? 'checked' : ''}/> 완료</label>
        </div>
      </div>
    </div>`;
  }

  function wireItems(recMap) {
    $$('.item').forEach((card) => {
      const code = card.dataset.code;
      const ta = $('textarea', card);
      const tick = $('.saved-tick', card);
      const item = state.fieldData ? flatItems(state.fieldData).find((x) => x.code === code) : null;

      const save = debounce(async () => {
        await DB.put({ year: state.year, field: state.field, code, answer: ta.value, done: card.classList.contains('done') });
        tick.classList.add('show'); setTimeout(() => tick.classList.remove('show'), 1200);
        updateBar();
      }, 500);
      ta.addEventListener('input', save);
      ta.addEventListener('input', autoGrow);
      autoGrow.call(ta);

      $('.done-toggle input', card).addEventListener('change', async (e) => {
        card.classList.toggle('done', e.target.checked);
        await DB.put({ year: state.year, field: state.field, code, answer: ta.value, done: e.target.checked });
        updateBar();
      });

      $('[data-act="ai"]', card).addEventListener('click', () => aiDraft(item || { code }, ta, card));
    });
  }
  function autoGrow() { this.style.height = 'auto'; this.style.height = Math.max(78, this.scrollHeight) + 'px'; }

  async function updateBar() {
    if (!state.fieldData) return;
    const items = flatItems(state.fieldData);
    const recs = await DB.byYear(state.year, state.field);
    const answered = recs.filter((r) => r.code !== '_notes' && r.answer && r.answer.trim()).length;
    const pct = items.length ? Math.round((answered / items.length) * 100) : 0;
    const fill = $('#fdBarFill'), lbl = $('#fdBarLbl');
    if (fill) fill.style.width = pct + '%';
    if (lbl) lbl.textContent = `${answered}/${items.length}`;
  }

  /* ---------- AI draft ---------- */
  async function aiDraft(item, ta, card) {
    const cfg = AI.get();
    const btn = $('[data-act="ai"]', card);
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    try {
      let draft;
      if (cfg.endpoint) {
        draft = await callEndpoint(cfg, item);
      } else {
        draft = offlineTemplate(item, cfg.context);
      }
      // append rather than overwrite if user already typed
      ta.value = ta.value.trim() ? ta.value.trim() + '\n\n' + draft : draft;
      autoGrow.call(ta);
      ta.dispatchEvent(new Event('input'));
      toast(cfg.endpoint ? 'AI 초안 생성됨' : '템플릿 초안 생성됨');
    } catch (e) {
      toast('초안 생성 실패: ' + e.message);
    } finally {
      btn.innerHTML = orig; btn.disabled = false;
    }
  }

  async function callEndpoint(cfg, item) {
    const r = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
      body: JSON.stringify({
        year: state.year, field: state.field,
        code: item.code, type: item.type, question: item.question,
        guidance: item.guidance, points: item.points,
        labContext: cfg.context || '', model: cfg.model || '',
      }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return j.draft || j.text || JSON.stringify(j);
  }

  // Offline scaffold built from the official guidance — no LLM needed.
  function offlineTemplate(item, ctx) {
    const lines = [];
    lines.push(`■ 기준 ${item.code} 답안 작성 가이드`);
    if (ctx) lines.push(`(기관: ${ctx})`);
    lines.push('');
    lines.push('[충족 근거] 우리 검사실에서 이 기준을 어떻게 충족하는지 기술:');
    lines.push('- ');
    if (item.guidance) {
      lines.push('');
      lines.push('[점검 포인트 — 기준 설명에서 도출]');
      item.guidance.split(/\n|·|•|●|(?:^|\s)\d+\)\s/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 8)
        .forEach((s) => lines.push(`□ ${s}`));
    }
    lines.push('');
    lines.push('[관련 문서/SOP]: ');
    lines.push('[증빙 자료]: ');
    lines.push('[담당/책임자]: ');
    return lines.join('\n');
  }

  /* ---------- PDF (non-structured) field ---------- */
  async function renderPdfField(f, y) {
    const notesRec = await DB.get(state.year, state.field, '_notes');
    const notes = notesRec ? notesRec.answer || '' : '';
    view.innerHTML = `
      <div class="fd-head"><h2>${esc(state.field)}</h2>
        <div class="fd-sub">${state.year} 심사점검표 · 공식 PDF</div></div>
      <div class="pdf-card">
        <p>이 분야는 현재 <b>공식 PDF 원문 보기</b>로 제공됩니다. 아래에서 점검표를 확인하고,
        분야 전체에 대한 준비 메모를 작성·저장할 수 있습니다. (기준별 구조화·AI 초안은 추후 확장)</p>
        ${y.pdf ? `<a class="btn primary" href="${esc(y.pdf)}" target="_blank" rel="noopener">📄 점검표 PDF 열기</a>
          <iframe class="pdf-frame" src="${esc(y.pdf)}" title="${esc(state.field)} 점검표"></iframe>` : '<p>PDF 파일이 없습니다.</p>'}
        <div class="answer-wrap" style="padding:14px 0 0">
          <div class="sub-title" style="margin-left:0">분야 준비 메모</div>
          <textarea id="fieldNotes" placeholder="이 분야 준비사항·담당·증빙 메모…">${esc(notes)}</textarea>
          <div class="item-actions"><span class="saved-tick" id="notesTick">저장됨 ✓</span></div>
        </div>
      </div>`;
    const ta = $('#fieldNotes');
    const tick = $('#notesTick');
    const save = debounce(async () => {
      await DB.put({ year: state.year, field: state.field, code: '_notes', answer: ta.value, done: false });
      tick.classList.add('show'); setTimeout(() => tick.classList.remove('show'), 1200);
    }, 500);
    ta.addEventListener('input', save);
  }

  /* ---------- export / import ---------- */
  async function exportJson() {
    const all = await DB.all();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), answers: all }, null, 2)], { type: 'application/json' });
    download(blob, `LMF점검표_답안_${new Date().toISOString().slice(0, 10)}.json`);
    toast('답안 내보내기 완료');
  }
  async function exportHtml() {
    const cat = state.catalog;
    const all = await DB.all();
    const byKey = {};
    all.forEach((r) => (byKey[`${r.year}|${r.field}|${r.code}`] = r));
    let body = `<h1>LMF 인증심사 점검표 답안 — ${state.year}</h1><p>생성: ${new Date().toLocaleString('ko-KR')}</p>`;
    for (const f of cat.fields) {
      const y = f.years[state.year]; if (!y) continue;
      if (y.structured) {
        const data = await loadJson(y.json);
        let fieldBody = '';
        data.sections.forEach((s) => (s.subsections || []).forEach((ss) => (ss.items || []).forEach((it) => {
          const rec = byKey[`${state.year}|${f.name}|${it.code}`];
          if (!rec || !(rec.answer && rec.answer.trim())) return;
          fieldBody += `<div class="qa"><div class="c">${it.code} <span class="t">${it.type || 'B'}</span></div>
            <div class="qq">${esc(it.question)}</div>
            <div class="aa">${esc(rec.answer).replace(/\n/g, '<br>')}</div></div>`;
        })));
        if (fieldBody) body += `<h2>${esc(f.name)}</h2>${fieldBody}`;
      } else {
        const rec = byKey[`${state.year}|${f.name}|_notes`];
        if (rec && rec.answer && rec.answer.trim())
          body += `<h2>${esc(f.name)} (메모)</h2><div class="aa">${esc(rec.answer).replace(/\n/g, '<br>')}</div>`;
      }
    }
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>LMF 점검표 답안 ${state.year}</title>
      <style>body{font-family:"Malgun Gothic",sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#222;line-height:1.6}
      h1{font-size:22px;border-bottom:3px solid #0b7d73;padding-bottom:8px}
      h2{font-size:18px;color:#0b7d73;margin-top:28px;border-left:5px solid #0b7d73;padding-left:8px}
      .qa{margin:12px 0;padding:12px;border:1px solid #ddd;border-radius:8px;page-break-inside:avoid}
      .c{font-weight:700;color:#0b7d73;font-size:13px}.t{background:#eee;border-radius:4px;padding:1px 6px;font-size:11px;margin-left:4px}
      .qq{font-weight:600;margin:4px 0}.aa{white-space:pre-wrap;background:#f7faf9;padding:8px;border-radius:6px;font-size:14px}
      @media print{.qa{border-color:#999}}</style></head><body>${body}
      <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else { download(new Blob([html], { type: 'text/html' }), `LMF점검표_답안_${state.year}.html`); }
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- sheets / menu ---------- */
  function openSheet(id) { $(id).hidden = false; }
  function closeSheets() { $('#sheet').hidden = true; $('#aiModal').hidden = true; }
  document.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeSheets(); });

  $('#menuBtn').addEventListener('click', async () => {
    const all = await DB.all();
    $('#storageInfo').textContent = `저장된 답안 ${all.filter((r) => r.answer && r.answer.trim()).length}건`;
    openSheet('#sheet');
  });
  $('#exportJsonBtn').addEventListener('click', () => { closeSheets(); exportJson(); });
  $('#exportHtmlBtn').addEventListener('click', () => { closeSheets(); exportHtml(); });
  $('#syncBtn').addEventListener('click', async () => {
    closeSheets();
    let total = 0, errors = 0;
    toast('답안 동기화 중…');
    let files = ['answers_draft.json','extra_수탁검사.json','extra_종합검증.json','extra_현장검사.json','extra_세포유전검사.json','answers_extra_part1.json','glass_answers.json'];
    try {
      const mr = await fetch('data/enhanced/manifest.json');
      if (mr.ok) { const mj = await mr.json(); files = [...files, ...mj.files]; }
    } catch {}
    for (const f of files) {
      try {
        const r = await fetch(f.startsWith('data/') ? f : 'data/' + f);
        if (!r.ok) continue;
        const j = await r.json();
        const recs = j.answers || j;
        if (Array.isArray(recs) && recs.length) { await DB.importMany(recs); total += recs.length; }
      } catch { errors++; }
    }
    toast(`동기화 완료: ${total}건 불러옴`);
    state.field ? renderField() : renderHome();
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const recs = j.answers || j;
      await DB.importMany(recs);
      toast(`${recs.length}건 불러오기 완료`); closeSheets();
      state.field ? renderField() : renderHome();
    } catch (err) { toast('불러오기 실패: ' + err.message); }
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm(`${state.year}년도 답안을 모두 삭제할까요? (되돌릴 수 없음)`)) return;
    await DB.clearYear(state.year); closeSheets();
    toast('초기화 완료'); state.field ? renderField() : renderHome();
  });
  $('#aiSettingsBtn').addEventListener('click', () => {
    closeSheets();
    const c = AI.get();
    $('#aiEndpoint').value = c.endpoint || ''; $('#aiKey').value = c.key || '';
    $('#aiModel').value = c.model || 'claude-opus-4-8'; $('#aiContext').value = c.context || '';
    openSheet('#aiModal');
  });
  $('#aiSaveBtn').addEventListener('click', () => {
    AI.set({ endpoint: $('#aiEndpoint').value.trim(), key: $('#aiKey').value.trim(), model: $('#aiModel').value.trim(), context: $('#aiContext').value.trim() });
    closeSheets(); toast('AI 설정 저장됨');
  });

  /* ---------- search button ---------- */
  $('#searchBtn').addEventListener('click', () => go('__search__'));

  /* ---------- year toggle ---------- */
  $('#yearToggle').addEventListener('click', (e) => {
    const b = e.target.closest('.year-btn'); if (!b) return;
    state.year = b.dataset.year;
    searchIndex = null; // invalidate index on year change
    $$('.year-btn').forEach((x) => x.classList.toggle('active', x === b));
    state.field ? renderField() : renderHome();
  });

  /* ---------- init ---------- */
  (async function init() {
    try {
      state.catalog = await loadJson('data/index.json');
      renderHome();
    } catch (e) {
      view.innerHTML = `<div class="empty">데이터를 불러오지 못했습니다.<br><small>${esc(e.message)}</small><br><br>로컬 서버로 실행했는지 확인하세요 (file:// 직접 열기는 제한될 수 있음).</div>`;
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
})();
