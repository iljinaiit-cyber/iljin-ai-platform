# 용량·데이터 등급 조사 실행 가이드

`config/data-inventory.example.json`을 승인된 조사 파일로 복사한 뒤 데이터 소유자가 건수, 평균 크기, 월 증가량, 보존기간, 개인정보 포함 여부와 ACL 정본을 입력한다. 예시의 `0`과 `미확정` 값은 구축 완료 증거가 아니다.

```powershell
node scripts/calculate-capacity.mjs config/data-inventory.json --require-confirmed
```

종료 코드 `2`는 미확정 데이터 소스가 남았다는 의미다. 출력값은 초기 저장소 기준선이며 PDF 파생 이미지, OCR, 다중 임베딩, Snapshot, WAL/PITR 여유 공간은 실제 표본 색인 결과로 보정해야 한다.

필수 승인 항목:

- 데이터 소유자와 시스템별 접근 방식
- 공개·사내·기밀·개인정보 등급
- 문서 건수·평균/최대 크기·월 증가량
- 동시 사용자·Peak QPS·응답시간 목표
- 보존 및 삭제 정책
- 사용자·그룹·부서 ACL의 정본 시스템
- RPO/RTO와 복구 책임자

