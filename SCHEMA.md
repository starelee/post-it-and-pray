# 데이터 스키마

앱의 전체 상태는 하나의 JSON 객체(**저장소 `Store`**, 버전 2)로 관리됨. 이 객체가 그대로:

- `localStorage`의 `postit-todo-store-v2` 키에 직렬화되어 저장되고,
- 로그인 상태면 Supabase `postit_data` 테이블의 `data` 컬럼(유저 id를 PK로 하는 행)에도 그대로 저장됨.

두 저장소 모두 **같은 shape**을 씀 — 별도의 서버용/클라이언트용 변환이 없음. 프로젝트 도입 전(v1)에는 아래 `Boards` 하나가 그 자리였음(`postit-todo-boards-v1` 키 / 클라우드 행의 `data`) — 아래 "프로젝트와 v1 마이그레이션" 참고.

## 프로젝트와 `Store`

```ts
type Store = {
  version: 2;
  projects: Project[];   // 1개 이상. 배열 순서 = 프로젝트 목록 순서
  lupin: Task[];         // 월급루팡 — 모든 프로젝트 공통 한 벌
  removed: string[];     // 지운 프로젝트 id(최대 50개) — 병합 때 되살아나지 않게 하는 기록
};

type Project = {
  id: string;            // /^[A-Za-z0-9_-]{1,40}$/. 처음 프로젝트는 'main', 새로 만들면 'p' + 시각(36진수) + 난수. 바뀌지 않고 재사용되지 않음
  name: string;          // 사람이 보는 라벨(최대 20자, 공백 정리). 바꿔도 id·항목은 그대로. 같은 이름(대소문자·공백 무시)은 UI가 막음
  boards: Boards;        // 이 프로젝트의 보드. 단 `lupin` 키는 저장하지 않음(공통 `Store.lupin`을 씀)
};
```

- **프로젝트는 서로 완전히 분리**됨: 항목은 한 프로젝트의 `boards`에만 있고, 프로젝트 사이로 옮기는 기능은 없음. 검색·하루 시작하기·묶음·삭제 기록(`trash`)·되돌리기(`Ctrl+Z`)는 모두 열어 둔 프로젝트 안에서만 동작함.
- **메모리에서는** 나머지 코드가 전부 `boards`(= 열어 둔 프로젝트의 `Boards` + 공통 `lupin`) 하나만 봄. 저장할 때 `serializeStore`가 열어 둔 프로젝트의 `boards`에서 `lupin`을 빼 그 프로젝트 자리에 넣고, `lupin`은 `Store.lupin`으로 올림. 불러올 때 `applyStore`가 반대로 합침.
- **열어 둔 프로젝트(`activeProject`)는 저장소에 없음**: 이 기기의 `localStorage['postit-active-project']`(프로젝트 id)에만 기억하는 기기별 값. 목록에 없는 id면 첫 프로젝트로 열림.
- **프로젝트 전환 규칙**: 지금 프로젝트의 `boards`를 목록에 갈무리하고 다음 프로젝트의 `boards` + 공통 `lupin`을 `boards`로 삼은 뒤, 되돌리기 기록을 비우고 새 프로젝트에 `migrateArchive`를 한 번 적용(켜 둔 채 날짜가 바뀐 경우를 위해). 하루 시작하기·포커스가 진행 중이거나 확인 모달이 떠 있으면 전환하지 않음.
- **프로젝트 지우기**: 항목이 하나라도 있으면(done·gone 포함) 프로젝트 이름을 직접 입력해야 함. 지우면 `projects`에서 빠지고 id가 `removed`에 들어감(복구 없음). 마지막 프로젝트는 지울 수 없음. 열어 둔 프로젝트를 지우면 먼저 다른(첫) 프로젝트로 옮겨 감.
- **프로젝트별 기기 값**: 하루 시작하기 초안/확정 날짜 키(`postit-daystart-draft-v1`, `postit-daystart-confirmed-v1`)는 `main`이면 그대로, 다른 프로젝트는 뒤에 `:<프로젝트 id>`가 붙음. 구글 캘린더 연결·테마·포커스 세션 키는 프로젝트와 무관한 공통 값.
- **병합(`mergeStores`)**: 프로젝트 id별로 `mergeBoards`(아래 항목 단위 규칙)를 적용하고 `lupin`도 같은 규칙으로 따로 병합함. `removed`는 양쪽의 합집합이고, 거기 있는 id의 프로젝트는 결과에서 빠짐. 이름은 이 기기 쪽이 이김. 프로젝트를 한쪽에서 새로 만들었으면 합집합으로 남음. 지운 프로젝트에 다른 기기가 나중에 더한 항목은 지운 것과 함께 사라짐.
- **백업 파일(v2)**: `{ app: 'post-it-and-pray', version: 2, exportedAt, projects, lupin }`. 복구하면 프로젝트 전체가 파일 내용으로 바뀌고(파일에 없는 지금 프로젝트는 지운 것으로 기록, 이미 지운 id가 파일에 있으면 새 id로 되살림), 되돌리기 기록은 비워서 `Ctrl+Z`로 되돌릴 수 없음.

