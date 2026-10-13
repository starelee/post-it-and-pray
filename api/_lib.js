// 구글 캘린더 연동용 서버 함수들이 같이 쓰는 도우미. (`_`로 시작하는 파일은 Vercel이 따로 함수로 만들지 않음)
//
// 흐름: 브라우저가 Supabase 로그인 토큰(JWT)으로 이 함수들을 부르면 → JWT로 사용자를 확인하고 →
// 그 사용자의 구글 갱신 토큰(refresh token)을 Supabase `google_tokens` 테이블(서버 전용)에서 꺼내 →
// 구글에서 새 액세스 토큰을 받아 캘린더를 읽음. 브라우저는 구글 토큰을 만지지 않으므로 만료/갱신 걱정이 없음.
//
// 필요한 환경변수(Vercel → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — Supabase Google 로그인에 쓰는 것과 같은 OAuth 클라이언트
//   SUPABASE_SERVICE_ROLE_KEY               — `google_tokens`를 읽고 쓰는 서버 전용 키(브라우저에 절대 노출 금지)
// (SUPABASE_URL / SUPABASE_ANON_KEY는 선택 — 없으면 앱에 이미 공개돼 있는 같은 값을 씀)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ytnlgabrbrddfpjzzrrn.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0bmxnYWJyYnJkZGZwanp6cnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzY1NzEsImV4cCI6MjEwNTExMjU3MX0.3H3oSigr6E649McUa8HFf9JYDbM1qIdZQGlJw6-WGro';

function configured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Authorization: Bearer <Supabase JWT> → 로그인한 사용자(없으면 null)
async function getUser(req) {
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + m[1] }
  });
  if (!r.ok) return null;
  const user = await r.json();
  return user && user.id ? user : null;
}

function serviceHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, extra || {});
}

// 사용자 id는 Supabase가 준 UUID여야만 쿼리에 넣음(쿼리 문자열 주입 방지)
function safeId(id) {
  return /^[0-9a-f-]{36}$/i.test(String(id)) ? String(id) : null;
}

async function readRefreshToken(userId) {
  const id = safeId(userId);
  if (!id) return null;
  const r = await fetch(SUPABASE_URL + '/rest/v1/google_tokens?select=refresh_token&user_id=eq.' + id, { headers: serviceHeaders() });
  if (!r.ok) throw new Error('token lookup failed: ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0].refresh_token : null;
}

async function saveRefreshToken(userId, refreshToken) {
  const id = safeId(userId);
  if (!id) throw new Error('bad user id');
  const r = await fetch(SUPABASE_URL + '/rest/v1/google_tokens?on_conflict=user_id', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ user_id: id, refresh_token: refreshToken, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error('token save failed: ' + r.status);
}

async function deleteRefreshToken(userId) {
  const id = safeId(userId);
  if (!id) return;
  await fetch(SUPABASE_URL + '/rest/v1/google_tokens?user_id=eq.' + id, { method: 'DELETE', headers: serviceHeaders() });
}

// 갱신 토큰 → 새 액세스 토큰. 토큰이 취소/만료됐으면(invalid_grant) { reauth: true }.
async function refreshAccessToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok && body.access_token) return { token: body.access_token };
  if (body.error === 'invalid_grant' || body.error === 'invalid_client' || r.status === 400 || r.status === 401) return { reauth: true };
  throw new Error('token refresh failed: ' + r.status);
}

module.exports = {
  configured, send, getUser,
  readRefreshToken, saveRefreshToken, deleteRefreshToken, refreshAccessToken
};
