// 게이트웨이 외부 송신 판정 검증.
//
// completeWithGateway 의 초크포인트 로직을 그대로 재현해 판정만 확인한다.
// 실제 모델을 부르지 않으므로 비용이 들지 않는다.
//
//   node scripts/verify-egress.mjs

const RANK = { public: 0, internal: 1, confidential: 2 };
const normalize = (v) =>
  v === 'public' || v === 'internal' || v === 'confidential' ? v : 'public';

const externalAllowed = (sensitivity, maxEgressEnv) =>
  RANK[sensitivity ?? 'internal'] <= RANK[normalize(maxEgressEnv)];

let failed = 0;
const check = (cond, name) => {
  if (!cond) { failed += 1; console.log(`  FAIL ${name}`); }
  else console.log(`  OK   ${name}`);
};

console.log('외부 송신 판정 검증');
console.log('='.repeat(58));

console.log('\n[기본 정책 — MAX_EGRESS_SENSITIVITY 미설정]');
check(externalAllowed('public', undefined) === true, 'public 은 외부 허용');
check(externalAllowed('internal', undefined) === false, 'internal 은 외부 차단');
check(externalAllowed('confidential', undefined) === false, 'confidential 은 외부 차단');
check(externalAllowed(undefined, undefined) === false, '민감도 미상은 internal 로 간주해 차단');

console.log('\n[풀스택 정책 — MAX_EGRESS_SENSITIVITY=internal]');
check(externalAllowed('public', 'internal') === true, 'public 허용');
check(externalAllowed('internal', 'internal') === true, 'internal 허용(수용 결정)');
check(externalAllowed('confidential', 'internal') === false, 'confidential 은 여전히 차단');

console.log('\n[설정 오류는 엄격한 기본값으로]');
for (const bad of ['', 'PUBLIC', 'all', 'none', null, 42]) {
  check(externalAllowed('internal', bad) === false, `${JSON.stringify(bad)} → public 으로 강등`);
}

console.log('\n' + '='.repeat(58));
if (failed) { console.log(`실패 ${failed}건`); process.exit(1); }
console.log('전부 통과');