### 프로젝트와 v1 마이그레이션

- `normalizeStore`는 v1 모양(`Boards` 객체, `projects` 키 없음)을 만나면 그것을 id `main`, 이름 `기본`인 프로젝트 하나로 감싸고 그 `Boards`의 `lupin`을 공통 `Store.lupin`으로 올림. 로컬 로드, 클라우드 로드, 백업 복구가 전부 이 함수를 거치므로 어디서 읽어도 같은 결과.
- 로컬은 `postit-todo-store-v2`가 없을 때만 v1 키(`postit-todo-boards-v1`) → 그보다 옛 `postit-todo-tasks-v1` 순으로 읽음. **v1 키는 지우지도 다시 쓰지도 않으므로** 처음 저장되기 전까지(그리고 그 뒤에도) 옛 데이터가 그대로 남아 있음.
- 클라우드 행은 처음 저장하는 순간 v2 모양으로 바뀜. v1 모양 행도 위 규칙으로 읽히고, v1 백업 파일(`{ app, version: 1, boards }`)은 복구할 때 **지금 열어 둔 프로젝트 하나만** 바꿈(공통 `lupin` 포함, 다른 프로젝트는 그대로).
- 프로젝트 도입 전 앱 버전으로 되돌리면 v2 데이터를 읽지 못함(v1 키의 옛 값이 보임) — 되돌리기 전에 백업 데이터를 받아 둘 것.

## `boards` (프로젝트 하나의 `Boards`)

```ts
type Boards = {
  today: Task[];
  waiting: Task[];
  someday: Task[];
  scheduled: Task[];
  archive: Task[];
  lupin: Task[];
  memos?: Memo[];        // 메모 보드 — Task가 아님. 아래 "`Memo`" 참고 (없으면 빈 배열로 정리됨)
};
```

(`lupin`은 메모리에서 열어 둔 프로젝트의 `boards`에 공통 월급루팡이 합쳐져 있을 뿐, 저장된 프로젝트의 `boards`에는 없음 — 위 `Store.lupin`. v1 저장 데이터에는 여기 들어 있었음.)

`memos`를 뺀 여섯 개 배열 모두 `Task` 객체의 배열이며, **어느 배열에 들어있느냐 자체가 그 항목이 어떤 보드에 속해 있는지를 결정함**(별도의 `boardId` 필드 없음). 항목이 보드를 이동하면(예: 날짜 지정, 완료 처리, waiting → today 복귀) 실제로 한 배열에서 `splice`해서 다른 배열로 `push`함. 단, `lupin`은 예외 — 아래 참고.

## `Task`

