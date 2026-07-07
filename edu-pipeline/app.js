// edu-pipeline app — 정적 PWA, 데이터는 localStorage에만 저장
'use strict';

const STORE_KEY = 'eduPipeline.v1';

// ── 상태 ──────────────────────────────────────────────────
function defaultState() {
  const career = {}, records = {};
  SEED_CHILDREN.forEach(c => {
    career[c.id] = { hypotheses: [], tests: [], cards: [], subjects: [] };
    records[c.id] = [];
  });
  return {
    schoolYear: SEED_BASE_SCHOOL_YEAR,
    children: JSON.parse(JSON.stringify(SEED_CHILDREN)),
    activeChildId: SEED_CHILDREN[0].id,
    career, records,
    admissionCards: JSON.parse(JSON.stringify(SEED_ADMISSION_CARDS)),
    ddays: JSON.parse(JSON.stringify(SEED_DDAYS)),
    links: [],
  };
}

let state = loadState();

function loadState() {
  let s;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { s = null; }
  if (!s || !s.children) s = defaultState();
  advanceGrades(s);
  return s;
}

function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

// 학년도(3월 시작) 바뀌면 학년 자동 진급
function currentSchoolYear() {
  const now = new Date();
  return now.getMonth() + 1 >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}
function advanceGrades(s) {
  const diff = currentSchoolYear() - s.schoolYear;
  if (diff > 0) {
    s.children.forEach(c => { c.gradeIdx = Math.min(12, c.gradeIdx + diff); });
    s.schoolYear = currentSchoolYear();
  }
}

// 대입 학년도: 고3이 되는 해 + 1
function admissionYear(child) { return currentSchoolYear() + (12 - child.gradeIdx) + 1; }
function gradeName(idx) { return GRADE_NAMES[idx] || '?'; }
function activeChild() { return state.children.find(c => c.id === state.activeChildId) || state.children[0]; }
function careerOf(id) {
  if (!state.career[id]) state.career[id] = { hypotheses: [], tests: [], cards: [], subjects: [] };
  return state.career[id];
}
function recordsOf(id) {
  if (!state.records[id]) state.records[id] = [];
  return state.records[id];
}

