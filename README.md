# ILJIN AI Works

일진글로벌 임직원 업무를 지원하는 AI 포털입니다.

## LLM 라우팅 (2026-07-23)

채팅 답변 생성은 public/internal 요청에서 `Cloudflare AI GLM 4.7 Flash → 로컬 PC vLLM/Ollama` 순서로 호출합니다. Cloudflare가 미구성, 타임아웃, 비정상 응답 또는 회로 차단 상태이면 로컬 모델로 자동 전환합니다. confidential 요청은 외부로 전송하지 않고 로컬 LLM만 사용합니다. RAG 임베딩과 재랭킹도 Cloudflare AI binding으로 처리합니다.

- 로컬 개발: `LOCAL_LLM_BASE_URL=http://127.0.0.1:11434`
- Cloudflare 운영: `LOCAL_LLM_BASE_URL=https://<보호된-Tunnel-호스트>`
- Cloudflare 기본 모델: `CLOUDFLARE_AI_MODEL=@cf/zai-org/glm-4.7-flash`
- 운영 Tunnel은 Cloudflare Access 서비스 토큰으로 반드시 보호합니다.
- 상세 절차: [`docs/cloudflare-local-llm-runbook.md`](docs/cloudflare-local-llm-runbook.md)


ILJIN 임직원용 AI 업무 포털입니다. 같은 vinext 애플리케이션이 로컬 PC와 Cloudflare Sites에서 실행되며, 서버 측 LLM Gateway가 로컬 LLM과 Cloudflare GLM 4.7 Flash를 순차 호출합니다.

## 구성

```text
브라우저 → Cloudflare Worker → D1/R2 Document RAG → 로컬/Cloudflare GLM 4.7 Flash 생성
```

- Cloudflare AI는 서버 binding으로만 호출하며 브라우저에 공급자 인증정보를 전달하지 않습니다.
- 내부 요청은 권한 검증 후 Cloudflare RAG와 GLM 4.7 Flash를 사용할 수 있으며, 기밀 요청은 로컬 LLM으로만 라우팅합니다.
- Provider 원문 오류와 비밀값은 API 응답에 노출하지 않습니다.
- 로컬과 Cloudflare가 동일한 API 및 보안 경계를 사용합니다.
- 원문은 R2, 자산·세그먼트·벡터·검색 Trace는 D1에 저장합니다.
- 검색은 BM25 계열 점수와 Cloudflare Dense Vector를 결합하고 Cloudflare Reranker로 재정렬합니다.
- 이메일·비밀번호 자격증명과 해시된 세션을 D1 사용자 프로필에 매핑하고, 관리자 승인 후 Tenant·부서·역할을 적용합니다.
- 신규 사용자는 이름·이메일·비밀번호·희망 부서·신청 사유를 제출합니다. 관리자가 사용자/매니저 역할을 지정해 승인하기 전까지 업무 API가 차단됩니다.
- 검색 본문이나 임의 부서 헤더는 권한 결정에 사용하지 않습니다.
- 검색 전 부서 ACL과 Context Builder 직전 권한 범위를 적용합니다.
- Evidence Gate를 통과하지 못하면 답변 생성을 중단합니다.
- 대화·메시지·피드백·감사 로그는 D1에 영속화합니다.
- 문서는 hash 중복 방지, Version, 삭제, 재색인, 실패 Job 재처리 수명주기를 가집니다.
- Agent는 Router → Planner → Retrieval → Verification → Execution의 최대 5단계로 제한되며 실행·단계·승인·Tool 결과를 D1에 저장합니다.
- Tool registry는 R0~R3 위험등급, 역할, Timeout, Retry, 멱등성 정책을 제공하고 R2 이상 실행은 별도의 업무 Tool 승인을 요구합니다.
- 실제 실행은 읽기 전용 built-in Demo Tool로 제한합니다. ERP·MES·HR·ITSM은 Adapter 계약만 등록되며 연결 전까지 비활성 상태입니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다. `.env.example`을 참고해 환경변수를 현재 셸이나 로컬의 무시된 `.env.local`에 설정한 뒤 실행합니다.

```bash
npm install
npm run dev
```

검증 명령은 다음과 같습니다.

```bash
npm test
npm run build
npm run test:rag:g1
npm run test:rag:g2
npm run test:rag:golden
npm run test:access
npm run test:agent
```

## 환경변수

