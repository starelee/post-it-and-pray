-- 구글 캘린더 연동: 사용자별 구글 갱신 토큰(refresh token) 저장소.
-- Supabase 대시보드 → SQL Editor에서 한 번 실행하세요.
--
-- RLS를 켜고 정책을 하나도 만들지 않으므로 브라우저(anon/로그인 키)는 이 표를 읽을 수도 쓸 수도 없고,
-- 서버 함수(api/*.js)가 서비스 롤 키로만 접근합니다.
create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;
-- (정책 없음 = 서비스 롤 외 접근 불가)

revoke all on public.google_tokens from anon, authenticated;
