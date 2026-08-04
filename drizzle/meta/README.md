# drizzle/meta — 유실 상태 (2026-08-04)

`_journal.json` 과 `0000~0004_snapshot.json` 이 유실됐다. **복원하지 않았다.**

## 배포에는 영향이 없다

`wrangler.jsonc` 가 `migrations_dir: "drizzle"` 로 **Cloudflare D1 마이그레이션**을 쓴다.
이 방식은 `drizzle/*.sql` 파일만 읽고, 적용 이력은 D1 안의 `d1_migrations` 테이블이 관리한다.
`.sql` 20개가 모두 있으므로 `wrangler d1 migrations apply` 는 정상 동작한다.

## 막히는 것은 새 마이그레이션 생성이다

`npm run db:generate`(drizzle-kit)는 이전 스냅샷과 `db/schema.ts` 를 비교해 diff 를 만든다.
스냅샷이 없으면 drizzle-kit 은 **DB가 비어 있다고 판단**하고 전체 스키마를 새로 만드는
마이그레이션을 생성한다. 그대로 적용하면 기존 테이블과 충돌하거나 데이터를 잃는다.

## 왜 복원하지 않았나

스냅샷은 각 마이그레이션 시점의 스키마 상태를 담은 파일이다. `.sql` 로부터 역산할 수는
있지만, 한 글자라도 어긋나면 drizzle-kit 이 **잘못된 diff — 즉 파괴적 마이그레이션**을
만든다. 추측으로 채우는 것이 비워 두는 것보다 위험하다.

## 해소 방법 (택 1)

1. **재기준선(권장)** — 운영 D1 의 현재 스키마를 정본으로 삼아 스냅샷을 새로 만든다.
   `drizzle-kit generate` 로 나온 초기 마이그레이션은 **적용하지 않고** 삭제하되
   생성된 `meta/` 스냅샷만 남긴다. 이후 변경분부터 정상적으로 diff 가 계산된다.
   적용 전 `wrangler d1 execute <DB> --command "SELECT name FROM d1_migrations"` 로
   이력을 확인하고, 새 마이그레이션 번호가 0020 부터 시작하는지 반드시 본다.

2. **수기 SQL** — 앞으로 스키마 변경 시 `.sql` 을 직접 작성한다. drizzle-kit 을 쓰지 않는다.

어느 쪽이든 **운영 DB 백업(Time Travel 시점 확인) 후** 진행한다.