- `CLOUDFLARE_AI_MODEL`: Cloudflare AI binding 또는 REST API에서 호출할 기본 모델이며 기본값은 `@cf/zai-org/glm-4.7-flash`입니다.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`: Sites처럼 AI binding이 없는 운영 환경에서 사용하는 Cloudflare AI REST 인증입니다. API Token은 Secret으로 저장합니다.
- `CLOUDFLARE_AI_GATEWAY_ID`: 선택값이며 별도 Gateway를 지정하지 않으면 계정 기본 Gateway를 사용합니다.
- `CLOUDFLARE_EMBED_MODEL`: Cloudflare Embedding 모델이며 기본값은 `@cf/google/embeddinggemma-300m`입니다.
- `CLOUDFLARE_RERANK_MODEL`: Cloudflare Reranker 모델이며 기본값은 `@cf/baai/bge-reranker-base`입니다.
- `LLM_TIMEOUT_MS`: 5~60초 범위의 Provider 타임아웃입니다.
- `DEFAULT_TENANT_ID`, `DEFAULT_DEPARTMENT`, `DEFAULT_USER_ROLE`: 신규 로그인 사용자 프로필 기본값입니다. 운영 기본 역할은 `user`입니다.
- `ADMIN_EMAILS`: 관리자 이메일 allowlist입니다.
- `ALLOW_DEV_IDENTITY`: 로컬 테스트용이며 운영에서는 반드시 `false`로 유지합니다.
- `TRUSTED_IDENTITY_MODE`: 기본값은 `session`이며, `sites-siwc`는 신뢰된 게이트웨이가 헤더를 보장하는 경우에만 사용합니다.
- `TRUSTED_IDENTITY_HOSTS`: SIWC 전달 헤더를 허용할 정확한 호스트 목록입니다. 비워 두면 전달 identity 헤더는 항상 무시됩니다.

운영 배포는 엣지에서 `EDGE_RATE_LIMITER`(일반 API 120회/분)와 `AUTH_RATE_LIMITER`(인증 API 20회/분)를 사용합니다. 이 binding이 빠진 `preview`·`production` 배포는 fail-closed로 503을 반환합니다. 인덱서 Worker는 `workers.dev` 공개 라우트를 사용하지 않도록 `workers_dev=false`로 배포합니다.

Cloudflare 배포 환경의 값은 `.openai/hosting.json`이나 Git에 기록하지 않고 Sites 런타임 환경변수로 관리합니다.

## API

- `GET /api/health`: 비밀값을 제외한 Gateway 준비 상태
- `GET /api/auth/me`: 로그인 사용자와 관리자 승인 상태
- `POST /api/auth/application`: 인증 이메일 기반 가입 신청·재신청
- `GET|PATCH /api/admin/access-requests`: 관리자 접근 요청 목록·승인·거절
- `GET /api/admin/providers`: Provider·모델·리전 상태
- `POST /api/v1/assets`: TXT·Markdown·CSV·JSON 문서 수집 및 인덱싱
- `GET /api/v1/assets`: 인덱싱 자산 목록
- `GET|PATCH|DELETE /api/v1/assets/{id}`: 권한 기반 자산 조회·수정·삭제
- `POST /api/v1/assets/{id}/reindex`: 원본 기반 원자적 재색인과 Version 증가
- `POST /api/v1/search`: ACL 기반 Hybrid Search 및 재정렬
- `GET /api/v1/citations`: 권한 재검증된 세그먼트 근거 조회
- `POST /api/v1/chat/completions`: RAG 채팅, Conversation 저장, JSON 또는 SSE 응답
- `GET|POST /api/v1/conversations`: 본인 대화 목록·생성
- `GET|DELETE /api/v1/conversations/{id}`: 본인 대화 조회·삭제
- `POST /api/v1/messages/{id}/feedback`: 답변 피드백 저장
- `GET|POST /api/v1/agent/runs`: Agent 실행 이력 조회·새 실행
- `GET /api/v1/agent/runs/{id}`: Agent 단계·승인·Tool 실행 상세
- `GET /api/v1/tools`: Tool registry와 위험등급·연결 상태
- `GET /api/v1/tool-approvals`: 사용자 또는 Tenant 업무 Tool 승인함
- `PATCH /api/v1/tool-approvals/{id}`: manager/admin의 R2 이상 Tool 승인·거절
- `GET /api/admin/index-jobs`: 인덱싱 작업 상태
- `POST /api/admin/index-jobs/{id}/retry`: 관리자 실패 작업 재처리

전체 계약은 [`docs/openapi.yaml`](docs/openapi.yaml)을 기준으로 합니다.

## 현재 수용 범위

이 저장소의 자동 Gate는 Text RAG 플랫폼과 안전한 읽기 전용 Agent/Tool 통제 범위를 검증합니다. PDF·DOCX·PPTX·XLSX 파서, 실제 기업 IdP 조직 매핑, 음성·영상·이미지 RAG, ERP/MES/HR/ITSM 실연계, 150명 부하/UAT는 외부 패키지·계정·원천 데이터·업무시스템이 제공된 환경에서 별도 수용해야 합니다.