// ── 유틸 ──────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function uid() { return 'x' + Math.random().toString(36).slice(2, 10); }
function today() { return new Date().toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function fmtDday(dateStr) {
  const d = daysBetween(today(), dateStr);
  if (d === 0) return 'D-DAY';
  return d > 0 ? `D-${d}` : `D+${-d}`;
}
function seasonOfMonth(m) {
  if (m >= 3 && m <= 6) return 'spring';
  if (m >= 7 && m <= 8) return 'summer';
  if (m >= 9) return 'fall';
  return 'winter';
}
const SEASON_LABEL = { spring: '학기 초·중반(3~6월)', summer: '여름방학(7~8월)', fall: '2학기(9~12월)', winter: '겨울방학(1~2월)' };

// ── 모달 폼 ───────────────────────────────────────────────
const overlay = document.getElementById('modalOverlay');
const modalBox = document.getElementById('modalBox');

function openForm(title, fields, initial, onSubmit) {
  modalBox.innerHTML = `<h2>${esc(title)}</h2>` + fields.map(f => {
    const val = esc(initial && initial[f.key] != null ? initial[f.key] : (f.default || ''));
    if (f.type === 'textarea') return `<label>${esc(f.label)}</label><textarea data-key="${f.key}">${val}</textarea>`;
    if (f.type === 'select') return `<label>${esc(f.label)}</label><select data-key="${f.key}">${f.options.map(o => `<option value="${esc(o)}" ${o === (initial && initial[f.key] || f.default) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<label>${esc(f.label)}</label><input type="${f.type || 'text'}" data-key="${f.key}" value="${val}">`;
  }).join('') + `
    <div class="modal-actions">
      <button class="btn ghost" id="mCancel">취소</button>
      <button class="btn" id="mSave">저장</button>
    </div>`;
  overlay.classList.remove('hidden');
  modalBox.querySelector('#mCancel').onclick = closeModal;
  modalBox.querySelector('#mSave').onclick = () => {
    const out = {};
    modalBox.querySelectorAll('[data-key]').forEach(el => { out[el.dataset.key] = el.value.trim(); });
    const missing = fields.filter(f => f.required && !out[f.key]);
    if (missing.length) { alert(missing[0].label + '을(를) 입력해 주세요.'); return; }
    closeModal();
    onSubmit(out);
    saveState();
    render();
  };
}
function closeModal() { overlay.classList.add('hidden'); }
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

// ── 내비게이션 ────────────────────────────────────────────
let currentTab = 'home';
let recordFilter = '전체';

document.getElementById('mainNav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  currentTab = btn.dataset.tab;
  document.querySelectorAll('#mainNav button').forEach(b => b.classList.toggle('active', b === btn));
  render();
});

function renderChildTabs() {
  const el = document.getElementById('childTabs');
  el.innerHTML = state.children.map(c =>
    `<button data-child="${c.id}" class="${c.id === state.activeChildId ? 'active' : ''}">${esc(c.name)}<span class="grade-badge">${gradeName(c.gradeIdx)}</span></button>`
  ).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => {
    state.activeChildId = b.dataset.child;
    saveState();
    render();
  });
}

// ── 홈 ────────────────────────────────────────────────────
function renderHome() {
  const c = activeChild();
  const rm = ROADMAPS[c.gradeIdx];
  const season = seasonOfMonth(new Date().getMonth() + 1);
  const todos = (rm && rm.seasons[season]) || [];

  const ddays = state.ddays
    .filter(d => !d.childId || d.childId === c.id)
    .filter(d => daysBetween(today(), d.endDate || d.date) >= -30)
    .sort((a, b) => a.date.localeCompare(b.date));

  const stale = state.admissionCards.filter(card =>
    (!card.childId || card.childId === c.id) && daysBetween(card.checkedDate, today()) > 90);

  const recent = recordsOf(c.id).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  return `
  <div class="card"><h2>📌 ${esc(c.name)} (${gradeName(c.gradeIdx)}) — ${admissionYear(c)}학년도 대입</h2>
    <p class="sub">${rm ? esc(rm.title) : ''}</p></div>

  <div class="card"><h2>⏳ 일정·D-day <button class="btn small" onclick="addDday()">+ 추가</button></h2>
    <p class="sub">방학특강·학원·캠프처럼 기간이 있는 일정은 종료일까지 넣으면 "진행 중"으로 표시됩니다.</p>
    ${ddays.length ? ddays.map(d => {
      const t = today();
      const ongoing = d.endDate && d.date <= t && t <= d.endDate;
      const dnum = ongoing
        ? `<div class="dday-num ongoing">진행 중<br><span class="sub">종료 ${fmtDday(d.endDate)}</span></div>`
        : `<div class="dday-num ${daysBetween(t, d.date) <= 30 && daysBetween(t, d.date) >= 0 ? 'soon' : ''}">${fmtDday(d.date)}</div>`;
      return `
      <div class="item-row">
        <div class="item-main"><div class="item-title">${d.category && d.category !== '기타' ? `<span class="badge neutral">${esc(d.category)}</span> ` : ''}${esc(d.title)}</div>
          <div class="item-meta">${esc(d.date)}${d.endDate ? ' ~ ' + esc(d.endDate) : ''}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
        ${dnum}
        <button class="icon-btn" onclick="delDday('${d.id}')">✕</button>
      </div>`;
    }).join('') : '<p class="empty">등록된 일정이 없습니다.</p>'}
  </div>

  <div class="card"><h2>✅ 지금 시기 할 일 — ${SEASON_LABEL[season]}</h2>
    ${todos.length ? '<ul>' + todos.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="empty">로드맵 탭에서 전체 계획을 확인하세요.</p>'}
    <p class="sub">전체 연간 계획은 로드맵 탭에서.</p>
  </div>

  ${stale.length ? `<div class="card"><h2>⚠️ 재확인 필요 정보</h2>
    ${stale.map(card => `<div class="item-row"><div class="item-main">
      <div class="item-title">${esc(card.title)}</div>
      <div class="item-meta">마지막 확인 ${esc(card.checkedDate)} (${daysBetween(card.checkedDate, today())}일 경과) — 원문 재확인 후 대입정보 탭에서 [확인함]</div>
    </div></div>`).join('')}</div>` : ''}

  <div class="card"><h2>📝 최근 기록</h2>
    ${recent.length ? recent.map(r => `<div class="item-row"><div class="item-main">
      <div class="item-title">[${esc(r.type)}] ${esc(r.title)}</div>
      <div class="item-meta">${esc(r.date)}</div></div></div>`).join('') : '<p class="empty">기록 탭에서 첫 기록을 남겨 보세요.</p>'}
  </div>`;
}

function addDday() {
  openForm('일정 추가 (특강·학원·시험·접수 등)', [
    { key: 'title', label: '제목 (예: 수학 여름방학 특강)', required: true },
    { key: 'category', label: '분류', type: 'select', options: ['특강', '학원', '캠프', '시험', '설명회', '접수/마감', '기타'], default: '기타' },
    { key: 'date', label: '날짜 (기간 일정이면 시작일)', type: 'date', required: true },
    { key: 'endDate', label: '종료일 (방학특강 등 기간 일정만)', type: 'date' },
    { key: 'note', label: '메모 (요일·시간·장소 등)' },
  ], null, out => {
    if (out.endDate && out.endDate < out.date) { alert('종료일이 시작일보다 빠릅니다.'); return; }
    state.ddays.push({ id: uid(), ...out, childId: state.activeChildId });
  });
}
function delDday(id) {
  if (!confirm('이 일정을 삭제할까요?')) return;
  state.ddays = state.ddays.filter(d => d.id !== id);
  saveState(); render();
}

// ── 진로 ──────────────────────────────────────────────────
function renderCareer() {
  const c = activeChild();
  const cr = careerOf(c.id);
  const active = cr.hypotheses.find(h => h.active);
  const archived = cr.hypotheses.filter(h => !h.active).sort((a, b) => b.date.localeCompare(a.date));

  return `
  <div class="notice">${esc(SEED_CAREER_NOTE)}</div>

  <div class="card"><h2>🧭 진로 가설 보드 <button class="btn small" onclick="addHypothesis()">가설 세우기</button></h2>
    ${active ? `<div class="hypothesis-active">
      <div class="item-title">${esc(active.text)}</div>
      <div class="item-meta">${esc(active.date)}부터${active.note ? ' · ' + esc(active.note) : ''}</div>
    </div>` : '<p class="empty">아직 가설이 없습니다. 계열 수준(예: "이과 성향, 공학 쪽 관심")이면 충분합니다.</p>'}
    ${archived.length ? `<h3>지난 가설 (탐색의 기록)</h3>` + archived.map(h => `
      <div class="item-row hypothesis-archived"><div class="item-main">
        <div class="item-title">${esc(h.text)}</div>
        <div class="item-meta">${esc(h.date)}${h.note ? ' · ' + esc(h.note) : ''}</div>
      </div></div>`).join('') : ''}
  </div>

  <div class="card"><h2>🧪 흥미·적성 검사 기록 <button class="btn small" onclick="addTest()">+ 추가</button></h2>
    <p class="sub">커리어넷·워크넷 검사 결과를 시기별로 기록 — 변화 자체가 데이터입니다.</p>
    ${cr.tests.length ? cr.tests.slice().sort((a, b) => b.date.localeCompare(a.date)).map(t => `
      <div class="item-row"><div class="item-main">
        <div class="item-title">${esc(t.name)}</div>
        <div class="item-meta">${esc(t.date)} · ${esc(t.result)}</div>
      </div><button class="icon-btn" onclick="delCareerItem('tests','${t.id}')">✕</button></div>`).join('') : '<p class="empty">기록 없음</p>'}
  </div>

  <div class="card"><h2>🃏 직업·학과 카드 <button class="btn small" onclick="addCareerCard()">+ 추가</button></h2>
    <p class="sub">조사한 내용 + 본인 소감을 함께. 커리어넷·어디가 학과정보 활용.</p>
    ${cr.cards.length ? cr.cards.map(k => `
      <div class="item-row"><div class="item-main">
        <div class="item-title">[${esc(k.type)}] ${esc(k.title)}</div>
        <div class="item-meta">${esc(k.memo)}${k.childNote ? `<br>💬 본인 소감: ${esc(k.childNote)}` : ''}</div>
      </div><button class="icon-btn" onclick="delCareerItem('cards','${k.id}')">✕</button></div>`).join('') : '<p class="empty">카드 없음 — 중학생이라면 10개 만들기가 목표!</p>'}
  </div>

  <div class="card"><h2>📚 전공↔과목 연계표 <button class="btn small" onclick="addSubject()">+ 추가</button></h2>
    <p class="sub">희망 계열의 권장과목 vs 학교 개설과목 vs 이수 계획을 대조 (고교학점제 핵심 도구, 고1 겨울 전 확정 권장). 권장과목 근거: 각 대학 전공 안내서.</p>
    ${cr.subjects.length ? `<div class="table-wrap"><table class="subject-map">
      <tr><th>과목</th><th>구분</th><th>관련 전공/계열</th><th>메모</th><th></th></tr>
      ${cr.subjects.map(s => `<tr>
        <td>${esc(s.subject)}</td><td>${esc(s.category)}</td><td>${esc(s.major)}</td><td>${esc(s.memo)}</td>
        <td><button class="icon-btn" onclick="delCareerItem('subjects','${s.id}')">✕</button></td>
      </tr>`).join('')}
    </table></div>` : '<p class="empty">행 없음 — 2학년 수강신청 전에 채워 보세요.</p>'}
  </div>`;
}

function addHypothesis() {
  openForm('진로 가설 세우기 (이전 가설은 이력으로 보존)', [
    { key: 'text', label: '가설 (예: 자연계열, 생명과학·의약 쪽 관심)', required: true },
    { key: 'note', label: '근거/계기 (예: 과학 탐구 활동에서 흥미)' },
  ], null, out => {
    const cr = careerOf(state.activeChildId);
    cr.hypotheses.forEach(h => h.active = false);
    cr.hypotheses.push({ id: uid(), text: out.text, note: out.note, date: today(), active: true });
  });
}
function addTest() {
  openForm('검사 기록 추가', [
    { key: 'name', label: '검사명 (예: 커리어넷 직업흥미검사 H형)', required: true },
    { key: 'date', label: '검사일', type: 'date', default: today(), required: true },
    { key: 'result', label: '결과 요약', type: 'textarea', required: true },
  ], null, out => { careerOf(state.activeChildId).tests.push({ id: uid(), ...out }); });
}
function addCareerCard() {
  openForm('직업·학과 카드 추가', [
    { key: 'type', label: '구분', type: 'select', options: ['직업', '학과'], default: '직업' },
    { key: 'title', label: '이름 (예: 임상병리사 / 컴퓨터공학과)', required: true },
    { key: 'memo', label: '조사 내용 (하는 일, 필요한 공부, 출처)', type: 'textarea', required: true },
    { key: 'childNote', label: '본인 소감 (자녀가 직접!)' },
  ], null, out => { careerOf(state.activeChildId).cards.push({ id: uid(), ...out }); });
}
function addSubject() {
  openForm('전공↔과목 연계표 행 추가', [
    { key: 'subject', label: '과목명 (예: 미적분Ⅱ, 생명과학)', required: true },
    { key: 'category', label: '구분', type: 'select', options: ['전공 권장', '학교 개설', '이수 예정', '이수 완료', '개설 안 됨(대안 필요)'], default: '전공 권장' },
    { key: 'major', label: '관련 전공/계열' },
    { key: 'memo', label: '메모 (근거 출처 등)' },
  ], null, out => { careerOf(state.activeChildId).subjects.push({ id: uid(), ...out }); });
}
function delCareerItem(kind, id) {
  if (!confirm('삭제할까요?')) return;
  const cr = careerOf(state.activeChildId);
  cr[kind] = cr[kind].filter(x => x.id !== id);
  saveState(); render();
}

// ── 기록 ──────────────────────────────────────────────────
const RECORD_TYPES = ['학습', '활동', '독서', '상담', '성찰'];

function renderRecords() {
  const c = activeChild();
  let list = recordsOf(c.id).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (recordFilter !== '전체') list = list.filter(r => r.type === recordFilter);

  return `
  <div class="card"><h2>📝 ${esc(c.name)}의 기록 <button class="btn small" onclick="addRecord()">+ 기록</button></h2>
    <div class="filter-chips">${['전체', ...RECORD_TYPES].map(t =>
      `<button class="${recordFilter === t ? 'active' : ''}" onclick="setRecordFilter('${t}')">${t}</button>`).join('')}</div>
    ${list.length ? list.map(r => `
      <div class="item-row"><div class="item-main">
        <div class="item-title">[${esc(r.type)}] ${esc(r.title)}</div>
        <div class="item-meta">${esc(r.date)}${r.body ? '<br>' + esc(r.body) : ''}</div>
      </div><button class="icon-btn" onclick="delRecord('${r.id}')">✕</button></div>`).join('')
      : '<p class="empty">기록이 없습니다. 사실(있었던 일)과 해석(부모 생각)을 구분해 적으면 나중에 판단이 쉬워집니다.</p>'}
  </div>`;
}
function setRecordFilter(t) { recordFilter = t; render(); }
function addRecord() {
  openForm('기록 추가', [
    { key: 'type', label: '종류', type: 'select', options: RECORD_TYPES, default: '학습' },
    { key: 'date', label: '날짜', type: 'date', default: today(), required: true },
    { key: 'title', label: '제목', required: true },
    { key: 'body', label: '내용 (사실과 해석을 구분해서)', type: 'textarea' },
  ], null, out => { recordsOf(state.activeChildId).push({ id: uid(), ...out }); });
}
function delRecord(id) {
  if (!confirm('삭제할까요?')) return;
  state.records[state.activeChildId] = recordsOf(state.activeChildId).filter(r => r.id !== id);
  saveState(); render();
}

// ── 로드맵 ────────────────────────────────────────────────
function renderRoadmap() {
  const c = activeChild();
  const rm = ROADMAPS[c.gradeIdx];
  const csy = currentSchoolYear();

  const timeline = state.children.map(ch => {
    const rows = [];
    for (let y = csy; y <= admissionYear(ch) - 1; y++) {
      const g = ch.gradeIdx + (y - csy);
      if (g > 12) break;
      rows.push({ year: y, grade: gradeName(g), current: y === csy });
    }
    return { ch, rows };
  });

  return `
  <div class="card"><h2>🗺️ ${esc(c.name)} — ${rm ? esc(rm.title) : gradeName(c.gradeIdx)}</h2>
    <h3>핵심</h3><ul>${rm.focus.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <h3>진로진학 축</h3><ul>${rm.career.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <h3>피해야 할 것</h3><ul>${rm.caution.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
  </div>

  <div class="card"><h2>📅 시기별 계획</h2>
    ${Object.keys(rm.seasons).map(s => `<h3>${SEASON_LABEL[s]}${seasonOfMonth(new Date().getMonth() + 1) === s ? ' ← 지금' : ''}</h3>
      <ul>${rm.seasons[s].map(t => `<li>${esc(t)}</li>`).join('')}</ul>`).join('')}
  </div>

  <div class="card"><h2>👨‍👩‍👧‍👦 가족 장기 타임라인</h2>
    <p class="sub">학년도(3월 시작) 기준. 각 자녀의 대입 학년도까지.</p>
    ${timeline.map(t => `<h3>${esc(t.ch.name)} — ${admissionYear(t.ch)}학년도 대입</h3>
      <div class="timeline">${t.rows.map(r => `
        <div class="timeline-row"><span class="timeline-year">${r.year}</span>
          <div class="timeline-cells"><span class="timeline-cell ${r.current ? 'hl' : ''}">${r.grade}${r.grade === '고3' ? ' · 수능 ' + r.year + '.11' : ''}</span></div>
        </div>`).join('')}</div>`).join('')}
    <p class="sub" style="margin-top:8px">⚠️ 2028학년도 대입부터 통합형 수능·내신 5등급제 — 세 자녀 모두 개편 이후 체제. 세부는 각 시점의 공식 발표로 확인.</p>
  </div>`;
}

// ── 대입정보 ──────────────────────────────────────────────
function renderAdmission() {
  const c = activeChild();
  const cards = state.admissionCards.filter(k => !k.childId || k.childId === c.id);

  return `
  <div class="notice">모든 정보 카드에는 <b>적용 학년도 · 출처 · 확인일 · 구분</b>이 붙습니다. 90일 이상 미확인이면 경고가 뜹니다. 지원 결정 전에는 반드시 대학 입학처 원문을 다시 확인하세요.</div>
  <div class="card"><h2>🎓 대입 정보 카드 <button class="btn small" onclick="addAdmissionCard()">+ 추가</button></h2>
    ${cards.length ? cards.map(k => {
      const staleDays = daysBetween(k.checkedDate, today());
      const freshBadge = staleDays > 90
        ? `<span class="badge danger">확인 ${staleDays}일 경과</span>`
        : `<span class="badge ok">확인 ${esc(k.checkedDate)}</span>`;
      const statusClass = k.status === '공식확정' ? 'ok' : (k.status === '예고' ? 'warn' : 'neutral');
      return `<div class="item-row"><div class="item-main">
        <div class="item-title">${k.url ? `<a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.title)}</a>` : esc(k.title)}</div>
        <div class="item-meta">${esc(k.body)}<br>
          <span class="badge ${statusClass}">${esc(k.status)}</span>
          <span class="badge neutral">${esc(k.appliesTo)}</span>
          <span class="badge neutral">${esc(k.org)}</span>
          ${freshBadge}
        </div></div>
        <div class="item-actions">
          <button class="btn small ghost" onclick="recheckCard('${k.id}')">확인함</button>
          <button class="icon-btn" onclick="delAdmissionCard('${k.id}')">✕</button>
        </div></div>`;
    }).join('') : '<p class="empty">카드 없음</p>'}
  </div>`;
}
function addAdmissionCard() {
  openForm('대입 정보 카드 추가', [
    { key: 'title', label: '제목', required: true },
    { key: 'body', label: '내용', type: 'textarea', required: true },
    { key: 'appliesTo', label: '적용 학년도 (예: 2029학년도)', required: true },
    { key: 'org', label: '기관/대학', required: true },
    { key: 'url', label: '출처 URL' },
    { key: 'status', label: '구분', type: 'select', options: ['공식확정', '예고', '개인해석'], default: '공식확정' },
  ], null, out => {
    state.admissionCards.push({ id: uid(), ...out, checkedDate: today(), childId: state.activeChildId });
  });
}
function recheckCard(id) {
  const k = state.admissionCards.find(x => x.id === id);
  if (k && confirm('원문을 다시 확인하셨나요? 확인일을 오늘로 갱신합니다.')) {
    k.checkedDate = today();
    saveState(); render();
  }
}
function delAdmissionCard(id) {
  if (!confirm('삭제할까요?')) return;
  state.admissionCards = state.admissionCards.filter(k => k.id !== id);
  saveState(); render();
}

// ── 자료실 ────────────────────────────────────────────────
function renderLibrary() {
  const all = [...SEED_LINKS, ...state.links];
  const groups = [...new Set(all.map(l => l.group))];
  return `
  <div class="card"><h2>🔗 공식 자료실 <button class="btn small" onclick="addLink()">+ 추가</button></h2>
    <p class="sub">1차 출처(공식) 우선. 학원 블로그·커뮤니티 정보는 참고용으로 구분해 저장하세요.</p>
    ${groups.map(g => `<h3>${esc(g)}</h3>` + all.filter(l => l.group === g).map(l => `
      <div class="item-row"><div class="item-main">
        <div class="item-title"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>
          ${l.official ? '<span class="badge ok">공식</span>' : '<span class="badge neutral">참고</span>'}</div>
        <div class="item-meta">${esc(l.note)}</div></div>
        ${l.id ? `<button class="icon-btn" onclick="delLink('${l.id}')">✕</button>` : ''}
      </div>`).join('')).join('')}
  </div>`;
}
function addLink() {
  openForm('링크 추가', [
    { key: 'group', label: '분류', type: 'select', options: ['대입', '진로', '고입', '학습', '기타'], default: '기타' },
    { key: 'title', label: '이름', required: true },
    { key: 'url', label: 'URL', required: true },
    { key: 'note', label: '메모' },
  ], null, out => { state.links.push({ id: uid(), ...out, official: false }); });
}
function delLink(id) {
  state.links = state.links.filter(l => l.id !== id);
  saveState(); render();
}

// ── 설정 ──────────────────────────────────────────────────
function renderSettings() {
  return `
  <div class="card"><h2>👥 자녀 관리</h2>
    ${state.children.map(c => `
      <div class="item-row"><div class="item-main">
        <div class="item-title">${esc(c.name)} — ${gradeName(c.gradeIdx)} (${admissionYear(c)}학년도 대입)</div>
      </div>
      <button class="btn small ghost" onclick="editChild('${c.id}')">수정</button></div>`).join('')}
    <p class="sub" style="margin-top:8px">학년은 매년 3월에 자동으로 올라갑니다.</p>
  </div>

  <div class="card"><h2>💾 백업</h2>
    <p class="sub">모든 데이터는 이 기기 브라우저에만 저장됩니다. 월 1회 내보내기를 권장합니다. 백업 파일에는 자녀 기록이 포함되므로 외부 서비스·AI에 업로드하지 마세요.</p>
    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
      <button class="btn" onclick="exportData()">JSON 내보내기</button>
      <button class="btn ghost" onclick="document.getElementById('importFile').click()">가져오기</button>
      <button class="btn danger" onclick="resetData()">전체 초기화</button>
    </div>
    <input type="file" id="importFile" accept=".json" style="display:none" onchange="importData(event)">
  </div>

  <div class="card"><h2>ℹ️ 설계 원칙</h2>
    <ul>
      <li>진로 가설 변경은 실패가 아니라 탐색의 기록</li>
      <li>사실(공식 발표) / 해석(부모 판단) / 가설(전략)을 구분해 기록</li>
      <li>합불 확률 숫자 대신 충족/미충족/확인 필요</li>
      <li>지원 결정 전 대학 입학처 원문 재확인 필수</li>
      <li>자녀의 기록은 자녀와 함께 — 감시 도구가 아니라 대화 도구</li>
    </ul>
  </div>`;
}
function editChild(id) {
  const c = state.children.find(x => x.id === id);
  openForm('자녀 정보 수정', [
    { key: 'name', label: '이름/호칭', required: true },
    { key: 'grade', label: '학년', type: 'select', options: GRADE_NAMES.slice(1), default: gradeName(c.gradeIdx) },
  ], { name: c.name, grade: gradeName(c.gradeIdx) }, out => {
    c.name = out.name;
    c.gradeIdx = GRADE_NAMES.indexOf(out.grade);
  });
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `edu-pipeline-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s.children || !s.career) throw new Error('형식 불일치');
      if (!confirm('현재 데이터를 백업 파일로 덮어씁니다. 계속할까요?')) return;
      state = s;
      advanceGrades(state);
      saveState(); render();
      alert('가져오기 완료');
    } catch (e) { alert('백업 파일을 읽을 수 없습니다: ' + e.message); }
  };
  reader.readAsText(file);
  ev.target.value = '';
}
function resetData() {
  if (!confirm('모든 데이터를 삭제하고 초기 상태로 돌립니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  if (!confirm('정말입니까? 내보내기 백업을 먼저 권장합니다.')) return;
  state = defaultState();
  saveState(); render();
}

// ── 렌더 ──────────────────────────────────────────────────
const RENDERERS = {
  home: renderHome, career: renderCareer, records: renderRecords,
  roadmap: renderRoadmap, admission: renderAdmission, library: renderLibrary, settings: renderSettings,
};
function render() {
  renderChildTabs();
  document.getElementById('content').innerHTML = RENDERERS[currentTab]();
}

// PWA
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