```ts
type Task = {
  id: number;           // Date.now() 기반, 사실상 유일값
  text: string;
  done: boolean;
  urgent: boolean;       // 완료(done=true)로 바뀌는 순간 false로 내려감 — 완료를 취소해도 복구하지 않음
  subtasks: Subtask[];
  scheduledDate?: string;      // "YYYY-MM-DD" — 수행 예정일("그날 하겠다"). scheduled 항목에만 존재. 옛 이름 dueDate
  deadline?: string;     // "YYYY-MM-DD" — 마감일("그날까지 해야 한다"). 수행일과 별개로 어느 보드의 항목에나 붙고 보드를 옮기지 않음
  snoozedAt?: string;    // "YYYY-MM-DD" — 하루 시작하기에서 '아니오(미루기)'를 누른 날(오래 묵은 것 등은 3일, 날짜 기반 질문은 내일까지 — 아래 `snoozedAt` 참고). updatedAt은 올리지 않음
  note?: string;         // 메모(최대 2000자, 줄바꿈 허용) — 없거나 빈 문자열이면 필드 자체가 없음. 항목이 보드를 옮겨 다니거나 아카이브로 가도 그대로 따라감
  group?: number;        // 묶음 id(처음 묶인 항목의 id) — 같은 값을 가진 항목끼리 한 묶음. 묶음 이름/별도 객체 없음. 아래 "묶음" 참고
  from?: string;         // 보드 id 문자열 — 아래 "from 필드의 두 가지 의미" 참고
  doneAt?: string;       // "YYYY-MM-DD" — done === true인 항목에만 존재
  todaySlot?: { date: string; index: number }; // gotta do를 떠난 날(YYYY-MM-DD)과 그때의 자리(0부터). 같은 날 gotta do로 돌아오면 그 자리로 복원하고 지움. 날짜가 오늘이 아니면 읽을 때 버림
  scheduledSetAt?: string;     // "YYYY-MM-DD" — scheduledDate가 생기거나 바뀐 날(saveBoards가 찍음). 하루 시작하기가 방금 정한 날짜를 다시 묻지 않는 근거. updatedAt은 올리지 않음
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

## `Memo`

`today`/`waiting`… 같은 할 일 보드 아래 따로 둔 **메모 보드**(`memo...` 포스트잇)의 항목. `Task`가 아니라서 체크·날짜·하위 항목·묶음·검색·하루 시작하기·done 아카이브·삭제 기록(`trash`)과 무관하고, `BOARD_IDS`에도 들어 있지 않음. **프로젝트마다 따로**(`Project.boards.memos`) 가지며 프로젝트 사이로 옮기는 기능은 없음(공통인 `lupin`과 다름).

```ts
type Memo = {
  id: number;          // Date.now() 기반. 같은 프로젝트 안에서만 유일하면 됨(Task id와는 별개 공간)
  title: string;       // 1~40자, 목록에 보이는 글. 비어 있으면 정리 때 본문 첫 줄로 채우고, 둘 다 없으면 그 메모는 버림
  body: string;        // 내용(최대 2000자, 줄바꿈 허용, 빈 문자열 가능) — 제목을 누르면 펼쳐 보임
  pinned?: true;       // 핀 — 있을 때만 존재. 목록 위쪽에 모임
  updatedAt?: number;  // 마지막으로 바뀐 시각(ms) — saveBoards가 바뀐 메모에만 찍음. 병합에서 "더 나중에 바꾼 쪽이 이김"의 근거
};
```

- **상한**: 프로젝트마다 최대 **7개**, 그중 핀은 최대 **3개**. 상한은 **새로 적거나 핀을 고정할 때만** 막음(입력창이 잠기고 안내가 뜸). 불러오기·클라우드 병합·백업 복구에서는 개수 때문에 메모를 버리지 않으므로, 다른 기기에서 따로 적어 7개를 넘게 합쳐지면 넘친 채로 모두 보이고 하나를 지워 7개 아래로 내려가야 새로 적을 수 있음. 핀이 3개를 넘게 합쳐지면 `normalizeMemos`가 가장 최근에 바꾼 3개만 남기고 나머지는 **핀만 해제**함(메모는 그대로).
- **표시**: 보드 전체가 기본 접힘(저장하지 않는 화면 상태, 열림 여부는 새로고침하면 접힘으로 돌아감). 열면 핀 메모가 위, 나머지가 아래(각각 배열 순서, 새 메모는 맨 아래). 제목만 보이고 누르면 내용이 펼쳐지며 한 번에 하나만 열림. 펼친 메모에서 복사·수정·핀 고정/풀기·삭제. 새 메모는 제목을 적고 Enter를 치면 만들어지고 바로 내용 입력으로 넘어감.
- **삭제**: 확인을 한 번 거쳐 지움. 휴지통(`trash`)에는 가지 않지만 `Ctrl+Z`(메모리 기록)로 되돌릴 수 있음.
- **병합(`mergeMemos`)**: id별로 `updatedAt`이 더 큰 쪽이 이기고(같거나 없으면 이 기기 쪽), 한쪽에서만 있는 메모는 합집합으로 남음. 할 일과 마찬가지로 한쪽에서 지우고 다른 쪽에서 그대로 두면 되살아나는 한계가 있음(삭제 기록 없음).
- **저장·백업**: 프로젝트의 `boards`에 그대로 실려 `Store`/백업 파일/클라우드에 함께 저장됨. `memos`가 없는 옛 데이터·옛 백업은 빈 메모 보드로 읽힘(마이그레이션 없음). 옛 백업을 복구하면 지금 메모는 파일 내용(없으면 빈 상태)으로 바뀜 — 복구 확인창의 요약에 `memo N`이 보이고, `Ctrl+Z`로 되돌릴 수 있음.

## 필드별 의미

- **`snoozedAt`**: 하루 시작하기에서 `아니오`로 미룬 날짜. 질문 종류에 따라 쉬는 기간이 다름 — `오래 묵은 것`·같은 제목·긴급 묵음 등은 3일(`SNOOZE_DAYS`) 동안 안 올라오고(검색 제안의 `오래 묵은 것` 포함), 날짜 기반 질문(예정일·회신·마감일, `DAYSTART_DATE_REST_DAYS`)은 오늘과 내일(2일)만 쉬고 모레 다시 물음. 단 마감이 D-1 이내이거나 지난 마감 질문은 `snoozedAt`과 무관하게 계속 물음. 어느 쪽이든 같은 필드 하나에 날짜만 남기고 기간은 질문 종류가 정함. '마지막으로 손댄 때'(`updatedAt`)와 '미룬 때'를 따로 관리하려고 별도 필드로 두었고, 변경 감지 서명(`stampChangedTasks`)에서 빼서 미루기만으로는 `updatedAt`이 올라가지 않음(올라가면 묵은 시계가 리셋돼 미루기가 곧 2주가 됨). 클라우드 병합에서 `updatedAt`이 같을 때는 더 나중에 미룬 쪽이 이김(`mergeBoards`). 보드를 옮기면 지워짐.

- **`scheduledDate`**: **"그날 하겠다"고 정한 날(수행 예정일)이지 마감일이 아님.** 그날이 되면 today에 나타나고, 지났는데 안 했으면 "기한 초과"가 아니라 "그날 못 한 일이 오늘로 이월된 것"(`oops, still here`)이다. 옛 이름은 `dueDate`(마감으로 오독되어 바꿈) — 불러올 때 `normalizeTasks`가 옛 이름(`dueDate`/`dueSetAt`)을 새 이름으로 읽어 주고, 저장하면 새 이름으로만 기록됨(옛 앱 버전은 새 이름을 못 읽음). `scheduled` 배열에 들어있는 항목만 가짐. `today`/`someday`/`waiting`/`archive`에 있는 동안엔 존재하지 않음(today/someday에서 날짜를 지정하는 순간 그 항목 자체가 `scheduled` 배열로 옮겨감).
- **`deadline`** (`YYYY-MM-DD`, 선택): **마감일 — "그날까지 해야 한다".** 수행일과 완전히 별개라 한 항목이 둘 다 가질 수 있고(예: 11/20에 하고 마감은 11/25), 값을 붙이거나 지워도 항목이 보드를 옮기지 않음(`today`/`someday`/`waiting`/`scheduled` 어디서나, 날짜 행의 둘째 줄 "마감" 칸 또는 새 항목 입력창의 미리 정하기). 어떤 스윕·이동·정렬도 이 필드를 근거로 자동 처리하지 않음(표시 전용). 라벨은 평소엔 숨겨 두고 호버/포커스/탭으로 연 항목에서만 보이며, D-4 이내(지난 것 포함)부터 평소에도 보임: D-4는 날짜(`11/20(금)`, 단 금요일에는 D-4도 `D-4`), D-3~D-day와 지난 것은 `D-3`·`D-day`·`D+2`. 완료한 항목에는 표시하지 않음. 없으면 필드 자체가 없음.
- **`replyDate`** (`YYYY-MM-DD`, 선택): `waiting` 전용 "회신 예정일". `scheduledDate`와 완전히 별개 필드라 날짜를 붙여도 항목이 `waiting`에 그대로 남고, today로 옮기는 스윕(`migrateArchive`)도 건드리지 않음. 오늘보다 뒤(내일 이후)면 waiting 카드의 접힘 구역에 표시되고, 오늘이거나 지났으면 일반 항목처럼 표시됨(렌더 시점에 매번 다시 계산, 저장된 플래그 없음). waiting에서 다른 보드로 이동하면(`moveTask`) 제거됨. 필드가 없으면 기존과 완전히 동일하게 동작.
- **`note`**: 항목에 붙은 메모. 비어 있으면 저장하지 않고(필드 삭제), 로드 시 `normalizeTasks`가 2000자로 자름. `updatedAt` 기반 클라우드 병합은 다른 필드와 똑같이 항목 단위로 적용됨.
- **`doneAt`**: 체크(`done = true`)한 날짜. 체크 해제하면 삭제됨. 완료 아카이브 스윕(다음날 정리) 및 아카이브 패널의 월/날짜 그룹핑 기준으로 쓰임. 이 필드가 생기기 전의 예전 데이터는 로드 시 오늘 날짜로 자동 백필됨(영구히 스윕 대상에서 빠지지 않도록).
- **`from`(두 가지 의미, 시점에 따라 다름)**:
  1. **`scheduled`에 살아있는 항목일 때**: "날짜 지정 전에 어느 보드에 있었는지" (`'today'` 또는 `'someday'`). 날짜를 지우면 이 값을 보고 원래 보드로 돌아감.
  2. **`archive`로 넘어간 항목일 때**: "완료 당시 어느 보드에서 나왔는지" (`'today'` / `'someday'` / `'scheduled'`). 항목이 아카이브로 들어가는 순간 이 필드가 덮어써짐 — 아카이브에 들어간 뒤로는 첫 번째 의미(날짜 지정 전 출처)는 더 이상 쓸모가 없으므로 안전하게 재사용됨.
- **`group`**: 같이 처리하는 항목들이 공유하는 묶음 id. 완료하지 않은 짝이 둘 이상일 때만 의미가 있고(`isGrouped`), 짝이 하나 이하로 줄면(삭제·빼기·해제) `cleanGroup`이 남은 항목의 `group`까지 지움. 묶인 항목들은 한 카드에서 붙어 렌더링됨(`clusterGroups` — 정렬 후 가장 앞 멤버 자리로 모음). 묶인 항목 **하나만** 보드를 옮기거나(`moveTask`) 날짜/회신 예정일을 바꾸면(`setDueDate`) 확인을 거쳐 ① 같이 적용(묶인 완료 전 항목 전부) 또는 ② 그 항목의 `group`을 지우고 단독 적용. 삭제하면 `group`을 지우고 휴지통으로. 완료 표시한 항목은 그 자리에서는 `group`을 유지하지만(체크를 풀면 다시 묶임) 묶음 표시·이동 대상에서 빠지고, **done(`archive`)으로 넘어가는 순간 `group`을 지움**(다음날 스윕 `migrateArchive`, 즉시 아카이브 `archiveNow`, 하루 시작하기의 완료). 하루 시작하기는 묶인 항목을 질문 하나로 묻고(`dsQuestions` — 가장 앞선 질문이 대표, 나머지 짝은 `others`), 확정할 때 대표의 답을 묶음 전체에 적용함(`dsMemberDecision`: 후속 연락은 대표만 새 할 일을 만들고 짝은 확인일만, 합치기·맨 위로·복제는 대표만). 묶인 항목에는 완료 질문("하위 항목을 모두 끝냈는데…")과 "이미 끝났어요/해결됐어요" 선택지를 내지 않음(완료가 짝에게 번지지 않게). '오늘 할 일이 많은데, 일부는 미룰래요?' 질문은 미룰 후보를 항목마다 `오늘`(그대로)/`내일`(금·토·일엔 `월요일`)/`날짜지정`으로 고르게 하고(처음엔 전부 `오늘`), 묶음은 한 줄로 묶어 짝째 미룸. 초안의 `overload`는 `{ ids, dates: { id: 'YYYY-MM-DD' }, count }`(구버전 `{ ids }`는 내일로 처리) 또는 `{ skip: true }`. `updatedAt` 병합은 다른 필드와 같이 항목 단위.
- **`waiting`의 `done`**: 구조적으로 필드는 존재하지만 항상 `false`로 유지됨. waiting은 완료 개념이 없는 보드라 UI에도 체크박스가 없고, 혹시 다른 보드에서 완료 처리된 항목이 이동해오면 `moveTask`가 강제로 `false`로 리셋함.

## 보드별 특이 동작

| 보드 | 항목 진입 경로 | 항목 이탈 경로 |
|---|---|---|
| `today` | 직접 입력, waiting에서 `←`로 복귀, archive에서 revive는 안 됨(항상 scheduled로 감) | 체크 후 다음날 스윕 → `archive` |
| `waiting` | 직접 입력, 다른 보드에서 이동 | `←`(→ today), 이동(→ someday), 삭제 |
| `someday` | 직접 입력 | 날짜 지정(→ `scheduled`), 체크(→ 즉시 `archive`, 유예 없음) |
| `scheduled` | today/someday 항목에 날짜 지정, 아카이브 항목 "다시 쓰기" | 날짜 지움(→ 원래 보드), 오늘 할 날짜인 항목은 체크 후 다음날 스윕(→ `archive`), 오늘이 아닌 항목은 체크 즉시(→ `archive`) |
| `archive` | 위 스윕/즉시 아카이브 경로 | 🗑️ 삭제만 가능(원본 삭제, 복구 없음). "다시 쓰기"는 원본은 그대로 두고 `scheduled`에 완전히 새로운 독립 항목을 생성 |
| `lupin` | 직접 입력만(waiting 스티키를 뒤집었을 때 나오는 개인용 숨김 메모장 UI에서) | 🗑️ 삭제, 또는 체크한 날 자정이 지나면 다음 `migrateArchive` 때 완전히 삭제(archive로 넘어가지 않고 그냥 사라짐). 체크한 당일에는 취소선만 그어진 채 그대로 남음 — `today`/`waiting`/`someday` 등 다른 보드로도 옮겨지지 않음(이동 버튼 자체가 없음), `BOARD_IDS`/`collectArchiveEntries`에서 의도적으로 제외되어 있어 done 아카이브 패널에도 절대 노출되지 않음 |

## `today`'s list에 표시되는데 `boards.today`엔 없는 항목들

`today` 카드(포스트잇)에 화면상 보이는 항목 중 일부는 실제로는 `boards.scheduled` 배열에 저장되어 있음 — 별도로 복제하지 않고 매 렌더링마다 조건에 맞는 걸 끌어와서 보여주는 방식(`renderToday()`):

- `scheduledDate === 오늘` && `!done` → today의 일반 활성 항목처럼 표시
- `scheduledDate === 오늘` && `done` → today의 완료(취소선) 구간에 표시
- `scheduledDate < 오늘` && `!done` → "oops, still here" 구분선 아래 표시

이 항목들을 체크/삭제/수정하면 실제로는 `boards.scheduled` 배열의 그 객체가 바뀜 — `boards.today` 자체엔 아무 영향 없음.

## 완료 아카이브(`archive`) 패널에 표시되는데 `boards.archive`엔 아직 없는 항목들

완료 아카이브 패널도 같은 방식(`collectArchiveEntries()`)으로, 아직 다음날 스윕이 안 된 "오늘 완료한 today/scheduled 항목"을 `boards.today`/`boards.scheduled`에서 그대로 읽어와서 `boards.archive`의 항목들과 합쳐서 보여줌. 실제로 배열이 옮겨지는 건 다음날 앱을 열 때(`migrateArchive()`)뿐.

## 마이그레이션/정규화

앱은 로드할 때마다(로컬 로드, 클라우드 동기화 둘 다) `normalizeStore()`를 거치고, 그 안에서 프로젝트마다 `normalizeBoards()`를 거침(아래 1~2는 프로젝트 하나 기준):

1. 각 보드 배열을 `normalizeTasks()`로 정리 — 알 수 없는/누락된 필드 정리, `doneAt` 없는 완료 항목은 오늘 날짜로 백필.
2. `migrateArchive()` 실행 — 유예 기간이 지난 완료 항목들을 `archive`로 스윕. 같은 함수가 로컬 새로고침과 클라우드 동기화 양쪽에서 다 호출되므로, "다음날 새로고침" 케이스와 "다른 기기에서 나중에 열어봄" 케이스를 하나의 로직으로 커버함.

## 저장 위치 참고

- 로컬: `localStorage['postit-todo-store-v2']` — 위 `Store` shape을 그대로 `JSON.stringify`. (프로젝트 도입 전 키 `postit-todo-boards-v1`은 읽기만 함 — 위 "프로젝트와 v1 마이그레이션")
- `localStorage['postit-active-project']`: 이 기기에서 열어 둔 프로젝트 id. 클라우드에는 안 올라가는 기기별 값.
- 클라우드(로그인 시): Supabase `postit_data` 테이블, `id` = Supabase 유저 id, `data` 컬럼에 같은 `Store` JSON. 본인 행에만 접근 가능.
- `localStorage['postit-cloud-dirty']`: 로그인한 채 이 기기에서 고쳤는데 아직 클라우드에 못 올린 변경이 있을 때 그 계정(Supabase 유저 id)을 적어 둠. 클라우드에 올리기가 성공하면(그 사이 더 고친 게 없을 때) 지움. 새로 열 때 이 값이 있으면 클라우드 내용으로 덮어쓰지 않고 항목별로 합친 뒤 다시 올림. `boards`/백업/클라우드에는 안 들어가는 기기별 값.
- 테마 설정(`light`/`dark`)은 별도로 `localStorage['postit-theme']`에 저장 — `boards`와 무관.

## 백업 파일

헤더 ⚙️ 설정 → 클라우드 / 백업 모달로 내려받는 백업 파일은 모든 프로젝트를 담은 JSON임:

```ts
type BackupFile = {
  app: 'post-it-and-pray';
  version: 2;          // 파일 형식 버전. 더 큰 값은 복구 시 거절됨 (1 = 프로젝트 도입 전, boards 하나)
  exportedAt: string;  // ISO 8601
  projects: Project[]; // 프로젝트별 boards(trash 포함, lupin은 없음)
  lupin: Task[];       // 공통 월급루팡
};
// v1: { app, version: 1, exportedAt, boards: Boards } — boards만 있는 파일(래퍼 없음)도 받아줌
```

v2 복구는 `normalizeStore`로 정리한 뒤 프로젝트 전체를 통째로 교체함(위 "백업 파일(v2)"). v1 파일은 `normalizeBoards`로 정리해 열어 둔 프로젝트 하나만 교체함.

## 하루 시작하기 초안(`boards`와 별개)

하루 시작하기 패드는 확정 전까지의 답을 `localStorage['postit-daystart-draft-v1']`(프로젝트별 — 기본 프로젝트가 아니면 `:<프로젝트 id>`가 붙음)에 둠 — `boards`/백업/클라우드에는 들어가지 않는 기기별 임시 값이라 `Task` 스키마는 바뀌지 않음(미루기 `snoozedAt`만 확정 때 `Task`에 기록됨). 마지막으로 확정한 날짜는 `localStorage['postit-daystart-confirmed-v1']`(`YYYY-MM-DD`, 헤더 버튼의 "미확정" 점 표시용, 같은 방식으로 프로젝트별).

```ts
type DayStartDraft = {
  date: string;                       // 초안을 만든 날(오늘이 아니면 버림)
  step: 'tidy' | 'cal' | 'order';
  decisions: Record<string, {         // key = 항목 id(문자열, 반복되는 일은 'r:<완료 기록 id>'). 질문에 '네/아니오'로 답한 결과
    action: 'today' | 'toSomeday' | 'done' | 'resolved' | 'urgent' | 'follow' | 'keep'
          | 'later' | 'setReply' | 'top' | 'merge' | 'repeat' | 'unurgent'
          | 'setDeadline' | 'clearDeadline';   // 마감일만 바꾸거나 지움(보드는 그대로)
    date?: string;                    // follow/setReply: 다음 확인 날짜, later: 다시 잡은 날짜(그날 하기로), setDeadline: 새 마감일(오늘도 가능)
    text?: string;                    // follow: 후속 작업 제목
    picked?: boolean;                 // later: 날짜를 직접 골랐음(someday '날짜 정하기' — 결과 문구만 '미룸' 대신 '시작'으로)
    snooze?: boolean | 'rest';        // keep: 아니오 = 미루기(확정 때 snoozedAt 기록). true = 3일, 'rest' = 내일까지(날짜 기반 질문)
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

확정하면 답을 `boards`에 한 번에 적용하고, 오늘 목록(일반 + 오늘 날짜인 항목)의 미완료 항목에 `order`를 0부터 차례로 기록함. 후속 연락/추가한 할 일은 일반 `Task`로 생성되며 원본과의 연결 필드는 없음.

구글 캘린더 연결 상태는 이 기기의 `localStorage`에만 둠(`boards`/백업/클라우드에는 안 들어감): `postit-gcal-token`(`{ token, exp }` — 1시간짜리 읽기 전용 액세스 토큰), `postit-gcal-granted`(한 번 동의했는지), `postit-gcal-cals`(읽을 캘린더 id 목록 JSON, 없으면 기본), `postit-gcal-account`(로그인 계정과 다른 계정을 직접 골랐을 때 그 이메일), `postit-gcal-declined`(연결 없이 넘어가서 일정 단계를 숨기는지). 로그인 직후 받은 구글 토큰은 `postit-gcal-seen`(이미 본 `provider_token`)으로 중복 반영을 막음.
