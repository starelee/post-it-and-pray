// 구글 캘린더 연결 관리 (로그인한 사용자 본인 것만)
//   GET    → { linked: boolean }                  연결돼 있는지
//   POST   { refresh_token }  → { linked: true }  브라우저가 구글 로그인 직후 받은 갱신 토큰을 서버에 맡김
//   DELETE → { linked: false }                    연결 해제(저장해 둔 갱신 토큰 삭제)
const { configured, send, getUser, readRefreshToken, saveRefreshToken, deleteRefreshToken } = require('./_lib');

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

module.exports = async (req, res) => {
  try {
    if (!configured()) return send(res, 503, { error: 'not_configured' });
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET') {
      const token = await readRefreshToken(user.id);
      return send(res, 200, { linked: !!token });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const token = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';
      if (!token || token.length > 4096) return send(res, 400, { error: 'bad_request' });
      await saveRefreshToken(user.id, token);
      return send(res, 200, { linked: true });
    }
    if (req.method === 'DELETE') {
      await deleteRefreshToken(user.id);
      return send(res, 200, { linked: false });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    return send(res, 500, { error: 'server_error' });
  }
};
