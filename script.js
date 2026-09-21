(function () {
  const STORAGE_KEY = 'postit-todo-boards-v1';
  const OLD_STORAGE_KEY = 'postit-todo-tasks-v1';
  const THEME_KEY = 'postit-theme';
  const SUPABASE_URL = 'https://ytnlgabrbrddfpjzzrrn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0bmxnYWJyYnJkZGZwanp6cnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzY1NzEsImV4cCI6MjEwNTExMjU3MX0.3H3oSigr6E649McUa8HFf9JYDbM1qIdZQGlJw6-WGro';
  const REORDER_DELAY = 300;
  const BOARD_IDS = ['today', 'waiting', 'someday', 'scheduled'];
  // Boards a task can be manually moved between with the move buttons.
  const MOVE_TARGET_IDS = ['today', 'waiting', 'someday'];
  // Boards that support a due date (calendar icon). Assigning a date moves
  // the task into `scheduled`; `waiting` never gets a date.
  const DATE_ENABLED_IDS = ['today', 'someday'];
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
      renderArchive();
      renderUpcoming();
    } else {
      setTrashViewOpen(false);
    }
  }
  archiveFlagBtns.forEach(btn => btn.addEventListener('click', toggleArchivePanel));

  const archiveCloseBtn = document.getElementById('archiveCloseBtn');
  if (archiveCloseBtn) {
    archiveCloseBtn.addEventListener('click', () => {
      archivePanelEl.classList.remove('open');
      setTrashViewOpen(false);
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
      if (typeof t.from === 'string' && t.from) out.from = t.from;
      if (typeof t.deletedAt === 'string' && t.deletedAt) out.deletedAt = t.deletedAt;
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
    // 휴지통은 3일이 지나면 완전히 사라짐 — 매 normalizeBoards마다
    // (초기 로드/클라우드 동기화 모두) 다시 걸러내므로 하루 지나 기한을
    // 넘기면 다음 렌더링에서 자연스럽게 빠짐.
    b.trash = (b.trash || []).filter(t => -daysUntilDue(t.deletedAt) <= 3);
  }

  // Bumped on every local edit so an in-flight cloud fetch (see syncRow)
  // can tell whether the user changed something while it was loading and
  // back off instead of clobbering that edit with stale server data.
  let localVersion = 0;

  function saveBoards() {
    localVersion++;
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
  // each task id resolves to whichever side shows more progress —
  // archived > done-in-place > still-active — so a stale "not done yet"
  // copy can never erase a real completion, and brand-new tasks added
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
          const useCloud = window.confirm(
            '이 계정에 이미 저장된 데이터가 있어요.\n\n' +
            '확인 → 클라우드 데이터를 불러옵니다 (지금 이 기기에만 있던 데이터는 사라져요)\n' +
            '취소 → 지금 이 기기의 데이터를 유지하고, 그걸로 클라우드를 덮어씁니다'
          );
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

  // Wires a collapse toggle button to a body element (used for the
  // scheduled/someday sections present in the static HTML, and reused for
  // the archive panel's dynamically-created month groups, which need to
  // call this themselves at creation time since the querySelectorAll below
  // only ever sees elements that exist at module-load time).
  function wireCollapseToggle(toggle, body, defaultOpen) {
    // 열림/닫힘을 다른 글자(▾/▴)로 바꾸는 대신 같은 글자를 180도 돌리기만
    // 함 — 두 글자가 폰트별로 미묘하게 다른 크기/기준선을 가져서(특히
    // 모바일 사파리) 위아래 화살표 크기가 달라 보이는 문제가 있었음.
    const arrow = toggle.querySelector('[data-toggle-arrow]');
    body.hidden = !defaultOpen;
    if (arrow) arrow.classList.toggle('toggle-arrow-open', defaultOpen);
    function setOpen(open) {
      body.hidden = !open;
      if (arrow) arrow.classList.toggle('toggle-arrow-open', open);
      // p/s 단축키가 "방금 열렸다(→ 입력창 포커스)"와 "한참 전에 열려있었다
      // (→ 다시 누르면 닫기)"를 구분할 수 있도록 열린 시각을 함수 자체에
      // 붙여둠 — setOpen을 그대로 들고 있는 쪽(collapseSections)이 굳이
      // 별도 상태 객체 없이 이 값을 바로 읽을 수 있음.
      if (open) setOpen.openedAt = Date.now();
    }
    setOpen.openedAt = defaultOpen ? Date.now() : 0;
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
    const setOpen = wireCollapseToggle(toggle, body, false);
    const listEl = body.querySelector('[data-tasklist]');
    if (listEl) collapseSections[listEl.dataset.tasklist] = { body, setOpen };
  });

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

  function render(boardId) {
    if (boardId === 'today') return renderToday();
    if (boardId === 'scheduled') return renderScheduled();

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

    updateCounter();
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
      backBtn.textContent = '←';
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
    const line = document.createElement('span');
    line.className = 'strike-line';
    text.appendChild(line);

    row.appendChild(text);

    let badge = null;
    if (task.dueDate) {
      badge = document.createElement('span');
      badge.className = 'due-badge';
      badge.textContent = formatDueDateRelative(task.dueDate);
      row.appendChild(badge);
    }

    li.appendChild(row);

    if (task.subtasks.length > 0) {
      const subList = document.createElement('ul');
      subList.className = 'subtask-list';
      task.subtasks.forEach(sub => subList.appendChild(renderSubtaskItem(boardId, task.id, sub)));
      li.appendChild(subList);
    }

    const controls = document.createElement('div');
    controls.className = 'task-controls';

    const urgentBtn = document.createElement('button');
    urgentBtn.className = 'urgent-btn';
    urgentBtn.type = 'button';
    urgentBtn.setAttribute('aria-label', task.urgent ? '긴급 해제' : '긴급 표시');
    urgentBtn.textContent = '!';
    urgentBtn.addEventListener('click', () => toggleUrgent(boardId, task.id));

    const addToggle = document.createElement('button');
    addToggle.className = 'add-subtask-toggle';
    addToggle.type = 'button';
    addToggle.setAttribute('aria-label', '하위 항목 추가');
    addToggle.textContent = '+';

    controls.appendChild(urgentBtn);
    controls.appendChild(addToggle);

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
      dateBtn.setAttribute('aria-label', task.dueDate ? '날짜 수정' : '날짜 지정');
      dateBtn.textContent = '📅';
      controls.appendChild(dateBtn);
    }

    // lupin은 숨겨진 개인 메모라 다른 보드로도, 다른 보드에서 lupin으로도
    // 옮겨질 수 없음 — 애초에 MOVE_TARGET_IDS에 없어서 뒤쪽은 이미 보장되고,
    // 여기선 lupin 항목 자체가 이동 버튼을 갖지 않도록 명시적으로 막음.
    (boardId === 'lupin' ? [] : MOVE_TARGET_IDS)
      .filter(id => id !== boardId)
      .filter(id => !(boardId === 'waiting' && id === 'today')) // redundant with the always-visible ←
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
      if (task.dueDate) dateInput.value = task.dueDate;
      dateInput.addEventListener('change', () => {
        setDueDate(boardId, task.id, dateInput.value);
        // 모바일 네이티브 달력에서 날짜를 확정(체크)하면 그걸로 볼일은
        // 끝난 거라, 되살리기 피커처럼 곧장 닫아줌 — 다시 눌러야만
        // 닫히던 예전 동작보다 자연스러움.
        dateRow.hidden = true;
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

      // 내일 날짜로 지정하는 경우가 워낙 많아서 달력을 열지 않고 바로 찍을
      // 수 있게 — dateInput의 change 리스너를 그대로 재사용하도록 값만
      // 채워넣고 change 이벤트를 직접 쏨.
      const tomorrowBtn = document.createElement('button');
      tomorrowBtn.className = 'date-clear-btn';
      tomorrowBtn.type = 'button';
      tomorrowBtn.textContent = '내일';
      tomorrowBtn.addEventListener('click', () => {
        dateInput.value = tomorrowStr();
        dateInput.dispatchEvent(new Event('change'));
      });

      const clearBtn = document.createElement('button');
      clearBtn.className = 'date-clear-btn';
      clearBtn.type = 'button';
      clearBtn.textContent = '날짜 지우기';
      clearBtn.hidden = !task.dueDate;
      clearBtn.addEventListener('click', () => setDueDate(boardId, task.id, ''));

      // Only shown while no date has been assigned yet — lets the user
      // close the picker without picking one. Once a date exists, clearBtn
      // above already covers "undo the date".
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'date-clear-btn';
      cancelBtn.type = 'button';
      cancelBtn.textContent = '취소';
      cancelBtn.hidden = !!task.dueDate;
      cancelBtn.addEventListener('click', () => {
        dateInput.value = '';
        dateRow.hidden = true;
      });

      dateRow.appendChild(dateInput);
      dateRow.appendChild(tomorrowBtn);
      dateRow.appendChild(clearBtn);
      dateRow.appendChild(cancelBtn);
      li.appendChild(dateRow);

      const toggleDateRow = () => {
        dateRow.hidden = !dateRow.hidden;
        if (!dateRow.hidden) dateInput.focus();
      };
      dateBtn.addEventListener('click', toggleDateRow);
      if (badge) badge.addEventListener('click', toggleDateRow);
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
    subInput.maxLength = 60;
    subInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
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
    addToggle.addEventListener('click', () => openAddSubtaskRow(boardId, task.id, true));

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

    const dateRow = document.createElement('div');
    dateRow.className = 'date-picker-row';
    dateRow.hidden = true;
    const dateInput = document.createElement('input');
    dateInput.className = 'date-picker-input';
    dateInput.type = 'date';
    dateInput.addEventListener('change', () => {
      // 일반 날짜 피커(재클릭해야 닫힘)와 다르게, 되살리기는 날짜를
      // 고르는 순간 그걸로 끝 — 곧장 새 카드를 만들고 피커도 닫아버림.
      if (dateInput.value) {
        reviveTask(task, dateInput.value);
        dateRow.hidden = true;
      }
    });
    dateRow.appendChild(dateInput);

    const tomorrowBtn = document.createElement('button');
    tomorrowBtn.className = 'date-clear-btn';
    tomorrowBtn.type = 'button';
    tomorrowBtn.textContent = '내일';
    tomorrowBtn.addEventListener('click', () => {
      dateInput.value = tomorrowStr();
      dateInput.dispatchEvent(new Event('change'));
    });
    dateRow.appendChild(tomorrowBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'date-clear-btn';
    clearBtn.type = 'button';
    clearBtn.textContent = '날짜 지우기';
    clearBtn.addEventListener('click', () => {
      dateInput.value = '';
      dateRow.hidden = true;
    });
    dateRow.appendChild(clearBtn);

    // 아직 값을 고르기 전(빈 칸)이면 Esc로 닫을 수 있게.
    // (예전엔 blur 시 자동으로도 닫았는데, 안드로이드 크롬은 네이티브
    // 달력이 뜨는 동안 입력창이 blur돼서 첫 탭에 피커가 바로 닫혀버리는
    // 문제가 있었음 — 제거함.)
    dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dateInput.value) {
        e.preventDefault();
        clearBtn.click();
      }
    });

    reviveBtn.addEventListener('click', () => {
      dateRow.hidden = !dateRow.hidden;
      if (!dateRow.hidden) dateInput.focus();
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
    li.appendChild(dateRow);
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
    li.appendChild(text);

    const badge = document.createElement('span');
    badge.className = 'due-badge';
    badge.textContent = formatDueDateRelative(task.dueDate);
    li.appendChild(badge);

    const controls = document.createElement('div');
    controls.className = 'archive-item-controls';

    const dateBtn = document.createElement('button');
    dateBtn.className = 'date-btn';
    dateBtn.type = 'button';
    dateBtn.setAttribute('aria-label', '날짜 수정');
    dateBtn.textContent = '📅';
    controls.appendChild(dateBtn);

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
    dateInput.addEventListener('change', () => {
      if (dateInput.value) {
        setDueDate('scheduled', task.id, dateInput.value);
        dateRow.hidden = true;
      }
    });
    dateRow.appendChild(dateInput);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'date-clear-btn';
    clearBtn.type = 'button';
    clearBtn.textContent = '날짜 지우기';
    clearBtn.addEventListener('click', () => {
      dateRow.hidden = true;
    });
    dateRow.appendChild(clearBtn);

    // (예전엔 blur 시 자동으로도 닫았는데, 안드로이드 크롬은 네이티브
    // 달력이 뜨는 동안 입력창이 blur돼서 첫 탭에 피커가 바로 닫혀버리는
    // 문제가 있었음 — 제거함.)
    dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dateRow.hidden = true;
      }
    });

    dateBtn.addEventListener('click', () => {
      dateRow.hidden = !dateRow.hidden;
      if (!dateRow.hidden) dateInput.focus();
    });

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

  function reviveTask(archivedTask, dateValue) {
    const clone = {
      id: Date.now(),
      text: archivedTask.text,
      done: false,
      urgent: !!archivedTask.urgent,
      subtasks: (archivedTask.subtasks || []).map((s, i) => ({
        id: Date.now() + i,
        text: s.text,
        done: !!s.done
      })),
      dueDate: dateValue
    };
    boards.scheduled.push(clone);
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
    // 자체를 아예 취소하고 편집 모드로만 들어가게 함.
    let chipClickTimer = null;
    chip.addEventListener('click', () => {
      clearTimeout(chipClickTimer);
      chipClickTimer = setTimeout(() => {
        toggleSubtask(boardId, taskId, sub.id);
      }, 250);
    });
    chip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      clearTimeout(chipClickTimer);
      startEditSubtask(boardId, taskId, sub.id);
    });

    const del = document.createElement('button');
    del.className = 'subtask-delete-btn';
    del.type = 'button';
    del.setAttribute('aria-label', '삭제');
    del.textContent = '×';
    del.addEventListener('click', () => deleteSubtask(boardId, taskId, sub.id));

    li.appendChild(chip);
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
    input.maxLength = 60;
    textEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const trimmed = input.value.trim();
      if (trimmed) task.text = trimmed;
      saveBoards();
      render(boardId);
      // 오늘 마감인 scheduled 항목은 실제로 today 목록 안에 그려져 있어서,
      // scheduled만 다시 그리면 방금 만든 이 input이 화면에 그대로 남음.
      if (boardId === 'scheduled') render('today');
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
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
    input.addEventListener('blur', commit);
  }

  function toggleTask(boardId, id) {
    const task = boards[boardId].find(t => t.id === id);
    if (!task) return;
    task.done = !task.done;
    if (task.done) task.doneAt = todayStr();
    else delete task.doneAt;

    const li = findTaskLi(id);
    if (li) li.classList.toggle('done', task.done);

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
      if (task.done && !gracedToday) {
        archiveNow(boardId, id);
      } else {
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
  }

  // Assigning a date on a today/someday task moves it into `scheduled`;
  // changing the date on an already-scheduled task keeps it there;
  // clearing it sends it back to the board it came from.
  function setDueDate(boardId, id, dateValue) {
    const idx = boards[boardId].findIndex(t => t.id === id);
    if (idx === -1) return;
    const task = boards[boardId][idx];

    if (boardId === 'scheduled') {
      if (dateValue) {
        task.dueDate = dateValue;
        saveBoards();
        render('today');
        render('scheduled');
      } else {
        boards.scheduled.splice(idx, 1);
        const backTo = task.from || 'today';
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
    if (draft && draft.dueDate) {
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
    input.maxLength = 60;
    input.size = Math.max(2, sub.text.length);
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
    input.addEventListener('blur', commit);
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
    urgentBtn.textContent = '!';
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
    subtaskToggle.textContent = '+';
    draftControls.appendChild(subtaskToggle);

    // 날짜 기능 없는 보드(waiting)는 기존 task-item과 동일하게 아예 제외.
    let dateBtn = null;
    if (DATE_ENABLED_IDS.includes(boardId)) {
      dateBtn = document.createElement('button');
      dateBtn.type = 'button';
      dateBtn.className = 'date-btn';
      dateBtn.setAttribute('aria-label', '날짜 지정');
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
        if (!dateRow.hidden) dateInput.focus();
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

      const applyDraftDate = (value) => {
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

      dateRow.appendChild(dateInput);
      dateRow.appendChild(tomorrowBtn);
      dateRow.appendChild(dateClearBtn);
      dateBtn.addEventListener('click', () => {
        dateRow.hidden = !dateRow.hidden;
        if (!dateRow.hidden) dateInput.focus();
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
    subtaskInput.maxLength = 60;

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

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
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
        const dateBtn = li && li.querySelector('.date-btn');
        if (dateBtn) dateBtn.click(); // 날짜 지정 안 되는 보드(waiting)면 dateBtn 자체가 없어서 자연히 무시됨
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
  // 모드와 달리 "뒤집는" 은유가 아니라 "상태가 바뀌는" 것이라 3D 플립
  // 대신 크로스페이드/스케일 전환을 씀.
  const todayStickyEl = document.getElementById('todaySticky');
  const todayListEl = todayStickyEl.querySelector('[data-today-list]');
  const todayFocusEl = todayStickyEl.querySelector('[data-today-focus]');
  const focusTitleEl = document.getElementById('focusTitleText');
  const focusBodyEl = document.getElementById('focusBody');
  const focusFooterEl = document.getElementById('focusFooter');
  const focusEnterBtn = document.getElementById('focusEnterBtn');
  const focusBackBtn = document.getElementById('focusBackBtn');
  const sideColEl = document.querySelector('.side-col');
  const FOCUS_DURATIONS_MIN = [3, 5, 15, 25];
  const FOCUS_TITLE_TEXT = 'f... focus 🍅';
  const FOCUS_STORAGE_KEY = 'postit-focus-session-v1';

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
        endAt: focusState.endAt
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
  // intervalId, exitConfirmOpen } — 어떤 보드(today/scheduled)에 실제로
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
    if (!task || !task.subtasks || task.subtasks.length === 0) return;
    const list = document.createElement('ul');
    list.className = 'subtask-list focus-subtask-list';
    task.subtasks.forEach(sub => {
      const li = document.createElement('li');
      li.className = 'subtask-item' + (sub.done ? ' done' : '');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'subtask-chip';
      chip.setAttribute('aria-label', sub.done ? '완료 취소' : '완료 표시');
      chip.textContent = '[' + sub.text + ']';
      chip.addEventListener('click', () => {
        toggleSubtask(boardId, taskId, sub.id);
        renderFocusPanel();
      });
      li.appendChild(chip);
      list.appendChild(li);
    });
    container.appendChild(list);
  }

  function makeFocusFooterBtn(text, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'focus-footer-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = text;
    return btn;
  }

  function renderFocusPanel() {
    if (!focusState) return;
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
      const taskLabel = document.createElement('p');
      taskLabel.className = 'focus-picked-task';
      taskLabel.textContent = focusState.taskText;
      focusBodyEl.appendChild(taskLabel);
      // 하위 항목은 점선 박스 "위"에 — 실제 점선 테두리는 아래 박스
      // 자체가 두르고 있으므로 그 앞에 붙이기만 하면 됨.
      appendFocusSubtasks(focusBodyEl, focusState.taskBoardId, focusState.taskId);

      const durationBox = document.createElement('div');
      durationBox.className = 'focus-duration-box';
      const hint = document.createElement('p');
      hint.className = 'focus-duration-hint';
      hint.textContent = '얼마나 집중할까요?';
      durationBox.appendChild(hint);
      const row = document.createElement('div');
      row.className = 'focus-duration-row';
      FOCUS_DURATIONS_MIN.forEach(min => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'focus-duration-btn';
        btn.textContent = min + '분';
        btn.addEventListener('click', () => startFocusCountdown(min * 60));
        row.appendChild(btn);
      });
      durationBox.appendChild(row);
      focusBodyEl.appendChild(durationBox);
      return;
    }

    if (focusState.step === 'running') {
      // running/ended 단계에서도 제목은 'f... focus'로 그대로 두고, 할 일
      // 텍스트는 pick-duration과 마찬가지로 본문 쪽에 표시.
      focusTitleEl.textContent = FOCUS_TITLE_TEXT;
      const taskLabel = document.createElement('p');
      taskLabel.className = 'focus-picked-task';
      taskLabel.textContent = focusState.taskText;
      focusBodyEl.appendChild(taskLabel);
      const num = document.createElement('div');
      num.className = 'focus-countdown-number';
      num.textContent = formatFocusClock(focusState.remainingSec);
      focusBodyEl.appendChild(num);
      appendFocusSubtasks(focusBodyEl, focusState.taskBoardId, focusState.taskId);

      if (focusState.exitConfirmOpen) {
        const confirmWrap = document.createElement('div');
        confirmWrap.className = 'focus-exit-confirm';
        const msg = document.createElement('p');
        msg.textContent = '타이머를 중단하고 메인화면으로 갈까요? 현재 진행 중인 타이머는 초기화됩니다.';
        confirmWrap.appendChild(msg);

        const yesBtn = makeFocusFooterBtn('네, 나갈게요 (타이머 리셋)', 'focus-footer-btn-danger');
        yesBtn.addEventListener('click', () => exitFocusMode(false));
        const noBtn = makeFocusFooterBtn('아니, 계속할게요');
        noBtn.addEventListener('click', () => {
          focusState.exitConfirmOpen = false;
          renderFocusPanel();
        });
        confirmWrap.appendChild(yesBtn);
        confirmWrap.appendChild(noBtn);
        focusFooterEl.appendChild(confirmWrap);
      } else {
        const doneBtn = makeFocusFooterBtn('완료로 표시', 'focus-footer-btn-primary');
        doneBtn.addEventListener('click', finishFocusAsDone);
        const exitBtn = makeFocusFooterBtn('나가기');
        exitBtn.addEventListener('click', () => {
          focusState.exitConfirmOpen = true;
          renderFocusPanel();
        });
        focusFooterEl.appendChild(doneBtn);
        focusFooterEl.appendChild(exitBtn);
      }
      return;
    }

    if (focusState.step === 'ended') {
      focusTitleEl.textContent = FOCUS_TITLE_TEXT;
      const taskLabel = document.createElement('p');
      taskLabel.className = 'focus-picked-task';
      taskLabel.textContent = focusState.taskText;
      focusBodyEl.appendChild(taskLabel);
      appendFocusSubtasks(focusBodyEl, focusState.taskBoardId, focusState.taskId);
      const choices = document.createElement('div');
      choices.className = 'focus-end-choices';

      const doneBtn = makeFocusFooterBtn('완료로 표시', 'focus-footer-btn-primary');
      doneBtn.addEventListener('click', finishFocusAsDone);

      const waitBtn = makeFocusFooterBtn('대기중으로 변경');
      waitBtn.addEventListener('click', () => {
        moveTask(focusState.taskBoardId, 'waiting', focusState.taskId);
        exitFocusMode(false);
      });

      const failBtn = makeFocusFooterBtn('앗.. 못했어요');
      failBtn.addEventListener('click', () => exitFocusMode(false));

      choices.appendChild(doneBtn);
      choices.appendChild(waitBtn);
      choices.appendChild(failBtn);
      focusBodyEl.appendChild(choices);
      return;
    }
  }

  function finishFocusAsDone() {
    toggleTask(focusState.taskBoardId, focusState.taskId);
    exitFocusMode(false);
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
      }
      renderFocusPanel();
    }, 1000);
  }

  // 리스트 ↔ 타이머 레이아웃 크로스페이드 — lupin의 3D 플립과 달리
  // "변신"이 아니라 "상태 전환"이라 애니메이션 중간(스케일이 가장 작아지는
  // 지점)에 두 레이아웃을 갈아끼움.
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
    todayStickyEl.classList.add('today-swapping');
    todaySwapTimer = setTimeout(() => {
      todayListEl.hidden = open;
      todayFocusEl.hidden = !open;
      todaySwapPending = false;
      if (!open && focusInputAfter) {
        const input = todayListEl.querySelector('[data-newtask]');
        if (input) input.focus();
      }
    }, 160);
    todayStickyEl.addEventListener('animationend', function handler() {
      todayStickyEl.classList.remove('today-swapping');
      todayStickyEl.removeEventListener('animationend', handler);
    });
  }

  function exitFocusMode(focusInputAfter) {
    if (focusState && focusState.intervalId) clearInterval(focusState.intervalId);
    focusState = null;
    clearFocusState();
    if (sideColEl) sideColEl.classList.remove('focus-blurred');
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
        if (remaining > 0) startFocusTicker();
        else saveFocusState();
      } else {
        return;
      }
    }

    todayFocusVisible = true;
    todayListEl.hidden = true;
    todayFocusEl.hidden = false;
    renderFocusPanel();
  }

  if (focusEnterBtn) focusEnterBtn.addEventListener('click', enterFocusPickTask);
  if (focusBackBtn) focusBackBtn.addEventListener('click', () => exitFocusMode(false));

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

  // Shift+Enter — 이미 등록된 항목(체크박스, 텍스트 등 그 task-item 안의
  // 아무 요소) 위에 포커스가 있을 때 새 항목 만들 때처럼 곧장 하위 항목
  // 추가 입력창을 열어줌. task-edit-input/new-subtask-input 등 자기
  // 나름의 키다운 처리를 이미 갖고 있는 입력창들은 그쪽에서 먼저 처리되고
  // (Enter에 blur가 걸려 activeElement가 바뀌므로) 여기까지 안 넘어옴.
  document.addEventListener('keydown', (e) => {
    if (isFocusLocked()) return;
    if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'Enter') return;
    const li = document.activeElement && document.activeElement.closest('.task-item');
    if (!li) return;
    e.preventDefault();
    openAddSubtaskRow(null, Number(li.dataset.id), true);
  });

  restoreFocusSession();
  renderAll();
})();
