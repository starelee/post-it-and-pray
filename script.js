(function () {
  const STORAGE_KEY = 'postit-todo-boards-v1';
  const OLD_STORAGE_KEY = 'postit-todo-tasks-v1';
  const THEME_KEY = 'postit-theme';
  const SUPABASE_URL = 'https://ytnlgabrbrddfpjzzrrn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0bmxnYWJyYnJkZGZwanp6cnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzY1NzEsImV4cCI6MjEwNTExMjU3MX0.3H3oSigr6E649McUa8HFf9JYDbM1qIdZQGlJw6-WGro';
  const REORDER_DELAY = 300;
  // 포커스 모드에서 "완료로 표시"를 눌렀을 때 뜨는 위글+빵빠레 축하
  // 애니메이션 길이 — style.css의 celebrate-burst-* 지속 시간(0.95s, 가장
  // 오래 걸리는 애니메이션)과 맞춰둠.
  const FOCUS_CELEBRATE_MS = 950;
  // 타이머 종이색이 빨갛게 변하기 시작하는 남은 시간(초).
  const FOCUS_URGENT_SEC = 60;
  const FOCUS_SHAKE_SEC = 10;
  const BOARD_IDS = ['today', 'waiting', 'someday', 'scheduled'];
  // Boards a task can be manually moved between with the move buttons.
  const MOVE_TARGET_IDS = ['today', 'waiting', 'someday'];
  // Boards that support a date (calendar icon). On today/someday, assigning
  // a date moves the task into `scheduled`; on `waiting` it only sets the
  // separate `replyDate` field and the task stays in waiting.
  const DATE_ENABLED_IDS = ['today', 'someday', 'waiting'];
  // waiting의 "회신 예정일"은 scheduled 전용 dueDate와 분리된 별도 필드 —
  // dueDate를 재사용하면 migrateArchive/today 렌더가 waiting 항목을 건드림.
  function dateFieldOf(boardId) {
    return boardId === 'waiting' ? 'replyDate' : 'dueDate';
  }
  const EMPTY_HINTS = {
    today: '오늘은 뭘 해볼까?',
    waiting: '기다리는 거 없음',
    someday: '언젠가 해볼까',
    scheduled: '예정된 일 없음',
    lupin: '아무것도 없음... 진짜로 🤫'
  };
  const BOARD_META = {
    today: { emoji: '✿', label: "today's list" },
    waiting: { emoji: '⏳', label: 'waiting...' },
    someday: { emoji: '🌙', label: 'someday...' },
    scheduled: { emoji: '📅', label: 'pray later...' }
  };

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function tomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // 값이 없을 때(아직 날짜를 안 고른 상태) 네이티브 date input이
  // mm/dd/yyyy 같은 자리표시 글자를 자체적으로 그려주지 않는 플랫폼이
  // 있어서(특히 iOS), 빈 칸이 그냥 텅 빈 상자로만 보여 날짜 필드인지도
  // 알아보기 어려웠음 — 우리가 직접 힌트 글자를 그 위에 덧그려서, 값이
  // 없을 땐 항상 "날짜 선택"이 보이고 값이 생기면 실제 값이 보이게 함.
  // 힌트는 pointer-events:none이라 탭은 그대로 밑의 input으로 전달됨.
  function wrapDateInputWithHint(dateInput) {
    const wrap = document.createElement('span');
    wrap.className = 'date-input-wrap';
    const hint = document.createElement('span');
    hint.className = 'date-input-hint';
    hint.textContent = 'YYYY.MM.DD.';
    hint.setAttribute('aria-hidden', 'true');
    const syncHint = () => { hint.hidden = !!dateInput.value; };
    dateInput.addEventListener('input', syncHint);
    dateInput.addEventListener('change', syncHint);
    syncHint();
    wrap.appendChild(dateInput);
    wrap.appendChild(hint);
    return wrap;
  }

  // 날짜 아이콘/배지를 눌러 날짜 행이 열릴 때 네이티브 달력까지 바로 띄움.
  // showPicker가 없거나(구형 브라우저) 사용자 동작 밖이라 거부되면 포커스만.
  function focusAndShowPicker(dateInput) {
    dateInput.focus();
    try {
      if (typeof dateInput.showPicker === 'function') dateInput.showPicker();
    } catch (e) {
      /* 포커스만으로 충분 */
    }
  }

  const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  // pray later 카드/리갈패드 "다가오는 일" 사이의 7일 경계를 실시간으로
  // 가르는 데 씀 — 저장 시점 플래그가 아니라 매 렌더링마다 오늘 날짜
  // 기준으로 다시 계산하므로, 하루 지나면 D+8이 자동으로 D+7이 되어
  // 경계를 넘어감.
  function daysUntilDue(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  function formatDueDateRelative(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.round((d - today) / 86400000);
      if (diffDays === 0) return '오늘';
      if (diffDays === 1) return '내일';
      if (diffDays === -1) return '어제';
      const sameMonth = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
      if (sameMonth) return d.getDate() + WEEKDAY_KO[d.getDay()];
      return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    } catch (e) {
      return dateStr;
    }
  }

  const dateEl = document.getElementById('dateText');
  const counterEl = document.getElementById('taskCounter');

  function setDate() {
    try {
      const d = new Date();
      const formatted = d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      dateEl.textContent = formatted;
    } catch (e) {
      dateEl.textContent = '';
    }
  }
  setDate();

  const themeToggleEl = document.getElementById('themeToggle');

  function effectiveTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (themeToggleEl) {
      themeToggleEl.textContent = effectiveTheme() === 'dark' ? '🌙 다크' : '☀️ 라이트';
    }
  }

  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem(THEME_KEY);
  } catch (e) {
    /* ignore */
  }
  applyTheme(storedTheme);

  if (themeToggleEl) {
    themeToggleEl.addEventListener('click', () => {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* ignore */
      }
      applyTheme(next);
    });
  }

  // Two flag buttons exist (one stuck to the today card, one to waiting) —
  // only one is visible at a time per the mobile/desktop media query, both
  // drive the same panel.
  const archiveFlagBtns = document.querySelectorAll('.archive-flag');
  const archivePanelEl = document.getElementById('archivePanel');
  const archiveGroupsEl = document.getElementById('archiveGroups');
  const archiveUpcomingEl = document.getElementById('archiveUpcoming');
  const archiveTrashEl = document.getElementById('archiveTrash');
  const upcomingFrontEl = archivePanelEl.querySelector('[data-upcoming-front]');
  const upcomingBackEl = archivePanelEl.querySelector('[data-upcoming-back]');
  const trashToggleBtn = document.getElementById('trashToggleBtn');
  const trashToggleBackBtn = document.getElementById('trashToggleBackBtn');

  function toggleArchivePanel() {
    const open = !archivePanelEl.classList.contains('open');
    archivePanelEl.classList.toggle('open', open);
    if (open) {
      closeSearchPanel(); // 두 리갈패드는 같은 자리를 덮으니 한쪽을 열면 다른 쪽은 닫음
      renderArchive();
      renderUpcoming();
    } else {
      setTrashViewOpen(false);
    }
  }
  archiveFlagBtns.forEach(btn => btn.addEventListener('click', toggleArchivePanel));

  function closeArchivePanel() {
    archivePanelEl.classList.remove('open');
    setTrashViewOpen(false);
  }

  const archiveCloseBtn = document.getElementById('archiveCloseBtn');
  if (archiveCloseBtn) archiveCloseBtn.addEventListener('click', closeArchivePanel);

  // Esc — 입력 중이 아니고 확인 모달도 안 떠 있을 때만 done 리갈패드 닫기.
  // (입력칸/모달의 Esc는 각자 먼저 처리하므로 건드리지 않음.)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!archivePanelEl.classList.contains('open')) return;
    const modal = document.getElementById('confirmModal');
    if (modal && !modal.hidden) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
    e.preventDefault();
    closeArchivePanel();
  });

  // ─────────────────────────────
  // 검색 — done 리갈패드와 같은 모양의 패드. 열려 있는 항목(gotta do/waiting/
  // someday/pray later)과 done 기록의 제목·하위 항목·메모에서 찾음.
  // lupin(월급루팡)과 gone(삭제 기록)은 일부러 검색 대상에서 뺌.
  // 읽기 전용이라 데이터는 건드리지 않고, 결과를 누르면 메모 모달(읽기 모드)이 뜸.
  // ─────────────────────────────
  const searchPanelEl = document.getElementById('searchPanel');
  const searchInputEl = document.getElementById('searchInput');
  const searchResultsEl = document.getElementById('searchResults');
  const searchFlagBtns = document.querySelectorAll('.search-flag');
  const searchCloseBtn = document.getElementById('searchCloseBtn');
  const SEARCH_GROUP_LIMIT = 20;

  function isConfirmModalOpen() {
    const modal = document.getElementById('confirmModal');
    return !!modal && !modal.hidden;
  }

  function openSearchPanel() {
    if (isFocusLocked() || isConfirmModalOpen()) return;
    if (archivePanelEl.classList.contains('open')) closeArchivePanel();
    searchPanelEl.classList.add('open');
    renderSearchResults();
    // 패널이 접힌 상태에서 막 펼쳐지는 중이라 한 프레임 뒤에 포커스
    requestAnimationFrame(() => {
      searchInputEl.focus({ preventScroll: true });
      searchInputEl.select();
    });
  }

  function closeSearchPanel() {
    if (!searchPanelEl.classList.contains('open')) return;
    searchPanelEl.classList.remove('open');
    // 다시 열었을 때 지난 검색어/결과가 남아 있으면 헷갈리니 초기화
    searchInputEl.value = '';
    searchInputEl.blur();
    clearEl(searchResultsEl);
  }

  searchFlagBtns.forEach(btn => btn.addEventListener('click', () => {
    if (searchPanelEl.classList.contains('open')) closeSearchPanel();
    else openSearchPanel();
  }));
  if (searchCloseBtn) searchCloseBtn.addEventListener('click', closeSearchPanel);
  searchInputEl.addEventListener('input', renderSearchResults);
  searchInputEl.addEventListener('keydown', (e) => {
    // Enter — 첫 결과를 바로 열기
    if (e.key === 'Enter' && !e.isComposing) {
      const first = searchResultsEl.querySelector('.search-item');
      if (first) { e.preventDefault(); first.click(); }
    }
  });

  // Esc — 메모 모달이 떠 있으면 그쪽이 먼저(캡처 단계에서 처리) 닫히고,
  // 모달이 없을 때만 검색 패드를 닫음. 입력칸에 포커스가 있어도 닫힘.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!searchPanelEl.classList.contains('open') || isConfirmModalOpen()) return;
    e.preventDefault();
    closeSearchPanel();
  });

  // Ctrl+K / Cmd+K — 입력창에 포커스가 있어도 열림(브라우저 기본 동작은 막음).
  // 물리 키(e.code) 기준이라 한글 자판에서도 동작.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== 'KeyK') return;
    e.preventDefault();
    openSearchPanel();
  });

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function searchTokens(query) {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
  }

  // 검색어를 전부 포함하면(제목·하위 항목·메모 어디에 흩어져 있어도) 결과.
  // 어디서 걸렸는지(하위 항목/메모)도 함께 돌려줘서 한 줄 미리보기에 씀.
  function matchSearchTask(task, tokens) {
    const subs = task.subtasks || [];
    const hay = [task.text || ''].concat(subs.map(s => s.text || ''), task.note || '').join('\n').toLowerCase();
    if (!tokens.every(t => hay.includes(t))) return null;
    const hasAny = (txt) => { const l = (txt || '').toLowerCase(); return tokens.some(t => l.includes(t)); };
    return {
      sub: subs.find(s => hasAny(s.text)) || null,
      note: hasAny(task.note) ? task.note : null
    };
  }

  function appendHighlighted(el, text, tokens) {
    const re = new RegExp('(' + tokens.slice().sort((a, b) => b.length - a.length).map(escapeRegExp).join('|') + ')', 'gi');
    text.split(re).forEach((part, i) => {
      if (!part) return;
      if (i % 2 === 1) {
        const mark = document.createElement('mark');
        mark.className = 'search-mark';
        mark.textContent = part;
        el.appendChild(mark);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  // 메모처럼 긴 글은 걸린 곳 주변만 잘라서 보여줌
  function makeSearchSnippet(text, tokens) {
    const flat = text.replace(/\s+/g, ' ');
    const lower = flat.toLowerCase();
    let idx = -1;
    tokens.forEach(t => {
      const i = lower.indexOf(t);
      if (i !== -1 && (idx === -1 || i < idx)) idx = i;
    });
    const start = Math.max(0, idx - 12);
    const end = start + 60;
    return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
  }

  function collectSearchGroups(tokens) {
    const wrap = (list, boardId) => list.map(task => ({ task, boardId }));
    const doneEntries = collectArchiveEntries().sort((a, b) => {
      if (a.task.doneAt !== b.task.doneAt) return (b.task.doneAt || '').localeCompare(a.task.doneAt || '');
      return b.task.id - a.task.id;
    }).map(e => ({ task: e.task, boardId: e.source }));
    // 오늘 체크한 항목은 아직 today/scheduled 배열에 있어도 done 쪽에서만 보여줌(중복 방지)
    const groups = [
      { key: 'today', label: 'gotta do', entries: wrap(boards.today.filter(t => !t.done), 'today') },
      { key: 'waiting', label: 'waiting', entries: wrap(boards.waiting, 'waiting') },
      { key: 'someday', label: 'someday', entries: wrap(boards.someday.filter(t => !t.done), 'someday') },
      { key: 'scheduled', label: 'pray later', entries: wrap(boards.scheduled.filter(t => !t.done), 'scheduled') },
      { key: 'done', label: 'done', entries: doneEntries }
    ];
    groups.forEach(g => {
      g.hits = g.entries
        .map(e => ({ task: e.task, boardId: e.boardId, match: matchSearchTask(e.task, tokens) }))
        .filter(h => h.match);
    });
    return groups.filter(g => g.hits.length);
  }

  // 카드 제목에 붙은 그 아이콘(✿ gotta do, ⏳ waiting, 🌙 someday, 📅 pray later)과
  // 같은 기호 — done 기록은 done 패널 제목의 📋. 항목이 어느 보드 것인지 알려줌.
  const BOARD_ICONS = { today: '✿', waiting: '⏳', someday: '🌙', scheduled: '📅', archive: '📋', done: '📋' };

  function makeBoardIcon(key) {
    const icon = document.createElement('span');
    icon.className = 'search-icon' + (key === 'today' ? ' search-icon-flower' : '');
    icon.textContent = BOARD_ICONS[key] || '';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function makeSearchChip(text) {
    const chip = document.createElement('span');
    chip.className = 'search-chip';
    chip.textContent = text;
    return chip;
  }

  function renderSearchItem(groupKey, hit, tokens) {
    const task = hit.task;
    const li = document.createElement('li');
    li.className = 'search-item' + (groupKey === 'done' ? ' search-item-done' : '');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');

    const row = document.createElement('div');
    row.className = 'search-item-row';
    row.appendChild(makeBoardIcon(groupKey));
    const title = document.createElement('span');
    title.className = 'search-item-text';
    appendHighlighted(title, task.text || '', tokens);
    row.appendChild(title);
    const dateKey = dateFieldOf(hit.boardId);
    if (groupKey === 'done') {
      if (task.doneAt) row.appendChild(makeSearchChip(task.doneAt.slice(5).replace('-', '/')));
    } else if (task[dateKey]) {
      row.appendChild(makeSearchChip(formatDueDateRelative(task[dateKey])));
    }
    if (task.note) row.appendChild(makeSearchChip('메모'));
    li.appendChild(row);

    const addSnippet = (label, text) => {
      const line = document.createElement('div');
      line.className = 'search-snippet';
      line.appendChild(document.createTextNode(label));
      appendHighlighted(line, text, tokens);
      li.appendChild(line);
    };
    if (hit.match.sub) addSnippet('하위: ', hit.match.sub.text);
    if (hit.match.note) addSnippet('메모: ', makeSearchSnippet(hit.match.note, tokens));

    const open = () => openNoteModal(hit.boardId, task.id, { anchorEl: li, view: true });
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return li;
  }

  // ─────────────────────────────
  // 백업 / 복구 — 전체 데이터(boards)를 JSON 파일로 내려받고, 그 파일로 되돌림.
  // 파일 모양: { app, version, exportedAt, boards }. boards는 localStorage/클라우드에
  // 저장되는 것과 같은 shape(월급루팡·삭제 기록 포함)이라 완전한 백업이 됨.
  // 복구는 "통째로 바꾸기"만 — saveBoards()를 거치므로 Ctrl+Z로 되돌릴 수 있고,
  // 로그인 상태면 평소 저장처럼 클라우드에도 반영됨.
  // ─────────────────────────────
  const BACKUP_APP = 'post-it-and-pray';
  const BACKUP_VERSION = 1;
  const backupBtn = document.getElementById('backupBtn');
  if (backupBtn) backupBtn.addEventListener('click', openBackupModal);

  function downloadBackup() {
    const payload = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), boards };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'postit-backup-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('백업 파일을 내려받았어요');
  }

  // 백업 파일 내용을 검사해 정리된 boards를 돌려줌. 앱이 쓰는 필드만 남기는
  // normalizeBoards를 거치므로 알 수 없는 값은 걸러짐. 형식이 아니면 reason.
  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { reason: 'JSON 파일이 아니에요' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { reason: '이 앱의 백업 파일이 아니에요' };
    if (data.app && data.app !== BACKUP_APP) return { reason: '이 앱의 백업 파일이 아니에요' };
    if (typeof data.version === 'number' && data.version > BACKUP_VERSION) return { reason: '더 새로운 버전의 백업 파일이에요' };
    // 래퍼({app, boards}) 없이 boards 객체만 있는 파일도 받아줌
    const raw = data.boards && typeof data.boards === 'object' ? data.boards : data;
    const known = BOARD_IDS.concat(['archive', 'lupin', 'trash']);
    if (!known.some(id => Array.isArray(raw[id]))) return { reason: '이 앱의 백업 파일이 아니에요' };
    return { boards: normalizeBoards(raw) };
  }

  function summarizeBoards(b) {
    return 'gotta do ' + b.today.length + ' · waiting ' + b.waiting.length + ' · someday ' + b.someday.length +
      ' · pray later ' + b.scheduled.length + ' · done ' + b.archive.length;
  }

  async function restoreFromFile(file) {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      showToast('파일을 읽지 못했어요');
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.boards) {
      showToast(parsed.reason);
      return;
    }
    const ok = await showConfirm({
      title: '이 백업으로 복구할까요?',
      message: summarizeBoards(parsed.boards) + '\n\n지금 데이터는 이 파일의 내용으로 바뀌어요.\n(Ctrl+Z로 되돌릴 수 있어요)',
      confirmLabel: '복구',
      cancelLabel: '취소'
    });
    if (!ok) return;
    boards = parsed.boards;
    saveBoards(); // 되돌리기 기록 + localStorage + (로그인 시) 클라우드
    closeArchivePanel();
    closeSearchPanel();
    renderAll();
    showToast('복구했어요 (Ctrl+Z로 되돌릴 수 있어요)');
  }

  async function openBackupModal() {
    if (isFocusLocked() || isConfirmModalOpen()) return;
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');

    const card = document.createElement('div');
    card.className = 'backup-card';
    const hint = document.createElement('p');
    hint.className = 'backup-hint';
    hint.textContent = '지금까지 쌓인 모든 데이터를 파일(JSON)로 저장하거나, 저장해 둔 파일로 되돌려요. 숨겨 둔 보드와 삭제 기록까지 전부 들어가요.';
    const summary = document.createElement('p');
    summary.className = 'backup-summary';
    summary.textContent = '지금 데이터: ' + summarizeBoards(boards);
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'confirm-btn backup-restore-btn';
    restoreBtn.textContent = '복구하기 (파일 고르기)';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.hidden = true;
    let pickedFile = null;
    restoreBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      pickedFile = fileInput.files && fileInput.files[0];
      if (pickedFile) cancelBtn.click(); // 이 모달을 닫고 아래에서 복구 확인 모달로 넘어감
    });
    card.appendChild(hint);
    card.appendChild(summary);
    card.appendChild(restoreBtn);
    card.appendChild(fileInput);

    const exportRequested = await showConfirm({
      title: '백업 / 복구',
      content: card,
      confirmLabel: '내보내기',
      cancelLabel: '닫기'
    });
    if (exportRequested) downloadBackup();
    else if (pickedFile) await restoreFromFile(pickedFile);
  }

  // ─────────────────────────────
  // 검색어가 없을 때의 제안 — 세 섹션, 각각 최대 4개(넘는 건 그냥 안 보여줌).
  //  · 챙길 것: 기한/회신 예정일이 오늘이거나 지남, 하위 항목이 거의 끝남.
  //    이유를 태그로 달아 한 줄로 합침(지난 것 → 오늘 → 마무리만 남은 것 순).
  //  · 오래 묵은 것: someday/waiting 중 2주 넘게 손 안 댄 것.
  //  · 최근 완료: 최근 3일 안에 끝낸 것.
  // 한 항목은 위 섹션에만 나옴. lupin/gone은 여기서도 제외.
  // ─────────────────────────────
  const SUGGEST_LIMIT = 4;
  const STALE_DAYS = 14;
  const RECENT_DONE_DAYS = 3;

  // 며칠째인지 정확한 숫자 대신 단계로 보여줌(19일/20일은 의미 있는 차이가 아니라서).
  // 60일 넘으면 전부 '두 달째'.
  function staleLabel(days) {
    if (days >= 60) return '두 달째';
    if (days >= 30) return '한 달째';
    return '2주째';
  }

  function suggestChecklistTags(task) {
    const subs = task.subtasks || [];
    const open = subs.filter(s => !s.done).length;
    if (subs.length >= 1 && open === 0) return ['하위 다 끝남'];
    if (subs.length >= 2 && open === 1) return ['하위 1개 남음'];
    return [];
  }

  function collectSuggestions() {
    const today = todayStr();
    const seen = new Set();

    // 1) 챙길 것
    const watch = [];
    const consider = (task, boardId) => {
      const tags = [];
      let overdue = 0;
      let isToday = false;
      const dateKey = boardId === 'waiting' ? 'replyDate' : 'dueDate';
      const label = boardId === 'waiting' ? '회신' : '마감';
      if (task[dateKey]) {
        const past = -daysUntilDue(task[dateKey]);
        if (past > 0) { tags.push(label + ' ' + past + '일 지남'); overdue = past; }
        else if (past === 0) { tags.push('오늘 ' + label); isToday = true; }
      }
      suggestChecklistTags(task).forEach(t => tags.push(t));
      if (!tags.length) return;
      watch.push({ task, boardId, tags, rank: overdue ? 0 : (isToday ? 1 : 2), overdue });
    };
    boards.today.filter(t => !t.done).forEach(t => consider(t, 'today'));
    boards.waiting.forEach(t => consider(t, 'waiting'));
    boards.someday.filter(t => !t.done).forEach(t => consider(t, 'someday'));
    boards.scheduled.filter(t => !t.done).forEach(t => consider(t, 'scheduled'));
    watch.sort((a, b) => a.rank - b.rank || b.overdue - a.overdue || b.tags.length - a.tags.length);
    const watchTop = watch.slice(0, SUGGEST_LIMIT);
    watch.forEach(w => seen.add(w.task.id)); // 4개를 넘겨 안 보이는 것도 다른 섹션에 중복해 올리지 않음

    // 2) 오래 묵은 것 — 마지막으로 손댄 시각(없으면 만든 시각=id)이 2주 넘은 someday/waiting
    const stale = [];
    const considerStale = (task, boardId) => {
      if (seen.has(task.id)) return;
      if (boardId === 'waiting' && task.replyDate && task.replyDate > today) return; // 일부러 미뤄 둔 것
      const touched = task.updatedAt || (task.id > 1e12 ? task.id : 0);
      if (!touched) return;
      const days = Math.floor((Date.now() - touched) / 86400000);
      if (days >= STALE_DAYS) stale.push({ task, boardId, tags: [staleLabel(days)], days });
    };
    boards.someday.filter(t => !t.done).forEach(t => considerStale(t, 'someday'));
    boards.waiting.forEach(t => considerStale(t, 'waiting'));
    stale.sort((a, b) => b.days - a.days);
    const staleTop = stale.slice(0, SUGGEST_LIMIT);

    // 3) 최근 완료 — 최근 3일(오늘 포함) 안에 끝낸 것
    const recent = collectArchiveEntries()
      .filter(e => e.task.doneAt && -daysUntilDue(e.task.doneAt) < RECENT_DONE_DAYS)
      .sort((a, b) => {
        if (a.task.doneAt !== b.task.doneAt) return b.task.doneAt.localeCompare(a.task.doneAt);
        return b.task.id - a.task.id;
      })
      .slice(0, SUGGEST_LIMIT)
      .map(e => ({ task: e.task, boardId: e.source, tags: [e.task.doneAt.slice(5).replace('-', '/')], done: true }));

    return [
      { label: '챙길 것', items: watchTop },
      { label: '오래 묵은 것', items: staleTop },
      { label: '최근 완료', items: recent }
    ].filter(sec => sec.items.length);
  }

  function renderSuggestionItem(item) {
    const task = item.task;
    const li = document.createElement('li');
    li.className = 'search-item' + (item.done ? ' search-item-done' : '');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    const row = document.createElement('div');
    row.className = 'search-item-row';
    row.appendChild(makeBoardIcon(item.done ? 'done' : item.boardId));
    const title = document.createElement('span');
    title.className = 'search-item-text';
    title.textContent = task.text || '';
    row.appendChild(title);
    item.tags.forEach(tag => {
      const chip = makeSearchChip(tag);
      if (/지남/.test(tag)) chip.classList.add('search-chip-alert');
      row.appendChild(chip);
    });
    if (task.note) row.appendChild(makeSearchChip('메모'));
    li.appendChild(row);
    const open = () => openNoteModal(item.boardId, task.id, { anchorEl: li, view: true });
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return li;
  }

  function renderSearchSuggestions() {
    const sections = collectSuggestions();
    if (sections.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = '지금 챙길 게 없어요';
      searchResultsEl.appendChild(hint);
      return;
    }
    sections.forEach(sec => {
      const heading = document.createElement('h3');
      heading.className = 'search-group-title';
      heading.textContent = sec.label;
      searchResultsEl.appendChild(heading);
      const list = document.createElement('ul');
      list.className = 'search-list';
      sec.items.forEach(item => list.appendChild(renderSuggestionItem(item)));
      searchResultsEl.appendChild(list);
    });
  }

  function renderSearchResults() {
    clearEl(searchResultsEl);
    const addHint = (text) => {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = text;
      searchResultsEl.appendChild(hint);
    };
    const query = searchInputEl.value.trim();
    if (!query) {
      renderSearchSuggestions();
      return;
    }
    const tokens = searchTokens(query);
    const groups = collectSearchGroups(tokens);
    if (groups.length === 0) {
      addHint('찾는 게 없어요');
      return;
    }
    groups.forEach(group => {
      const heading = document.createElement('h3');
      heading.className = 'search-group-title';
      heading.textContent = group.label + ' (' + group.hits.length + ')';
      searchResultsEl.appendChild(heading);
      const list = document.createElement('ul');
      list.className = 'search-list';
      group.hits.slice(0, SEARCH_GROUP_LIMIT).forEach(hit => list.appendChild(renderSearchItem(group.key, hit, tokens)));
      if (group.hits.length > SEARCH_GROUP_LIMIT) {
        const more = document.createElement('li');
        more.className = 'search-more';
        more.textContent = '…외 ' + (group.hits.length - SEARCH_GROUP_LIMIT) + '개 — 검색어를 더 구체적으로 써보세요';
        list.appendChild(more);
      }
      searchResultsEl.appendChild(list);
    });
  }

  // "not my problem... yet" 자리가 Ctrl+Z(휴지통)로 통째로 바뀌는 lupin
  // 모드 방식 — 목록 아래에 덧붙이지 않고 같은 자리를 갈아끼움. lupin처럼
  // 계속 열어둔 채 잊어버리지 않도록 3분 뒤 자동으로 되돌리고, done
  // 리갈패드를 닫았다 다시 열면 항상 "not my problem"부터 다시 보여줌.
  const TRASH_VIEW_TIMEOUT_MS = 3 * 60 * 1000;
  let trashViewOpen = false;
  let trashViewTimer = null;

  function setTrashViewOpen(open) {
    if (!upcomingFrontEl || !upcomingBackEl) return;
    trashViewOpen = open;
    upcomingFrontEl.hidden = open;
    upcomingBackEl.hidden = !open;
    clearTimeout(trashViewTimer);
    if (open) {
      renderTrash();
      trashViewTimer = setTimeout(() => setTrashViewOpen(false), TRASH_VIEW_TIMEOUT_MS);
    }
  }

  if (trashToggleBtn) trashToggleBtn.addEventListener('click', () => setTrashViewOpen(true));
  if (trashToggleBackBtn) trashToggleBackBtn.addEventListener('click', () => setTrashViewOpen(false));

  function updateCounter() {
    const today = todayStr();
    const tasks = boards.today.concat(
      boards.scheduled.filter(t => t.dueDate <= today)
    );
    let done = 0;
    let praying = 0;
    tasks.forEach(task => {
      if (task.done) done++; else praying++;
      task.subtasks.forEach(sub => {
        if (sub.done) done++; else praying++;
      });
    });
    // waiting은 항목 자체는 "완료" 개념이 없어(체크 없이 ←로만 돌아감) 여기
    // 세지 않지만, 그 안의 하위 항목은 실제로 끝낸 일이니 카운터엔 포함함
    // — 그렇다고 waiting 항목이 done 보관함(리갈패드)으로 넘어가진 않음.
    boards.waiting.forEach(task => {
      task.subtasks.forEach(sub => {
        if (sub.done) done++; else praying++;
      });
    });
    counterEl.textContent = done + ' done · ' + praying + ' praying';
  }

  function seedToday() {
    return [
      { id: 1, text: '빨래 돌리기', done: false, urgent: false, subtasks: [] },
      { id: 2, text: '메일 보내기', done: true, urgent: false, subtasks: [] },
      { id: 3, text: '산책', done: false, urgent: false, subtasks: [] },
      { id: 4, text: '뭐라도 읽기', done: false, urgent: false, subtasks: [] }
    ];
  }

  function loadBoards() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* fall through */
    }
    try {
      const old = localStorage.getItem(OLD_STORAGE_KEY);
      if (old) return { today: JSON.parse(old), waiting: [], someday: [] };
    } catch (e) {
      /* fall through to seed data */
    }
    return { today: seedToday(), waiting: [], someday: [] };
  }

  // 메모(task.note) 최대 글자 수
  const NOTE_MAX = 500;

  function normalizeTasks(list) {
    return list.map(t => {
      const out = {
        id: t.id,
        text: t.text,
        done: !!t.done,
        urgent: !!t.urgent,
        subtasks: Array.isArray(t.subtasks)
          ? t.subtasks.map(s => ({ id: s.id, text: s.text, done: !!s.done }))
          : []
      };
      if (typeof t.dueDate === 'string' && t.dueDate) out.dueDate = t.dueDate;
      if (typeof t.replyDate === 'string' && t.replyDate) out.replyDate = t.replyDate;
      if (typeof t.note === 'string' && t.note.trim()) out.note = t.note.slice(0, NOTE_MAX);
      if (typeof t.from === 'string' && t.from) out.from = t.from;
      if (typeof t.deletedAt === 'string' && t.deletedAt) out.deletedAt = t.deletedAt;
      if (typeof t.updatedAt === 'number' && isFinite(t.updatedAt)) out.updatedAt = t.updatedAt;
      if (out.done) {
        // Legacy done tasks from before doneAt existed get today's grace
        // period instead of being permanently excluded from the sweep.
        out.doneAt = (typeof t.doneAt === 'string' && t.doneAt) ? t.doneAt : todayStr();
      }
      return out;
    });
  }

  function normalizeBoards(data) {
    const result = {};
    BOARD_IDS.forEach(id => {
      result[id] = normalizeTasks(Array.isArray(data[id]) ? data[id] : []);
    });
    result.archive = normalizeTasks(Array.isArray(data.archive) ? data.archive : []);
    // lupin은 다른 보드로 옮겨지지도, done 아카이브로 넘어가지도 않는
    // 별도 은닉 보드라 BOARD_IDS/migrateArchive 양쪽 모두에서 의도적으로 제외.
    result.lupin = normalizeTasks(Array.isArray(data.lupin) ? data.lupin : []);
    result.trash = normalizeTasks(Array.isArray(data.trash) ? data.trash : []);
    migrateArchive(result);
    return result;
  }

  // Sweeps any task that's done and past its same-day grace period into
  // boards.archive. Runs on every normalizeBoards call (initial load and
  // cloud sync), so it covers both "opened the next day" and "another
  // device synced in later" without a separate boot-time call site.
  function migrateArchive(b) {
    const today = todayStr();
    function archiveOut(boardId, predicate) {
      const keep = [];
      b[boardId].forEach(t => {
        if (t.done && predicate(t)) {
          t.from = boardId;
          b.archive.push(t);
        } else {
          keep.push(t);
        }
      });
      b[boardId] = keep;
    }
    archiveOut('today', t => t.doneAt !== today);
    archiveOut('scheduled', t => t.dueDate !== today || t.doneAt !== today);
    archiveOut('someday', () => true);
    b.waiting.forEach(t => {
      t.done = false;
      delete t.doneAt;
    });
    // replyDate는 waiting 전용 — 다른 기기에서 병합돼 들어온 잔여값 정리.
    // (waiting 배열 자체는 날짜가 지나도 옮기지 않음: 아래 sweep은 today/
    // scheduled/someday의 done 항목만 다룸.)
    ['today', 'scheduled', 'someday'].forEach(id => {
      b[id].forEach(t => { delete t.replyDate; });
    });
    // 휴지통은 3일이 지나면 완전히 사라짐 — 매 normalizeBoards마다
    // (초기 로드/클라우드 동기화 모두) 다시 걸러내므로 하루 지나 기한을
    // 넘기면 다음 렌더링에서 자연스럽게 빠짐.
    b.trash = (b.trash || []).filter(t => -daysUntilDue(t.deletedAt) <= 3);
    // lupin은 다른 보드처럼 archive로 넘어가는 대신, 오늘 이전에 체크한
    // 항목은 완전히 삭제됨 — 숨겨진 개인 메모라 지난 완료 기록을 쌓아두지
    // 않고 매일 조용히 비워짐.
    b.lupin = (b.lupin || []).filter(t => !(t.done && t.doneAt !== today));
  }

  // Bumped on every local edit so an in-flight cloud fetch (see syncRow)
  // can tell whether the user changed something while it was loading and
  // back off instead of clobbering that edit with stale server data.
  let localVersion = 0;

  function saveBoards() {
    localVersion++;
    stampChangedTasks();
    recordHistory();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
    } catch (e) {
      /* storage unavailable — state just won't persist */
    }
    // Guests (activeRowId === null) stay local-only — no cloud write at all.
    if (activeRowId) pushToCloud();
  }

  let cloudClient = null;
  try {
    if (window.supabase) {
      cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch (e) {
    /* cloud sync unavailable — app still works from localStorage */
  }

  // null = guest, local-only. A real value = signed-in user id, synced to
  // that user's own cloud row.
  let activeRowId = null;

  // The updated_at this client last actually saw on the server (from a pull
  // or from its own last successful push). A plain upsert here would let a
  // stale tab/device — one that hasn't picked up a completion made
  // elsewhere yet — silently overwrite the whole row and resurrect
  // "already done" tasks. Instead every push is conditioned on this value:
  // if the row moved since we last saw it, someone else wrote in between,
  // so we pull their version, merge it forward, and retry.
  let lastKnownServerUpdatedAt = null;

  // Merges a server snapshot with the local one after a lost write. This is
  // NOT a full CRDT merge, just enough to stop the specific failure above:
  // each task id resolves to whichever side was changed more recently
  // (updatedAt); when that's missing or equal, to whichever side shows more
  // progress — archived > done-in-place > still-active — so a stale "not
  // done yet" copy can never erase a real completion, and brand-new tasks added
  // independently on either side survive (union by id). A task deleted on
  // one side while left untouched on the other will resurrect, since
  // neither side carries a tombstone — a real gap, just a much smaller one
  // than clobbering completions outright.
  function mergeBoards(serverBoards, localBoards) {
    const allBoardIds = BOARD_IDS.concat(['archive', 'lupin', 'trash']);
    const winners = new Map(); // id -> { task, boardId }

    function progress(boardId, task) {
      if (boardId === 'archive') return 2;
      if (task.done) return 1;
      return 0;
    }

    function consider(boardId, task) {
      const cur = winners.get(task.id);
      if (!cur) { winners.set(task.id, { task, boardId }); return; }
      // 양쪽 다 마지막으로 바꾼 시각이 다르면 더 나중에 바꾼 쪽이 이김(되돌린
      // 완료가 다시 완료로 뒤집히지 않도록). 시각이 없거나 같을 때만 아래의
      // 진행도 규칙으로 판단.
      const curT = cur.task.updatedAt || 0;
      const newT = task.updatedAt || 0;
      if (newT !== curT) {
        if (newT > curT) winners.set(task.id, { task, boardId });
        return;
      }
      const curP = progress(cur.boardId, cur.task);
      const newP = progress(boardId, task);
      if (newP > curP || (newP === curP && (task.doneAt || '') > (cur.task.doneAt || ''))) {
        winners.set(task.id, { task, boardId });
      }
    }

    allBoardIds.forEach(boardId => (serverBoards[boardId] || []).forEach(t => consider(boardId, t)));
    allBoardIds.forEach(boardId => (localBoards[boardId] || []).forEach(t => consider(boardId, t)));

    const merged = {};
    allBoardIds.forEach(id => { merged[id] = []; });
    winners.forEach(({ task, boardId }) => merged[boardId].push(task));
    return merged;
  }

  async function pushToCloudNow() {
    if (!cloudClient || !activeRowId) return;
    const newUpdatedAt = new Date().toISOString();
    try {
      const { data, error } = await cloudClient
        .from('postit_data')
        .update({ data: boards, updated_at: newUpdatedAt })
        .eq('id', activeRowId)
        .eq('updated_at', lastKnownServerUpdatedAt)
        .select('updated_at');
      if (error) throw error;
      if (data && data.length > 0) {
        // No one else wrote since we last synced — our write landed clean.
        lastKnownServerUpdatedAt = newUpdatedAt;
        return;
      }
      // Either the row moved (someone else wrote after our last known
      // snapshot) or it doesn't exist yet. Either way, find out which and
      // reconcile instead of blindly upserting over it.
      const { data: current, error: fetchErr } = await cloudClient
        .from('postit_data')
        .select('data, updated_at')
        .eq('id', activeRowId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!current) {
        // Row genuinely doesn't exist yet (first sync for this account) —
        // safe to create it outright.
        await cloudClient.from('postit_data').insert({ id: activeRowId, data: boards, updated_at: newUpdatedAt });
        lastKnownServerUpdatedAt = newUpdatedAt;
        return;
      }
      boards = mergeBoards(normalizeBoards(current.data), boards);
      migrateArchive(boards);
      resetHistory();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
      } catch (e) {
        /* ignore */
      }
      renderAll();
      lastKnownServerUpdatedAt = current.updated_at;
      pushToCloud(); // retry with the merged state, now conditioned on the version we just saw
    } catch (e) {
      /* offline or cloud unavailable — local state is still saved; the
         next successful push will reconcile */
    }
  }

  // Checking off five tasks in a row shouldn't fire five full-document
  // upserts — debounce so a burst of edits (saveBoards is called on every
  // single action) coalesces into one upload of whatever `boards` looks
  // like once things settle, instead of re-sending the whole thing each time.
  const CLOUD_PUSH_DEBOUNCE = 800;
  let cloudPushTimer = null;

  function pushToCloud() {
    if (!cloudClient || !activeRowId) return;
    clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(pushToCloudNow, CLOUD_PUSH_DEBOUNCE);
  }

  // Best-effort flush so closing the tab right after an edit doesn't just
  // drop the still-pending debounced write — no guarantee it completes
  // before the page unloads, but that's strictly better than never sending it.
  window.addEventListener('beforeunload', () => {
    if (cloudPushTimer) {
      clearTimeout(cloudPushTimer);
      cloudPushTimer = null;
      pushToCloudNow();
    }
  });

  // Syncs `boards` with the signed-in user's own cloud row. If that row
  // already exists, it's the source of truth and we pull it down; if it
  // doesn't exist yet (first login), whatever's currently on screen —
  // including pre-login guest data — gets pushed up as the initial migration.
  // 이 기기에서 이 계정과의 최초 병합(로컬 vs 클라우드 확인창)을 이미
  // 끝냈는지 기록 — 없으면 새로고침/재로그인 때마다 activeRowId가
  // 메모리 변수라 초기화되면서 매번 같은 확인창이 또 뜸.
  const SYNCED_USER_KEY = 'postit-synced-user';

  function getSyncedUserId() {
    try {
      return localStorage.getItem(SYNCED_USER_KEY);
    } catch (e) {
      return null;
    }
  }

  function markUserSynced(rowId) {
    try {
      localStorage.setItem(SYNCED_USER_KEY, rowId);
    } catch (e) {
      /* ignore */
    }
  }

  async function syncRow(rowId) {
    if (!cloudClient) return;
    activeRowId = rowId;
    const versionAtStart = localVersion;
    try {
      const { data, error } = await cloudClient
        .from('postit_data')
        .select('data, updated_at')
        .eq('id', rowId)
        .maybeSingle();
      if (error) throw error;
      if (localVersion !== versionAtStart) {
        // The user edited boards locally while this fetch was in flight —
        // that edit is newer, so push it up instead of overwriting it.
        // (pushToCloudNow's own conflict check reconciles against whatever
        // the server actually has, so it's fine that we don't know
        // data.updated_at here.)
        pushToCloud();
        return;
      }
      if (data && data.data) {
        const cloudBoards = normalizeBoards(data.data);
        const hasLocalData = Object.keys(boards).some(id => Array.isArray(boards[id]) && boards[id].length > 0);
        if (hasLocalData && getSyncedUserId() !== rowId) {
          const useCloud = await showConfirm({
            title: '이 계정에 저장된 데이터가 있어요',
            message: '클라우드 데이터를 불러오면 지금 이 기기에만 있던 데이터는 사라져요.\n' +
              '이 기기 데이터를 유지하면 클라우드가 지금 데이터로 덮어써져요.',
            confirmLabel: '클라우드 불러오기',
            cancelLabel: '이 기기 유지'
          });
          markUserSynced(rowId);
          if (!useCloud) {
            lastKnownServerUpdatedAt = data.updated_at; // 로컬을 유지하고 클라우드 쪽을 로컬로 덮어씀
            pushToCloud();
            return;
          }
        } else {
          markUserSynced(rowId);
        }
        boards = cloudBoards;
        resetHistory();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
        } catch (e) {
          /* ignore */
        }
        renderAll();
        lastKnownServerUpdatedAt = data.updated_at;
      } else {
        markUserSynced(rowId);
        lastKnownServerUpdatedAt = null; // row doesn't exist yet — pushToCloudNow will insert it
        pushToCloud();
      }
    } catch (e) {
      /* offline or cloud unavailable — keep using local data */
    }
  }

  const authRowEl = document.getElementById('authRow');

  function renderAuthUI(user) {
    if (!authRowEl) return;
    authRowEl.innerHTML = '';
    if (!cloudClient) return;

    if (user) {
      const span = document.createElement('span');
      span.className = 'auth-user';
      span.textContent = user.email || '로그인됨';

      const btn = document.createElement('button');
      btn.className = 'auth-btn';
      btn.type = 'button';
      btn.textContent = '로그아웃';
      btn.addEventListener('click', () => cloudClient.auth.signOut());

      authRowEl.appendChild(span);
      authRowEl.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'auth-btn auth-btn-primary';
      btn.type = 'button';
      btn.textContent = 'Google로 로그인';
      btn.addEventListener('click', () => {
        cloudClient.auth.signInWithOAuth({
          provider: 'google',
          // Never window.location.href here — if a previous login's
          // #access_token=... hash is still sitting in the address bar
          // (see clearAuthHash below), baking it into this redirect target
          // corrupts the round trip and the next login silently fails.
          options: { redirectTo: window.location.origin + window.location.pathname }
        });
      });

      const hint = document.createElement('span');
      hint.className = 'auth-hint';
      hint.textContent = '게스트 모드 · 이 기기에만 저장됨';

      authRowEl.appendChild(btn);
      authRowEl.appendChild(hint);
    }
  }

  // supabase-js normally strips the #access_token=... hash it left in the
  // URL after the OAuth redirect, but if that ever fails to happen the
  // stale token sits in the address bar and gets fed straight back into
  // the next login's redirectTo — clean it up ourselves as a backstop.
  function clearAuthHash() {
    if (/access_token|refresh_token|error_description/.test(window.location.hash)) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  async function handleAuthChange(session) {
    const user = session && session.user ? session.user : null;
    renderAuthUI(user);
    clearAuthHash();
    if (user) {
      if (activeRowId === user.id) return;
      await syncRow(user.id);
    } else {
      // Logged out (or never logged in): guest mode, local-only, no cloud sync.
      activeRowId = null;
    }
  }

  if (cloudClient) {
    cloudClient.auth.onAuthStateChange((_event, session) => {
      handleAuthChange(session);
    });
  }

  let boards = normalizeBoards(loadBoards());

  // Ctrl+Z / Ctrl+Shift+Z — 저장(saveBoards)될 때마다 "저장 직전 상태"를
  // 스냅샷으로 쌓아두고, 되돌리기는 그걸 꺼내 boards를 통째로 교체함.
  // 메모리에만 두고(새로고침하면 사라짐) 최근 UNDO_LIMIT번까지만 기억.
  // 항목마다 "마지막으로 바꾼 시각"(updatedAt)을 찍어둠 — 클라우드 병합이
  // 진행도 대신 "더 나중에 바꾼 쪽이 이김"으로 판단할 수 있게 하려는 것.
  // 저장(saveBoards) 때마다 직전 저장과 비교해서 달라진 항목(내용이 바뀌었거나
  // 다른 보드로 옮겨졌거나 새로 생김)에만 지금 시각을 찍음. 되돌리기/다시
  // 실행도 같은 저장 경로를 타므로, 되돌린 항목에도 그 순간의 시각이 찍힘.
  function taskSignatures() {
    const sigs = new Map();
    BOARD_IDS.concat(['archive', 'lupin', 'trash']).forEach(boardId => {
      (boards[boardId] || []).forEach(t => {
        const { updatedAt, ...rest } = t;
        sigs.set(t.id, boardId + '|' + JSON.stringify(rest));
      });
    });
    return sigs;
  }
  let lastSigs = taskSignatures();

  function stampChangedTasks() {
    const now = Date.now();
    const sigs = new Map();
    BOARD_IDS.concat(['archive', 'lupin', 'trash']).forEach(boardId => {
      (boards[boardId] || []).forEach(t => {
        const { updatedAt, ...rest } = t;
        const sig = boardId + '|' + JSON.stringify(rest);
        sigs.set(t.id, sig);
        if (lastSigs.get(t.id) !== sig) t.updatedAt = now;
      });
    });
    lastSigs = sigs;
  }

  const UNDO_LIMIT = 10;
  const undoStack = [];
  const redoStack = [];
  let lastSnapshot = JSON.stringify(boards);
  let applyingHistory = false;

  function recordHistory() {
    if (applyingHistory) return;
    const cur = JSON.stringify(boards);
    if (cur === lastSnapshot) return;
    undoStack.push(lastSnapshot);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    lastSnapshot = cur;
  }

  // 시작 시 정리 작업이나 클라우드에서 데이터를 통째로 받아온 직후처럼
  // 사용자가 한 동작이 아닌 변경은 되돌리기 대상이 아니므로 기록을 비움.
  function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    lastSnapshot = JSON.stringify(boards);
    lastSigs = taskSignatures(); // 클라우드에서 받은 항목을 "방금 바뀐 것"으로 오인하지 않게
  }

  let toastEl = null;
  let toastTimer = null;
  function showToast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    // 같은 자리에서 연속으로 뜰 때 애니메이션이 다시 시작되도록 리플로우
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  function stepHistory(from, to, doneMsg, emptyMsg) {
    if (!from.length) {
      showToast(emptyMsg);
      return;
    }
    const target = from.pop();
    to.push(JSON.stringify(boards));
    if (to.length > UNDO_LIMIT) to.shift();
    applyingHistory = true;
    try {
      boards = normalizeBoards(JSON.parse(target));
      saveBoards(); // 되돌린 항목에 새 시각을 찍고 localStorage + 클라우드에 평소처럼 반영
      lastSnapshot = JSON.stringify(boards); // 시각이 찍힌 뒤의 상태를 기준으로 삼음
    } finally {
      applyingHistory = false;
    }
    renderAll();
    showToast(doneMsg);
  }

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // e.key는 한글 자판 상태에서 'ㅋ'이 되므로 물리 키(code)로 판별
    const isUndo = e.code === 'KeyZ' && !e.shiftKey;
    const isRedo = (e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY';
    if (!isUndo && !isRedo) return;
    // 글자를 치는 중이면 브라우저 기본 글자 되돌리기를 그대로 둠
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (isFocusLocked()) return;
    const modal = document.getElementById('confirmModal');
    if (modal && !modal.hidden) return;
    e.preventDefault();
    if (isUndo) stepHistory(undoStack, redoStack, '되돌렸어요', '더 되돌릴 게 없어요');
    else stepHistory(redoStack, undoStack, '다시 실행했어요', '다시 실행할 게 없어요');
  });

  function getListEl(boardId) {
    return document.querySelector('[data-tasklist="' + boardId + '"]');
  }

  // Locates a task's <li> by id regardless of which board's list it's
  // currently rendered under — a due-today/overdue scheduled task is
  // rendered into today's list, not scheduled's, so looking it up via
  // getListEl(its owning board) misses the element that's actually on
  // screen.
  function findTaskLi(id) {
    return document.querySelector('.task-item[data-id="' + id + '"]');
  }

  // 데스크탑: 수정 중(입력창 포커스)에 같은 항목의 아이콘 버튼(긴급/+/🍅/날짜/
  // 대기/휴지통 등)을 누르면 mousedown에서 입력창이 blur되고, blur 핸들러가
  // 예약한 commit()+render()가 mouseup→click보다 먼저 돌아 버튼이 DOM에서
  // 사라져 클릭이 날아갔음(수정 모드만 풀리고 누른 기능은 안 먹힘).
  // 그래서 ① 이 항목 안 버튼의 mousedown은 포커스를 뺏지 않게 막고(입력창이
  // 계속 포커스), ② 이어지는 click은 가로채서 먼저 수정을 커밋+재렌더링한 뒤,
  // 새로 그려진 li에서 같은 순서의 버튼을 찾아 다시 클릭함. 새 li에는 진행 중
  // 수정이 없으므로 재발사된 클릭은 그대로 원래 핸들러로 감.
  document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest && e.target.closest('.task-item button');
    const li = btn && btn.closest('.task-item');
    if (li && li._activeEditCommit) e.preventDefault();
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.task-item button');
    const li = btn && btn.closest('.task-item');
    if (!li || !li._activeEditCommit) return;
    e.preventDefault();
    e.stopPropagation();
    const index = Array.prototype.indexOf.call(li.querySelectorAll('button'), btn);
    const id = li.dataset.id;
    li._activeEditCommit();
    const freshLi = findTaskLi(id);
    const freshBtn = freshLi && freshLi.querySelectorAll('button')[index];
    if (freshBtn) freshBtn.click();
  }, true);

  // 상위 항목 텍스트가 지금 편집 중(startEditTask로 만든 입력창이 살아
  // 있음)일 때 날짜/긴급/+(하위 항목 추가) 같은 옆 버튼을 그대로 누르면,
  // 그 클릭은 아직 수정 전인 옛 DOM 위에서 먼저 실행되고 — 입력창의 blur
  // 핸들러가 한 틱 뒤에야 커밋 + render()를 실행하도록 일부러 미뤄뒀기
  // 때문에(모바일에서 옆 버튼 클릭이 죽은 노드로 날아가는 걸 막으려고) —
  // 그 뒤늦은 render()가 li를 통째로 새로 그리면서, 방금 그 클릭이 열어둔
  // 상태(날짜 행 등)를 흔적도 없이 지워버림. 이 버튼들의 클릭 핸들러
  // 맨 앞에서 먼저 이 함수로 커밋을 앞당기고, 새로 그려진 li에서 같은
  // 버튼을 다시 찾아 클릭을 재발사함(Alt+D/E 단축키가 이미 쓰던 방식과
  // 동일) — 처리했으면 true를 돌려주므로 호출 쪽은 자기 로직을 건너뜀.
  function commitPendingEditThenRetry(li, taskId, selector) {
    const commit = li._activeEditCommit;
    if (!commit) return false;
    commit();
    const freshLi = findTaskLi(taskId);
    const freshEl = freshLi && freshLi.querySelector(selector);
    if (freshEl) freshEl.click();
    return true;
  }

  // 터치 기기에서 아이콘 줄을 펼치는 전용 "⋯" 버튼이 늘 떠 있어서 지저분해
  // 보인다는 피드백 — 길게 눌러서 펼치는 걸로 바꿈. 스와이프도 고려했지만
  // 이 화면은 세로 스크롤이 있어서 가로 스와이프와 겹쳐 오작동하기 쉽고,
  // 지금까지 겪은 터치 타이밍 문제들을 생각하면 롱프레스가 훨씬 안정적임.
  // excludeSelector에 걸리는 타겟(체크박스처럼 원래도 탭 한 번으로 확실한
  // 동작이 있는 요소)에서 시작한 터치는 아예 무시함. 길게 누른 뒤엔 그
  // 자리에서 이어지는 click(예: task-text의 편집 진입)을 눌러서 롱프레스와
  // 탭이 동시에 발동하지 않게 함.
  function attachLongPress(el, onLongPress, excludeSelector) {
    // 스크롤하려고 손가락을 올렸다가 의도치 않게 펼쳐지는 일이 있어서 길게.
    const LONG_PRESS_MS = 750;
    const MOVE_TOLERANCE = 10;
    let timer = null;
    let startX = 0;
    let startY = 0;
    let firedLongPress = false;

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (excludeSelector && e.target.closest(excludeSelector)) return;
      firedLongPress = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      timer = setTimeout(() => {
        timer = null;
        firedLongPress = true;
        if (navigator.vibrate) navigator.vibrate(8);
        onLongPress();
      }, LONG_PRESS_MS);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!timer) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
        clearTimeout(timer);
        timer = null;
      }
    }, { passive: true });

    const cancelPending = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    el.addEventListener('touchend', cancelPending);
    // 브라우저가 스크롤을 넘겨받으면 touchmove 대신 touchcancel이 오거나
    // 스크롤 이벤트만 오는 경우가 있어서 둘 다 대기 중인 롱프레스를 취소함.
    el.addEventListener('touchcancel', cancelPending);
    window.addEventListener('scroll', cancelPending, { passive: true, capture: true });

    // 캡처 단계에서 먼저 가로채서, 방금 롱프레스로 처리된 그 손가락이
    // 뗄 때 뒤이어 오는 click이 task-text 편집 진입 같은 원래 동작을
    // 같이 터뜨리지 않게 막음.
    el.addEventListener('click', (e) => {
      if (!firedLongPress) return;
      firedLongPress = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  // Wires a collapse toggle button to a body element (used for the
  // scheduled/someday sections present in the static HTML, and reused for
  // the archive panel's dynamically-created month groups, which need to
  // call this themselves at creation time since the querySelectorAll below
  // only ever sees elements that exist at module-load time).
  // pray later / someday 펼침 섹션은 이만큼 펼쳐진 채로 있으면 자동으로 접음 —
  // 한 번 펼쳐놓고 잊어버려서 카드가 계속 길게 늘어져 있는 걸 막으려는 것
  // (휴지통 3분, lupin 자리 비움 3분 자동 복귀와 같은 취지).
  const COLLAPSE_AUTO_CLOSE_MS = 15 * 60 * 1000;
  // 마침 그 섹션 안에서 항목을 고치는 중이면 닫지 않고 잠시 뒤에 다시 확인.
  const COLLAPSE_AUTO_CLOSE_RETRY_MS = 60 * 1000;

  function wireCollapseToggle(toggle, body, defaultOpen, autoCloseMs) {
    // 열림/닫힘을 다른 글자(▾/▴)로 바꾸는 대신 같은 글자를 180도 돌리기만
    // 함 — 두 글자가 폰트별로 미묘하게 다른 크기/기준선을 가져서(특히
    // 모바일 사파리) 위아래 화살표 크기가 달라 보이는 문제가 있었음.
    const arrow = toggle.querySelector('[data-toggle-arrow]');
    body.hidden = !defaultOpen;
    if (arrow) arrow.classList.toggle('toggle-arrow-open', defaultOpen);
    let autoCloseTimer = null;
    function scheduleAutoClose(ms) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
      if (!autoCloseMs || body.hidden) return;
      autoCloseTimer = setTimeout(() => {
        autoCloseTimer = null;
        if (body.hidden) return;
        if (body.contains(document.activeElement)) {
          scheduleAutoClose(COLLAPSE_AUTO_CLOSE_RETRY_MS);
          return;
        }
        setOpen(false);
      }, ms);
    }
    function setOpen(open) {
      body.hidden = !open;
      if (arrow) arrow.classList.toggle('toggle-arrow-open', open);
      // p/s 단축키가 "방금 열렸다(→ 입력창 포커스)"와 "한참 전에 열려있었다
      // (→ 다시 누르면 닫기)"를 구분할 수 있도록 열린 시각을 함수 자체에
      // 붙여둠 — setOpen을 그대로 들고 있는 쪽(collapseSections)이 굳이
      // 별도 상태 객체 없이 이 값을 바로 읽을 수 있음.
      if (open) setOpen.openedAt = Date.now();
      scheduleAutoClose(autoCloseMs);
    }
    setOpen.openedAt = defaultOpen ? Date.now() : 0;
    scheduleAutoClose(autoCloseMs);
    toggle.addEventListener('click', () => setOpen(body.hidden));
    return setOpen;
  }

  // someday 스티키 안의 pray later(scheduled)/someday 섹션 — p/s 단축키가
  // "닫혀있으면 열기만, 이미 열려있으면 입력창 포커스"를 판단할 때
  // body.hidden을 그대로 열림/닫힘 상태로 재사용함(따로 상태를 안 들고 있음).
  const collapseSections = {};
  document.querySelectorAll('[data-collapse-toggle]').forEach(toggle => {
    const body = toggle.nextElementSibling;
    if (!body || !body.hasAttribute('data-collapse-body')) return;
    const setOpen = wireCollapseToggle(toggle, body, false, COLLAPSE_AUTO_CLOSE_MS);
    const listEl = body.querySelector('[data-tasklist]');
    if (listEl) collapseSections[listEl.dataset.tasklist] = { body, setOpen };
  });

  // 로고 클릭 — 열려있던 오버레이/펼침 상태를 전부 기본값으로: 리갈패드
  // 닫기, waiting이 lupin 뒷면이면 앞면으로, someday/scheduled 펼침
  // 섹션은 다시 접고, 스크롤도 맨 위로. focus 타이머가 잠긴 상태에선
  // 로고 자체가 블러+pointer-events:none 대상이라 여기까지 오지 않음.
  const logoEl = document.querySelector('.logo');
  if (logoEl) {
    logoEl.addEventListener('click', () => {
      archivePanelEl.classList.remove('open');
      closeSearchPanel();
      setTrashViewOpen(false);
      if (isLupinOpen()) setLupinOpen(false);
      if (collapseSections.someday) collapseSections.someday.setOpen(false);
      if (collapseSections.scheduled) collapseSections.scheduled.setOpen(false);
      if (collapseSections.waitingLater) collapseSections.waitingLater.setOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function makeCheckSvg(iconClass) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', iconClass || 'check-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('class', 'check-path');
    path.setAttribute('d', 'M4 12.5l5 5L20 6');
    svg.appendChild(path);
    return svg;
  }

  function renderAll() {
    BOARD_IDS.forEach(render);
    render('lupin');
    updateCounter();
  }

  function byDueDate(a, b) {
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  }

  // getClientRects()가 주는 줄 높이는 line-height(1.3)까지 포함한 "줄
  // 상자" 전체라, 손글씨체(NostalgicMyoeunHeullim)처럼 잉크가 위쪽에
  // 몰리고 아래쪽에 여백이 많은 폰트에서는 그 상자의 기하학적 중앙이
  // 실제 글자보다 낮게 잡혀서 취소선이 밑줄처럼 보임 — 0.5(정중앙) 대신
  // 위로 당긴 비율을 씀. 0.4로는 PC에서도 여전히 밑줄에 가깝게 보여서
  // 더 위로 올림. 폰트가 바뀌면 다시 눈대중으로 맞출 값.
  const STRIKE_LINE_MID_RATIO = 0.32;

  // .task-text의 실제 텍스트 노드가 화면에서 몇 줄로 줄바꿈됐는지, 그
  // 각 줄이 정확히 어디서 시작해 얼마나 넓은지를 Range.getClientRects()로
  // 읽어옴 — 컨테이너(.task-text)는 flex:1이라 박스 자체는 행 전체로
  // 늘어나 있어도, 실제 글자가 차지하는 폭만 정확히 잡아내기 위함.
  function measureTextLineRects(textEl) {
    const textNode = Array.prototype.find.call(textEl.childNodes, n => n.nodeType === Node.TEXT_NODE);
    if (!textNode || !textNode.textContent) return [];
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const containerRect = textEl.getBoundingClientRect();
    return Array.from(range.getClientRects()).map(r => ({
      left: r.left - containerRect.left,
      top: r.top - containerRect.top,
      mid: r.top - containerRect.top + r.height * STRIKE_LINE_MID_RATIO,
      width: r.width,
      height: r.height
    }));
  }

  // 완료 표시된 항목이 처음 그려질 때(새로고침, 보드 이동 등) 이미 다
  // 그어진 상태로 바로 보여줌 — 애니메이션은 toggleTask에서 체크하는
  // "그 순간"에만 필요하므로 여기선 목표 너비로 바로 세팅함.
  function layoutStrikeLines(listEl) {
    if (!listEl) return;
    listEl.querySelectorAll('.task-item.done .task-text').forEach(textEl => {
      textEl.querySelectorAll('.strike-line').forEach(el => el.remove());
      measureTextLineRects(textEl).forEach(rect => {
        const line = document.createElement('span');
        line.className = 'strike-line';
        line.style.left = rect.left + 'px';
        line.style.top = rect.mid + 'px';
        line.style.width = rect.width + 'px';
        textEl.appendChild(line);
      });
    });
  }

  // 체크/체크해제 하는 그 순간에만 호출 — drawing=true면 줄마다 손그림
  // 대각선을 0폭에서 실제 글자 폭까지 그어지는 것처럼 애니메이션하고,
  // false면 있던 줄들을 다시 0폭으로 지움(엘리먼트 자체는 곧 이어지는
  // 전체 재렌더링이 정리하므로 여기선 굳이 제거하지 않음).
  function animateStrikeLines(li, drawing) {
    const textEl = li.querySelector('.task-text');
    if (!textEl) return;
    if (!drawing) {
      textEl.querySelectorAll('.strike-line').forEach(el => {
        el.style.width = '0px';
      });
      return;
    }
    textEl.querySelectorAll('.strike-line').forEach(el => el.remove());
    const lines = measureTextLineRects(textEl).map(rect => {
      const line = document.createElement('span');
      line.className = 'strike-line';
      line.style.left = rect.left + 'px';
      line.style.top = rect.mid + 'px';
      line.style.width = '0px';
      textEl.appendChild(line);
      return { line, targetWidth: rect.width };
    });
    // width:0으로 커밋된 다음 프레임에 목표 너비로 바꿔야 transition이
    // 실제로 재생됨 — 같은 프레임에서 바로 바꾸면 브라우저가 중간 상태를
    // 건너뛰고 바로 최종값으로 그려버림.
    requestAnimationFrame(() => {
      lines.forEach(({ line, targetWidth }) => {
        line.style.width = targetWidth + 'px';
      });
    });
  }

  function render(boardId) {
    if (boardId === 'today') return renderToday();
    if (boardId === 'scheduled') return renderScheduled();
    if (boardId === 'waiting') return renderWaiting();

    const listEl = getListEl(boardId);
    if (!listEl) return;
    listEl.innerHTML = '';

    const tasks = boards[boardId];
    const active = tasks.filter(t => !t.done);
    const done = tasks.filter(t => t.done);

    if (active.length === 0 && done.length === 0) {
      const hint = document.createElement('li');
      hint.className = 'empty-hint';
      hint.textContent = EMPTY_HINTS[boardId] || '아직 없음';
      listEl.appendChild(hint);
    }

    active.forEach(t => listEl.appendChild(renderItem(boardId, t)));

    if (done.length > 0) {
      const divider = document.createElement('li');
      divider.className = 'divider';
      divider.textContent = '─────────';
      listEl.appendChild(divider);
      done.forEach(t => listEl.appendChild(renderItem(boardId, t)));
    }

    layoutStrikeLines(listEl);
    updateCounter();
  }

  // waiting: 회신 예정일이 내일 이후인 항목은 목록 아래 접힘 구역으로,
  // 예정일이 오늘이거나 지났거나 없으면 일반 항목으로(별도 정렬/강조 없음).
  const REPLY_LATER_HINT_TITLE = '회신 예정일이 아직 안 된 항목이에요';
  function renderWaiting() {
    const listEl = getListEl('waiting');
    if (!listEl) return;
    listEl.innerHTML = '';

    const today = todayStr();
    const isLater = t => !!t.replyDate && t.replyDate > today;
    const tasks = boards.waiting;
    const normal = tasks.filter(t => !isLater(t));
    const later = tasks.filter(isLater).sort((a, b) => a.replyDate.localeCompare(b.replyDate));

    if (normal.length === 0) {
      const hint = document.createElement('li');
      hint.className = 'empty-hint';
      hint.textContent = EMPTY_HINTS.waiting;
      listEl.appendChild(hint);
    }
    normal.forEach(t => listEl.appendChild(renderItem('waiting', t)));

    const laterListEl = getListEl('waitingLater');
    const section = document.querySelector('[data-reply-later]');
    if (laterListEl && section) {
      laterListEl.innerHTML = '';
      later.forEach(t => laterListEl.appendChild(renderItem('waiting', t)));
      section.hidden = later.length === 0;
      const toggle = section.querySelector('[data-collapse-toggle]');
      if (toggle) {
        toggle.title = '아직 안 와도 되는 것 ' + later.length + '개\n' + REPLY_LATER_HINT_TITLE;
        toggle.setAttribute('aria-label', '회신 예정일이 아직 안 된 항목 ' + later.length + '개 보기/숨기기');
      }
    }

    updateCounter();
  }

  function renderScheduled() {
    const listEl = getListEl('scheduled');
    if (!listEl) return;
    listEl.innerHTML = '';

    const today = todayStr();
    // Tasks due today live entirely inside today's list (active or done) —
    // never here, checked or not.
    const tasks = boards.scheduled.filter(t => t.dueDate !== today).sort(byDueDate);
    // Unchecked tasks overdue from before today already show under today's
    // "oops, still here" — don't duplicate them. Anything more than 7 days
    // out moves to the legal pad's "다가오는 일" section instead (see
    // renderUpcoming) so this card doesn't pile up with far-future items.
    const active = tasks.filter(t => !t.done && t.dueDate > today && daysUntilDue(t.dueDate) <= 7);
    const done = tasks.filter(t => t.done);

    if (active.length === 0 && done.length === 0) {
      const hint = document.createElement('li');
      hint.className = 'empty-hint';
      hint.textContent = EMPTY_HINTS.scheduled;
      listEl.appendChild(hint);
    }

    active.forEach(t => listEl.appendChild(renderItem('scheduled', t)));

    if (done.length > 0) {
      const divider = document.createElement('li');
      divider.className = 'divider';
      divider.textContent = '─────────';
      listEl.appendChild(divider);
      done.forEach(t => listEl.appendChild(renderItem('scheduled', t)));
    }

    layoutStrikeLines(listEl);
  }

  function renderToday() {
    const listEl = getListEl('today');
    if (!listEl) return;
    listEl.innerHTML = '';

    const today = todayStr();
    const plain = boards.today;
    const dueToday = boards.scheduled.filter(t => !t.done && t.dueDate === today).sort(byDueDate);
    const doneToday = boards.scheduled.filter(t => t.done && t.dueDate === today).sort(byDueDate);
    const oops = boards.scheduled.filter(t => !t.done && t.dueDate < today).sort(byDueDate);

    const active = plain.filter(t => !t.done);
    const done = plain.filter(t => t.done);

    if (active.length === 0 && dueToday.length === 0 && done.length === 0 && doneToday.length === 0 && oops.length === 0) {
      const hint = document.createElement('li');
      hint.className = 'empty-hint';
      hint.textContent = EMPTY_HINTS.today;
      listEl.appendChild(hint);
    }

    active.forEach(t => listEl.appendChild(renderItem('today', t, { showFocusBtn: true })));
    dueToday.forEach(t => listEl.appendChild(renderItem('scheduled', t, { showFocusBtn: true })));

    if (done.length > 0 || doneToday.length > 0) {
      const divider = document.createElement('li');
      divider.className = 'divider';
      divider.textContent = '─────────';
      listEl.appendChild(divider);
      done.forEach(t => listEl.appendChild(renderItem('today', t)));
      doneToday.forEach(t => listEl.appendChild(renderItem('scheduled', t)));
    }

    if (oops.length > 0) {
      const divider = document.createElement('li');
      divider.className = 'divider divider-oops';
      divider.textContent = 'oops, still here';
      listEl.appendChild(divider);
      oops.forEach(t => listEl.appendChild(renderItem('scheduled', t, { showFocusBtn: true })));
    }

    if (focusState) renderFocusPanel();

    layoutStrikeLines(listEl);
    updateCounter();
  }

  // 하위 항목 진행도 "(완료/전체)" — 없으면 null.
  function subtaskProgressText(task) {
    const total = task.subtasks.length;
    const done = task.subtasks.filter(s => s.done).length;
    return '(' + done + '/' + total + ')';
  }

  function makeSubtaskProgress(task) {
    if (!task.subtasks || task.subtasks.length === 0) return null;
    const el = document.createElement('span');
    el.className = 'subtask-progress';
    el.textContent = subtaskProgressText(task);
    return el;
  }

  function refreshSubtaskProgress(li, task) {
    const el = li && li.querySelector(':scope > .task-row > .subtask-progress');
    if (el) el.textContent = subtaskProgressText(task);
  }

  // waiting에서 완료된 하위 항목을 펼친 task id -> 자동으로 접히는 시각.
  // 재렌더로 li가 새로 만들어져도 펼침 상태/남은 시간이 유지되게 함.
  const DONE_OPEN_MS = 30000;
  const doneOpenUntil = new Map();
  const doneOpenTimers = new Map();

  function toggleDoneOpen(id, li) {
    clearTimeout(doneOpenTimers.get(id));
    if (li.classList.toggle('done-open')) {
      doneOpenUntil.set(id, Date.now() + DONE_OPEN_MS);
      doneOpenTimers.set(id, setTimeout(() => {
        doneOpenUntil.delete(id);
        const cur = findTaskLi(id);
        if (cur) cur.classList.remove('done-open');
      }, DONE_OPEN_MS));
    } else {
      doneOpenUntil.delete(id);
    }
  }

  function renderItem(boardId, task, opts) {
    opts = opts || {};
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '') + (task.urgent ? ' urgent' : '');
    if (urgentFlash && urgentFlash.id === task.id) {
      li.className += urgentFlash.mode === 'in' ? ' urgent-flash-in' : ' urgent-flash-out';
      urgentFlash = null;
    }
    if (moveHighlight && moveHighlight.id === task.id) {
      li.className += ' move-arrive-' + moveHighlight.mode;
      moveHighlight = null;
    }
    li.dataset.id = task.id;

    const row = document.createElement('div');
    row.className = 'task-row';

    // waiting has no "done" concept — its checkbox is replaced by an
    // always-visible ← that sends the task back to today.
    if (boardId === 'waiting') {
      const backBtn = document.createElement('button');
      backBtn.className = 'back-btn';
      backBtn.type = 'button';
      backBtn.setAttribute('aria-label', 'today로 되돌리기');
      // 폰트 글리프 ←는 가늘고 작아서 체크 표시와 결이 안 맞음 — 체크와 같은
      // 둥근 끝 선으로 직접 그린 화살표.
      const ns = 'http://www.w3.org/2000/svg';
      const arrow = document.createElementNS(ns, 'svg');
      arrow.setAttribute('class', 'back-arrow');
      arrow.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M20 12H5M11 5.5L4.5 12l6.5 6.5');
      arrow.appendChild(path);
      backBtn.appendChild(arrow);
      backBtn.addEventListener('click', () => moveTask('waiting', 'today', task.id));
      row.appendChild(backBtn);
    } else {
      const checkbox = document.createElement('button');
      checkbox.className = 'checkbox';
      checkbox.type = 'button';
      checkbox.setAttribute('aria-label', task.done ? '완료 취소' : '완료 표시');
      checkbox.appendChild(makeCheckSvg());
      checkbox.addEventListener('click', () => toggleTask(boardId, task.id));
      row.appendChild(checkbox);
    }

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    text.tabIndex = 0;
    text.setAttribute('role', 'button');
    text.setAttribute('aria-label', '내용 수정');
    text.addEventListener('click', () => startEditTask(boardId, task.id));

    row.appendChild(text);

    // 하위 항목이 있으면 항상 만들어두고 CSS가 보일 곳(waiting/someday/
    // 완료된 gotta do 항목)에서만 드러냄 — 체크 직후 재렌더 전에도 어긋나지
    // 않게 하려고 JS에서 조건 분기 안 함.
    const progress = makeSubtaskProgress(task);
    // waiting(완료된 하위 항목)과 완료된 gotta do 항목(하위 항목 전체)은
    // 접어두고, (완료/전체)를 눌러야 아래로 펼쳐짐. 다시 누르거나 30초가
    // 지나면 접힘.
    const togglable = boardId === 'waiting' ? task.subtasks.some(s => s.done) : task.done;
    const makeToggle = (el) => {
      if (!togglable) return;
      el.classList.add('subtask-progress-toggle');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.setAttribute('aria-label', '완료된 하위 항목 보기/숨기기');
      const toggle = () => toggleDoneOpen(task.id, li);
      // 눌러서 포커스가 가면 :focus-within 때문에 아이콘 줄(.task-controls)까지
      // 같이 펼쳐지고 포커스 링도 생김 — 마우스/터치로 누를 땐 포커스를 막음.
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    };
    if (progress) {
      if (togglable && doneOpenUntil.get(task.id) > Date.now()) li.classList.add('done-open');
      makeToggle(progress);
      row.appendChild(progress);
    }

    const dateKey = dateFieldOf(boardId);
    let badge = null;
    if (task[dateKey]) {
      badge = document.createElement('span');
      badge.className = 'due-badge';
      badge.textContent = formatDueDateRelative(task[dateKey]);
      row.appendChild(badge);
    }

    // 메모가 붙어 있으면 날짜/진행도 알약과 같은 모양의 "메모" 알약 —
    // 누르면 상위/하위 항목과 메모를 보여주는 모달이 뜸.
    if (task.note) {
      const noteBadge = document.createElement('span');
      noteBadge.className = 'note-badge';
      noteBadge.textContent = '메모';
      noteBadge.setAttribute('role', 'button');
      noteBadge.tabIndex = 0;
      noteBadge.setAttribute('aria-label', '메모 보기');
      const openNote = () => {
        if (commitPendingEditThenRetry(li, task.id, '.note-badge')) return;
        openNoteModal(boardId, task.id, { anchorEl: li });
      };
      noteBadge.addEventListener('mousedown', (e) => e.preventDefault());
      noteBadge.addEventListener('click', openNote);
      noteBadge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNote(); }
      });
      row.appendChild(noteBadge);
    }

    // 데스크톱은 hover로 아이콘 줄이 펼쳐지지만, 터치 기기는 hover를
    // 안정적으로 감지 못해서(호버 흉내→지연된 클릭 등) 그 방식에 기대면
    // 누르자마자 다시 접히는 문제가 있었음 — 늘 떠 있는 버튼 대신, 이
    // 줄을 길게 누르면 "이 항목만" 펼치고 접히게 함(전부 다 펼쳐두면
    // 아이콘이 너무 많아진다는 피드백, 버튼이 항상 보여서 지저분하다는
    // 피드백 둘 다 반영). 체크박스는 원래도 한 번 탭으로 확실한 동작이
    // 있으니 롱프레스 대상에서 제외.
    attachLongPress(row, () => {
      // 롱프레스는 클릭 재발사로 처리할 방법이 없으니(클릭 한 번으로
      // 되는 동작이 아님), 편집 중이면 직접 커밋부터 하고 새로 그려진
      // li에 펼침 클래스를 붙임.
      const commit = li._activeEditCommit;
      if (commit) commit();
      const targetLi = commit ? findTaskLi(task.id) : li;
      if (targetLi) targetLi.classList.toggle('controls-open');
    }, '.checkbox');

    li.appendChild(row);

    if (task.subtasks.length > 0) {
      const subList = document.createElement('ul');
      subList.className = 'subtask-list';
      task.subtasks.forEach(sub => subList.appendChild(renderSubtaskItem(boardId, task.id, sub)));
      // 목록을 grid 래퍼로 감싸서 CSS가 실제 높이만큼 0fr <-> 1fr로 접고
      // 펼 수 있게 함(.subtask-collapse 참고) — max-height 방식은 목표 값이
      // 실제 높이와 안 맞아 애니메이션 타이밍이 어긋났음.
      const subWrap = document.createElement('div');
      subWrap.className = 'subtask-collapse';
      subWrap.appendChild(subList);
      li.appendChild(subWrap);
    }

    const controls = document.createElement('div');
    controls.className = 'task-controls';

    const urgentBtn = document.createElement('button');
    urgentBtn.className = 'urgent-btn';
    urgentBtn.type = 'button';
    urgentBtn.setAttribute('aria-label', task.urgent ? '긴급 해제' : '긴급 표시');
    // 옆에 나란히 있는 다른 버튼들(🍅📅⏳🌙🗑️)이 전부 이모지라 "!"만
    // 맨 텍스트로 튀어 보였음 — ❗로 통일. 색 있는 이모지라 CSS color로
    // 꺼짐/켜짐을 못 바꾸니, 글자는 항상 같고 CSS가 opacity/grayscale로
    // 흐리게/선명하게만 바꿈(li의 urgent 클래스 기준).
    // U+FE0F(변형 선택자)를 안 붙이면 ➕(U+2795)는 기본이 텍스트
    // 표시라서 플랫폼에 따라 이모지가 아니라 얇은 흑백 "+"로 렌더링돼
    // 옆 이모지들과 두께/여백이 달라 보였음 — 강제로 이모지 표시를 요청.
    urgentBtn.textContent = '❗️';
    urgentBtn.addEventListener('click', () => {
      if (commitPendingEditThenRetry(li, task.id, '.urgent-btn')) return;
      toggleUrgent(boardId, task.id);
    });

    const addToggle = document.createElement('button');
    addToggle.className = 'add-subtask-toggle';
    addToggle.type = 'button';
    addToggle.setAttribute('aria-label', '하위 항목 추가');
    addToggle.textContent = '➕️';

    const noteBtn = document.createElement('button');
    noteBtn.className = 'note-btn';
    noteBtn.type = 'button';
    noteBtn.setAttribute('aria-label', task.note ? '메모 수정' : '메모 추가');
    noteBtn.textContent = '📝';
    noteBtn.addEventListener('click', () => {
      if (commitPendingEditThenRetry(li, task.id, '.note-btn')) return;
      openNoteModal(boardId, task.id, { anchorEl: li, startEditing: true });
    });

    controls.appendChild(urgentBtn);
    controls.appendChild(addToggle);
    controls.appendChild(noteBtn);

    if (opts.showFocusBtn) {
      const focusBtn = document.createElement('button');
      focusBtn.className = 'focus-btn';
      focusBtn.type = 'button';
      focusBtn.setAttribute('aria-label', '포커스 모드로 집중하기');
      focusBtn.textContent = '🍅';
      focusBtn.addEventListener('click', () => enterFocusPickDuration(boardId, task.id));
      controls.appendChild(focusBtn);
    }

    const canDate = DATE_ENABLED_IDS.includes(boardId) || boardId === 'scheduled';
    let dateBtn = null;
    if (canDate) {
      dateBtn = document.createElement('button');
      dateBtn.className = 'date-btn';
      dateBtn.type = 'button';
      const dateLabel = boardId === 'waiting' ? '회신 예정일' : '날짜';
      dateBtn.setAttribute('aria-label', task[dateKey] ? dateLabel + ' 수정' : dateLabel + ' 지정');
      dateBtn.textContent = '📅';
      controls.appendChild(dateBtn);
    }

    // lupin은 숨겨진 개인 메모라 다른 보드로도, 다른 보드에서 lupin으로도
    // 옮겨질 수 없음 — 애초에 MOVE_TARGET_IDS에 없어서 뒤쪽은 이미 보장되고,
    // 여기선 lupin 항목 자체가 이동 버튼을 갖지 않도록 명시적으로 막음.
    (boardId === 'lupin' ? [] : MOVE_TARGET_IDS)
      .filter(id => id !== boardId)
      .filter(id => !(boardId === 'waiting' && id === 'today')) // redundant with the always-visible ←
      // 오늘 마감/지난 마감인 scheduled 항목은 today 목록 안에 이미 그려져
      // 있어서(renderToday의 dueToday/oops), "오늘로 이동" 버튼이 자기가
      // 이미 있는 곳으로 또 옮기라는 것처럼 보임 — 날짜 지우기와 결과가
      // 같으니 중복. 아직 안 온(미래 날짜) scheduled 항목은 pray later
      // 카드에만 있으니 그대로 둠.
      .filter(id => !(boardId === 'scheduled' && id === 'today' && task.dueDate <= todayStr()))
      .forEach(otherId => {
      const moveBtn = document.createElement('button');
      moveBtn.className = 'move-btn';
      moveBtn.type = 'button';
      moveBtn.setAttribute('aria-label', BOARD_META[otherId].label + '로 이동');
      moveBtn.textContent = BOARD_META[otherId].emoji;
      moveBtn.addEventListener('click', () => moveTask(boardId, otherId, task.id));
      controls.appendChild(moveBtn);
    });

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.type = 'button';
    del.setAttribute('aria-label', '삭제');
    del.textContent = '🗑️';
    del.addEventListener('click', () => deleteTask(boardId, task.id));
    controls.appendChild(del);

    li.appendChild(controls);

    if (canDate) {
      const dateRow = document.createElement('div');
      dateRow.className = 'date-picker-row';
      dateRow.hidden = true;

      const dateInput = document.createElement('input');
      dateInput.className = 'date-picker-input';
      dateInput.type = 'date';
      if (task[dateKey]) dateInput.value = task[dateKey];
      if (boardId === 'waiting') dateInput.min = todayStr();

      // 이미 날짜가 채워진 채로 열린 경우(날짜 수정), 년/월/일 중 한 칸만
      // 고쳐도 나머지 칸은 이미 값이 있어서 첫 글자만으로 곧장 "완성된
      // 날짜"가 되어버림 — 그 순간 change가 발생해서, 키패드로 "15"처럼
      // 두 자리를 치는 도중 "1"만으로 바로 커밋+닫힘이 일어나 "5"를 칠
      // 틈이 없어짐. change를 받자마자 반영하지 않고 잠깐(400ms) 기다렸다가
      // 커밋하고, 그 사이 또 change가 오면(다음 자리 입력) 타이머를 리셋해서
      // 최종 값만 커밋되게 함.
      let commitTimer = null;
      let pickerOpenedAt = 0; // 달력을 연 시각(가짜 change 구분용)
      const commitDate = (value) => {
        clearTimeout(commitTimer);
        commitTimer = null;
        setDueDate(boardId, task.id, value);
        // 모바일 네이티브 달력에서 날짜를 확정(체크)하면 그걸로 볼일은
        // 끝난 거라, 되살리기 피커처럼 곧장 닫아줌 — 다시 눌러야만
        // 닫히던 예전 동작보다 자연스러움.
        dateRow.hidden = true;
      };
      dateInput.addEventListener('change', () => {
        // 모바일(특히 iOS)에서 이미 날짜가 채워진 입력창에 focus()로
        // 네이티브 피커를 띄우기만 해도, 사용자가 아무것도 안 골랐는데
        // value가 빈 문자열인 change가 가짜로 한 번 발생하는 경우가
        // 있었음 — 저장 데이터는 이미 무시하도록 막아뒀지만, 이 입력창
        // 자체의 표시값(dateInput.value)도 그 순간 진짜로 빈 문자열이 되어
        // 있어서, 화면에는 "날짜가 잠깐 보였다가 사라지는" 것처럼 보였음
        // — 저장된 task.dueDate로 표시값도 같이 되돌려놓음(진짜 지우기는
        // "날짜 지우기" 버튼이 따로 처리).
        if (!dateInput.value) {
          // 달력의 "삭제"(크롬)처럼 칸 전체를 진짜로 비웠으면 "날짜 지우기"와
          // 똑같이 처리. 구분 기준: ① 년/월/일 중 일부만 지운 입력 중이면
          // badInput이 true라 제외, ② 달력을 연 직후(700ms 이내)에 오는 빈
          // change는 위에서 말한 모바일의 가짜 이벤트라 제외.
          const justOpened = Date.now() - pickerOpenedAt < 700;
          if (task[dateKey] && !dateInput.validity.badInput && !justOpened) {
            clearTimeout(commitTimer);
            setDueDate(boardId, task.id, '');
            return;
          }
          if (task[dateKey]) dateInput.value = task[dateKey];
          return;
        }
        clearTimeout(commitTimer);
        commitTimer = setTimeout(() => commitDate(dateInput.value), 400);
      });
      // 아직 값을 고르기 전(빈 칸)이면 Esc로 그냥 닫을 수 있게 — 취소
      // 버튼(cancelBtn)과 동일한 동작이라, cancelBtn 클릭을 그대로 재사용.
      // (예전엔 blur 시 자동으로도 닫았는데, 안드로이드 크롬의 네이티브
      // 달력이 열리는 동안 입력창이 blur되는 경우가 있어서 고르는 도중에
      // 피커가 먼저 닫혀버리는 문제가 있었음 — 제거함.)
      dateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !dateInput.value) {
          e.preventDefault();
          cancelBtn.click();
        }
      });

      // someday/pray later(그리고 거기서 마감이 지나 today의 "oops, still
      // here"로 넘어온 항목)에 달력을 열지 않고 바로 오늘/내일로 찍을 수
      // 있게 — 명확한 단일 클릭이라 디바운스 없이 commitDate를 바로 호출.
      const todayBtn = document.createElement('button');
      todayBtn.className = 'date-clear-btn';
      todayBtn.type = 'button';
      todayBtn.textContent = '오늘';
      todayBtn.addEventListener('click', () => {
        dateInput.value = todayStr();
        commitDate(dateInput.value);
      });

      const tomorrowBtn = document.createElement('button');
      tomorrowBtn.className = 'date-clear-btn';
      tomorrowBtn.type = 'button';
      tomorrowBtn.textContent = '내일';
      tomorrowBtn.addEventListener('click', () => {
        dateInput.value = tomorrowStr();
        commitDate(dateInput.value);
      });

      const clearBtn = document.createElement('button');
      clearBtn.className = 'date-clear-btn';
      clearBtn.type = 'button';
      clearBtn.textContent = '날짜 지우기';
      clearBtn.hidden = !task[dateKey];
      clearBtn.addEventListener('click', () => {
        clearTimeout(commitTimer);
        setDueDate(boardId, task.id, '');
      });

      // Only shown while no date has been assigned yet — lets the user
      // close the picker without picking one. Once a date exists, clearBtn
      // above already covers "undo the date".
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'date-clear-btn';
      cancelBtn.type = 'button';
      cancelBtn.textContent = '취소';
      cancelBtn.hidden = !!task[dateKey];
      cancelBtn.addEventListener('click', () => {
        clearTimeout(commitTimer);
        dateInput.value = '';
        dateRow.hidden = true;
        li.classList.remove('row-pinned');
      });

      dateRow.appendChild(wrapDateInputWithHint(dateInput));
      dateRow.appendChild(todayBtn);
      dateRow.appendChild(tomorrowBtn);
      dateRow.appendChild(clearBtn);
      dateRow.appendChild(cancelBtn);
      li.appendChild(dateRow);

      const toggleDateRow = () => {
        dateRow.hidden = !dateRow.hidden;
        // .task-controls는 평소 hover/focus-within으로만 펼쳐지는데,
        // 모바일에서 dateInput.focus()가 네이티브 날짜 피커를 띄우면 iOS가
        // 그 순간 focus-within을 잠깐 놓쳐서 이 줄 전체가 도로 접혀버리는
        // 문제가 있었음(달력 안 뜨고 원래 상태로 돌아가는 것처럼 보임) —
        // 날짜 행이 열려있는 동안은 별도 클래스로 강제로 펼쳐둠.
        li.classList.toggle('row-pinned', !dateRow.hidden);
        if (dateRow.hidden) {
          clearTimeout(commitTimer);
        } else {
          // hidden을 푼 직후 같은 틱에 focus()를 부르면(그래서 네이티브
          // 피커가 뜨면) 아직 리플로우 전이라 iOS가 이 줄이 실제로 펼쳐진
          // 상태를 못 보고 다시 접어버리는 것으로 보임 — 한 프레임 뒤로
          // 미뤄서 레이아웃이 자리잡은 다음에 포커스를 줌.
          pickerOpenedAt = Date.now();
          requestAnimationFrame(() => focusAndShowPicker(dateInput));
        }
      };
      dateBtn.addEventListener('click', () => {
        if (commitPendingEditThenRetry(li, task.id, '.date-btn')) return;
        toggleDateRow();
      });
      if (badge) badge.addEventListener('click', () => {
        if (commitPendingEditThenRetry(li, task.id, '.due-badge')) return;
        toggleDateRow();
      });
    }

    const addSubRow = document.createElement('div');
    addSubRow.className = 'add-subtask-row';
    addSubRow.hidden = true;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'plus';
    plus.setAttribute('aria-label', '하위 항목 등록');
    plus.textContent = '+';
    const subInput = document.createElement('input');
    subInput.className = 'new-subtask-input';
    subInput.type = 'text';
    subInput.placeholder = '하위 항목 추가...';
    subInput.autocomplete = 'off';
    subInput.maxLength = 100;
    subInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // addSubtask가 내부에서 이미 이 행을 다시 열고 새 입력창에
          // 포커스를 주므로(연속 입력용 기존 동작) 그대로 둬서 다음 하위
          // 항목을 곧장 이어서 입력할 수 있게 함.
          addSubtask(boardId, task.id, subInput.value);
          return;
        }
        // addSubtask가 내부에서 render() 후 곧장 이 행을 다시 열고
        // 새 입력창에 포커스를 줘버려서(연속 입력용 기존 동작), 여기 있는
        // subInput은 그 시점엔 이미 떨어져나간(교체된) 옛 노드라 blur()가
        // 안 먹음 — addSubtask가 방금 다시 연 행을 taskId로 다시 찾아서
        // 명시적으로 닫아줌.
        addSubtask(boardId, task.id, subInput.value);
        openAddSubtaskRow(boardId, task.id, false);
      } else if (e.key === 'Escape') {
        // 이미 등록된 하위 항목들은 그대로 두고, 아직 등록 안 한 입력
        // 중이던 텍스트만 지운 채로 포커스를 빼서 행을 닫음.
        subInput.value = '';
        subInput.blur();
      }
    });
    subInput.addEventListener('blur', () => {
      if (!subInput.value.trim()) openAddSubtaskRow(boardId, task.id, false);
    });
    // 이 버튼도 Enter와 동일하게 등록 — 클릭하면 subInput이 먼저 blur되지만
    // 텍스트가 있으면 위 blur 리스너가 행을 닫지 않으므로 안전함.
    plus.addEventListener('click', () => {
      const trimmed = subInput.value.trim();
      if (trimmed) addSubtask(boardId, task.id, subInput.value);
      else subInput.focus();
    });
    addToggle.addEventListener('click', () => {
      if (commitPendingEditThenRetry(li, task.id, '.add-subtask-toggle')) return;
      openAddSubtaskRow(boardId, task.id, true);
    });

    addSubRow.appendChild(plus);
    addSubRow.appendChild(subInput);
    li.appendChild(addSubRow);

    return li;
  }

  // Today-done tasks stay visible in today's list during their grace
  // period (see toggleTask), but should still show up in the archive right
  // away rather than waiting for tomorrow's sweep — read them live off
  // their real board instead of copying them, so there's a single source
  // of truth until the sweep actually moves them into boards.archive.
  function collectArchiveEntries() {
    const today = todayStr();
    const archived = boards.archive.map(t => ({ task: t, source: 'archive' }));
    const liveToday = boards.today.filter(t => t.done).map(t => ({ task: t, source: 'today' }));
    const liveScheduledToday = boards.scheduled
      .filter(t => t.done && t.dueDate === today)
      .map(t => ({ task: t, source: 'scheduled' }));
    return archived.concat(liveToday, liveScheduledToday);
  }

  function renderArchive() {
    archiveGroupsEl.innerHTML = '';

    const items = collectArchiveEntries().sort((a, b) => {
      if (a.task.doneAt !== b.task.doneAt) return (b.task.doneAt || '').localeCompare(a.task.doneAt || '');
      return b.task.id - a.task.id;
    });

    if (items.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = '아직 다 한 일 없음';
      archiveGroupsEl.appendChild(hint);
      return;
    }

    const curMonth = todayStr().slice(0, 7);
    const byMonth = new Map();
    items.forEach(entry => {
      const m = (entry.task.doneAt || '').slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(entry);
    });

    Array.from(byMonth.keys()).sort().reverse().forEach(month => {
      const toggle = document.createElement('button');
      toggle.className = 'sticky-title sticky-title-toggle';
      toggle.type = 'button';
      toggle.innerHTML = month + ' <span class="toggle-arrow" data-toggle-arrow>▾</span>';

      const body = document.createElement('div');
      body.className = 'collapsible-body';

      const byDate = new Map();
      byMonth.get(month).forEach(entry => {
        const d = entry.task.doneAt;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(entry);
      });

      const list = document.createElement('ul');
      list.className = 'task-list';
      Array.from(byDate.keys()).sort().reverse().forEach(dateStr => {
        const d = new Date(dateStr + 'T00:00:00');
        const group = document.createElement('li');
        group.className = 'archive-date-group';

        const heading = document.createElement('span');
        heading.className = 'archive-date-heading';
        heading.textContent = d.getDate() + '일 (' + WEEKDAY_KO[d.getDay()] + ')';
        group.appendChild(heading);

        const dateItems = document.createElement('ul');
        dateItems.className = 'archive-date-items';
        byDate.get(dateStr).forEach(entry => dateItems.appendChild(renderArchivedItem(entry)));
        group.appendChild(dateItems);

        list.appendChild(group);
      });
      body.appendChild(list);

      archiveGroupsEl.appendChild(toggle);
      archiveGroupsEl.appendChild(body);
      wireCollapseToggle(toggle, body, month === curMonth);
    });
  }

  function renderArchivedItem(entry) {
    const task = entry.task;
    const li = document.createElement('li');
    li.className = 'archive-item';
    li.dataset.id = task.id;

    const text = document.createElement('span');
    text.className = 'archive-item-text';
    text.textContent = task.text;
    li.appendChild(text);

    const controls = document.createElement('div');
    controls.className = 'archive-item-controls';

    const reviveBtn = document.createElement('button');
    reviveBtn.className = 'archive-revive-btn';
    reviveBtn.type = 'button';
    reviveBtn.textContent = '↻ 또 하기';

    // "또 하기"를 누르면 상위 항목 + 하위 항목을 통째로 고칠 수
    // 있는 모달이 뜸 — 여기서 고쳐도 원래 지난 기록(archive의 task)은
    // 그대로 두고, "완료"를 눌렀을 때만 지금 초안 그대로 새 카드가 만들어짐.
    let draftSubtasks = (task.subtasks || []).map(s => s.text);
    let draftDueDate = '';

    const reviveCard = document.createElement('div');
    reviveCard.className = 'revive-card';
    reviveCard.hidden = true;

    const reviveTextInput = document.createElement('input');
    reviveTextInput.className = 'revive-text-input';
    reviveTextInput.type = 'text';
    reviveTextInput.maxLength = 100;
    reviveTextInput.value = task.text;
    reviveCard.appendChild(reviveTextInput);

    const reviveSubtaskChips = document.createElement('ul');
    reviveSubtaskChips.className = 'subtask-list';
    reviveCard.appendChild(reviveSubtaskChips);

    function renderReviveSubtasks() {
      reviveSubtaskChips.innerHTML = '';
      reviveSubtaskChips.hidden = draftSubtasks.length === 0;
      draftSubtasks.forEach((subText, i) => {
        const subLi = document.createElement('li');
        subLi.className = 'subtask-item';
        const chip = document.createElement('span');
        chip.className = 'subtask-chip';
        chip.textContent = '[' + subText + ']';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'subtask-delete-btn';
        del.setAttribute('aria-label', '삭제');
        del.textContent = '×';
        del.addEventListener('click', () => {
          draftSubtasks.splice(i, 1);
          renderReviveSubtasks();
        });
        subLi.appendChild(chip);
        subLi.appendChild(del);
        reviveSubtaskChips.appendChild(subLi);
      });
    }
    renderReviveSubtasks();

    const reviveSubtaskRow = document.createElement('div');
    reviveSubtaskRow.className = 'add-subtask-row';
    const reviveSubtaskPlus = document.createElement('button');
    reviveSubtaskPlus.type = 'button';
    reviveSubtaskPlus.className = 'plus';
    reviveSubtaskPlus.setAttribute('aria-label', '하위 항목 등록');
    reviveSubtaskPlus.textContent = '+';
    const reviveSubtaskInput = document.createElement('input');
    reviveSubtaskInput.className = 'new-subtask-input';
    reviveSubtaskInput.type = 'text';
    reviveSubtaskInput.placeholder = '하위 항목 추가...';
    reviveSubtaskInput.autocomplete = 'off';
    reviveSubtaskInput.maxLength = 100;
    function addReviveSubtask() {
      const trimmed = reviveSubtaskInput.value.trim();
      if (!trimmed) return;
      draftSubtasks.push(trimmed);
      reviveSubtaskInput.value = '';
      renderReviveSubtasks();
      reviveSubtaskInput.focus();
    }
    reviveSubtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addReviveSubtask();
    });
    reviveSubtaskPlus.addEventListener('click', addReviveSubtask);
    reviveSubtaskRow.appendChild(reviveSubtaskPlus);
    reviveSubtaskRow.appendChild(reviveSubtaskInput);
    reviveCard.appendChild(reviveSubtaskRow);

    // 날짜 행은 이 카드 안에서는 처음부터 바로 보이게 함 — "또 하기"로
    // 이미 펼친 편집 모드인데, 날짜를 보려고 또 한 번 눌러야 하면 중복.
    // "완료"도 이 행 맨 끝에 "날짜 지우기"와 같은 스타일로 나란히 둠.
    const reviveDateRow = document.createElement('div');
    reviveDateRow.className = 'date-picker-row';
    const reviveDateInput = document.createElement('input');
    reviveDateInput.className = 'date-picker-input';
    reviveDateInput.type = 'date';
    reviveDateInput.addEventListener('change', () => { draftDueDate = reviveDateInput.value; });
    reviveDateRow.appendChild(wrapDateInputWithHint(reviveDateInput));

    const reviveTomorrowBtn = document.createElement('button');
    reviveTomorrowBtn.className = 'date-clear-btn';
    reviveTomorrowBtn.type = 'button';
    reviveTomorrowBtn.textContent = '내일';
    reviveTomorrowBtn.addEventListener('click', () => {
      reviveDateInput.value = tomorrowStr();
      draftDueDate = reviveDateInput.value;
    });
    reviveDateRow.appendChild(reviveTomorrowBtn);

    const reviveDateClearBtn = document.createElement('button');
    reviveDateClearBtn.className = 'date-clear-btn';
    reviveDateClearBtn.type = 'button';
    reviveDateClearBtn.textContent = '날짜 지우기';
    reviveDateClearBtn.addEventListener('click', () => {
      reviveDateInput.value = '';
      draftDueDate = '';
    });
    reviveDateRow.appendChild(reviveDateClearBtn);

    reviveCard.appendChild(reviveDateRow);

    function resetReviveDraft() {
      reviveTextInput.value = task.text;
      draftSubtasks = (task.subtasks || []).map(s => s.text);
      renderReviveSubtasks();
      reviveSubtaskInput.value = '';
      draftDueDate = '';
      reviveDateInput.value = '';
    }

    // "또 하기"는 리갈 패드 안에 카드를 펼치는 대신 모달로 물어봄 —
    // 완료를 누르면 지금 초안 그대로 새 카드를 만들고, 취소/Esc/바깥 클릭이면
    // 아무것도 안 함(지난 기록은 어느 쪽이든 그대로).
    reviveBtn.addEventListener('click', async () => {
      resetReviveDraft();
      reviveCard.hidden = false;
      const ok = await showConfirm({
        title: '어떻게 기억해둘까요?',
        content: reviveCard,
        confirmLabel: '완료',
        cancelLabel: '취소',
        anchorEl: li,
        focusEl: reviveTextInput,
        beforeConfirm: () => {
          if (!reviveTextInput.value.trim()) {
            reviveTextInput.focus();
            return false;
          }
        }
      });
      if (ok) {
        // 지정한 날짜가 있으면 그 날짜로 예정(scheduled), 없으면 today로
        // 바로 되살림 — 날짜는 선택 사항.
        reviveTask(task, { text: reviveTextInput.value.trim(), subtasks: draftSubtasks.slice(), dueDate: draftDueDate });
      }
      reviveCard.hidden = true;
      resetReviveDraft();
    });

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.type = 'button';
    del.setAttribute('aria-label', '삭제');
    del.textContent = '🗑️';
    del.addEventListener('click', () => {
      // A today/scheduled entry here is still live on its real board (see
      // collectArchiveEntries) — delete it there; only entries already
      // swept into boards.archive get deleted from that array.
      if (entry.source === 'archive') {
        deleteArchivedTask(task.id);
      } else {
        deleteTask(entry.source, task.id);
        renderArchive();
      }
    });

    controls.appendChild(reviveBtn);
    controls.appendChild(del);
    li.appendChild(controls);
    return li;
  }

  // "다가오는 일" — pray later 카드에 안 보이는(7일 넘게 남은) scheduled
  // 항목들. 저장 시점 플래그가 아니라 dueDate로 매번 다시 걸러내므로,
  // 하루 지나 7일 이내로 들어오면 다음 렌더링에서 자연스럽게 사라지고
  // pray later 쪽에 나타남.
  function renderUpcoming() {
    if (!archiveUpcomingEl) return;
    archiveUpcomingEl.innerHTML = '';

    const items = boards.scheduled
      .filter(t => !t.done && daysUntilDue(t.dueDate) > 7)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    if (items.length === 0) {
      const hint = document.createElement('li');
      hint.className = 'empty-hint';
      hint.textContent = '아직, 없음';
      archiveUpcomingEl.appendChild(hint);
      return;
    }

    items.forEach(task => archiveUpcomingEl.appendChild(renderUpcomingItem(task)));
  }

  function renderUpcomingItem(task) {
    const li = document.createElement('li');
    li.className = 'archive-item';
    li.dataset.id = task.id;

    const text = document.createElement('span');
    text.className = 'archive-item-text upcoming-item-text';
    text.textContent = task.text;
    text.tabIndex = 0;
    text.setAttribute('role', 'button');
    text.setAttribute('aria-label', '내용 수정');
    // 이 칸의 li는 .task-item이 아니라 .archive-item이라 findTaskLi
    // (.task-item[data-id]로 찾음) 기반의 공용 startEditTask를 못 씀 —
    // 여기서만 쓰는 가벼운 인라인 편집을 따로 둠. task는 boards.scheduled
    // 안 실제 객체라 여기서 바로 고쳐써도 됨.
    text.addEventListener('click', () => {
      const input = document.createElement('input');
      input.className = 'task-edit-input';
      input.type = 'text';
      input.value = task.text;
      input.maxLength = 100;
      text.replaceWith(input);
      input.focus();
      input.select();

      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        const trimmed = input.value.trim();
        if (trimmed) task.text = trimmed;
        saveBoards();
        renderUpcoming();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') {
          input.value = task.text;
          input.blur();
        }
      });
      input.addEventListener('blur', () => setTimeout(commit, 0));
    });
    li.appendChild(text);

    // 하위 항목이 평소엔 접혀 있으니 옆에 (완료/전체)만 남겨둠. 항상 보임
    // (.subtask-progress의 기본 표시 규칙은 waiting/someday/완료 항목 한정).
    const progress = makeSubtaskProgress(task);
    if (progress) {
      progress.classList.add('subtask-progress-always');
      li.appendChild(progress);
    }

    const badge = document.createElement('span');
    badge.className = 'due-badge';
    badge.textContent = formatDueDateRelative(task.dueDate);
    // 📅 버튼 대신 날짜 배지를 눌러서 수정
    badge.tabIndex = 0;
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', '날짜 수정');
    li.appendChild(badge);

    const controls = document.createElement('div');
    controls.className = 'archive-item-controls';

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.type = 'button';
    del.setAttribute('aria-label', '삭제');
    del.textContent = '🗑️';
    del.addEventListener('click', () => deleteTask('scheduled', task.id));
    controls.appendChild(del);

    li.appendChild(controls);

    const dateRow = document.createElement('div');
    dateRow.className = 'date-picker-row';
    dateRow.hidden = true;

    const dateInput = document.createElement('input');
    dateInput.className = 'date-picker-input';
    dateInput.type = 'date';
    dateInput.value = task.dueDate;

    // renderItem의 날짜 피커와 같은 이유로 디바운스 — 이미 날짜가 채워진
    // 채로 열려서, 키패드로 두 자리 숫자를 치는 도중 첫 자리만으로 change가
    // 발생해 곧장 커밋+닫힘이 일어나는 문제를 막음.
    let commitTimer = null;
    dateInput.addEventListener('change', () => {
      clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        if (dateInput.value) {
          setDueDate('scheduled', task.id, dateInput.value);
          dateRow.hidden = true;
        }
      }, 400);
    });
    dateRow.appendChild(wrapDateInputWithHint(dateInput));

    const clearBtn = document.createElement('button');
    clearBtn.className = 'date-clear-btn';
    clearBtn.type = 'button';
    clearBtn.textContent = '닫기';
    clearBtn.addEventListener('click', () => {
      clearTimeout(commitTimer);
      dateRow.hidden = true;
    });
    dateRow.appendChild(clearBtn);

    // (예전엔 blur 시 자동으로도 닫았는데, 안드로이드 크롬은 네이티브
    // 달력이 뜨는 동안 입력창이 blur돼서 첫 탭에 피커가 바로 닫혀버리는
    // 문제가 있었음 — 제거함.)
    dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearTimeout(commitTimer);
        dateRow.hidden = true;
      }
    });

    const toggleUpcomingDateRow = () => {
      dateRow.hidden = !dateRow.hidden;
      if (dateRow.hidden) clearTimeout(commitTimer);
      else dateInput.focus();
    };
    badge.addEventListener('click', toggleUpcomingDateRow);
    badge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleUpcomingDateRow();
      }
    });

    // 하위 항목이 있으면 평소엔 접어두고 이 줄에 호버(또는 안의 무언가에
    // 포커스)했을 때만 펼쳐서 보여줌 — 목록이 다닥다닥 붙어있는 "not my
    // problem... yet" 칸이 하위 항목까지 항상 펼쳐놓으면 너무 빽빽해짐.
    // task는 boards.scheduled 안 실제 객체라 여기서 바로 고쳐써도 됨.
    const subList = document.createElement('ul');
    subList.className = 'subtask-list upcoming-subtask-list';

    function syncUpcomingProgress() {
      if (!progress) return;
      progress.textContent = subtaskProgressText(task);
      progress.hidden = task.subtasks.length === 0;
    }

    function renderUpcomingSubtasks() {
      subList.innerHTML = '';
      subList.hidden = task.subtasks.length === 0;
      syncUpcomingProgress();
      task.subtasks.forEach(sub => {
        const subLi = document.createElement('li');
        subLi.className = 'subtask-item' + (sub.done ? ' done' : '');
        subLi.dataset.id = sub.id;

        const chip = document.createElement('button');
        chip.className = 'subtask-chip';
        chip.type = 'button';
        chip.setAttribute('aria-label', sub.done ? '완료 취소' : '완료 표시');
        chip.textContent = '[' + sub.text + ']';
        // renderSubtaskItem과 동일한 이유로 클릭을 살짝 늦춰서, 더블클릭이
        // 오면 완료 토글 없이 편집 모드로만 들어가게 함.
        let chipClickTimer = null;
        chip.addEventListener('click', () => {
          clearTimeout(chipClickTimer);
          chipClickTimer = setTimeout(() => {
            sub.done = !sub.done;
            saveBoards();
            subLi.classList.toggle('done', sub.done);
            syncUpcomingProgress();
          }, 400);
        });
        chip.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          clearTimeout(chipClickTimer);
          startEditUpcomingSubtask(sub, chip);
        });

        const edit = document.createElement('button');
        edit.className = 'subtask-edit-btn';
        edit.type = 'button';
        edit.setAttribute('aria-label', '수정');
        edit.textContent = '✎';
        edit.addEventListener('click', () => startEditUpcomingSubtask(sub, chip));

        const del = document.createElement('button');
        del.className = 'subtask-delete-btn';
        del.type = 'button';
        del.setAttribute('aria-label', '삭제');
        del.textContent = '×';
        del.addEventListener('click', () => {
          task.subtasks = task.subtasks.filter(s => s.id !== sub.id);
          saveBoards();
          renderUpcomingSubtasks();
        });

        subLi.appendChild(chip);
        subLi.appendChild(edit);
        subLi.appendChild(del);
        subList.appendChild(subLi);
      });
    }

    function startEditUpcomingSubtask(sub, chipEl) {
      const input = document.createElement('input');
      input.className = 'subtask-edit-input';
      input.type = 'text';
      input.value = sub.text;
      input.maxLength = 100;
      input.size = Math.max(2, sub.text.length);
      fitSubtaskEditInput(input, chipEl);
      chipEl.replaceWith(input);
      input.focus();
      input.select();

      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        const trimmed = input.value.trim();
        if (trimmed) sub.text = trimmed;
        saveBoards();
        renderUpcomingSubtasks();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') {
          input.value = sub.text;
          input.blur();
        }
      });
      input.addEventListener('blur', () => setTimeout(commit, 0));
    }

    renderUpcomingSubtasks();
    li.appendChild(subList);
    // 하위 항목 아래에 날짜 행이 오도록 이 순서로 붙임 — 위에 붙이면
    // 날짜를 눌렀을 때 하위 항목 "위"에 끼어드는 것처럼 보였음.
    li.appendChild(dateRow);

    return li;
  }

  // Ctrl+Z 패널 — 최근 3일 안에 지운 항목만 보여줌(오래된 건 migrateArchive가
  // 이미 걸러냄). doneAt이 아니라 deletedAt 기준으로 정렬해 방금 지운
  // 게 맨 위로 오게 함.
  function renderTrash() {
    if (!archiveTrashEl) return;
    archiveTrashEl.innerHTML = '';

    const items = boards.trash
      .slice()
      .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || '') || b.id - a.id);

    if (items.length === 0) {
      const hint = document.createElement('li');
      hint.className = 'empty-hint';
      hint.textContent = '최근 3일간 지운 항목 없음';
      archiveTrashEl.appendChild(hint);
      return;
    }

    items.forEach(task => archiveTrashEl.appendChild(renderTrashItem(task)));
  }

  function renderTrashItem(task) {
    const li = document.createElement('li');
    li.className = 'archive-item';
    li.dataset.id = task.id;

    const text = document.createElement('span');
    text.className = 'archive-item-text upcoming-item-text';
    text.textContent = task.text;
    li.appendChild(text);

    const badge = document.createElement('span');
    badge.className = 'due-badge';
    badge.textContent = formatDueDateRelative(task.deletedAt);
    li.appendChild(badge);

    const controls = document.createElement('div');
    controls.className = 'archive-item-controls';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'archive-revive-btn';
    restoreBtn.type = 'button';
    restoreBtn.textContent = '↩ 되살리기';
    restoreBtn.addEventListener('click', () => restoreFromTrash(task.id));
    controls.appendChild(restoreBtn);

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.type = 'button';
    del.setAttribute('aria-label', '완전히 삭제');
    del.textContent = '🗑️';
    del.addEventListener('click', () => {
      boards.trash = boards.trash.filter(t => t.id !== task.id);
      saveBoards();
      renderTrash();
    });
    controls.appendChild(del);

    li.appendChild(controls);
    return li;
  }

  function reviveTask(archivedTask, opts) {
    opts = opts || {};
    const text = (opts.text || '').trim() || archivedTask.text;
    const subtaskTexts = Array.isArray(opts.subtasks)
      ? opts.subtasks
      : (archivedTask.subtasks || []).map(s => s.text);
    const clone = {
      id: Date.now(),
      text,
      done: false,
      urgent: !!archivedTask.urgent,
      subtasks: subtaskTexts.map((t, i) => ({ id: Date.now() + i, text: t, done: false }))
    };
    if (archivedTask.note) clone.note = archivedTask.note;
    // 날짜를 지정했으면 그 날짜로 예정(scheduled), 안 지정했으면 today로
    // 바로 되살림 — 되살리기 카드의 날짜는 선택 사항.
    if (opts.dueDate) {
      clone.dueDate = opts.dueDate;
      boards.scheduled.push(clone);
    } else {
      boards.today.push(clone);
    }
    saveBoards();
    render('today');
    render('scheduled');
    if (archivePanelEl.classList.contains('open')) renderUpcoming();
  }

  function deleteArchivedTask(id) {
    const idx = boards.archive.findIndex(t => t.id === id);
    if (idx === -1) return;
    const [task] = boards.archive.splice(idx, 1);
    task.from = 'archive';
    task.deletedAt = todayStr();
    boards.trash.push(task);
    saveBoards();
    renderArchive();
    if (archivePanelEl.classList.contains('open')) renderTrash();
  }

  const TRASH_RESTORE_TARGETS = ['today', 'waiting', 'someday', 'scheduled', 'lupin', 'archive'];

  function restoreFromTrash(id) {
    const idx = boards.trash.findIndex(t => t.id === id);
    if (idx === -1) return;
    const [task] = boards.trash.splice(idx, 1);
    const target = TRASH_RESTORE_TARGETS.includes(task.from) ? task.from : 'today';
    delete task.deletedAt;
    delete task.from;
    boards[target].push(task);
    saveBoards();
    if (target === 'archive') {
      renderArchive();
    } else {
      render(target);
      if (target === 'scheduled') render('today');
    }
    renderTrash();
  }

  function openAddSubtaskRow(boardId, taskId, open) {
    const li = findTaskLi(taskId);
    if (!li) return;
    const toggle = li.querySelector('.add-subtask-toggle');
    const row = li.querySelector('.add-subtask-row');
    if (!toggle || !row) return;
    row.hidden = !open;
    toggle.hidden = open;
    if (open) {
      const input = row.querySelector('.new-subtask-input');
      if (input) input.focus();
    }
  }

  function renderSubtaskItem(boardId, taskId, sub) {
    const li = document.createElement('li');
    li.className = 'subtask-item' + (sub.done ? ' done' : '');
    li.dataset.id = sub.id;

    const chip = document.createElement('button');
    chip.className = 'subtask-chip';
    chip.type = 'button';
    chip.setAttribute('aria-label', sub.done ? '완료 취소' : '완료 표시');
    chip.textContent = '[' + sub.text + ']';
    // 더블클릭으로 이름을 바꾸려는 순간에도 그 앞의 두 번의 click이 먼저
    // 따로 fire돼서 완료 표시가 잠깐 켜졌다 꺼지는 게 거슬렸음 — 클릭을
    // 곧장 처리하지 않고 살짝 늦춰서, 그 사이 dblclick이 오면 완료 토글
    // 자체를 아예 취소하고 편집 모드로만 들어가게 함. 250ms는 실제
    // 더블클릭 속도(보통 300~500ms 간격)보다 짧아서 놓치는 경우가 있어
    // 400ms로 늘림 — 단일 클릭 반응이 아주 살짝 늦어지지만 더블클릭
    // 인식이 훨씬 안정적임.
    let chipClickTimer = null;
    chip.addEventListener('click', () => {
      clearTimeout(chipClickTimer);
      chipClickTimer = setTimeout(() => {
        toggleSubtask(boardId, taskId, sub.id);
      }, 400);
    });
    chip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      clearTimeout(chipClickTimer);
      startEditSubtask(boardId, taskId, sub.id);
    });

    // 더블클릭으로 편집 들어가는 게 클릭 타이밍과 겹쳐서 헷갈린다는 피드백
    // 때문에 추가한, 호버하면 삭제(×) 옆에 같이 뜨는 명시적 수정 버튼 —
    // 더블클릭은 그대로 남겨두되(익숙한 사람은 계속 씀) 이게 기본 경로.
    const edit = document.createElement('button');
    edit.className = 'subtask-edit-btn';
    edit.type = 'button';
    edit.setAttribute('aria-label', '수정');
    edit.textContent = '✎';
    edit.addEventListener('click', () => startEditSubtask(boardId, taskId, sub.id));

    const del = document.createElement('button');
    del.className = 'subtask-delete-btn';
    del.type = 'button';
    del.setAttribute('aria-label', '삭제');
    del.textContent = '×';
    del.addEventListener('click', () => deleteSubtask(boardId, taskId, sub.id));

    li.appendChild(chip);
    li.appendChild(edit);
    li.appendChild(del);
    return li;
  }

  function startEditTask(boardId, id) {
    const task = boards[boardId].find(t => t.id === id);
    const li = findTaskLi(id);
    if (!task || !li) return;
    const textEl = li.querySelector('.task-text');
    if (!textEl) return;

    const input = document.createElement('input');
    input.className = 'task-edit-input';
    input.type = 'text';
    input.value = task.text;
    input.maxLength = 100;
    textEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      delete li._activeEditCommit;
      const trimmed = input.value.trim();
      if (trimmed) task.text = trimmed;
      saveBoards();
      render(boardId);
      // 오늘 마감인 scheduled 항목은 실제로 today 목록 안에 그려져 있어서,
      // scheduled만 다시 그리면 방금 만든 이 input이 화면에 그대로 남음.
      if (boardId === 'scheduled') render('today');
    };
    // 날짜/긴급/하위 항목 버튼이 지금 수정 중인 텍스트를 두고 그냥 눌리면,
    // 그 클릭은 (아래 blur 핸들러의 설계대로) 옛(수정 전) DOM 위에서 먼저
    // 실행된 뒤에야 commit()의 render()가 뒤늦게 실행됨 — 문제는 날짜 행을
    // "연" 상태처럼 그 클릭이 남겨놓은 UI 상태가, 뒤이은 render()가 li를
    // 통째로 새로 그리면서 흔적도 없이 지워져버린다는 것(연 순간 바로 원래
    // 값으로 돌아가 보이는 원인). 해당 버튼들이 클릭 시점에 이 함수를 먼저
    // 불러 커밋+재렌더링을 앞당기고, 새로 그려진 li에서 자기 자신을 다시
    // 찾아 클릭을 재발사하도록 함(Alt+D/E 단축키가 이미 쓰던 방식과 동일).
    li._activeEditCommit = commit;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
        // Shift+Enter(=Alt+Enter) — 새 항목 입력창과 같은 규칙: 지금 수정한 상위 항목을
        // 먼저 확정하고, 그 항목의 하위 항목 입력을 바로 열어서 포커스.
        // commit()이 li를 통째로 다시 그리므로 새로 그려진 li에서 다시 찾아 엶.
        e.preventDefault();
        commit();
        openAddSubtaskRow(boardId, id, true);
      } else if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = task.text;
        input.blur();
      } else if (e.altKey && (e.code === 'KeyD' || e.code === 'KeyE')) {
        e.preventDefault();
        // Opening the date row (or clicking urgent) re-renders the list —
        // commit the text edit first so that render happens once, up
        // front, instead of firing again later via this input's own blur
        // and wiping out the date row we just opened.
        commit();
        const freshLi = findTaskLi(id);
        const btn = freshLi && freshLi.querySelector(e.code === 'KeyD' ? '.date-btn' : '.urgent-btn');
        if (btn) btn.click();
      }
    });
    // 삭제/긴급/날짜 등 옆 버튼을 탭하면 이 입력창이 먼저 blur되는데,
    // commit()을 바로 실행하면 render()가 리스트를 통째로 다시 그려서
    // 지금 막 탭한 그 버튼 엘리먼트 자체가 DOM에서 사라짐 — 이어서 와야 할
    // click 이벤트가 죽은 노드를 향해 날아가 아무 일도 안 일어남(모바일
    // 휴지통 눌러도 삭제 안 되던 원인). 한 틱 미뤄서 그 버튼의 click이
    // 먼저 끝나고 나서 commit이 실행되게 함.
    input.addEventListener('blur', () => setTimeout(commit, 0));
  }

  // 브라우저 기본 confirm 대신 쓰는 앱 스타일 확인 모달. 확인 시 true,
  // 취소/Esc/바깥 클릭 시 false로 resolve. 이미 떠 있으면 앞 모달이 닫힌
  // 뒤에 차례로 띄움(클라우드 불러오기 선택이 다른 모달 때문에 자동
  // '취소'로 처리되어 데이터를 덮어쓰는 일이 없도록).
  // anchorEl(부모 항목)의 왼쪽 위 모서리에 카드의 왼쪽 위 모서리를 맞춰
  // 띄움. 화면 밖으로 나가면 안쪽으로 밀어 넣음. anchorEl이 없으면
  // (클라우드 불러오기 등) 가운데.
  function positionConfirmCard(overlay, anchorEl) {
    const card = overlay.querySelector('.confirm-card');
    card.style.left = card.style.top = '';
    overlay.classList.remove('anchored');
    if (!anchorEl || !anchorEl.isConnected) return;
    const r = anchorEl.getBoundingClientRect();
    if (!r.width && !r.height) return;
    overlay.classList.add('anchored');
    const m = 12;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const left = Math.max(m, Math.min(r.left, window.innerWidth - cw - m));
    const top = Math.max(m, Math.min(r.top, window.innerHeight - ch - m));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  // 라벨에 줄바꿈이 있으면 둘째 줄부터 작은 글씨로 보조 설명처럼 표시.
  function setConfirmBtnLabel(btn, label) {
    const [main, ...rest] = label.split('\n');
    btn.textContent = main;
    if (rest.length) {
      const sub = document.createElement('small');
      sub.textContent = rest.join(' ');
      btn.appendChild(sub);
    }
  }

  let confirmQueue = Promise.resolve();
  function showConfirm(opts) {
    const run = confirmQueue.then(() => showConfirmNow(opts));
    confirmQueue = run.catch(() => {});
    return run;
  }
  function showConfirmNow({ title, message = '', confirmLabel = '확인', cancelLabel = '취소', anchorEl = null, content = null, beforeConfirm = null, focusEl = null }) {
    const overlay = document.getElementById('confirmModal');
    if (!overlay) return Promise.resolve(false);
    const card = overlay.querySelector('.confirm-card');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    const messageEl = document.getElementById('confirmMessage');
    const contentEl = document.getElementById('confirmContent');
    document.getElementById('confirmTitle').textContent = title;
    messageEl.textContent = message;
    messageEl.hidden = !message;
    contentEl.innerHTML = '';
    contentEl.hidden = !content;
    if (content) contentEl.appendChild(content);
    setConfirmBtnLabel(okBtn, confirmLabel);
    setConfirmBtnLabel(cancelBtn, cancelLabel);
    const prevFocus = document.activeElement;

    return new Promise(resolve => {
      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        overlay.removeEventListener('click', onOverlay);
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.classList.remove('open');
        overlay.hidden = true;
        if (content) content.remove();
        contentEl.hidden = true;
        if (prevFocus && typeof prevFocus.focus === 'function' && prevFocus.isConnected) prevFocus.focus();
        resolve(result);
      }
      const onOk = () => {
        if (beforeConfirm && beforeConfirm() === false) return;
        close(true);
      };
      const onCancel = () => close(false);
      const onOverlay = e => { if (e.target === overlay) close(false); };
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(false);
        } else if (e.key === 'Tab') {
          // 포커스가 모달 밖으로 나가지 않게 카드 안 요소들 사이에서만 순환
          const items = Array.from(card.querySelectorAll('button, input, select, textarea'))
            .filter(el => !el.disabled && el.offsetParent !== null);
          if (!items.length) return;
          const i = items.indexOf(document.activeElement);
          const next = e.shiftKey
            ? items[i <= 0 ? items.length - 1 : i - 1]
            : items[i === -1 || i === items.length - 1 ? 0 : i + 1];
          e.preventDefault();
          next.focus();
        } else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          // 뒤쪽 화면의 단축키가 Enter를 가로채지 않게 (입력칸/textarea의 Enter는 그대로 통과 —
          // 메모 칸의 Shift+Enter 저장이 그 칸의 keydown까지 닿아야 함)
          e.stopPropagation();
        }
      }
      document.addEventListener('keydown', onKey, true);
      overlay.addEventListener('click', onOverlay);
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.hidden = false;
      positionConfirmCard(overlay, anchorEl);
      requestAnimationFrame(() => overlay.classList.add('open'));
      (focusEl || okBtn).focus();
      if (focusEl && typeof focusEl.select === 'function') focusEl.select();
    });
  }

  // 항목 메모 모달. 읽기 모드는 상위 항목 + 하위 항목 + 메모를 보여주고,
  // "수정"을 누르면 같은 모달 안에서 셋 다 입력칸으로 바뀜(저장/취소).
  // 기존 확인 모달(showConfirm)을 그대로 쓰고, 확인 버튼의 beforeConfirm이
  // false를 돌려주면 닫히지 않는 점을 이용해 읽기→수정 전환을 처리함.
  async function openNoteModal(boardId, taskId, opts) {
    opts = opts || {};
    let task = boards[boardId] && boards[boardId].find(t => t.id === taskId);
    if (!task) return;
    const overlay = document.getElementById('confirmModal');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    if (!overlay) return;

    // 저장하면 뒤쪽 목록이 다시 그려져서 anchorEl(항목 li)이 DOM에서
    // 사라짐 — 그러면 카드가 가운데로 튀므로, 처음 위치를 기억해 둔 가짜
    // 앵커로 항상 같은 자리에 붙여둠.
    const anchorRect = opts.anchorEl && opts.anchorEl.isConnected ? opts.anchorEl.getBoundingClientRect() : null;
    const anchor = anchorRect ? { isConnected: true, getBoundingClientRect: () => anchorRect } : null;

    let editing = false;
    let draftTitle = '';
    let draftSubs = [];
    let draftNote = '';
    let subSeq = 0;

    const card = document.createElement('div');
    card.className = 'revive-card note-card';

    // 수정 중에는 어느 칸에서든 Shift+Enter(= Alt/Ctrl/Cmd+Enter)로 저장 — 새 항목 입력창의
    // Shift+Enter("확정하고 다음으로")와 같은 규칙. 메모 칸의 Enter는 그냥 줄바꿈.
    card.addEventListener('keydown', (e) => {
      if (editing && e.key === 'Enter' && !e.isComposing && (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        okBtn.click();
      }
    });

    const startDraft = () => {
      draftTitle = task.text;
      draftSubs = (task.subtasks || []).map(s => ({ id: s.id, text: s.text, done: !!s.done }));
      draftNote = task.note || '';
    };

    let titleInput = null;
    let noteArea = null;
    let newSubInput = null;

    function buildView() {
      clearEl(card);
      const title = document.createElement('p');
      title.className = 'note-view-title';
      title.textContent = task.text;
      card.appendChild(title);
      if (task.subtasks && task.subtasks.length) {
        const list = document.createElement('ul');
        list.className = 'subtask-list';
        task.subtasks.forEach(sub => {
          const li = document.createElement('li');
          li.className = 'subtask-item' + (sub.done ? ' done' : '');
          const chip = document.createElement('span');
          chip.className = 'subtask-chip';
          chip.textContent = '[' + sub.text + ']';
          li.appendChild(chip);
          list.appendChild(li);
        });
        card.appendChild(list);
      }
      const body = document.createElement('p');
      body.className = 'note-view-body';
      body.textContent = task.note || '';
      card.appendChild(body);
    }

    function buildEdit() {
      clearEl(card);
      titleInput = document.createElement('input');
      titleInput.className = 'revive-text-input';
      titleInput.type = 'text';
      titleInput.maxLength = 100;
      titleInput.value = draftTitle;
      titleInput.addEventListener('input', () => { draftTitle = titleInput.value; });
      card.appendChild(titleInput);

      const list = document.createElement('ul');
      list.className = 'subtask-list';
      list.hidden = draftSubs.length === 0;
      draftSubs.forEach((sub, i) => {
        const li = document.createElement('li');
        li.className = 'subtask-item' + (sub.done ? ' done' : '');
        const input = document.createElement('input');
        input.className = 'note-sub-input';
        input.type = 'text';
        input.maxLength = 100;
        input.value = sub.text;
        input.addEventListener('input', () => { sub.text = input.value; });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'subtask-delete-btn';
        del.setAttribute('aria-label', '삭제');
        del.textContent = '×';
        del.addEventListener('click', () => {
          draftSubs.splice(i, 1);
          buildEdit();
          positionConfirmCard(overlay, anchor);
        });
        li.appendChild(input);
        li.appendChild(del);
        list.appendChild(li);
      });
      card.appendChild(list);

      const addRow = document.createElement('div');
      addRow.className = 'add-subtask-row';
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'plus';
      plus.setAttribute('aria-label', '하위 항목 등록');
      plus.textContent = '+';
      newSubInput = document.createElement('input');
      newSubInput.className = 'new-subtask-input';
      newSubInput.type = 'text';
      newSubInput.placeholder = '하위 항목 추가...';
      newSubInput.autocomplete = 'off';
      newSubInput.maxLength = 100;
      const addSub = () => {
        const v = newSubInput.value.trim();
        if (!v) return;
        draftSubs.push({ id: Date.now() + (subSeq++), text: v, done: false });
        buildEdit();
        positionConfirmCard(overlay, anchor);
        newSubInput.focus();
      };
      newSubInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSub(); });
      plus.addEventListener('click', addSub);
      addRow.appendChild(plus);
      addRow.appendChild(newSubInput);
      card.appendChild(addRow);

      noteArea = document.createElement('textarea');
      noteArea.className = 'note-textarea';
      noteArea.rows = 4;
      noteArea.maxLength = NOTE_MAX;
      noteArea.placeholder = '메모...';
      noteArea.value = draftNote;
      noteArea.addEventListener('input', () => { draftNote = noteArea.value; });
      card.appendChild(noteArea);
    }

    // 글 전체가 선택되지 않게(showConfirm의 focusEl은 select()를 부름)
    // 따로 포커스하고 커서를 맨 끝에 둠.
    function focusNoteArea() {
      if (!noteArea) return;
      noteArea.focus();
      noteArea.setSelectionRange(noteArea.value.length, noteArea.value.length);
    }

    // 수정 중 저장/취소 후엔 모달을 닫지 않고 읽기 화면으로 돌아감
    function leaveEdit() {
      editing = false;
      buildView();
      setConfirmBtnLabel(okBtn, '수정');
      setConfirmBtnLabel(cancelBtn, '닫기');
      positionConfirmCard(overlay, anchor);
      okBtn.focus();
    }

    // 초안을 실제 항목에 저장. 항목이 사라졌으면 false.
    function commitDraft() {
      // 모달이 떠 있던 사이 상태가 바뀌었을 수 있어 id로 다시 찾음
      const cur = boards[boardId] && boards[boardId].find(t => t.id === taskId);
      if (!cur) return false;
      cur.text = draftTitle.trim();
      cur.subtasks = draftSubs
        .map(s => ({ id: s.id, text: s.text.trim(), done: s.done }))
        .filter(s => s.text);
      const note = draftNote.trim().slice(0, NOTE_MAX);
      if (note) cur.note = note;
      else delete cur.note;
      if (focusState && focusState.taskId === taskId) {
        focusState.taskText = cur.text;
        saveFocusState();
      }
      saveBoards();
      render(boardId);
      if (boardId === 'scheduled') render('today');
      if (focusState) renderFocusPanel();
      if (searchPanelEl.classList.contains('open')) renderSearchResults();
      task = cur;
      return true;
    }

    function enterEdit() {
      editing = true;
      startDraft();
      buildEdit();
      setConfirmBtnLabel(okBtn, '저장');
      setConfirmBtnLabel(cancelBtn, '취소');
      positionConfirmCard(overlay, anchor);
      focusNoteArea();
    }

    if (opts.startEditing || (!task.note && !opts.view)) {
      editing = true;
      startDraft();
      buildEdit();
    } else {
      buildView();
    }

    // 수정 중(되돌아갈 읽기 화면이 있을 때)에는 취소/Esc/바깥 클릭도 모달을
    // 닫지 않고 초안을 버린 채 읽기 화면으로 돌아감. showConfirm의 리스너보다
    // 먼저 등록돼서 stopImmediatePropagation으로 닫힘을 막음.
    function backToView(e) {
      if (!editing || !(task.note || opts.view)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      leaveEdit();
    }
    function onOverlayWhileEditing(e) { if (e.target === overlay) backToView(e); }
    function onEscWhileEditing(e) { if (e.key === 'Escape') backToView(e); }
    cancelBtn.addEventListener('click', backToView);
    overlay.addEventListener('click', onOverlayWhileEditing);
    document.addEventListener('keydown', onEscWhileEditing, true);

    if (editing) setTimeout(focusNoteArea, 60);
    await showConfirm({
      title: '메모',
      content: card,
      confirmLabel: editing ? '저장' : '수정',
      cancelLabel: editing ? '취소' : '닫기',
      anchorEl: anchor,
      beforeConfirm: () => {
        if (!editing) {
          enterEdit();
          return false;
        }
        // 입력해두고 +를 안 누른 하위 항목도 같이 저장
        const pending = newSubInput && newSubInput.value.trim();
        if (pending) draftSubs.push({ id: Date.now() + (subSeq++), text: pending, done: false });
        if (!draftTitle.trim()) {
          titleInput.focus();
          return false;
        }
        if (!commitDraft()) return; // 항목이 사라졌으면 그냥 닫음
        // 메모를 비워서 저장했으면 보여줄 게 없으니 닫고, 아니면 읽기 화면으로
        // (검색 결과에서 연 모달은 메모가 없어도 읽기 화면이 있음)
        if (!task.note && !opts.view) return;
        leaveEdit();
        return false;
      }
    });
    cancelBtn.removeEventListener('click', backToView);
    overlay.removeEventListener('click', onOverlayWhileEditing);
    document.removeEventListener('keydown', onEscWhileEditing, true);
  }

  async function toggleTask(boardId, id, opts = {}) {
    const skipConfirm = !!opts.skipConfirm;
    let task = boards[boardId].find(t => t.id === id);
    if (!task) return;

    // 미완료 하위항목이 남은 채로 부모를 완료하려 하면 먼저 확인 —
    // 확인하면 하위항목도 함께 완료, 취소하면 아무것도 바꾸지 않음.
    // (하위항목을 다 끝내도 부모 자동 완료는 없고, 부모를 되돌려도
    // 하위항목 상태는 그대로 둠.)
    if (!task.done) {
      const pending = (task.subtasks || []).filter(s => !s.done);
      if (pending.length > 0) {
        if (!skipConfirm) {
          const ok = await showConfirm({
            title: '아직 못 끝낸 하위 항목이 있어요',
            message: '미완료 하위 항목 ' + pending.length + '개가 남아 있어요.\n함께 완료 처리할까요?',
            confirmLabel: '모두 완료',
            cancelLabel: '취소',
            anchorEl: opts.anchorEl || findTaskLi(id)
          });
          if (!ok) return;
          // 모달이 떠 있던 사이 상태가 바뀌었을 수 있어 다시 찾음
          task = boards[boardId].find(t => t.id === id);
          if (!task || task.done) return;
        }
        const taskLi = findTaskLi(id);
        task.subtasks.forEach(s => {
          if (s.done) return;
          s.done = true;
          const subLi = taskLi && taskLi.querySelector('.subtask-list [data-id="' + s.id + '"]');
          if (subLi) subLi.classList.add('done');
        });
        refreshSubtaskProgress(taskLi, task);
      }
    }

    task.done = !task.done;
    if (task.done) task.doneAt = todayStr();
    else delete task.doneAt;

    const li = findTaskLi(id);
    if (li) {
      li.classList.toggle('done', task.done);
      animateStrikeLines(li, task.done);
    }

    saveBoards();

    // lupin은 체크해도 절대 done 아카이브로 넘어가지 않음 — 숨겨진 개인
    // 메모라 다른 보드로 옮겨지듯 노출되면 안 되고, 취소선만 그어진 채
    // 지우기 전까지 그 자리에 그대로 남아있음.
    if (boardId === 'lupin') {
      setTimeout(() => render(boardId), REORDER_DELAY);
      return;
    }

    const today = todayStr();
    // `today` tasks (plain, or a scheduled task due today rendered inside
    // today's list) get a same-day grace period before archiving; anything
    // else archives immediately once the strikethrough animation finishes.
    const gracedToday = boardId === 'today' || (boardId === 'scheduled' && task.dueDate === today);

    setTimeout(() => {
      // Ctrl+Z로 boards가 통째로 교체됐을 수 있어 옛 task 객체 대신 지금
      // 상태를 다시 찾아 확인 — 되돌린 항목이 그대로 아카이브로 가지 않게.
      const cur = boards[boardId] && boards[boardId].find(t => t.id === id);
      if (cur && cur.done && !gracedToday) {
        archiveNow(boardId, id);
      } else {
        // gotta do 카드 안에서 체크/체크해제 후 구분선 위아래로 다시
        // 나타나는 항목은 뚝 끊기지 않게 살짝 떠오르며 페이드인 —
        // move-arrive-fade를 그대로 재사용.
        moveHighlight = { id, mode: 'fade' };
        render(boardId);
        // A scheduled task due today/overdue is displayed inside today's
        // list, not scheduled's — refresh both so it lands in the right one.
        if (boardId === 'scheduled') render('today');
      }
    }, REORDER_DELAY);
  }

  function archiveNow(boardId, id) {
    const idx = boards[boardId].findIndex(t => t.id === id);
    if (idx === -1) return;
    const [task] = boards[boardId].splice(idx, 1);
    delete task.dueDate;
    task.from = boardId;
    boards.archive.push(task);
    saveBoards();
    render(boardId);
    if (boardId === 'scheduled') render('today');
    if (archivePanelEl.classList.contains('open')) renderArchive();
  }

  function deleteTask(boardId, id) {
    const idx = boards[boardId].findIndex(t => t.id === id);
    if (idx === -1) return;
    const [task] = boards[boardId].splice(idx, 1);
    task.from = boardId;
    task.deletedAt = todayStr();
    boards.trash.push(task);
    saveBoards();
    render(boardId);
    if (boardId === 'scheduled') {
      render('today');
      if (archivePanelEl.classList.contains('open')) renderUpcoming();
    }
    if (archivePanelEl.classList.contains('open')) renderTrash();
  }

  function moveTask(fromBoardId, toBoardId, id) {
    const idx = boards[fromBoardId].findIndex(t => t.id === id);
    if (idx === -1) return;
    const [task] = boards[fromBoardId].splice(idx, 1);
    delete task.dueDate;
    delete task.replyDate; // 회신 예정일은 waiting에 있을 때만 의미 있음
    delete task.from;
    if (toBoardId === 'waiting') {
      // waiting has no done concept — defend against a done task landing
      // there via a hover move-button from another board.
      task.done = false;
      delete task.doneAt;
    }
    boards[toBoardId].push(task);
    if (toBoardId === 'today' && (fromBoardId === 'waiting' || fromBoardId === 'someday' || fromBoardId === 'scheduled')) {
      moveHighlight = { id, mode: 'wiggle' };
    } else if (fromBoardId === 'today' && toBoardId === 'waiting') {
      moveHighlight = { id, mode: 'wiggle' };
    } else if (fromBoardId === 'today' && toBoardId === 'someday') {
      moveHighlight = { id, mode: 'fade' };
    }
    saveBoards();
    render(fromBoardId);
    render(toBoardId);
    // scheduled 항목(오늘 마감/지난 마감분)은 실제로 today 카드 안에
    // 그려져 있어서, scheduled 쪽이 오가면 today도 같이 다시 그려야
    // 화면에서 바로 사라지거나 나타남 — 안 하면 새로고침 전까진 그대로
    // 남아있는 것처럼 보임.
    if (fromBoardId === 'scheduled' || toBoardId === 'scheduled') render('today');
  }

  // Assigning a date on a today/someday task moves it into `scheduled`;
  // changing the date on an already-scheduled task keeps it there;
  // clearing it sends it back to the board it came from.
  function setDueDate(boardId, id, dateValue) {
    const idx = boards[boardId].findIndex(t => t.id === id);
    if (idx === -1) return;
    const task = boards[boardId][idx];

    if (boardId === 'waiting') {
      // 회신 예정일: 보드를 옮기지 않고 필드만 바꿈. 내일 이후면 접힘 구역,
      // 오늘/지난 날짜/없음이면 일반 목록(renderWaiting이 매번 다시 가름).
      // 오늘 이전 날짜는 적용하지 않음(입력창 min으로 1차 차단, 직접 타이핑한
      // 값은 여기서 막고 다시 그려 입력창 표시값도 원래대로 되돌림).
      if (dateValue && dateValue < todayStr()) {
        render('waiting');
        return;
      }
      if (dateValue) task.replyDate = dateValue;
      else delete task.replyDate;
      saveBoards();
      render('waiting');
      return;
    }

    if (boardId === 'scheduled') {
      if (dateValue) {
        task.dueDate = dateValue;
        saveBoards();
        render('today');
        render('scheduled');
      } else {
        boards.scheduled.splice(idx, 1);
        // 오늘 마감이거나 지난 마감이면 pray later... 카드가 아니라 이미
        // gotta do 카드 안(dueToday/oops)에 그려지고 있었던 항목이라,
        // 날짜를 지우면 원래 왔던 someday 등으로 돌아가는 대신 지금 보고
        // 있던 그대로 today에 남아야 자연스러움. 아직 pray later...에만
        // 있던(미래 날짜) 항목만 기존처럼 원래 보드로 돌려보냄.
        const wasInTodayCard = task.dueDate <= todayStr();
        const backTo = wasInTodayCard ? 'today' : (task.from || 'today');
        delete task.dueDate;
        delete task.from;
        boards[backTo].push(task);
        saveBoards();
        render('today');
        render('scheduled');
        render(backTo);
      }
      if (archivePanelEl.classList.contains('open')) renderUpcoming();
    } else if (dateValue) {
      boards[boardId].splice(idx, 1);
      task.dueDate = dateValue;
      task.from = boardId;
      boards.scheduled.push(task);
      if (boardId === 'today') {
        moveHighlight = { id, mode: 'fade' };
      }
      saveBoards();
      render(boardId);
      render('today');
      render('scheduled');
      if (archivePanelEl.classList.contains('open')) renderUpcoming();
    }
  }

  // Tracks, per board, the id of the task most recently created via
  // addTask — used by the Shift+Enter/Shift+D/Shift+E input shortcuts so
  // they target the task the user just typed, not merely whatever happens
  // to sit last in the array (which could be an unrelated older task if
  // no task has been added yet in this session).
  const lastAddedTaskId = { today: null, waiting: null, someday: null, lupin: null };

  // Set right before a render caused by toggleUrgent, so the freshly
  // rebuilt li for that one task can play an in/out animation once —
  // renderItem consumes and clears it as soon as it matches.
  let urgentFlash = null;

  // Set right before a render caused by moveTask, so the freshly rebuilt li
  // for that one task can play a one-shot arrival animation — renderItem
  // consumes and clears it as soon as it matches. 'wiggle' is a light shake,
  // used both for waiting/someday/scheduled -> today and for today ->
  // waiting; 'fade' is a soft fade/rise-in for today -> someday. Any other
  // transition gets no animation.
  let moveHighlight = null;

  // draft: 등록 전 입력창에서 마우스로 미리 정해둔 긴급/날짜/하위 항목
  // ({ urgent, dueDate, subtasks: string[] }) — 새 항목 입력창의 draft
  // 컨트롤(아래 [data-newtask] 와이어링)에서 넘어옴.
  function addTask(boardId, text, draft) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const task = {
      id: Date.now(),
      text: trimmed,
      done: false,
      urgent: !!(draft && draft.urgent),
      subtasks: (draft && draft.subtasks || []).map((t, i) => ({ id: Date.now() + i, text: t, done: false }))
    };
    lastAddedTaskId[boardId] = task.id;
    if (boardId === 'waiting' && draft && draft.dueDate) {
      task.replyDate = draft.dueDate;
      boards.waiting.push(task);
      saveBoards();
      render('waiting');
    } else if (draft && draft.dueDate) {
      // setDueDate가 today/someday 항목을 scheduled로 옮길 때와 동일한
      // 모양 — 처음부터 날짜가 있는 채로 바로 scheduled에 생성함.
      task.dueDate = draft.dueDate;
      task.from = boardId;
      boards.scheduled.push(task);
      saveBoards();
      render(boardId);
      render('today');
      render('scheduled');
      if (archivePanelEl.classList.contains('open')) renderUpcoming();
    } else {
      boards[boardId].push(task);
      saveBoards();
      render(boardId);
    }
  }

  // Resolves the shortcut target for a board: the task tracked by
  // lastAddedTaskId, but only if it still actually exists there (it may
  // have been deleted or moved elsewhere since) — or, if a draft date was
  // set at creation, in `scheduled` instead (see addTask).
  function getShortcutTargetTask(boardId) {
    const id = lastAddedTaskId[boardId];
    if (id == null) return null;
    return boards[boardId].find(t => t.id === id) || boards.scheduled.find(t => t.id === id) || null;
  }

  function toggleUrgent(boardId, id) {
    const task = boards[boardId].find(t => t.id === id);
    if (!task) return;
    task.urgent = !task.urgent;
    urgentFlash = { id, mode: task.urgent ? 'in' : 'out' };
    saveBoards();
    render(boardId);
    if (boardId === 'scheduled') render('today');
  }

  // 하위 항목 수정 입력창 너비 — size(글자 수)는 한글처럼 폭이 넓은 글자에서
  // 실제보다 훨씬 좁게 잡혀 글자가 잘렸음. 원래 칩 너비에서 시작해 글자를
  // 입력하는 만큼 같은 글꼴로 실제 폭을 재서 늘림. chipEl은 아직 DOM에
  // 붙어 있을 때(replaceWith 전에) 넘겨야 너비를 잴 수 있음.
  function fitSubtaskEditInput(input, chipEl) {
    const startW = chipEl && chipEl.offsetWidth ? chipEl.offsetWidth : 0;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;';
    const fit = () => {
      if (!input.isConnected) return;
      const cs = getComputedStyle(input);
      probe.style.font = cs.font;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.textContent = input.value || ' ';
      document.body.appendChild(probe);
      const textW = probe.getBoundingClientRect().width;
      probe.remove();
      input.style.boxSizing = 'content-box';
      input.style.width = Math.ceil(Math.max(startW, textW + 8)) + 'px';
    };
    input.addEventListener('input', fit);
    // 붙은 직후(replaceWith 다음 틱)에 한 번 맞춤 — 그때부터 폰트가 계산됨
    requestAnimationFrame(fit);
  }

  function startEditSubtask(boardId, taskId, subId) {
    const task = boards[boardId].find(t => t.id === taskId);
    const sub = task && task.subtasks.find(s => s.id === subId);
    const taskLi = findTaskLi(taskId);
    const subLi = taskLi && taskLi.querySelector('.subtask-list [data-id="' + subId + '"]');
    if (!sub || !subLi) return;
    const chipEl = subLi.querySelector('.subtask-chip');
    if (!chipEl) return;

    const input = document.createElement('input');
    input.className = 'subtask-edit-input';
    input.type = 'text';
    input.value = sub.text;
    input.maxLength = 100;
    input.size = Math.max(2, sub.text.length);
    fitSubtaskEditInput(input, chipEl);
    chipEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const trimmed = input.value.trim();
      if (trimmed) sub.text = trimmed;
      saveBoards();
      render(boardId);
      if (boardId === 'scheduled') render('today');
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = sub.text;
        input.blur();
      }
    });
    // 삭제 버튼을 탭해서 blur됐을 때, commit()의 render()가 그 버튼을
    // 곧장 지워버려 뒤이은 click이 허공에 날아가는 걸 막기 위해 한 틱 미룸
    // (startEditTask와 동일한 이유).
    input.addEventListener('blur', () => setTimeout(commit, 0));
  }

  function toggleSubtask(boardId, taskId, subId) {
    const task = boards[boardId].find(t => t.id === taskId);
    if (!task) return;
    const sub = task.subtasks.find(s => s.id === subId);
    if (!sub) return;
    sub.done = !sub.done;

    const taskLi = findTaskLi(taskId);
    const subLi = taskLi && taskLi.querySelector('.subtask-list [data-id="' + subId + '"]');
    if (subLi) subLi.classList.toggle('done', sub.done);
    refreshSubtaskProgress(taskLi, task);

    saveBoards();
    updateCounter();
  }

  function deleteSubtask(boardId, taskId, subId) {
    const task = boards[boardId].find(t => t.id === taskId);
    if (!task) return;
    task.subtasks = task.subtasks.filter(s => s.id !== subId);
    saveBoards();
    render(boardId);
    if (boardId === 'scheduled') render('today');
  }

  function addSubtask(boardId, taskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const task = boards[boardId].find(t => t.id === taskId);
    if (!task) return;
    task.subtasks.push({ id: Date.now(), text: trimmed, done: false });
    saveBoards();
    render(boardId);
    if (boardId === 'scheduled') render('today');
    openAddSubtaskRow(boardId, taskId, true);
  }

  // p 단축키 두 번째 누름에서 someday 입력창의 날짜 피커를 열어주기 위해
  // 아래 forEach(해당 입력창이 만들어질 때) 안에서 채워짐.
  let openSomedayDatePicker = null;

  document.querySelectorAll('[data-newtask]').forEach(input => {
    // waiting 스티키 뒷면(lupin)의 입력창도 같은 .sticky[data-board="waiting"]
    // 안에 물리적으로 들어있어서 .closest('.sticky')로는 구분이 안 됨 —
    // 뒷면 래퍼 자체에 data-board="lupin"을 따로 붙여두고 가장 가까운
    // [data-board]를 찾아서 앞/뒷면 입력창을 정확히 구분함.
    const boardId = input.closest('[data-board]').dataset.board;
    const addRow = input.closest('.add-row');

    // 아직 등록 전인 새 항목에 대해서도 날짜/긴급/하위 항목을 마우스로
    // 미리 정해둘 수 있게 하는 "초안" 상태 — 등록되는 순간 addTask로
    // 그대로 넘어가고, 등록 후엔 다음 입력을 위해 리셋됨.
    let draftUrgent = false;
    let draftDueDate = '';
    let draftSubtasks = [];

    // draftControls를 add-row 안에 같이 두면 opacity로 숨겨도 flex 공간은
    // 그대로 차지해서 "+"/입력창이 원래 자리에서 밀려남 — 그래서 실제
    // task-item처럼 별도의 행으로 분리하고, add-row를 감싸는 래퍼에
    // 마우스를 올리거나(또는 입력창에 포커스하면) max-height로 펼쳐서
    // 보여줌. 평소엔 높이 0이라 자리 자체를 안 차지함.
    const addRowWrap = document.createElement('div');
    addRowWrap.className = 'add-row-wrap';
    addRow.replaceWith(addRowWrap);
    addRowWrap.appendChild(addRow);

    const draftControls = document.createElement('div');
    draftControls.className = 'draft-controls';
    addRowWrap.appendChild(draftControls);

    const urgentBtn = document.createElement('button');
    urgentBtn.type = 'button';
    urgentBtn.className = 'urgent-btn';
    urgentBtn.setAttribute('aria-label', '긴급 표시');
    urgentBtn.textContent = '❗️';
    urgentBtn.addEventListener('click', () => {
      draftUrgent = !draftUrgent;
      urgentBtn.classList.toggle('draft-active', draftUrgent);
      // 버튼 자체는 호버 중에만 보이니, 긴급 여부는 행 배경색으로 항상
      // 표시해줌 — 실제 등록된 항목의 urgent 강조와 같은 방식.
      addRow.classList.toggle('draft-urgent', draftUrgent);
    });
    draftControls.appendChild(urgentBtn);

    const subtaskToggle = document.createElement('button');
    subtaskToggle.type = 'button';
    subtaskToggle.className = 'add-subtask-toggle';
    subtaskToggle.setAttribute('aria-label', '하위 항목 추가');
    subtaskToggle.textContent = '➕️';
    draftControls.appendChild(subtaskToggle);

    // waiting은 "회신 예정일"(replyDate) — 등록해도 waiting에 남음.
    let dateBtn = null;
    if (DATE_ENABLED_IDS.includes(boardId)) {
      dateBtn = document.createElement('button');
      dateBtn.type = 'button';
      dateBtn.className = 'date-btn';
      dateBtn.setAttribute('aria-label', boardId === 'waiting' ? '회신 예정일 지정' : '날짜 지정');
      dateBtn.textContent = '📅';
      draftControls.appendChild(dateBtn);
    }

    let insertAfter = addRowWrap;
    function insertAfterAddRow(el) {
      insertAfter.insertAdjacentElement('afterend', el);
      insertAfter = el;
    }

    let dateRow = null;
    let dateInput = null;
    let dateBadge = null;
    if (dateBtn) {
      dateBadge = document.createElement('span');
      dateBadge.className = 'due-badge';
      dateBadge.hidden = true;
      dateBadge.addEventListener('click', () => {
        dateRow.hidden = !dateRow.hidden;
        if (!dateRow.hidden) focusAndShowPicker(dateInput);
      });
      // draftControls(호버해야 보임)가 아니라 add-row 안에 둬서 날짜를
      // 지정해두면 호버 여부와 상관없이 항상 보이게 함.
      addRow.appendChild(dateBadge);

      dateRow = document.createElement('div');
      dateRow.className = 'date-picker-row';
      dateRow.hidden = true;

      dateInput = document.createElement('input');
      dateInput.className = 'date-picker-input';
      dateInput.type = 'date';
      if (boardId === 'waiting') dateInput.min = todayStr();

      const applyDraftDate = (value) => {
        if (boardId === 'waiting' && value && value < todayStr()) {
          dateInput.value = draftDueDate;
          return;
        }
        draftDueDate = value;
        dateBadge.hidden = !value;
        if (value) {
          dateBadge.textContent = formatDueDateRelative(value);
          // 모바일 네이티브 달력에서 날짜를 확정(체크)하거나 "내일"을
          // 누르면 그걸로 끝 — 다시 눌러야만 닫히던 예전 동작 대신
          // 곧장 닫아줌.
          dateRow.hidden = true;
        }
      };
      dateInput.addEventListener('change', () => applyDraftDate(dateInput.value));

      const tomorrowBtn = document.createElement('button');
      tomorrowBtn.type = 'button';
      tomorrowBtn.className = 'date-clear-btn';
      tomorrowBtn.textContent = '내일';
      tomorrowBtn.addEventListener('click', () => {
        dateInput.value = tomorrowStr();
        applyDraftDate(dateInput.value);
      });

      const dateClearBtn = document.createElement('button');
      dateClearBtn.type = 'button';
      dateClearBtn.className = 'date-clear-btn';
      dateClearBtn.textContent = '날짜 지우기';
      dateClearBtn.addEventListener('click', () => {
        dateInput.value = '';
        applyDraftDate('');
        dateRow.hidden = true;
      });

      // 아직 값을 고르기 전(빈 칸)이면 Esc로 그냥 닫을 수 있게.
      // (예전엔 blur 시 자동으로도 닫았는데, 안드로이드 크롬은 네이티브
      // 달력이 뜨는 동안 입력창이 blur돼서 첫 탭에 피커가 바로 닫혀버리는
      // 문제가 있었음 — 제거함.)
      dateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !dateInput.value) {
          e.preventDefault();
          dateClearBtn.click();
        }
      });

      dateRow.appendChild(wrapDateInputWithHint(dateInput));
      dateRow.appendChild(tomorrowBtn);
      dateRow.appendChild(dateClearBtn);
      dateBtn.addEventListener('click', () => {
        dateRow.hidden = !dateRow.hidden;
        if (!dateRow.hidden) focusAndShowPicker(dateInput);
      });
      insertAfterAddRow(dateRow);

      // p 단축키 두 번째 누름(pray later용 새 항목 입력 + 날짜 옵션 활성화)이
      // someday 입력창의 날짜 피커를 곧장 펼칠 수 있도록 바깥에 노출함.
      if (boardId === 'someday') {
        openSomedayDatePicker = () => {
          dateRow.hidden = false;
        };
      }
    }

    const subtaskChips = document.createElement('ul');
    subtaskChips.className = 'subtask-list';
    subtaskChips.hidden = true;
    insertAfterAddRow(subtaskChips);

    const subtaskRow = document.createElement('div');
    subtaskRow.className = 'add-subtask-row';
    subtaskRow.hidden = true;
    const subtaskPlus = document.createElement('button');
    subtaskPlus.type = 'button';
    subtaskPlus.className = 'plus';
    subtaskPlus.setAttribute('aria-label', '하위 항목 등록');
    subtaskPlus.textContent = '+';
    const subtaskInput = document.createElement('input');
    subtaskInput.className = 'new-subtask-input';
    subtaskInput.type = 'text';
    subtaskInput.placeholder = '하위 항목 추가...';
    subtaskInput.autocomplete = 'off';
    subtaskInput.maxLength = 100;

    function renderDraftSubtasks() {
      subtaskChips.innerHTML = '';
      subtaskChips.hidden = draftSubtasks.length === 0;
      draftSubtasks.forEach((text, i) => {
        const li = document.createElement('li');
        li.className = 'subtask-item';
        const chip = document.createElement('span');
        chip.className = 'subtask-chip';
        chip.textContent = '[' + text + ']';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'subtask-delete-btn';
        del.setAttribute('aria-label', '삭제');
        del.textContent = '×';
        del.addEventListener('click', () => {
          draftSubtasks.splice(i, 1);
          renderDraftSubtasks();
        });
        li.appendChild(chip);
        li.appendChild(del);
        subtaskChips.appendChild(li);
      });
    }

    function addDraftSubtask() {
      const trimmed = subtaskInput.value.trim();
      if (!trimmed) return;
      draftSubtasks.push(trimmed);
      subtaskInput.value = '';
      renderDraftSubtasks();
      subtaskInput.focus();
    }
    subtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addDraftSubtask();
    });
    subtaskPlus.addEventListener('click', addDraftSubtask);
    subtaskToggle.addEventListener('click', () => {
      subtaskRow.hidden = !subtaskRow.hidden;
      if (!subtaskRow.hidden) subtaskInput.focus();
    });

    subtaskRow.appendChild(subtaskPlus);
    subtaskRow.appendChild(subtaskInput);
    insertAfterAddRow(subtaskRow);

    // 등록 직전에 초안(긴급/날짜/하위 항목)을 addTask로 넘기고, 등록 후엔
    // 다음 입력을 위해 전부 원상태로 되돌림 — Enter, "+" 클릭, Alt+D/E
    // 선등록 전부 이 한 곳을 거쳐가게 해서 초안 처리가 한 군데로 모임.
    function commitDraft() {
      const trimmed = input.value.trim();
      if (!trimmed) return false;
      addTask(boardId, input.value, { urgent: draftUrgent, dueDate: draftDueDate, subtasks: draftSubtasks });
      input.value = '';
      draftUrgent = false;
      draftDueDate = '';
      draftSubtasks = [];
      urgentBtn.classList.remove('draft-active');
      addRow.classList.remove('draft-urgent');
      if (dateBadge) dateBadge.hidden = true;
      if (dateInput) dateInput.value = '';
      if (dateRow) dateRow.hidden = true;
      subtaskRow.hidden = true;
      renderDraftSubtasks();
      return true;
    }

    // "+" 버튼 — 지금까지는 Enter로만 등록할 수 있어서 마우스만으로는
    // 새 항목을 넣을 방법이 아예 없었음.
    const plusBtn = addRow.querySelector('.plus');
    plusBtn.addEventListener('click', () => {
      commitDraft();
      input.focus();
    });

    // task-item과 같은 이유 — 호버를 못 쓰는 터치 기기에서 긴급/하위 항목
    // 초안 버튼(draft-controls)을 길게 눌러서 펼치고 접음. 입력창 자체는
    // 제외해서(텍스트 선택/붙여넣기 같은 원래 동작을 안 건드림) "+" 버튼
    // 이나 빈 자리를 길게 누르면 됨.
    attachLongPress(addRow, () => addRowWrap.classList.toggle('controls-open'), 'input');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey || e.altKey) {
          if (commitDraft()) openAddSubtaskRow(boardId, lastAddedTaskId[boardId], true); // 등록된 그 항목의 하위 항목 입력을 바로 열고 포커스
        } else {
          commitDraft();
        }
        return;
      }
      // 아직 아무것도 안 친 새 항목 입력창이면 Esc로 포커스만 놓음(today/
      // waiting/someday/lupin 전부 이 리스너를 같이 타서 자동으로 다 적용됨) —
      // 뭔가 쳐놓은 상태에서 Esc를 누르면 그 텍스트는 그대로 두고 무시.
      if (e.key === 'Escape') {
        if (!input.value.trim()) input.blur();
        return;
      }
      // Alt+D/Alt+E — Shift+D/Shift+E였을 땐 "Draft", "Edit"처럼 대문자
      // D/E가 들어간 텍스트를 아예 칠 수 없어서(입력창이 비어있을 때만
      // 봐줘도 첫 글자가 D/E인 경우엔 여전히 충돌) Alt 조합으로 변경 —
      // 일반 타이핑으로는 절대 나오지 않는 조합이라 텍스트와 안 겹침.
      if ((e.altKey && e.code === 'KeyD') || (e.altKey && e.code === 'KeyE')) {
        // 아직 등록 안 하고 치고 있던 텍스트가 있으면 Shift+Enter처럼 먼저
        // 상위 항목으로 등록함 — 안 그러면 지금 치는 중인 게 아니라
        // 세션에서 마지막으로 등록됐던 예전 항목이 대상이 돼서 헷갈림.
        commitDraft();
      }
      if (e.altKey && e.code === 'KeyD') {
        const target = getShortcutTargetTask(boardId);
        if (!target) return;
        e.preventDefault();
        const li = findTaskLi(target.id);
        // 회신 예정일이 내일 이후라 접힘 구역에 들어간 waiting 항목이면
        // 날짜 행이 숨은 채로 열리지 않도록 구역부터 펼침.
        const laterSection = li && li.closest('[data-collapse-body]');
        if (laterSection && laterSection.hidden && collapseSections.waitingLater) collapseSections.waitingLater.setOpen(true);
        const dateBtn = li && li.querySelector('.date-btn');
        if (dateBtn) dateBtn.click();
        return;
      }
      if (e.altKey && e.code === 'KeyE') {
        const target = getShortcutTargetTask(boardId);
        if (!target) return;
        e.preventDefault();
        // 입력 중이던 포커스를 먼저 놓아서 "긴급 알림이 끼어든" 느낌을 줌 —
        // 토글 자체(및 애니메이션)는 그 다음에 일어남.
        input.blur();
        const li = findTaskLi(target.id);
        const urgentBtn = li && li.querySelector('.urgent-btn');
        if (urgentBtn) urgentBtn.click(); // 방금 등록한 할일의 긴급 표시를 토글
      }
    });
  });

  // lupin mode — waiting 스티키를 뒤집으면 나오는 개인용 숨김 메모장.
  // 🕶️/⏳ 아이콘 클릭 또는 키보드 l/w로 뒤집음(아래 keydown 리스너 참고).
  const waitingStickyEl = document.getElementById('waitingSticky');
  const lupinFlipBtn = document.getElementById('lupinFlipBtn');
  const lupinFlipBackBtn = document.getElementById('lupinFlipBackBtn');
  const lupinFrontEl = waitingStickyEl.querySelector('[data-lupin-front]');
  const lupinBackEl = waitingStickyEl.querySelector('[data-lupin-back]');

  let lupinOpen = false;
  // 실제 DOM 스왑은 애니메이션 중간(300ms 지연)에야 일어나므로, 그 사이에
  // 같은 방향으로 또 눌린 키(예: l→l, w→w)를 시간 간격으로 판단하면 한글
  // 입력기 경합 등으로 키 이벤트 간격이 벌어질 때 오판하기 쉬움 — 그래서
  // "지금 스왑이 진행 중인가"를 시간이 아니라 상태로 직접 들고 있음.
  let lupinSwapPending = false;
  let lupinFocusPending = false;
  let lupinSwapTimer = null;

  function isLupinOpen() {
    return lupinOpen;
  }

  // open이 true면 뒷면(lupin) 입력창을, false면 앞면(waiting) 입력창을
  // 포커스 대상으로 삼음 — l(뒤집어 들어갈 때)과 w(뒤집어 나올 때) 양쪽의
  // "이미 그 면이면 바로 포커스" 동작을 이 함수 하나로 같이 처리하기 위함.
  function setLupinOpen(open, focusInput) {
    if (lupinOpen === open) {
      // 이미 그 방향이거나(정지 상태) 그쪽으로 스왑 진행 중 — 새 애니메이션은
      // 시작하지 않고 포커스 요청만 반영.
      if (focusInput) {
        if (lupinSwapPending) {
          lupinFocusPending = true; // 스왑 콜백에서 마저 포커스
        } else {
          const faceEl = open ? lupinBackEl : lupinFrontEl;
          const input = faceEl.querySelector('[data-newtask]');
          if (input) input.focus();
        }
      }
      return;
    }

    lupinOpen = open;
    lupinSwapPending = true;
    lupinFocusPending = !!focusInput;
    clearTimeout(lupinSwapTimer);

    waitingStickyEl.classList.add('sticky-flipping');
    // 카드가 옆으로 서서 안 보이는 애니메이션 중간 지점에 표시 면을 바꿔치기
    // 해야 실제로 "뒤집는" 것처럼 보임(페이드가 아니라).
    lupinSwapTimer = setTimeout(() => {
      lupinFrontEl.hidden = open;
      lupinBackEl.hidden = !open;
      // 인라인 style="--paper: var(--paper-waiting)"가 이미 걸려있어서
      // 클래스 규칙보다 우선순위가 높음 — 같은 인라인 자리에서 직접 덮어씀.
      waitingStickyEl.style.setProperty('--paper', open ? 'var(--paper-lupin)' : 'var(--paper-waiting)');
      // lupin 리스트는 뒷면이 숨겨진(hidden) 채로 render()됐을 수 있어서
      // getClientRects()가 전부 0으로 잡혀 취소선 위치 계산이 틀렸을 수
      // 있음 — 실제로 보이게 된 지금 다시 잰다.
      if (open) layoutStrikeLines(getListEl('lupin'));
      lupinSwapPending = false;
      if (lupinFocusPending) {
        lupinFocusPending = false;
        const faceEl = open ? lupinBackEl : lupinFrontEl;
        const input = faceEl.querySelector('[data-newtask]');
        if (input) input.focus();
      }
    }, 300);
    waitingStickyEl.addEventListener('animationend', function handler() {
      waitingStickyEl.classList.remove('sticky-flipping');
      waitingStickyEl.removeEventListener('animationend', handler);
      // 위 중간 지점 재측정은 카드가 아직 회전(3D transform) 중일 때라
      // getClientRects() 폭이 원근/회전에 눌려 실제보다 짧게 잡힘 — 애니메이션이
      // 끝나 transform이 풀린 지금 한 번 더 정확한 폭으로 다시 잰다.
      if (lupinOpen) layoutStrikeLines(getListEl('lupin'));
    });
  }

  lupinFlipBtn.addEventListener('click', () => setLupinOpen(true));
  lupinFlipBackBtn.addEventListener('click', () => setLupinOpen(false));

  // lupin 모드를 켜둔 채로 탭을 다른 데로 돌리거나(visibilitychange) 다른
  // 창/앱으로 넘어가서(window blur) 3분 넘게 자리를 비우면, 개인 메모가
  // 계속 노출돼있지 않게 자동으로 waiting으로 되돌림. 잠깐 다른 탭
  // 확인하고 바로 돌아오는 정도는 안 꺼지게 유예 시간을 둠.
  const LUPIN_AWAY_CLOSE_MS = 3 * 60 * 1000;
  let lupinAwayTimer = null;

  function isAppAway() {
    return document.hidden || !document.hasFocus();
  }

  function handleAwayChange() {
    if (isAppAway()) {
      if (!isLupinOpen() || lupinAwayTimer) return;
      lupinAwayTimer = setTimeout(() => {
        lupinAwayTimer = null;
        if (isLupinOpen() && isAppAway()) setLupinOpen(false);
      }, LUPIN_AWAY_CLOSE_MS);
    } else if (lupinAwayTimer) {
      clearTimeout(lupinAwayTimer);
      lupinAwayTimer = null;
    }
  }

  document.addEventListener('visibilitychange', handleAwayChange);
  window.addEventListener('blur', handleAwayChange);
  window.addEventListener('focus', handleAwayChange);

  // focus mode (뽀모도로) — gotta do 카드 자체가 리스트 ↔ 타이머 레이아웃으로
  // 전환됨(별도 오버레이 없이 같은 카드 안에서 내용물만 갈아끼움). lupin
  // 모드와 똑같이 3D 플립 + 종이색 전환(--paper-focus)으로 "뒤집혀서
  // 다른 용도의 카드가 된다"는 은유를 그대로 씀.
  const todayStickyEl = document.getElementById('todaySticky');
  const todayListEl = todayStickyEl.querySelector('[data-today-list]');
  const todayFocusEl = todayStickyEl.querySelector('[data-today-focus]');
  const focusTitleEl = document.getElementById('focusTitleText');
  const focusBodyEl = document.getElementById('focusBody');
  const focusFooterEl = document.getElementById('focusFooter');
  const focusEnterBtn = document.getElementById('focusEnterBtn');
  const focusBackBtn = document.getElementById('focusBackBtn');
  const sideColEl = document.querySelector('.side-col');
  const headerEl = document.querySelector('.header');
  const FOCUS_DURATIONS_MIN = [3, 5, 15, 25];
  const FOCUS_TITLE_TEXT = 'f... focus 🍅';
  const FOCUS_STORAGE_KEY = 'postit-focus-session-v1';
  const ORIGINAL_DOCUMENT_TITLE = document.title;

  // 카운트다운 중엔 탭을 다른 데 두고도 남은 시간을 볼 수 있게 탭
  // 제목표시줄에 같이 띄움 — 매 렌더링(매초)마다 다시 불러서 항상
  // 최신 값으로 맞춤.
  function updateFocusDocumentTitle() {
    if (!focusState) {
      document.title = ORIGINAL_DOCUMENT_TITLE;
    } else if (focusState.step === 'running') {
      document.title = focusState.paused
        ? '⏸ ' + formatFocusClock(focusState.remainingSec) + ' · f... focus'
        : formatFocusClock(focusState.remainingSec) + ' · f... focus 🍅';
    } else if (focusState.step === 'ended') {
      document.title = '⏰ 다 됐어요! · f... focus';
    } else {
      document.title = ORIGINAL_DOCUMENT_TITLE;
    }
  }

  // 새로고침해도 타이머가 강제로 끊기지 않게 진행 상황을 localStorage에
  // 같이 저장해둠 — 남은 시간은 초 단위 카운터 대신 "언제 0에 도달하는지"
  // (endAt, 절대 시각)로 들고 있다가 매번 그 시각과 현재 시각의 차이로
  // 다시 계산함. 그래야 새로고침/짧은 절전 등으로 흐른 시간이 자동으로
  // 반영되고, setInterval이 배경 탭에서 늦게 불려도 화면 숫자가 밀리지
  // 않음.
  function saveFocusState() {
    try {
      if (!focusState) {
        localStorage.removeItem(FOCUS_STORAGE_KEY);
        return;
      }
      localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify({
        step: focusState.step,
        taskBoardId: focusState.taskBoardId,
        taskId: focusState.taskId,
        endAt: focusState.endAt,
        paused: !!focusState.paused,
        remainingSec: focusState.remainingSec
      }));
    } catch (e) {
      /* ignore */
    }
  }

  function clearFocusState() {
    try {
      localStorage.removeItem(FOCUS_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  // null이면 리스트 화면. 있으면 { step: 'pick-task'|'pick-duration'|
  // 'running'|'ended', taskBoardId, taskId, taskText, remainingSec,
  // intervalId, exitConfirmOpen, paused } — paused는 running 단계에서만
  // 의미 있고, true면 티커가 꺼진 채 remainingSec이 멈춘 시점 그대로임.
  // 어떤 보드(today/scheduled)에 실제로
  // 들어있는 항목인지 taskBoardId로 들고 있어야 toggleTask/moveTask를
  // 그대로 재사용할 수 있음(scheduled로 표시된 오늘 마감/지난 마감 항목도
  // gotta do 카드에 같이 그려지므로).
  let focusState = null;
  let todayFocusVisible = false;
  let todaySwapPending = false;
  let todaySwapTimer = null;

  // 카운트다운 진행 중이거나(러닝) 다 끝나서 결과를 고르는 중(엔디드)이면
  // "몰입 강제" 상태 — 마우스로 화면에 뜬 버튼을 눌러야만 빠져나갈 수
  // 있고, 그 어떤 키보드 단축키도 먹지 않음.
  function isFocusLocked() {
    return !!focusState && (focusState.step === 'running' || focusState.step === 'ended');
  }

  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function formatFocusClock(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // gotta do 카드에 지금 그려지는 항목들 그대로(체크 안 된 today 순수 항목
  // + 오늘 마감 + 지난 마감) — 순서도 renderToday와 동일하게.
  function getTodayFocusableTasks() {
    const today = todayStr();
    const active = boards.today
      .filter(t => !t.done)
      .map(t => ({ boardId: 'today', id: t.id, text: t.text }));
    const dueToday = boards.scheduled
      .filter(t => !t.done && t.dueDate === today)
      .sort(byDueDate)
      .map(t => ({ boardId: 'scheduled', id: t.id, text: t.text }));
    const oops = boards.scheduled
      .filter(t => !t.done && t.dueDate < today)
      .sort(byDueDate)
      .map(t => ({ boardId: 'scheduled', id: t.id, text: t.text }));
    return active.concat(dueToday, oops);
  }

  // 카운트다운 화면에서도 하위 항목을 하나씩 체크할 수 있게 — 기존
  // toggleSubtask를 그대로 재사용하되, 그쪽은 원본 task-item(지금은 숨겨진
  // gotta do 리스트 쪽)의 DOM만 직접 건드리고 focus 패널은 모르기 때문에
  // 토글 후 renderFocusPanel을 우리가 직접 다시 불러줌.
  function appendFocusSubtasks(container, boardId, taskId) {
    const task = boards[boardId] && boards[boardId].find(t => t.id === taskId);
    if (!task) return;
    const list = document.createElement('ul');
    list.className = 'subtask-list focus-subtask-list';
    (task.subtasks || []).forEach(sub => {
      const li = document.createElement('li');
      li.className = 'subtask-item' + (sub.done ? ' done' : '');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'subtask-chip';
      chip.setAttribute('aria-label', sub.done ? '완료 취소' : '완료 표시');
      chip.textContent = '[' + sub.text + ']';
      // 원본 subtask-chip과 같은 규칙(400ms — 실제 더블클릭 속도보다 짧으면
      // 놓침) — click을 살짝 늦춰 그 사이 dblclick이 오면 완료 토글 자체를
      // 취소함.
      let chipClickTimer = null;
      chip.addEventListener('click', () => {
        clearTimeout(chipClickTimer);
        chipClickTimer = setTimeout(() => {
          toggleSubtask(boardId, taskId, sub.id);
          renderFocusPanel();
        }, 400);
      });
      chip.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        clearTimeout(chipClickTimer);
        startEditFocusSubtask(boardId, taskId, sub.id, chip);
      });

      // 호버하면 뜨는 명시적 수정 버튼 — 더블클릭 타이밍과 헷갈리지 않는
      // 기본 경로(메인 리스트의 subtask-edit-btn과 동일).
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'subtask-edit-btn';
      editBtn.setAttribute('aria-label', '수정');
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', () => startEditFocusSubtask(boardId, taskId, sub.id, chip));

      li.appendChild(chip);
      li.appendChild(editBtn);
      list.appendChild(li);
    });
    // 하위 항목이 하나도 없어도 이 [+추가]는 항상 마지막 칩 자리에 보임 —
    // 별도 줄로 뺀 add-row는 없앰.
    list.appendChild(makeFocusAddSubtaskItem(boardId, taskId));
    container.appendChild(list);
  }

  // 마지막 하위 항목 칩 옆에 나란히 붙는 [+추가] — 누르면 그 자리에서
  // 바로 인라인 입력창으로 바뀜.
  function makeFocusAddSubtaskItem(boardId, taskId) {
    const li = document.createElement('li');
    li.className = 'subtask-item focus-subtask-add-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'subtask-chip focus-subtask-add-btn';
    btn.textContent = '[+추가]';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'focus-add-subtask-input';
    input.placeholder = '하위 항목...';
    input.maxLength = 100;
    input.hidden = true;

    btn.addEventListener('click', () => {
      btn.hidden = true;
      input.hidden = false;
      input.focus();
    });

    function closeInput() {
      input.hidden = true;
      input.value = '';
      btn.hidden = false;
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = input.value;
        input.value = '';
        // addFocusSubtask가 renderFocusPanel()로 전체를 다시 그려서 이
        // 항목도 새로 만들어짐(닫힌 상태로) — 여기서 더 할 일 없음.
        addFocusSubtask(boardId, taskId, text);
      } else if (e.key === 'Escape') {
        closeInput();
      }
    });
    input.addEventListener('blur', () => {
      if (!input.value) closeInput();
    });

    li.appendChild(btn);
    li.appendChild(input);
    return li;
  }

  function startEditFocusSubtask(boardId, taskId, subId, chipEl) {
    const task = boards[boardId] && boards[boardId].find(t => t.id === taskId);
    const sub = task && task.subtasks.find(s => s.id === subId);
    if (!sub || !chipEl) return;

    const input = document.createElement('input');
    input.className = 'subtask-edit-input';
    input.type = 'text';
    input.value = sub.text;
    input.maxLength = 100;
    input.size = Math.max(2, sub.text.length);
    fitSubtaskEditInput(input, chipEl);
    chipEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const trimmed = input.value.trim();
      if (trimmed) sub.text = trimmed;
      saveBoards();
      render(boardId);
      if (boardId === 'scheduled') render('today');
      renderFocusPanel();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = sub.text;
        input.blur();
      }
    });
    // 삭제 버튼 탭으로 blur됐을 때 commit()의 render()가 그 버튼을 먼저
    // 지워버리지 않게 한 틱 미룸(startEditTask와 동일한 이유).
    input.addEventListener('blur', () => setTimeout(commit, 0));
  }

  // 상위 항목(선택된 할 일) 텍스트 — 본문에 세 단계(pick-duration/running/
  // ended) 모두에서 같은 모양으로 나오므로 공통 팩토리로 뽑음. 클릭하면
  // 원본 task-text와 동일하게 곧장 편집 모드로 들어감.
  function makeFocusPickedTaskLabel() {
    const el = document.createElement('p');
    el.className = 'focus-picked-task';
    el.textContent = focusState.taskText;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', '할 일 내용 수정');
    el.addEventListener('click', startEditFocusTask);
    return el;
  }

  // 상위 항목 + 하위 항목을 점선 박스 하나로 묶음(시간 선택 박스와 같은
  // 스타일) — pick-duration/running/ended 세 곳 모두 동일한 모양이라
  // 공통 팩토리로 뽑음. showReselect는 pick-duration에서만 true로 넘어와
  // "다시 선택"을 박스 맨 아래(예전 add-subtask-row 자리)에 붙여줌 —
  // 진행 중/종료 후엔 안 보임.
  function makeFocusTaskBox(showReselect, flat) {
    const box = document.createElement('div');
    // flat: 진행 중/종료 화면 — 둥근 점선 박스 없이 글씨만(구분은 아래 타이머 띠의 점선)
    box.className = 'focus-box focus-task-box' + (flat ? ' focus-flat' : '');
    box.appendChild(makeFocusPickedTaskLabel());
    appendFocusSubtasks(box, focusState.taskBoardId, focusState.taskId);
    // 메모는 알약 대신 박스 안에 바로 보여줌 — 카운트다운 중엔 읽기 전용이고,
    // 시간 고르는 단계에선 누르면 메모 수정 모달이 열림(제목 수정과 같은 방식).
    const focusTask = boards[focusState.taskBoardId] && boards[focusState.taskBoardId].find(t => t.id === focusState.taskId);
    if (focusTask && focusTask.note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'focus-note';
      noteEl.textContent = focusTask.note;
      if (!isFocusLocked()) {
        noteEl.classList.add('focus-note-editable');
        noteEl.tabIndex = 0;
        noteEl.setAttribute('role', 'button');
        noteEl.setAttribute('aria-label', '메모 수정');
        const edit = () => openNoteModal(focusState.taskBoardId, focusState.taskId, { anchorEl: box, startEditing: true });
        noteEl.addEventListener('click', edit);
        noteEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); }
        });
      }
      box.appendChild(noteEl);
    }
    if (showReselect) {
      const reselectBtn = document.createElement('button');
      reselectBtn.type = 'button';
      reselectBtn.className = 'focus-reselect-btn';
      reselectBtn.textContent = '↻ 다시 고르기';
      reselectBtn.addEventListener('click', () => {
        focusState = { step: 'pick-task' };
        saveFocusState();
        renderFocusPanel();
      });
      box.appendChild(reselectBtn);
    }
    return box;
  }

  // 3/5/15/25분 프리셋 + 직접 입력(+). pick-duration(onPick 생략 시
  // startFocusCountdown)과 running의 "시간 변경"(onPick으로 진행 중인
  // endAt만 다시 계산하는 콜백 전달) 둘 다 이 박스를 재사용함.
  function makeFocusDurationBox(onPick) {
    const pick = onPick || (sec => startFocusCountdown(sec));
    const durationBox = document.createElement('div');
    durationBox.className = 'focus-box focus-duration-box focus-flat';
    const hint = document.createElement('p');
    hint.className = 'focus-duration-hint';
    hint.textContent = '⏰ 얼마나 집중할까요?';
    durationBox.appendChild(hint);
    const row = document.createElement('div');
    row.className = 'focus-duration-row';
    FOCUS_DURATIONS_MIN.forEach(min => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'focus-duration-btn';
      btn.textContent = '[' + min + '분]';
      btn.addEventListener('click', () => pick(min * 60));
      row.appendChild(btn);
    });

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'focus-duration-btn';
    customBtn.textContent = '[+]';
    customBtn.setAttribute('aria-label', '직접 입력');

    const customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.min = '1';
    customInput.max = '180';
    customInput.placeholder = '분';
    customInput.className = 'focus-duration-custom-input';
    customInput.hidden = true;

    customBtn.addEventListener('click', () => {
      customBtn.hidden = true;
      customInput.hidden = false;
      customInput.focus();
    });
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const min = parseInt(customInput.value, 10);
        if (min > 0) pick(min * 60);
      } else if (e.key === 'Escape') {
        customInput.hidden = true;
        customInput.value = '';
        customBtn.hidden = false;
      }
    });
    customInput.addEventListener('blur', () => {
      if (!customInput.value) {
        customInput.hidden = true;
        customBtn.hidden = false;
      }
    });

    row.appendChild(customBtn);
    row.appendChild(customInput);
    durationBox.appendChild(row);
    return durationBox;
  }

  // "빨리 등록하고 까먹어라" — 호버 토글 없이 항상 열려있는 입력창.
  // Enter로 등록하면 gotta do(today)에 바로 추가되고 입력창은 비워진 채
  // 그대로 다음 입력을 받음(renderFocusPanel이 다시 그려도 이 한 줄
  // 자체는 매번 새로 만들어지므로 자연히 비워짐).
  function makeFocusQuickAddTaskRow() {
    const wrap = document.createElement('div');
    wrap.className = 'focus-quick-add-row';
    // 메인(.add-row)처럼 "+" 버튼 + 왼쪽 정렬 입력창 — "+"를 눌러도 입력창에
    // 포커스가 가게 함.
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'plus focus-quick-add-plus';
    plus.setAttribute('aria-label', '새 할 일 등록');
    plus.textContent = '+';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'focus-quick-add-input';
    input.placeholder = '얘도 해야함..';
    input.maxLength = 100;
    plus.addEventListener('click', () => input.focus());
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value;
      addTask('today', text);
      // addTask -> render('today')가 renderFocusPanel까지 다시 그려서
      // 이 입력창도 새 노드로 바뀜 — 연달아 등록할 수 있게 그 새 입력창에
      // 다시 포커스를 줌.
      const fresh = focusBodyEl.querySelector('.focus-quick-add-input');
      if (fresh) fresh.focus();
    });
    wrap.appendChild(plus);
    wrap.appendChild(input);
    return wrap;
  }

  function addFocusSubtask(boardId, taskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const task = boards[boardId] && boards[boardId].find(t => t.id === taskId);
    if (!task) return;
    task.subtasks.push({ id: Date.now(), text: trimmed, done: false });
    saveBoards();
    render(boardId);
    if (boardId === 'scheduled') render('today');
    renderFocusPanel();
  }

  function startEditFocusTask() {
    if (!focusState || !focusState.taskBoardId) return;
    const boardId = focusState.taskBoardId;
    const taskId = focusState.taskId;
    const task = boards[boardId] && boards[boardId].find(t => t.id === taskId);
    const labelEl = focusBodyEl.querySelector('.focus-picked-task');
    if (!task || !labelEl) return;

    const input = document.createElement('input');
    input.className = 'focus-picked-task-edit';
    input.type = 'text';
    input.value = task.text;
    input.maxLength = 100;
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const trimmed = input.value.trim();
      if (trimmed) {
        task.text = trimmed;
        if (focusState) focusState.taskText = trimmed;
      }
      saveBoards();
      render(boardId);
      if (boardId === 'scheduled') render('today');
      renderFocusPanel();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = task.text;
        input.blur();
      }
    });
    // 옆 버튼 탭으로 blur됐을 때 commit()의 render()가 그 버튼을 먼저
    // 지워버리지 않게 한 틱 미룸(startEditTask와 동일한 이유).
    input.addEventListener('blur', () => setTimeout(commit, 0));
  }

  function makeFocusFooterBtn(text, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'focus-footer-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = '[' + text + ']';
    return btn;
  }

  function makeFocusIconBtn(icon, label, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'focus-footer-btn focus-icon-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = icon;
    btn.dataset.tip = label;
    btn.setAttribute('aria-label', label);
    return btn;
  }

  // 아이콘 줄의 버튼(data-tip)에 마우스/키보드 포커스가 가면 줄의
  // data-hint에 그 설명을 넣어 CSS가 그 아이콘 밑(세로는 고정)에 보여줌.
  function attachFocusIconHints(row) {
    const show = (e) => {
      const btn = e.target.closest('[data-tip]');
      if (!btn || !row.contains(btn)) return;
      row.dataset.hint = btn.dataset.tip;
      // 가로는 올린 아이콘의 가운데, 세로는 CSS의 고정값. offsetLeft는
      // hover 때 걸리는 scale의 영향을 안 받음.
      row.style.setProperty('--hint-x', (btn.offsetLeft + btn.offsetWidth / 2) + 'px');
    };
    const hide = () => { delete row.dataset.hint; };
    row.addEventListener('mouseover', show);
    row.addEventListener('focusin', show);
    row.addEventListener('mouseleave', hide);
    row.addEventListener('focusout', hide);
  }

  function renderFocusPanel() {
    if (!focusState) return;
    updateFocusDocumentTitle();
    clearEl(focusBodyEl);
    clearEl(focusFooterEl);
    // 선택 단계(할일/시간 고르는 중)에서만 gotta do로 돌아가는 아이콘을
    // 보여줌 — 카운트다운/종료 후엔 화면의 버튼으로만 빠져나가게 하는
    // "몰입 강제" 규칙이라 이 버튼도 같이 숨김.
    if (focusBackBtn) focusBackBtn.hidden = isFocusLocked();

    if (focusState.step === 'pick-task') {
      focusTitleEl.textContent = FOCUS_TITLE_TEXT;
      const tasks = getTodayFocusableTasks();
      if (tasks.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'focus-empty-hint';
        hint.textContent = '집중할 일이 없어요';
        focusBodyEl.appendChild(hint);
      } else {
        const list = document.createElement('div');
        list.className = 'focus-task-pick-list';
        tasks.forEach(t => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'focus-task-pick-btn';
          btn.textContent = t.text;
          btn.addEventListener('click', () => {
            focusState = { step: 'pick-duration', taskBoardId: t.boardId, taskId: t.id, taskText: t.text };
            saveFocusState();
            renderFocusPanel();
          });
          list.appendChild(btn);
        });
        focusBodyEl.appendChild(list);
      }
      return;
    }

    if (focusState.step === 'pick-duration') {
      // 선택 단계에선 제목을 'f... focus'로 고정해두고, 고른 할 일은
      // 본문 쪽에 보여줌 — 카운트다운이 시작된 뒤에야(running/ended)
      // 제목 자리가 실제 할 일 텍스트로 바뀜.
      focusTitleEl.textContent = FOCUS_TITLE_TEXT;
      focusBodyEl.appendChild(makeFocusTaskBox(true, true));
      focusBodyEl.appendChild(makeFocusDurationBox());
      return;
    }

    if (focusState.step === 'running') {
      // running/ended 단계에서도 제목은 'f... focus'로 그대로 두고, 할 일
      // 텍스트는 pick-duration과 마찬가지로 본문 쪽에 표시. "다시 선택"은
      // 진행 중엔 안 보임(showReselect 생략).
      focusTitleEl.textContent = FOCUS_TITLE_TEXT;
      focusBodyEl.appendChild(makeFocusTaskBox(false, true));
      const countdownBox = document.createElement('div');
      countdownBox.className = 'focus-box focus-duration-box focus-countdown-box focus-flat';
      if (focusState.paused) countdownBox.classList.add('focus-paused');
      const num = document.createElement('div');
      num.className = 'focus-countdown-number';
      num.textContent = formatFocusClock(focusState.remainingSec);
      countdownBox.appendChild(num);

      // 일시정지/재개 옆에 시간 추가를 같이 둠 — 둘 다 타이머 진행 중에
      // 자주 쓰는 버튼이라 숫자 바로 밑 한 줄에 묶음.
      {
        const pauseRow = document.createElement('div');
        pauseRow.className = 'focus-pause-row';
        const pauseBtn = makeFocusFooterBtn(focusState.paused ? '▶ 재개' : '⏸ 일시정지', 'focus-pause-btn');
        pauseBtn.addEventListener('click', () => {
          if (focusState.paused) resumeFocusCountdown();
          else pauseFocusCountdown();
        });
        pauseRow.appendChild(pauseBtn);

        // "시간 변경"(전체 재설정) 대신 "시간 추가" — 전체 선택 화면으로
        // 안 바뀌고, 이 자리에서 버튼이 곧장 분 입력창으로 바뀌어 지금
        // 남은 시간 위에 그만큼 더해줌.
        const addTimeBtn = makeFocusFooterBtn('시간 추가');
        const addTimeInput = document.createElement('input');
        addTimeInput.type = 'number';
        addTimeInput.min = '1';
        addTimeInput.max = '180';
        addTimeInput.placeholder = '분';
        addTimeInput.className = 'focus-duration-custom-input';
        addTimeInput.hidden = true;
        addTimeBtn.addEventListener('click', () => {
          addTimeBtn.hidden = true;
          addTimeInput.hidden = false;
          addTimeInput.focus();
        });
        function closeAddTimeInput() {
          addTimeInput.hidden = true;
          addTimeInput.value = '';
          addTimeBtn.hidden = false;
        }
        addTimeInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const min = parseInt(addTimeInput.value, 10);
            if (min > 0) {
              // 멈춰있는 동안엔 endAt이 재개할 때 remainingSec 기준으로
              // 다시 잡히므로(resumeFocusCountdown), 지금 굳이 건드리지
              // 않음 — 건드리면 재개 시 덮어써져 무의미해짐.
              if (!focusState.paused) focusState.endAt += min * 60 * 1000;
              focusState.remainingSec += min * 60;
              saveFocusState();
              renderFocusPanel();
            }
          } else if (e.key === 'Escape') {
            closeAddTimeInput();
          }
        });
        addTimeInput.addEventListener('blur', () => {
          if (!addTimeInput.value) closeAddTimeInput();
        });

        pauseRow.appendChild(addTimeBtn);
        pauseRow.appendChild(addTimeInput);
        countdownBox.appendChild(pauseRow);
      }

      // 완료/대기중/나가기 아이콘은 밑에 새 박스를 만드는 게 아니라 이
      // 숫자 박스 하단에 그대로 들어감 — #focusFooter는 running 단계에서
      // 더는 안 씀.
      {
        const actions = document.createElement('div');
        actions.className = 'focus-countdown-actions';
        // 완료/대기중/나가기는 글자 대신 이모지 아이콘만 — 의미는 title로.
        // 완료 아이콘은 gotta do 체크리스트의 체크박스와 같은 SVG(체크된
        // 상태)를 그대로 씀.
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'checkbox focus-check-btn';
        doneBtn.dataset.tip = '완료로 표시';
        doneBtn.setAttribute('aria-label', '완료로 표시');
        doneBtn.appendChild(makeCheckSvg());
        doneBtn.addEventListener('click', finishFocusAsDone);
        const waitBtn = makeFocusIconBtn('⏳', '대기중으로 변경');
        waitBtn.addEventListener('click', finishFocusAsWaiting);
        const exitBtn = makeFocusIconBtn('❌', '나가기');
        exitBtn.addEventListener('click', confirmExitFocus);
        actions.appendChild(doneBtn);
        actions.appendChild(waitBtn);
        actions.appendChild(exitBtn);
        attachFocusIconHints(actions);
        countdownBox.appendChild(actions);
      }
      focusBodyEl.appendChild(countdownBox);
      focusBodyEl.appendChild(makeFocusQuickAddTaskRow());
      applyFocusPaper();
      return;
    }

    if (focusState.step === 'ended') {
      focusTitleEl.textContent = FOCUS_TITLE_TEXT;
      focusBodyEl.appendChild(makeFocusTaskBox(false, true));
      // 진행 중 카운트다운 박스와 같은 반투명 점선 박스 안에 00:00 + 아이콘 4개
      // 한 줄로(숫자는 00:00으로 남김) — 완료는 gotta do 체크박스와 같은 SVG, 나머지는 이모지.
      const endBox = document.createElement('div');
      endBox.className = 'focus-box focus-duration-box focus-countdown-box focus-flat';
      // 0초에 도달한 순간 박스는 가장 급박한 색(100%)이었으니 거기서 시작해
      // 기본색으로 천천히 번지듯 돌아옴(디졸브) — 갑자기 평온해지지 않게.
      endBox.classList.add('focus-dissolve');
      endBox.style.setProperty('--focus-t', '100%');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        endBox.style.setProperty('--focus-t', '0%');
      }));
      const endNum = document.createElement('div');
      endNum.className = 'focus-countdown-number';
      endNum.textContent = formatFocusClock(0);
      endBox.appendChild(endNum);
      const endLabel = document.createElement('div');
      endLabel.className = 'focus-end-label';
      endLabel.textContent = '⏰ 다 됐어요!';
      endBox.appendChild(endLabel);
      const choices = document.createElement('div');
      choices.className = 'focus-countdown-actions focus-end-choices';

      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'checkbox focus-check-btn';
      doneBtn.dataset.tip = '완료로 표시';
      doneBtn.setAttribute('aria-label', '완료로 표시');
      doneBtn.appendChild(makeCheckSvg());
      doneBtn.addEventListener('click', finishFocusAsDone);

      // 같은 할 일로 시간 선택 단계로 돌아가 타이머를 다시 맞춤.
      const restartBtn = makeFocusIconBtn('🔄', '타이머 재설정');
      restartBtn.addEventListener('click', () => {
        focusState.step = 'pick-duration';
        focusState.endAt = null;
        focusState.paused = false;
        focusState.exitConfirmOpen = false;
        if (sideColEl) sideColEl.classList.remove('focus-blurred');
        if (headerEl) headerEl.classList.remove('focus-blurred');
        saveFocusState();
        updateFocusDocumentTitle();
        renderFocusPanel();
      });

      const waitBtn = makeFocusIconBtn('⏳', '대기중으로 변경');
      waitBtn.addEventListener('click', () => {
        moveTask(focusState.taskBoardId, 'waiting', focusState.taskId);
        exitFocusMode(false);
      });

      const failBtn = makeFocusIconBtn('😥', '앗... 못했어요');
      failBtn.addEventListener('click', () => exitFocusMode(false));

      choices.appendChild(doneBtn);
      choices.appendChild(restartBtn);
      choices.appendChild(waitBtn);
      choices.appendChild(failBtn);
      attachFocusIconHints(choices);
      endBox.appendChild(choices);
      focusBodyEl.appendChild(endBox);
      return;
    }
  }

  // 완료로 표시를 누르면 곧장 체크 처리하는 대신: 타이머 레이아웃 → 리스트로
  // 뒤집히는 애니메이션(setTodayFocusOpen, 300ms)이 끝나 항목이 실제로 다시
  // 보이는 시점에 맞춰 위글+빵빠레 축하 애니메이션을 먼저 보여주고, 그게
  // 끝난 뒤에야 toggleTask로 체크 처리(취소선 애니메이션)함.
  function finishFocusAsDone() {
    const boardId = focusState.taskBoardId;
    const taskId = focusState.taskId;
    exitFocusMode(false);
    setTimeout(() => {
      const li = findTaskLi(taskId);
      if (!li) {
        toggleTask(boardId, taskId, { skipConfirm: true });
        return;
      }
      li.classList.add('celebrate-flash');
      setTimeout(() => {
        li.classList.remove('celebrate-flash');
        toggleTask(boardId, taskId, { skipConfirm: true });
      }, FOCUS_CELEBRATE_MS);
    }, 300);
  }

  // 대기중으로 넘기는 것도 "이 일은 내 손을 떠났다"는 완료의 한 형태라
  // 완료와 같은 축하 애니메이션을 보여줌 — 뒤집히는 애니메이션이 끝난 뒤
  // 대기중 카드로 옮기고, 옮겨진 항목에서 위글+빵빠레를 터뜨림.
  function finishFocusAsWaiting() {
    const boardId = focusState.taskBoardId;
    const taskId = focusState.taskId;
    exitFocusMode(false);
    setTimeout(() => {
      moveTask(boardId, 'waiting', taskId);
      const li = findTaskLi(taskId);
      if (!li) return;
      li.classList.add('celebrate-flash');
      setTimeout(() => li.classList.remove('celebrate-flash'), FOCUS_CELEBRATE_MS);
    }, 300);
  }

  // 남은 시간이 FOCUS_URGENT_SEC 이하로 줄어들수록 카드 전체가 아니라
  // 가운데 타이머 박스(.focus-countdown-box)의 배경만 점점 빨갛게 변함 —
  // 0초에 가까울수록 더 진하게.
  function applyFocusPaper() {
    const box = focusBodyEl && focusBodyEl.querySelector('.focus-countdown-box');
    if (!box) return;
    const running = focusState && focusState.step === 'running';
    if (running && focusState.remainingSec < FOCUS_URGENT_SEC) {
      const t = Math.min(1, Math.max(0, 1 - focusState.remainingSec / FOCUS_URGENT_SEC));
      box.style.setProperty('--focus-t', Math.round(t * 100) + '%');
    } else {
      box.style.removeProperty('--focus-t');
    }
    // 숫자만 떨림 — FOCUS_URGENT_SEC(60초)부터 아주 약하게 시작해서
    // FOCUS_SHAKE_SEC(10초)에 1px까지 커지고, 거기서부터는 0초까지 3px로
    // 더 세짐. 세기는 최대(3px) 대비 비율(--focus-shake, 0~1). 일시정지
    // 중엔 멈춤.
    if (running && !focusState.paused && focusState.remainingSec < FOCUS_URGENT_SEC) {
      const r = focusState.remainingSec;
      const px = r > FOCUS_SHAKE_SEC
        ? 0.4 + 0.6 * (FOCUS_URGENT_SEC - r) / (FOCUS_URGENT_SEC - FOCUS_SHAKE_SEC)
        : 1 + 2 * (1 - r / FOCUS_SHAKE_SEC);
      box.style.setProperty('--focus-shake', (Math.min(3, px) / 3).toFixed(3));
      box.classList.add('focus-shaking');
    } else {
      box.style.removeProperty('--focus-shake');
      box.classList.remove('focus-shaking');
    }
  }

  function startFocusCountdown(durationSec) {
    focusState.step = 'running';
    focusState.endAt = Date.now() + durationSec * 1000;
    focusState.remainingSec = durationSec;
    focusState.exitConfirmOpen = false;
    // waiting 카드는 무조건 앞면 상태로 만들고 들어감 — 이미 앞면이어도
    // 그대로 두면 되는 거라 별도 조건 분기가 필요 없음.
    setLupinOpen(false);
    if (sideColEl) sideColEl.classList.add('focus-blurred');
    if (headerEl) headerEl.classList.add('focus-blurred');
    saveFocusState();
    renderFocusPanel();
    startFocusTicker();
  }

  // 일시정지 — endAt까지 안 기다리고 지금 남은 시간을 굳혀서 remainingSec에
  // 박아두고 티커를 끔. 재개 전까진 이 값이 그대로 진짜 남은 시간.
  function pauseFocusCountdown() {
    if (!focusState || focusState.paused) return;
    if (focusState.intervalId) {
      clearInterval(focusState.intervalId);
      focusState.intervalId = null;
    }
    focusState.remainingSec = focusState.endAt
      ? Math.max(0, Math.round((focusState.endAt - Date.now()) / 1000))
      : focusState.remainingSec;
    focusState.paused = true;
    saveFocusState();
    updateFocusDocumentTitle();
    renderFocusPanel();
  }

  // ❌ 누르는 즉시 타이머를 멈추고 확인 모달을 띄움. 나가면 리셋, 계속하면
  // 원래 상태로 복귀(원래 일시정지 중이었으면 그대로 멈춰둠).
  let focusExitConfirming = false;
  async function confirmExitFocus() {
    if (focusExitConfirming || !focusState) return;
    focusExitConfirming = true;
    const wasPaused = focusState.paused;
    if (!wasPaused) pauseFocusCountdown();
    try {
      const ok = await showConfirm({
        title: '이 일을 중단하고 메인으로 돌아갈까요?',
        message: '현재 진행 중인 타이머는 초기화됩니다.',
        confirmLabel: '네, 나갈게요\n(타이머 리셋)',
        cancelLabel: '계속 할게요\n(돌아가기)',
        anchorEl: document.querySelector('.focus-countdown-box')
      });
      if (ok) exitFocusMode(false);
      else if (!wasPaused) resumeFocusCountdown();
    } finally {
      focusExitConfirming = false;
    }
  }

  // 재개 — 멈춰있던 remainingSec 기준으로 endAt을 지금 시각에 새로 맞춰
  // 잡고 티커를 다시 켬.
  function resumeFocusCountdown() {
    if (!focusState || !focusState.paused) return;
    focusState.endAt = Date.now() + focusState.remainingSec * 1000;
    focusState.paused = false;
    saveFocusState();
    renderFocusPanel();
    startFocusTicker();
  }

  // endAt(0에 도달하는 절대 시각)과 지금 시각의 차이로 매번 다시 계산 —
  // 새로고침 직후 복원할 때도, 배경 탭이라 setInterval이 늦게 불릴 때도
  // 그냥 이 함수 하나로 항상 정확한 남은 시간이 나옴.
  function startFocusTicker() {
    if (!focusState || !focusState.endAt) return;
    focusState.intervalId = setInterval(() => {
      if (!focusState) return;
      const remaining = Math.max(0, Math.round((focusState.endAt - Date.now()) / 1000));
      focusState.remainingSec = remaining;
      if (remaining <= 0) {
        clearInterval(focusState.intervalId);
        focusState.intervalId = null;
        focusState.step = 'ended';
        saveFocusState();
        renderFocusPanel();
        return;
      }
      // 매초 전체를 다시 그리면 그 사이 열어둔 하위 항목 추가 입력창 같은
      // 걸 다 날려버리므로, 진행 중엔 숫자/탭 제목만 직접 갱신함 — 상태가
      // 실제로 바뀌는 시점(0 도달)에만 전체 렌더링.
      updateFocusDocumentTitle();
      applyFocusPaper();
      const numEl = focusBodyEl.querySelector('.focus-countdown-number');
      if (numEl) numEl.textContent = formatFocusClock(remaining);
    }, 1000);
  }

  // 리스트 ↔ 타이머 레이아웃 전환 — lupin 모드와 똑같은 3D 플립(같은
  // .sticky-flipping 애니메이션 재사용)과 종이색 전환(--paper를 토마토색
  // 으로) 방식을 그대로 씀. 카드가 "뒤집혀서" 다른 용도의 카드로 바뀐다는
  // 물리적 은유가 lupin과 같은 맥락이라는 피드백을 반영.
  function setTodayFocusOpen(open, focusInputAfter) {
    if (todayFocusVisible === open) {
      if (!open && focusInputAfter && !todaySwapPending) {
        const input = todayListEl.querySelector('[data-newtask]');
        if (input) input.focus();
      }
      return;
    }
    todayFocusVisible = open;
    todaySwapPending = true;
    clearTimeout(todaySwapTimer);
    todayStickyEl.classList.add('sticky-flipping');
    todaySwapTimer = setTimeout(() => {
      todayListEl.hidden = open;
      todayFocusEl.hidden = !open;
      // lupin은 원래 상태(waiting)도 --paper-waiting이라는 별도 변수라
      // 그대로 세팅하면 되지만, today의 기본 종이색 변수 이름 자체가
      // --paper라서 "닫힐 때 --paper를 var(--paper)로" 쓰면 자기 자신을
      // 참조하는 순환 참조가 되어 무효화됨 — 닫힐 땐 아예 인라인 오버라이드를
      // 지워서 전역 --paper를 그대로 물려받게 함.
      if (open) {
        todayStickyEl.style.setProperty('--paper', 'var(--paper-focus)');
      } else {
        todayStickyEl.style.removeProperty('--paper');
      }
      todaySwapPending = false;
      if (!open && focusInputAfter) {
        const input = todayListEl.querySelector('[data-newtask]');
        if (input) input.focus();
      }
    }, 300);
    todayStickyEl.addEventListener('animationend', function handler() {
      todayStickyEl.classList.remove('sticky-flipping');
      todayStickyEl.removeEventListener('animationend', handler);
    });
  }

  function exitFocusMode(focusInputAfter) {
    if (focusState && focusState.intervalId) clearInterval(focusState.intervalId);
    focusState = null;
    clearFocusState();
    updateFocusDocumentTitle();
    if (sideColEl) sideColEl.classList.remove('focus-blurred');
    if (headerEl) headerEl.classList.remove('focus-blurred');
    setTodayFocusOpen(false, focusInputAfter);
  }

  function enterFocusPickTask() {
    focusState = { step: 'pick-task' };
    saveFocusState();
    renderFocusPanel();
    setTodayFocusOpen(true);
  }

  function enterFocusPickDuration(boardId, taskId) {
    const task = boards[boardId] && boards[boardId].find(t => t.id === taskId);
    if (!task) return;
    focusState = { step: 'pick-duration', taskBoardId: boardId, taskId: taskId, taskText: task.text };
    saveFocusState();
    renderFocusPanel();
    setTodayFocusOpen(true);
  }

  // 새로고침 직후 저장된 세션을 그대로 복원 — 카운트다운 중이었다면 흐른
  // 시간만큼 remainingSec을 다시 계산해서 이어붙이고(다 됐으면 곧장 ended
  // 단계로), waiting 리셋/블러 등 진입 시 부수효과도 startFocusCountdown과
  // 동일하게 다시 적용함. 대상 항목이 그새 지워졌거나 완료됐으면 그냥
  // 포기하고 리스트 화면으로 둠. 페이드 애니메이션 없이 처음부터 그
  // 화면으로 떠야 하므로 setTodayFocusOpen 대신 hidden을 직접 건드림.
  function restoreFocusSession() {
    let data;
    try {
      const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
      if (!raw) return;
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!data || !data.step) return;

    if (data.step === 'pick-task') {
      focusState = { step: 'pick-task' };
    } else {
      const task = boards[data.taskBoardId] && boards[data.taskBoardId].find(t => t.id === data.taskId);
      if (!task || task.done) {
        clearFocusState();
        return;
      }
      if (data.step === 'pick-duration') {
        focusState = { step: 'pick-duration', taskBoardId: data.taskBoardId, taskId: data.taskId, taskText: task.text };
      } else if (data.step === 'running' && data.paused) {
        // 멈춰있던 동안은 시간이 흐르지 않으므로 endAt으로 다시 계산하지
        // 않고 멈춘 시점의 remainingSec을 그대로 이어받음 — 티커도 다시
        // 켜지 않음(재개 버튼을 눌러야 endAt이 새로 잡히고 티커가 시작됨).
        focusState = {
          step: 'running',
          taskBoardId: data.taskBoardId,
          taskId: data.taskId,
          taskText: task.text,
          endAt: data.endAt,
          remainingSec: data.remainingSec || 0,
          paused: true,
          exitConfirmOpen: false
        };
        setLupinOpen(false);
        if (sideColEl) sideColEl.classList.add('focus-blurred');
        if (headerEl) headerEl.classList.add('focus-blurred');
      } else if (data.step === 'running' || data.step === 'ended') {
        const remaining = data.endAt ? Math.max(0, Math.round((data.endAt - Date.now()) / 1000)) : 0;
        focusState = {
          step: remaining > 0 ? 'running' : 'ended',
          taskBoardId: data.taskBoardId,
          taskId: data.taskId,
          taskText: task.text,
          endAt: data.endAt,
          remainingSec: remaining,
          exitConfirmOpen: false
        };
        setLupinOpen(false);
        if (sideColEl) sideColEl.classList.add('focus-blurred');
        if (headerEl) headerEl.classList.add('focus-blurred');
        if (remaining > 0) startFocusTicker();
        else saveFocusState();
      } else {
        return;
      }
    }

    todayFocusVisible = true;
    todayListEl.hidden = true;
    todayFocusEl.hidden = false;
    todayStickyEl.style.setProperty('--paper', 'var(--paper-focus)');
    renderFocusPanel();
  }

  if (focusEnterBtn) focusEnterBtn.addEventListener('click', enterFocusPickTask);
  if (focusBackBtn) focusBackBtn.addEventListener('click', () => exitFocusMode(false));

  // Esc — 선택 단계(할일/시간 고르는 중)에서 곧장 gotta do 리스트로.
  // 카운트다운/종료 후엔 isFocusLocked()에서 걸러져 기존 규칙대로 안 먹힘.
  document.addEventListener('keydown', (e) => {
    if (!focusState || isFocusLocked()) return;
    if (e.key !== 'Escape') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    exitFocusMode(false);
  });

  // Alt+T — Alt+D/Alt+E와 같은 자리(task-item 안 아무 요소가 포커스된 채)에서
  // 동작. 호버 시 뜨는 🍅 버튼이 있는 항목(= gotta do 카드에 그려지는
  // 항목)에서만 의미가 있으므로, 그 버튼을 실제로 찾아 클릭을 재사용함.
  document.addEventListener('keydown', (e) => {
    if (isFocusLocked()) return;
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.code !== 'KeyT') return;
    const li = document.activeElement && document.activeElement.closest('.task-item');
    const btn = li && li.querySelector('.focus-btn');
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  });

  // n/w: 어떤 입력창에도 포커스가 없을 때만 각 보드의 새 항목 입력창으로 포커스 이동.
  // 물리 키(e.code) 기준으로 감지 — e.key로 비교하면 한글 입력기가 켜져
  // 있을 때 물리적으로 같은 자리를 눌러도 자모가 들어와서 단축키가 아예
  // 안 먹는 문제가 있어서, Alt+D/Alt+E와 같은 방식으로 통일함.
  const SHORTCUT_BOARD_CODES = { KeyN: 'today', KeyW: 'waiting' };

  // someday 입력창은 someday/scheduled 두 리스트를 같이 담고 있는 스티키
  // 안에 하나뿐이라, s/p 모두 결국 이 입력창을 포커스함 — 차이는 어떤
  // 드롭다운(someday/pray later)을 먼저 열어주고, p는 추가로 날짜 피커까지
  // 펼쳐주는지에 있음.
  function focusSomedayInput() {
    const input = document.querySelector('.sticky[data-board="someday"] [data-newtask]');
    if (input) input.focus();
  }

  // 드롭다운이 열린 직후(바로 다음 키 입력으로 이어붙인 "두 번째 누름")와
  // 한참 전에 열어두고 나중에 다시 누른 경우("이제 닫아줘")를 구분하는
  // 기준 시간 — 자모 두 번 입력(dd/ss처럼 빠르게 이어치는 정도)보다는
  // 확실히 크게 잡아서, 빠른 두 번째 누름은 여전히 입력창 포커스로,
  // 그보다 늦게 다시 누르면 닫기로 처리함.
  const REOPEN_VS_CLOSE_MS = 600;

  // s: 닫혀있으면 펼치기만, 방금 펼친 직후(REOPEN_VS_CLOSE_MS 이내)면 곧장
  // 새 항목 입력창 포커스, 그보다 오래 열려있었으면 다시 눌렀을 때 닫기 —
  // d(보관함 토글)처럼 한 번 더 누르면 닫히되, 빠른 연타는 예외로 둠.
  function handleSomedayShortcut() {
    const section = collapseSections.someday;
    if (!section) return;
    if (section.body.hidden) {
      section.setOpen(true);
    } else if (Date.now() - section.setOpen.openedAt < REOPEN_VS_CLOSE_MS) {
      focusSomedayInput();
    } else {
      section.setOpen(false);
    }
  }

  // p: someday와 같은 열기/포커스/닫기 3단 규칙이되, "방금 펼친 직후"
  // 케이스에서는 입력창 포커스와 함께 날짜 피커까지 열어줌.
  function handlePrayLaterShortcut() {
    const section = collapseSections.scheduled;
    if (!section) return;
    if (section.body.hidden) {
      section.setOpen(true);
    } else if (Date.now() - section.setOpen.openedAt < REOPEN_VS_CLOSE_MS) {
      focusSomedayInput();
      if (openSomedayDatePicker) openSomedayDatePicker();
    } else {
      section.setOpen(false);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // 카운트다운 진행 중/종료 후 선택 대기 중엔 모든 단축키 비활성 —
    // 화면에 뜬 버튼을 마우스로 눌러야만 빠져나갈 수 있게 의도적으로 막음.
    if (isFocusLocked()) return;

    // t: gotta do가 리스트 화면일 때만 timer 레이아웃(할일 고르는 단계)으로
    // 전환. 이미 timer 레이아웃이면(선택 단계) 아무 동작 없음.
    if (e.code === 'KeyT') {
      if (!focusState) {
        e.preventDefault();
        enterFocusPickTask();
      }
      return;
    }

    // /: 검색 패드 열기 (Ctrl+K도 같음 — 그건 위에서 따로 처리)
    if (e.code === 'Slash' && !e.shiftKey) {
      e.preventDefault();
      openSearchPanel();
      return;
    }

    if (e.code === 'KeyD') {
      e.preventDefault();
      toggleArchivePanel(); // 플래그 버튼 클릭과 같은 토글 함수 재사용
      return;
    }

    // l: 닫혀있으면 일단 열기만(포커스 없이), 이미 보이는 중(또는 열리는
    // 중)이면 바로 새 lupin 항목 입력창 포커스 — w와 대칭되는 규칙이라
    // 시간 간격을 잴 필요가 없음(그래서 한글 입력 중 두 번 눌러도 안전).
    if (e.code === 'KeyL') {
      e.preventDefault();
      setLupinOpen(true, isLupinOpen());
      return;
    }

    // w: lupin이 보이는 중(또는 보이려는 중)이면 첫 누름은 waiting으로
    // 복귀만, 그 뒤로 또 누르면(복귀 중이든 이미 복귀했든) 곧장 waiting
    // 입력창 포커스. 이미 완전히 waiting 화면이면 아래 일반 경로로 넘어감.
    if (e.code === 'KeyW' && (isLupinOpen() || lupinSwapPending)) {
      e.preventDefault();
      setLupinOpen(false, !isLupinOpen());
      return;
    }

    if (e.code === 'KeyS') {
      e.preventDefault();
      handleSomedayShortcut();
      return;
    }

    if (e.code === 'KeyP') {
      e.preventDefault();
      handlePrayLaterShortcut();
      return;
    }

    // n: timer 레이아웃의 선택 단계(할일/시간 고르는 중)에서 눌리면 gotta
    // do 리스트 화면으로 복귀 + 새 항목 입력창 포커스. 카운트다운 중엔 위
    // isFocusLocked() 가드에서 이미 걸러짐.
    if (e.code === 'KeyN' && focusState) {
      e.preventDefault();
      exitFocusMode(true);
      return;
    }

    const boardId = SHORTCUT_BOARD_CODES[e.code];
    if (!boardId) return;

    const input = document.querySelector('.sticky[data-board="' + boardId + '"] [data-newtask]');
    if (!input) return;

    e.preventDefault();
    input.focus();
  });

  // Alt+W/Alt+N — 포커스가 today/waiting 항목(체크박스, 텍스트, 이동/삭제
  // 버튼 등 그 task-item 안의 아무 요소) 위에 있을 때 곧장 반대쪽으로
  // 옮김. 위 keydown 리스너는 altKey가 눌려있으면 통째로 return해버리는
  // 별도 핸들러라, 여기서 따로 처리함.
  document.addEventListener('keydown', (e) => {
    if (isFocusLocked()) return;
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.code !== 'KeyW' && e.code !== 'KeyN') return;
    const li = document.activeElement && document.activeElement.closest('.task-item');
    if (!li) return;
    const id = Number(li.dataset.id);
    if (e.code === 'KeyW' && boards.today.some(t => t.id === id)) {
      e.preventDefault();
      moveTask('today', 'waiting', id);
    } else if (e.code === 'KeyN' && boards.waiting.some(t => t.id === id)) {
      e.preventDefault();
      moveTask('waiting', 'today', id);
    }
  });

  // Shift+Enter / Alt+Enter — 이미 등록된 항목(체크박스, 텍스트 등 그 task-item 안의
  // 아무 요소) 위에 포커스가 있을 때 새 항목 만들 때처럼 곧장 하위 항목
  // 추가 입력창을 열어줌. task-edit-input/new-subtask-input 등 자기
  // 나름의 키다운 처리를 이미 갖고 있는 입력창들은 그쪽에서 먼저 처리되고
  // (Enter에 blur가 걸려 activeElement가 바뀌므로) 여기까지 안 넘어옴.
  document.addEventListener('keydown', (e) => {
    if (isFocusLocked()) return;
    if (!(e.shiftKey || e.altKey) || e.metaKey || e.ctrlKey) return;
    if (e.key !== 'Enter') return;
    const li = document.activeElement && document.activeElement.closest('.task-item');
    if (!li) return;
    e.preventDefault();
    openAddSubtaskRow(null, Number(li.dataset.id), true);
  });

  restoreFocusSession();
  renderAll();
  resetHistory();
})();
