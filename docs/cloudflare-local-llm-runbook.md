# Cloudflare GLM 5.2 → 로컬 LLM 폴백 운영 절차

작성일: 2026-07-23

## 목표 구조

```text
사용자 브라우저
  → Cloudflare Sites/Worker
    → 1차: Cloudflare AI → @cf/zai-org/glm-5.2
    → public/internal 요청의 장애 시 2차: Cloudflare Access로 보호된 Tunnel → 로컬 vLLM 또는 Ollama
    → confidential 요청: 로컬 vLLM 또는 Ollama 전용

RAG 임베딩/재랭킹
  → Cloudflare Embedding / Reranker
```

로컬 추론 서버 포트를 공유기나 방화벽에서 직접 공개하지 않습니다. `cloudflared`가 Cloudflare로 만드는 아웃바운드 전용 Tunnel만 사용하고, Tunnel 호스트에는 Access 서비스 토큰 정책을 적용합니다. Gateway는 `/v1/models`와 `/v1/chat/completions`를 사용하므로 vLLM과 Ollama를 설정 변경만으로 교체할 수 있습니다.

Cloudflare 통합 AI 카탈로그의 GLM 5.2 모델 ID는 [`@cf/zai-org/glm-5.2`](https://developers.cloudflare.com/ai/models/@cf/zai-org/glm-5.2/)입니다. API Token을 브라우저에 저장하지 않고 Pages Function의 AI binding으로 호출합니다.

## 1. 로컬 OpenAI 호환 서버 확인

현재 PC는 NVIDIA GPU가 확인되지 않아 GPU 기반 vLLM을 직접 운영하기에는 적합하지 않습니다. 현 PC에서는 Ollama OpenAI 호환 API를 기본으로 사용하고, 실제 vLLM은 NVIDIA GPU가 연결된 Linux/WSL 또는 별도 GPU 서버에 배치하는 구성을 권장합니다.

Ollama를 사용할 때 PowerShell에서 다음을 실행합니다.

```powershell
Invoke-RestMethod http://127.0.0.1:11434/v1/models
```

vLLM을 사용할 때는 GPU 서버에서 OpenAI 호환 서버를 실행하고 같은 경로를 확인합니다.

```bash
vllm serve <모델명> --host 0.0.0.0 --port 8000 --api-key <서버전용키>
curl -H "Authorization: Bearer <서버전용키>" http://127.0.0.1:8000/v1/models
```

기본 채팅 모델은 이 PC에서 실행 가능한 `gemma4:latest`입니다. CPU 추론은 응답이 오래 걸릴 수 있어 로컬 제한 시간을 90초로 둡니다. `.env.local`의 로컬 항목은 다음과 같습니다.

```dotenv
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434
LOCAL_LLM_MODEL=gemma4:latest
LOCAL_LLM_TIMEOUT_MS=90000
```

## 2. cloudflared 설치 및 Tunnel 생성

Cloudflare 대시보드에서 관리할 도메인이 계정에 연결되어 있어야 합니다.

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create iljin-local-llm
cloudflared tunnel route dns iljin-local-llm llm.<회사도메인>
```

`cloudflared` 설정 파일의 ingress는 선택한 로컬 OpenAI 호환 서버 주소로 연결합니다.

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: C:\Users\<사용자>\.cloudflared\<TUNNEL-UUID>.json
ingress:
  - hostname: llm.<회사도메인>
    service: http://127.0.0.1:11434 # vLLM이면 http://127.0.0.1:8000
  - service: http_status:404
```

설정 후 테스트 실행:

```powershell
cloudflared tunnel run iljin-local-llm
```

PC 재부팅 후에도 자동 실행하려면 관리자 PowerShell에서 Cloudflare 공식 서비스 설치 방식을 적용합니다. 설치 전에 설정 파일과 Tunnel UUID가 정확한지 확인합니다.

## 3. Cloudflare Access 보호

Zero Trust 대시보드에서 `llm.<회사도메인>`을 Self-hosted application으로 등록합니다.

1. 기본 정책은 Deny로 둡니다.
2. Worker 전용 Service Token을 생성합니다.
3. Allow 정책의 Include 조건에 해당 Service Token을 지정합니다.
4. 브라우저에서 익명으로 `/v1/models`를 열었을 때 차단되는지 확인합니다.
5. 서비스 토큰 헤더로 요청했을 때만 200이 반환되는지 확인합니다.

서비스 토큰의 Client Secret은 생성 시 한 번만 표시되므로 비밀 저장소에 보관하고 Git, 문서, 채팅에 기록하지 않습니다.

## 4. Cloudflare AI GLM 5.2

Pages Function에 `AI` Workers AI binding을 연결하고 모델 변수는 다음 값으로 유지합니다.

```dotenv
CLOUDFLARE_AI_MODEL=@cf/zai-org/glm-5.2
```

관리자 AI Control Tower의 Cloudflare AI 카드에서 `연결 테스트`를 실행하면 최소 토큰으로 실제 모델 호출을 확인합니다. 일반 Readiness 조회는 비용이 발생하지 않도록 binding 존재 여부만 확인합니다.

## 5. Cloudflare Sites 운영 환경 변수

Sites 프로젝트의 서버 환경에 다음 값을 등록합니다.

```dotenv
LOCAL_LLM_BASE_URL=https://llm.<회사도메인>
LOCAL_LLM_MODEL=gemma4:latest
LOCAL_LLM_TIMEOUT_MS=90000
LOCAL_LLM_ACCESS_CLIENT_ID=<Access Service Token Client ID>
LOCAL_LLM_ACCESS_CLIENT_SECRET=<Access Service Token Client Secret>
```

RAG 임베딩·재랭킹은 `CLOUDFLARE_EMBED_MODEL`, `CLOUDFLARE_RERANK_MODEL`과 AI binding을 사용합니다. Sites처럼 AI binding이 제공되지 않는 환경에서는 `CLOUDFLARE_ACCOUNT_ID`와 Secret `CLOUDFLARE_API_TOKEN`으로 Cloudflare AI REST API를 호출합니다. 로컬 LLM에 별도 Bearer 인증 프록시를 둔 경우에만 `LOCAL_LLM_API_KEY`를 사용합니다.

## 6. 검증 순서

1. `GET /api/health`에서 `llmRouting.sequence=["cloudflare","local"]`를 확인합니다.
2. 관리자 `GET /api/admin/readiness`에서 `cloudflarePrimary`, `localFallback`이 모두 `ready`인지 확인합니다.
3. 정상 public/internal 채팅 응답 헤더가 `X-LLM-Provider: cloudflare`인지 확인합니다.
4. Cloudflare AI를 잠시 중지한 테스트 환경에서 응답 헤더가 `X-LLM-Provider: local`로 바뀌는지 확인합니다.
5. 로컬 LLM도 중지한 테스트 환경에서 `ALL_PROVIDERS_UNAVAILABLE`을 반환하는지 확인합니다.
6. Cloudflare AI를 다시 시작하고 Circuit 초기화 후 Cloudflare 공급자로 돌아오는지 확인합니다.
7. Access 토큰 없이 Tunnel URL을 직접 호출했을 때 차단되는지 확인합니다.

## 7. 장애 기준

- 로컬 호출은 최대 1회 재시도합니다.
- 공급자별 연속 3회 실패 시 30초 동안 회로 차단기가 열립니다.
- public/internal 요청에서 Cloudflare GLM 5.2 실패 시 로컬 LLM으로 자동 폴백합니다.
- confidential 요청은 Cloudflare로 전송하지 않고 로컬 LLM만 사용합니다.
- 두 공급자가 모두 실패하면 `ALL_PROVIDERS_UNAVAILABLE`과 Trace ID를 반환합니다.
- 로그와 API 응답에는 API 키나 Access Client Secret을 포함하지 않습니다.
