# QA 및 Gate 검증 Runbook

이 패키지는 개발 중 검증 가능한 항목과 사업 승인에 필요한 외부 증거를 구분합니다. 기본 명령은 서버나 외부 Provider 없이 코드, QA 자산, 체크리스트와 Gate 증거 구조를 검사합니다.

## 빠른 실행

```powershell
cd "C:\AI Project\Iljin AI Agent platform\web-app"
npm.cmd run qa:verify
```

로컬 서버와 Cloudflare D1/R2/AI binding이 준비된 경우 별도 터미널에서 `npm.cmd run dev`를 실행한 뒤 다음 명령을 사용합니다.

```powershell
npm.cmd run qa:verify:live
```

Live 보안 시험은 loopback 주소만 허용합니다. 고유 QA Principal과 임시 문서 하나를 사용하며 임시 문서는 `finally`에서 삭제합니다. 가입 승인 우회 시험은 고유 개발 Principal의 프로필을 남길 수 있고, Rate Limit 시험은 만료되는 분 단위 버킷을 기록합니다. 기존 업무 데이터는 수정하지 않습니다.

## G1과 G2 분리

- `npm.cmd run test:rag:g1`: 텍스트 플랫폼 수명주기와 G1 필수 사업 증거를 판정합니다.
- `npm.cmd run test:rag:g2`: ACL/Citation 코드 증거와 Starter Golden 평가를 판정합니다.
- 두 명령은 더 이상 같은 스크립트를 실행하지 않습니다.
- `tests/golden-rag.json`은 3건짜리 개발용 Starter Set입니다. 공식 G2의 300건 Golden Set이나 사람의 Faithfulness/Citation 평가를 대체하지 않습니다.
- `--strict`는 모든 수동 증거가 준비되지 않은 현재 상태에서 의도적으로 실패합니다.

## 150명 부하 프로파일

`qa/load/k6-150-users.js`는 Portal 40명, Search 60명, Grounded Chat 50명으로 총 150명의 동시 사용자를 5분간 유지합니다. 임계치는 Portal P95 3초, Search P95 2초/P99 4초, SSE First Token P95 3초, RAG P95 8초/P99 12초, 오류율 1% 미만입니다.

실행 예시는 다음과 같습니다. k6는 별도 설치가 필요합니다.

```powershell
$env:BASE_URL = "https://qa.example.internal"
$env:QA_AUTH_HEADER_NAME = "x-dev-user-email"
$env:QA_AUTH_HEADER_VALUE = "approved-load-user@example.com"
k6 run qa/load/k6-150-users.js --summary-export qa/results/k6-summary.json
```

운영과 동일한 Rate Limit을 포함해 시험할 때에는 승인된 사용자 150명의 풀과 실제 인증 주입 방법을 사용해야 합니다. 단일 계정 결과는 사용자별 Rate Limit의 영향을 받아 용량 결과로 승인할 수 없습니다.

## DR 리허설

`qa/dr-rehearsal.checklist.json`의 각 통제 상태를 `verified`로 바꾸기 전에 증거 파일을 `evidence` 배열에 기록합니다. 증거는 D1/R2 백업, 격리 복원, 무결성 비교, 복원 후 Smoke, RPO/RTO 실측, Rollback 및 담당자 서명을 포함해야 합니다.

```powershell
npm.cmd run qa:dr
npm.cmd run qa:dr:strict
```

기본 명령은 체크리스트 구조를 검증하고 준비 상태를 보고합니다. Strict 명령은 모든 통제가 증거와 함께 검증되지 않으면 실패합니다.

## 증거 보존

자동 결과는 `qa/results/*.json`에 생성됩니다. 배포 승인 시 명령, Commit SHA, 환경, 실행 시각, 원시 로그와 담당자 서명을 함께 보존해야 합니다. `qa/gates.manifest.json`의 `decision`은 증거 검토 후에만 변경합니다.
