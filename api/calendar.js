// GET /api/calendar?from=<ISO>&to=<ISO> → { events: [...] }  (primary 캘린더, 읽기 전용)
// 갱신 토큰으로 매번 새 액세스 토큰을 받아 쓰므로 브라우저 쪽 토큰 만료와 무관함.
const { configured, send, getUser, readRefreshToken, deleteRefreshToken, refreshAccessToken } = require('./_lib');

const MAX_RANGE_MS = 4 * 24 * 60 * 60 * 1000; // 한 번에 며칠까지만(오늘·내일이면 충분)

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (!configured()) return send(res, 503, { error: 'not_configured' });
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: 'unauthorized' });

    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (isNaN(from) || isNaN(to) || to <= from || to - from > MAX_RANGE_MS) return send(res, 400, { error: 'bad_range' });

    const refresh = await readRefreshToken(user.id);
    if (!refresh) return send(res, 404, { error: 'not_linked' });
    const access = await refreshAccessToken(refresh);
    if (access.reauth) {
      await deleteRefreshToken(user.id); // 취소/만료된 토큰은 버리고 다시 연결하게 함
      return send(res, 401, { error: 'reauth' });
    }

    const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50'
    }).toString();
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + access.token } });
    if (r.status === 401 || r.status === 403) return send(res, 401, { error: 'reauth' }); // 캘린더 읽기 권한이 없음
    if (!r.ok) return send(res, 502, { error: 'google_error' });
    const data = await r.json();

    const events = (data.items || [])
      .filter(ev => ev.status !== 'cancelled')
      .filter(ev => !ev.eventType || ev.eventType === 'default') // 근무 위치/부재 같은 것은 제외
      .filter(ev => !(ev.attendees || []).some(a => a.self && a.responseStatus === 'declined')) // 거절한 일정 제외
      .map(ev => {
        const allDay = !!(ev.start && ev.start.date);
        return {
          id: ev.id,
          title: ev.summary || '(제목 없음)',
          allDay,
          start: allDay ? ev.start.date : (ev.start && ev.start.dateTime),
          end: allDay ? (ev.end && ev.end.date) : (ev.end && ev.end.dateTime),
          location: ev.location || ''
        };
      })
      .filter(ev => ev.start);
    return send(res, 200, { events });
  } catch (e) {
    return send(res, 500, { error: 'server_error' });
  }
};
