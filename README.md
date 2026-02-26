# viruagent-mcp

`viruagent`의 포스팅 기능을 MCP 서버로 노출한 패키지입니다.

- 클로드/코덱스/Claude Code 등에서 MCP tool 호출로 글쓰기 동작 제어 가능
- 티스토리 로그인 + 발행(또는 임시저장) + 카테고리 조회
- 추후 Naver Provider 확장 위치 제공

## 설치

```bash
cd /Users/tk/Desktop/project/viruagent-mcp
npm install
```

## 실행

```bash
npm start
```

또는

```bash
node bin/index.js
```

## 제공 tool

```text
- viruagent_auth_status
- viruagent_login
- viruagent_publish
- viruagent_save_draft
- viruagent_list_categories
- viruagent_list_posts
- viruagent_logout
- viruagent_list_providers
```

### 기본 사용 예시 (MCP 클라이언트 설정)

```json
{
  "mcpServers": {
    "viruagent-mcp": {
      "command": "node",
      "args": ["/Users/tk/Desktop/project/viruagent-mcp/bin/index.js"]
    }
  }
}
```

## 동작 포인트

- session 파일은 사용자 홈(`~/.viruagent-mcp/sessions`)에 provider별로 분리 저장됩니다.
- `viruagent_login`은 기본적으로 브라우저를 띄워 티스토리 로그인 -> 카카오 로그인 페이지 이동 -> 로그인/2차 인증 흐름을 처리합니다.
- `viruagent_login`은 아이디/비밀번호 자동 로그인을 지원합니다.
- 카카오톡 푸시 2차 인증이 감지되면, 사용자 승인 대기(`status: "pending_2fa"`) 상태를 반환하고 승인 완료 후 재시도할 수 있습니다.
- `remember browser`(이 브라우저에서 2차 인증 사용 안 함)에 해당하는 체크박스가 보이면 자동 체크를 시도합니다.
- `viruagent_publish`는 category가 없으면 카테고리 목록을 돌려주고 사용자가 `category`를 지정해 다시 요청하게 합니다. (카테고리가 하나뿐이면 자동 선택)
- `viruagent_publish`는 발행 요청 시 403(일일 발행 제한) 오류가 발생하면 자동으로 임시저장으로 전환합니다.
- `viruagent_publish`는 본문 placeholder(`<!-- IMAGE: keyword -->`)를 발견하면 `imageUrls`를 받아
  원격 URL이면 로컬로 다운로드하고, 로컬 파일 경로면 바로 업로드합니다.
  업로드는 Tistory 이미지 업로드 API를 통해 진행됩니다.
  성공 시 본문에는 업로드된 이미지 URL이 `<img src="...">` 형태로 삽입됩니다.
  썸네일은 업로드된 이미지 키(`kage@...`) 기준으로 자동 후보를 생성합니다.
- `viruagent_save_draft`도 동일한 이미지 치환 파이프라인을 사용합니다.
- 업로드된 첫 번째 이미지는 썸네일 자동 후보가 됩니다. (`thumbnail` 직접 지정이 우선)
- `thumbnail`은 `kage@...` 형식이 가장 안전합니다. (`thumbnail`이 비어 있으면 업로드된 첫 이미지의 `kage@` 키를 자동 사용)
- `relatedImageKeywords`는 이미지 수집용 힌트이며, 실제 업로드는 `imageUrls`가 있을 때만 수행됩니다.
- `autoUploadImages`와 `imageUploadLimit`은 `placeholder`+URL 처리 동작을 제어합니다.

## 자동 로그인 사용법

1. 환경변수 설정

```bash
export TISTORY_USERNAME="your-id"
export TISTORY_PASSWORD="your-password"
```

2. MCP 도구 호출 예시

```json
{
  "name": "viruagent_login",
  "arguments": {
    "provider": "tistory",
    "headless": true,
    "username": "your-id",
    "password": "your-password"
  }
}
```

발행 요청 시 카테고리를 생략하면 아래처럼 `status: "need_category"` 응답이 올 수 있습니다.
```json
{
  "provider": "tistory",
  "mode": "publish",
  "status": "need_category",
  "loggedIn": true,
  "title": "자동 테스트 글",
  "visibility": 0,
  "tags": "테스트",
  "message": "category가 없어서 중단했습니다. 카테고리 ID를 지정해 publish를 재요청해 주세요.",
  "categories": [
    { "name": "기본", "id": 0 }
 ]
}
```

이미지 업로드 단계에서 실패가 발생하면 아래 상태가 반환됩니다.
- `status: "image_upload_failed"`: 플레이스홀더가 있지만 업로드된 이미지가 0개
- `status: "image_upload_partial"`: 일부 업로드 실패

실패 응답에는 `uploadErrors`에 실패 URL/에러 메시지가 들어오므로, 동일 `title/content`로 `imageUrls`만 보완해서 재요청하세요.

발행이 403으로 막혀 임시저장으로 넘어간 경우:
```json
{
  "provider": "tistory",
  "mode": "draft",
  "status": "publish_fallback_to_draft",
  "message": "발행 제한(403)으로 인해 임시저장으로 전환했습니다."
}
```

2차 인증이 있으면 `twoFactorCode`를 추가로 전달합니다.
- 카카오톡 푸시 방식에서는 `twoFactorCode`가 없어도 자동으로 2차 인증 승인 대기 후 실패 시 `pending_2fa` 결과가 반환될 수 있습니다.

`viruagent_publish` 이미지 자동 업로드 예시:
```json
{
  "name": "viruagent_publish",
  "arguments": {
    "provider": "tistory",
    "title": "최신 IT 뉴스 요약",
    "content": "<blockquote data-ke-style=\"style1\">...</blockquote><!-- IMAGE: galaxy s26 --><p>...</p>",
    "visibility": "public",
    "category": 1284210,
    "tags": "IT,뉴스",
    "relatedImageKeywords": ["galaxy s26", "AI phone"],
    "imageUrls": ["https://example.com/image1.jpg", "https://example.com/image2.jpg"],
    "autoUploadImages": true,
    "imageUploadLimit": 3
  }
}
```

`pending_2fa` 응답 예시:
```json
{
  "provider": "tistory",
  "status": "pending_2fa",
  "loggedIn": false,
  "message": "카카오 2차 인증이 필요합니다. 앱에서 인증 후 다시 실행하면 됩니다."
}
```
- 현재 Naver provider는 스텁이며, 요청 시 `ready:false` 형태로 사용 가능 여부를 반환합니다.
