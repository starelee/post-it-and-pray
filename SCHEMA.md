# 데이터 스키마

앱의 전체 상태는 하나의 JSON 객체(`boards`)로 관리됨. 이 객체가 그대로:

- `localStorage`의 `postit-todo-boards-v1` 키에 직렬화되어 저장되고,
- 로그인 상태면 Supabase `postit_data` 테이블의 `data` 컬럼(유저 id를 PK로 하는 행)에도 그대로 저장됨.

두 저장소 모두 **같은 shape**을 씀 — 별도의 서버용/클라이언트용 변환이 없음.

## `boards`

```ts
type Boards = {
  today: Task[];
  waiting: Task[];
  someday: Task[];
  scheduled: Task[];
  archive: Task[];
};
```

다섯 개 배열 모두 `Task` 객체의 배열이며, **어느 배열에 들어있느냐 자체가 그 항목이 어떤 보드에 속해 있는지를 결정함**(별도의 `boardId` 필드 없음). 항목이 보드를 이동하면(예: 날짜 지정, 완료 처리, waiting → today 복귀) 실제로 한 배열에서 `splice`해서 다른 배열로 `push`함.

## `Task`

```ts
type Task = {
  id: number;           // Date.now() 기반, 사실상 유일값
  text: string;
  done: boolean;
  urgent: boolean;
  subtasks: Subtask[];
  dueDate?: string;      // "YYYY-MM-DD" — scheduled 항목에만 존재
  from?: string;         // 보드 id 문자열 — 아래 "from 필드의 두 가지 의미" 참고
  doneAt?: string;       // "YYYY-MM-DD" — done === true인 항목에만 존재
};
```

### `Subtask`

```ts
type Subtask = {
  id: number;
  text: string;
  done: boolean;
};
```

## 필드별 의미

- **`dueDate`**: `scheduled` 배열에 들어있는 항목만 가짐. `today`/`someday`/`waiting`/`archive`에 있는 동안엔 존재하지 않음(날짜를 지정하는 순간 그 항목 자체가 `scheduled` 배열로 옮겨감).
- **`doneAt`**: 체크(`done = true`)한 날짜. 체크 해제하면 삭제됨. 완료 아카이브 스윕(다음날 정리) 및 아카이브 패널의 월/날짜 그룹핑 기준으로 쓰임. 이 필드가 생기기 전의 예전 데이터는 로드 시 오늘 날짜로 자동 백필됨(영구히 스윕 대상에서 빠지지 않도록).
- **`from`(두 가지 의미, 시점에 따라 다름)**:
  1. **`scheduled`에 살아있는 항목일 때**: "날짜 지정 전에 어느 보드에 있었는지" (`'today'` 또는 `'someday'`). 날짜를 지우면 이 값을 보고 원래 보드로 돌아감.
  2. **`archive`로 넘어간 항목일 때**: "완료 당시 어느 보드에서 나왔는지" (`'today'` / `'someday'` / `'scheduled'`). 항목이 아카이브로 들어가는 순간 이 필드가 덮어써짐 — 아카이브에 들어간 뒤로는 첫 번째 의미(날짜 지정 전 출처)는 더 이상 쓸모가 없으므로 안전하게 재사용됨.
- **`waiting`의 `done`**: 구조적으로 필드는 존재하지만 항상 `false`로 유지됨. waiting은 완료 개념이 없는 보드라 UI에도 체크박스가 없고, 혹시 다른 보드에서 완료 처리된 항목이 이동해오면 `moveTask`가 강제로 `false`로 리셋함.

## 보드별 특이 동작

| 보드 | 항목 진입 경로 | 항목 이탈 경로 |
|---|---|---|
| `today` | 직접 입력, waiting에서 `←`로 복귀, archive에서 revive는 안 됨(항상 scheduled로 감) | 체크 후 다음날 스윕 → `archive` |
| `waiting` | 직접 입력, 다른 보드에서 이동 | `←`(→ today), 이동(→ someday), 삭제 |
| `someday` | 직접 입력 | 날짜 지정(→ `scheduled`), 체크(→ 즉시 `archive`, 유예 없음) |
| `scheduled` | today/someday 항목에 날짜 지정, 아카이브 항목 "다시 쓰기" | 날짜 지움(→ 원래 보드), 오늘 마감분은 체크 후 다음날 스윕(→ `archive`), 오늘 마감 아닌 항목은 체크 즉시(→ `archive`) |
| `archive` | 위 스윕/즉시 아카이브 경로 | 🗑️ 삭제만 가능(원본 삭제, 복구 없음). "다시 쓰기"는 원본은 그대로 두고 `scheduled`에 완전히 새로운 독립 항목을 생성 |

## `today`'s list에 표시되는데 `boards.today`엔 없는 항목들

`today` 카드(포스트잇)에 화면상 보이는 항목 중 일부는 실제로는 `boards.scheduled` 배열에 저장되어 있음 — 별도로 복제하지 않고 매 렌더링마다 조건에 맞는 걸 끌어와서 보여주는 방식(`renderToday()`):

- `dueDate === 오늘` && `!done` → today의 일반 활성 항목처럼 표시
- `dueDate === 오늘` && `done` → today의 완료(취소선) 구간에 표시
- `dueDate < 오늘` && `!done` → "oops, still here" 구분선 아래 표시

이 항목들을 체크/삭제/수정하면 실제로는 `boards.scheduled` 배열의 그 객체가 바뀜 — `boards.today` 자체엔 아무 영향 없음.

## 완료 아카이브(`archive`) 패널에 표시되는데 `boards.archive`엔 아직 없는 항목들

완료 아카이브 패널도 같은 방식(`collectArchiveEntries()`)으로, 아직 다음날 스윕이 안 된 "오늘 완료한 today/scheduled 항목"을 `boards.today`/`boards.scheduled`에서 그대로 읽어와서 `boards.archive`의 항목들과 합쳐서 보여줌. 실제로 배열이 옮겨지는 건 다음날 앱을 열 때(`migrateArchive()`)뿐.

## 마이그레이션/정규화

앱은 로드할 때마다(로컬 로드, 클라우드 동기화 둘 다) `normalizeBoards()`를 거침:

1. 각 보드 배열을 `normalizeTasks()`로 정리 — 알 수 없는/누락된 필드 정리, `doneAt` 없는 완료 항목은 오늘 날짜로 백필.
2. `migrateArchive()` 실행 — 유예 기간이 지난 완료 항목들을 `archive`로 스윕. 같은 함수가 로컬 새로고침과 클라우드 동기화 양쪽에서 다 호출되므로, "다음날 새로고침" 케이스와 "다른 기기에서 나중에 열어봄" 케이스를 하나의 로직으로 커버함.

## 저장 위치 참고

- 로컬: `localStorage['postit-todo-boards-v1']` — 위 `Boards` shape을 그대로 `JSON.stringify`.
- 클라우드(로그인 시): Supabase `postit_data` 테이블, `id` = Supabase 유저 id, `data` 컬럼에 같은 `Boards` JSON. 본인 행에만 접근 가능.
- 테마 설정(`light`/`dark`)은 별도로 `localStorage['postit-theme']`에 저장 — `boards`와 무관.
