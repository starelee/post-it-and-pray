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
  lupin: Task[];
};
```

여섯 개 배열 모두 `Task` 객체의 배열이며, **어느 배열에 들어있느냐 자체가 그 항목이 어떤 보드에 속해 있는지를 결정함**(별도의 `boardId` 필드 없음). 항목이 보드를 이동하면(예: 날짜 지정, 완료 처리, waiting → today 복귀) 실제로 한 배열에서 `splice`해서 다른 배열로 `push`함. 단, `lupin`은 예외 — 아래 참고.

## `Task`

```ts
type Task = {
  id: number;           // Date.now() 기반, 사실상 유일값
  text: string;
  done: boolean;
  urgent: boolean;       // 완료(done=true)로 바뀌는 순간 false로 내려감 — 완료를 취소해도 복구하지 않음
  subtasks: Subtask[];
  dueDate?: string;      // "YYYY-MM-DD" — scheduled 항목에만 존재
  snoozedAt?: string;    // "YYYY-MM-DD" — 하루 시작하기의 '오래 묵은 것'에서 '그대로 두기(3일 미루기)'를 누른 날. updatedAt은 올리지 않음
  note?: string;         // 메모(최대 2000자, 줄바꿈 허용) — 없거나 빈 문자열이면 필드 자체가 없음. 항목이 보드를 옮겨 다니거나 아카이브로 가도 그대로 따라감
  group?: number;        // 묶음 id(처음 묶인 항목의 id) — 같은 값을 가진 항목끼리 한 묶음. 묶음 이름/별도 객체 없음. 아래 "묶음" 참고
  from?: string;         // 보드 id 문자열 — 아래 "from 필드의 두 가지 의미" 참고
  doneAt?: string;       // "YYYY-MM-DD" — done === true인 항목에만 존재
  todaySlot?: { date: string; index: number }; // gotta do를 떠난 날(YYYY-MM-DD)과 그때의 자리(0부터). 같은 날 gotta do로 돌아오면 그 자리로 복원하고 지움. 날짜가 오늘이 아니면 읽을 때 버림
  dueSetAt?: string;     // "YYYY-MM-DD" — dueDate가 생기거나 바뀐 날(saveBoards가 찍음). 하루 시작하기가 방금 정한 마감을 다시 묻지 않는 근거. updatedAt은 올리지 않음
  updatedAt?: number;    // 마지막으로 바뀐 시각(ms, Date.now()) — saveBoards가 바뀐 항목에만 찍음. 클라우드 병합에서 "더 나중에 바꾼 쪽이 이김"의 근거
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

- **`snoozedAt`**: 하루 시작하기의 `오래 묵은 것`에서 `그대로 두기`(= 3일 미루기)를 누른 날짜. 이 날짜로부터 3일이 지나기 전에는 `오래 묵은 것`(검색 제안 포함)에 안 올라옴. '마지막으로 손댄 때'(`updatedAt`)와 '미룬 때'를 따로 관리하려고 별도 필드로 두었고, 변경 감지 서명(`stampChangedTasks`)에서 빼서 미루기만으로는 `updatedAt`이 올라가지 않음(올라가면 묵은 시계가 리셋돼 미루기가 곧 2주가 됨). 클라우드 병합에서 `updatedAt`이 같을 때는 더 나중에 미룬 쪽이 이김(`mergeBoards`). 보드를 옮기면 지워짐.

- **`dueDate`**: `scheduled` 배열에 들어있는 항목만 가짐. `today`/`someday`/`waiting`/`archive`에 있는 동안엔 존재하지 않음(today/someday에서 날짜를 지정하는 순간 그 항목 자체가 `scheduled` 배열로 옮겨감).
- **`replyDate`** (`YYYY-MM-DD`, 선택): `waiting` 전용 "회신 예정일". `dueDate`와 완전히 별개 필드라 날짜를 붙여도 항목이 `waiting`에 그대로 남고, today로 옮기는 스윕(`migrateArchive`)도 건드리지 않음. 오늘보다 뒤(내일 이후)면 waiting 카드의 접힘 구역에 표시되고, 오늘이거나 지났으면 일반 항목처럼 표시됨(렌더 시점에 매번 다시 계산, 저장된 플래그 없음). waiting에서 다른 보드로 이동하면(`moveTask`) 제거됨. 필드가 없으면 기존과 완전히 동일하게 동작.
- **`note`**: 항목에 붙은 메모. 비어 있으면 저장하지 않고(필드 삭제), 로드 시 `normalizeTasks`가 2000자로 자름. `updatedAt` 기반 클라우드 병합은 다른 필드와 똑같이 항목 단위로 적용됨.
- **`doneAt`**: 체크(`done = true`)한 날짜. 체크 해제하면 삭제됨. 완료 아카이브 스윕(다음날 정리) 및 아카이브 패널의 월/날짜 그룹핑 기준으로 쓰임. 이 필드가 생기기 전의 예전 데이터는 로드 시 오늘 날짜로 자동 백필됨(영구히 스윕 대상에서 빠지지 않도록).
- **`from`(두 가지 의미, 시점에 따라 다름)**:
  1. **`scheduled`에 살아있는 항목일 때**: "날짜 지정 전에 어느 보드에 있었는지" (`'today'` 또는 `'someday'`). 날짜를 지우면 이 값을 보고 원래 보드로 돌아감.
  2. **`archive`로 넘어간 항목일 때**: "완료 당시 어느 보드에서 나왔는지" (`'today'` / `'someday'` / `'scheduled'`). 항목이 아카이브로 들어가는 순간 이 필드가 덮어써짐 — 아카이브에 들어간 뒤로는 첫 번째 의미(날짜 지정 전 출처)는 더 이상 쓸모가 없으므로 안전하게 재사용됨.
- **`group`**: 같이 처리하는 항목들이 공유하는 묶음 id. 완료하지 않은 짝이 둘 이상일 때만 의미가 있고(`isGrouped`), 짝이 하나 이하로 줄면(삭제·빼기·해제) `cleanGroup`이 남은 항목의 `group`까지 지움. 묶인 항목들은 한 카드에서 붙어 렌더링됨(`clusterGroups` — 정렬 후 가장 앞 멤버 자리로 모음). 묶인 항목 **하나만** 보드를 옮기거나(`moveTask`) 날짜/회신 예정일을 바꾸면(`setDueDate`) 확인을 거쳐 ① 같이 적용(묶인 완료 전 항목 전부) 또는 ② 그 항목의 `group`을 지우고 단독 적용. 삭제하면 `group`을 지우고 휴지통으로. 완료 표시한 항목은 그 자리에서는 `group`을 유지하지만(체크를 풀면 다시 묶임) 묶음 표시·이동 대상에서 빠지고, **done(`archive`)으로 넘어가는 순간 `group`을 지움**(다음날 스윕 `migrateArchive`, 즉시 아카이브 `archiveNow`, 하루 시작하기의 완료). 하루 시작하기는 묶인 항목을 질문 하나로 묻고(`dsQuestions` — 가장 앞선 질문이 대표, 나머지 짝은 `others`), 확정할 때 대표의 답을 묶음 전체에 적용함(`dsMemberDecision`: 후속 연락은 대표만 새 할 일을 만들고 짝은 확인일만, 합치기·맨 위로·복제는 대표만). 묶인 항목에는 완료 질문("하위 항목을 모두 끝냈는데…")과 "이미 끝났어요/해결됐어요" 선택지를 내지 않음(완료가 짝에게 번지지 않게). '오늘 할 일이 너무 많아요' 질문은 묶음을 쪼개지 않고 짝째 미룸. `updatedAt` 병합은 다른 필드와 같이 항목 단위.
- **`waiting`의 `done`**: 구조적으로 필드는 존재하지만 항상 `false`로 유지됨. waiting은 완료 개념이 없는 보드라 UI에도 체크박스가 없고, 혹시 다른 보드에서 완료 처리된 항목이 이동해오면 `moveTask`가 강제로 `false`로 리셋함.

## 보드별 특이 동작

| 보드 | 항목 진입 경로 | 항목 이탈 경로 |
|---|---|---|
| `today` | 직접 입력, waiting에서 `←`로 복귀, archive에서 revive는 안 됨(항상 scheduled로 감) | 체크 후 다음날 스윕 → `archive` |
| `waiting` | 직접 입력, 다른 보드에서 이동 | `←`(→ today), 이동(→ someday), 삭제 |
| `someday` | 직접 입력 | 날짜 지정(→ `scheduled`), 체크(→ 즉시 `archive`, 유예 없음) |
| `scheduled` | today/someday 항목에 날짜 지정, 아카이브 항목 "다시 쓰기" | 날짜 지움(→ 원래 보드), 오늘 마감분은 체크 후 다음날 스윕(→ `archive`), 오늘 마감 아닌 항목은 체크 즉시(→ `archive`) |
| `archive` | 위 스윕/즉시 아카이브 경로 | 🗑️ 삭제만 가능(원본 삭제, 복구 없음). "다시 쓰기"는 원본은 그대로 두고 `scheduled`에 완전히 새로운 독립 항목을 생성 |
| `lupin` | 직접 입력만(waiting 스티키를 뒤집었을 때 나오는 개인용 숨김 메모장 UI에서) | 🗑️ 삭제, 또는 체크한 날 자정이 지나면 다음 `migrateArchive` 때 완전히 삭제(archive로 넘어가지 않고 그냥 사라짐). 체크한 당일에는 취소선만 그어진 채 그대로 남음 — `today`/`waiting`/`someday` 등 다른 보드로도 옮겨지지 않음(이동 버튼 자체가 없음), `BOARD_IDS`/`collectArchiveEntries`에서 의도적으로 제외되어 있어 done 아카이브 패널에도 절대 노출되지 않음 |

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
- `localStorage['postit-cloud-dirty']`: 로그인한 채 이 기기에서 고쳤는데 아직 클라우드에 못 올린 변경이 있을 때 그 계정(Supabase 유저 id)을 적어 둠. 클라우드에 올리기가 성공하면(그 사이 더 고친 게 없을 때) 지움. 새로 열 때 이 값이 있으면 클라우드 내용으로 덮어쓰지 않고 항목별로 합친 뒤 다시 올림. `boards`/백업/클라우드에는 안 들어가는 기기별 값.
- 테마 설정(`light`/`dark`)은 별도로 `localStorage['postit-theme']`에 저장 — `boards`와 무관.

## 백업 파일

헤더의 💾 버튼으로 내려받는 백업 파일은 위 `boards`를 래퍼로 감싼 JSON임:

```ts
type BackupFile = {
  app: 'post-it-and-pray';
  version: 1;          // 파일 형식 버전. 더 큰 값은 복구 시 거절됨
  exportedAt: string;  // ISO 8601
  boards: Boards;      // lupin, trash 포함 전체
};
```

복구는 `boards`를 `normalizeBoards`로 정리한 뒤 통째로 교체함. `boards`만 있는 파일(래퍼 없음)도 받아줌.

## 하루 시작하기 초안(`boards`와 별개)

하루 시작하기 패드는 확정 전까지의 답을 `localStorage['postit-daystart-draft-v1']`에 둠 — `boards`/백업/클라우드에는 들어가지 않는 기기별 임시 값이라 `Task` 스키마는 바뀌지 않음(미루기 `snoozedAt`만 확정 때 `Task`에 기록됨). 마지막으로 확정한 날짜는 `localStorage['postit-daystart-confirmed-v1']`(`YYYY-MM-DD`, 헤더 버튼의 "미확정" 점 표시용).

```ts
type DayStartDraft = {
  date: string;                       // 초안을 만든 날(오늘이 아니면 버림)
  step: 'tidy' | 'cal' | 'order';
  decisions: Record<string, {         // key = 항목 id(문자열, 반복되는 일은 'r:<완료 기록 id>'). 질문에 '네/아니오'로 답한 결과
    action: 'today' | 'toSomeday' | 'done' | 'resolved' | 'urgent' | 'follow' | 'keep'
          | 'later' | 'setReply' | 'top' | 'merge' | 'repeat' | 'unurgent';
    date?: string;                    // follow/setReply: 다음 확인 날짜, later: 다시 잡은 마감일
    text?: string;                    // follow: 후속 작업 제목
    picked?: boolean;                 // later: 날짜를 직접 골랐음(someday '날짜 정하기' — 결과 문구만 '미룸' 대신 '시작'으로)
    snooze?: boolean;                 // keep: 아니오 = 3일 미루기(확정 때 snoozedAt 기록)
    intoId?: number;                  // merge: 합쳐질(먼저 만든) 항목 id
    prevOrder?: string[];             // top: 되돌릴 때 복원할 이전 순서
    sig: string;                      // "보드|updatedAt" — 답한 뒤 항목이 바뀌었는지 확인용
  }>;
  log: (number | string)[];           // 답한 순서(← 이전으로 되돌리기용, 'overload' 포함)
  overload?: { ids: number[] } | { skip: true };  // '오늘 할 일이 너무 많은데 내일로 미룰래요?' 답(항목에 묶이지 않는 질문)
  prep: { key: string; text: string; date?: string; src?: string }[];  // 순서 단계에서 추가한/캘린더 일정에서 담은 할 일(확정 때 Task로 만들어짐, 날짜가 내일 이후면 pray later로). src = '<구글 일정 id>@<날짜>'(캘린더에서 담은 것)
  order: string[];                    // 오늘 순서: 항목 id 또는 'f:<원본id>'(후속)/'p:<n>'(추가) 키
  orderW: string[];                   // 기다리는 중(waiting) 순서 — 항목 id 키, 직접 바꾼 경우만 확정 때 task.order로 기록
  doneKeys: string[];                 // 오늘 순서 화면에서 ✓로 완료 표시한 항목 키(id 또는 추가한 할 일 키) — 확정 때 완료 처리, 오늘 목록에 없는 키는 무시
  seq: number;
};
```

확정하면 답을 `boards`에 한 번에 적용하고, 오늘 목록(일반 + 오늘 마감)의 미완료 항목에 `order`를 0부터 차례로 기록함. 후속 연락/추가한 할 일은 일반 `Task`로 생성되며 원본과의 연결 필드는 없음.

구글 캘린더 연결 상태는 이 기기의 `localStorage`에만 둠(`boards`/백업/클라우드에는 안 들어감): `postit-gcal-token`(`{ token, exp }` — 1시간짜리 읽기 전용 액세스 토큰), `postit-gcal-granted`(한 번 동의했는지), `postit-gcal-cals`(읽을 캘린더 id 목록 JSON, 없으면 기본), `postit-gcal-account`(로그인 계정과 다른 계정을 직접 골랐을 때 그 이메일), `postit-gcal-declined`(연결 없이 넘어가서 일정 단계를 숨기는지). 로그인 직후 받은 구글 토큰은 `postit-gcal-seen`(이미 본 `provider_token`)으로 중복 반영을 막음.
