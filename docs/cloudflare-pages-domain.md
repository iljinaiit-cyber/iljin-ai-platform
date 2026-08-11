# Cloudflare Pages 도메인 연결

## 현재 배포

- Pages 프로젝트: `iljin-ai`
- 기본 주소: `https://iljin-ai.pages.dev`
- Production branch: `main`
- 프론트엔드: Cloudflare Pages 정적 자산
- SSR/API: Pages Advanced Mode의 `_worker.js` (Cloudflare Workers 런타임)
- D1: `iljin-ai-db`, binding `DB`, APAC
- R2: 계정에서 아직 활성화되지 않음

이 구조는 화면과 `/api/*`를 같은 Origin에서 제공하므로 CORS 설정이나 로그인 쿠키의 별도 도메인 처리가 필요 없다.

## 배포

```powershell
cd "C:\AI Project\Iljin AI Agent platform\web-app"
npm run deploy:pages
```

`build:pages`는 Vinext 빌드 결과를 다음처럼 변환한다.

```text
dist/pages/
├─ 정적 자산
├─ _routes.json
└─ _worker.js/
   ├─ index.js
   ├─ worker-entry.js
   └─ ssr/
```

## 사용자 도메인 연결 전 필수 조건

1. Cloudflare 계정에 보유 도메인을 Zone으로 추가하고 네임서버를 활성화한다.
2. 사용할 호스트명을 확정한다. 권장값은 `ai.<보유도메인>`이다.
3. Cloudflare Dashboard의 **Workers & Pages → iljin-ai → Custom domains**에서 호스트명을 추가한다.
4. Cloudflare가 생성한 DNS 레코드와 Universal SSL 인증서가 `Active`가 될 때까지 기다린다.
5. 아래 검증을 수행한다.

```powershell
curl.exe -I https://ai.<보유도메인>/
curl.exe https://ai.<보유도메인>/api/health
```

기존에 같은 호스트명의 A, AAAA, CNAME 레코드가 있으면 먼저 충돌 여부를 확인한다. 운영 호스트명을 확정하기 전에는 기존 DNS 레코드를 삭제하지 않는다.

## 운영 바인딩

### R2

Cloudflare Dashboard에서 R2를 활성화한 다음 버킷을 생성하고 `wrangler.jsonc`에 binding `BUCKET`으로 추가한다.

```jsonc
"r2_buckets": [
  {
    "binding": "BUCKET",
    "bucket_name": "iljin-ai-originals"
  }
]
```

### LLM Secrets

다음 값은 Git이나 `wrangler.jsonc`에 기록하지 않고 Pages Secrets로 설정한다.

- `LOCAL_LLM_BASE_URL`: Cloudflare Tunnel로 보호된 로컬 vLLM/Ollama URL
- `LOCAL_LLM_API_KEY`
- `LOCAL_LLM_ACCESS_CLIENT_ID`
- `LOCAL_LLM_ACCESS_CLIENT_SECRET`
- `ADMIN_EMAILS`

Cloudflare GLM 5.2는 Pages Function의 `AI` binding으로 연결하며 모델 ID는 `@cf/zai-org/glm-5.2`를 사용한다. GLM 5.2는 Cloudflare 통합 AI 카탈로그의 제3자 모델이므로 계정의 통합 AI 과금 및 사용 권한도 확인한다.

로컬 PC의 `127.0.0.1` 주소는 Cloudflare에서 접근할 수 없으므로 운영 값으로 등록하지 않는다. 로컬 LLM 호스트는 Cloudflare Access 서비스 토큰으로 보호해야 한다.

## 완료 기준

- 사용자 도메인 `/` 응답 `200`
- `/api/health`에서 `d1Configured: true`
- R2 활성화 후 `r2Configured: true`
- Tunnel/Access 설정 후 `primaryConfigured: true`
- Workers AI binding 설정 후 `secondaryConfigured: true`
- GLM 5.2 binding 설정 후 `fallbackConfigured: true`
- CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options` 헤더 확인
- 이메일 가입 신청과 관리자 승인 데이터가 D1에 저장됨
