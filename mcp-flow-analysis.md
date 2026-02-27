# viruagent-mcp 총 흐름 분석 (개선 반영 버전)

## 1) 시스템 경계 (현재 구조)
- 실행 엔트리
  - `bin/index.js` → `runMcpServer()` 실행
  - `src/server.js`에서 MCP 스키마/핸들러 등록
- 핵심 의존성 흐름
  - MCP 클라이언트 요청 → `providerManager` → `provider` (`tistory`/`naver`) → `tistoryApiClient` (`src/services/tistoryApiClient.js`)
- 영속 데이터
  - `~/.viruagent-mcp/sessions/{provider}-session.json` (로그인 쿠키 저장)
  - `~/.viruagent-mcp/providers.json` (provider 메타 저장)

## 2) 실행/핸드쉐이크 흐름
1. `node bin/index.js`
2. `runMcpServer()`가 `StdioServerTransport`로 MCP 서버 시작
3. 클라이언트의 `list_tools` 요청 시 tool 스키마 반환
4. `CallToolRequestSchema` 핸들러에서 tool name → provider method 매핑
5. provider의 결과를 `buildOk/buildError`로 MCP 응답 포맷 통합

## 3) provider manager 흐름
- 파일: `src/services/providerManager.js`
- provider 문자열 정규화 후 팩토리(`tistory`, `naver`)로 인스턴스 획득
- provider별 sessionPath는 `getSessionPath`에서 결정

## 4) `withProviderSession` 동작
- 현재 구현: `withProviderSession`은 실행 함수만 래핑(추가 글로벌 바인딩 없음)
- 세션 바인딩 책임은 각 provider 내부에서 `sessionPath` 기반 `context.storageState`와 API 클라이언트 초기화에서 직접 처리

## 5) tistory provider 핵심 구조 (`src/providers/tistoryProvider.js`)
### 5-1. `tistory` 모듈 의존성 제거 및 API 직접 통신 전환
- `require('../../../viruagent/src/lib/tistory.js')` 의존성 제거
- `src/services/tistoryApiClient.js` 신규 도입 및 사용
- `publish/saveDraft/getPost/getCategories/listPosts/image upload/카테고리 조회/인증상태 체크`를 MCP 내부 API 클라이언트에서 직접 수행
- 결과적으로 `mcp`가 더 이상 외부 viruagent 모듈의 `tistory.js`에 위임하지 않음

### 5-2. 세션 관리
- 로그인 성공 시 브라우저 컨텍스트의 cookie를 `storageState()`로 저장
- 동시에 `persistTistorySession()`에서 Tistory 도메인 쿠키만 정제해 session 파일에 보관
- `authStatus`, `publish`, `saveDraft`, `listCategories`, `listPosts`, `getPost`는 실행 시 `tistoryApi.initBlog()`로 세션 유효성을 간접 검증

### 5-3. 인증/로그인 흐름
`login()` 흐름
1. `TISTORY_USERNAME`, `TISTORY_PASSWORD`(또는 호출 인자) 확보
2. `playwright`로 `https://www.tistory.com/auth/login` 접속
3. **일반 로그인 폼을 사용하지 않음**
4. 바로 카카오 계정 로그인 트리거 클릭
5. 카카오 계정 아이디/비밀번호 입력 + 제출
6. 2차 인증 브랜치 처리
   - OTP 입력 필드 감지 시 `twoFactorCode` 있으면 입력 후 진행
   - 카카오 푸시(앱 승인) 또는 이메일 인증으로 전환 가능한 모드 감지
   - 인증 미완료 시 `pending_2fa` 상태 반환
7. 로그인 성공 시
   - `context.storageState({ path: sessionPath })`
   - `persistTistorySession()` 실행
   - `tistoryApi.initBlog()`로 블로그명 확인 후 완료 응답

### 5-4. 공개 API 동작 (`publish`)
- 이미지 플레이스홀더(`<!-- IMAGE: ... -->`) + image URL/keyword로 업로드 실행
- 업로드 실패/부분 실패 시 각각 `image_upload_failed`, `image_upload_partial` 반환
- `카테고리` 미지정 시 개수에 따라 자동 처리 or `need_category`
- `publish` 최종 실패가 403 관련이면 `saveDraft` 폴백 (`publish_fallback_to_draft`)

### 5-5. 임시저장 (`saveDraft`)
- publish와 동일한 이미지 치환/썸네일 보정 로직 사용
- 카테고리 미지정은 `0` 기본 처리
- `tistoryApi.saveDraft()` 직접 호출

### 5-6. 조회 API
- `listCategories()` : `tistoryApi.getCategories()`(HTML에서 `window.Config.blog.categories` 파싱)
- `listPosts()` : `tistoryApi.getPosts()` 결과에서 `items`
- `getPost()` : `items` + optional `drafts` 탐색 후 `status: 'not_found'` 반환 가능

## 6) API 클라이언트 (`src/services/tistoryApiClient.js`)
- 책임 범위
  - 세션 cookie 로드 및 헤더 조립
  - blog name resolve (`/legacy/member/blog/api/myBlogs`)
  - post 생성/임시저장 (`/post.json`, `/drafts`)
  - 카테고리 파싱용 페이지 조회 (`/newpost`)
  - 이미지 업로드 (`/post/attach.json`)
- 장점
  - 이전의 외부 모듈 의존성 제거
  - provider와 인증/도메인 상태가 한 곳에서 관리

## 7) 이미지 업로드/치환 파이프라인
- 입력: `replaceImagePlaceholdersWithUploaded`
- 처리:
  - `extractImagePlaceholders()`로 플레이스홀더 추출
  - `buildKeywordImageCandidates` → 본문 링크/검색 결과 기반 후보 생성
  - `uploadImageFromRemote(api, url, keyword)`를 통해 mcp가 직접 업로드
  - 업로드 결과는 `normalizeUploadedImageThumbnail` 후 `[##_Image|...##]` 치환
- 최종 업로드 결과는 `status` + `images`/`uploadErrors`로 반환

## 8) naver provider
- `src/providers/naverProvider.js`는 스텁 상태 유지(`ready:false`)
- 실제 동작은 아직 미구현

## 9) openai/unsplash 의존성 관점
- `package.json` 기준 MCP는 `playwright` + MCP SDK만 직접 의존
- 텍스트 생성/이미지 키워드 확장/콘텐츠 생성은 외부 Agent가 담당하는 구조가 맞음
- MCP는 게시 실행에 필요한 실행기능(로그인/게시/임시저장/조회)만 수행

## 10) 남은 개선 포인트
1. 카카오 로그인의 selector 의존도 높음
   - 로그인 페이지 UI 변경에 대한 회복 로직 보강
2. `waitForLoginFinish()` 타임아웃/상태 검출 개선
3. `naver` provider 구현 또는 제거 검토
4. `tistoryApiClient` 실패 응답 디테일(에러 본문 파싱) 개선
