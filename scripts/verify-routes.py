#!/usr/bin/env python3
"""
복구된 API 라우트 정적 검증.

Node 없이 44개 라우트를 손으로 쓰면 import 오타와 시그니처 착오가 반드시 난다.
tsc 를 못 돌리는 환경에서 최소한 이것만이라도 잡는다.

  1. 상대 import 경로가 실제 파일로 풀리는가
  2. 가져다 쓰는 심볼이 그 파일에서 실제로 export 되는가
  3. 라우트가 HTTP 메서드를 하나라도 export 하는가
  4. openapi.yaml 에 명세된 경로가 파일로 존재하는가 (반대 방향도)

    python3 scripts/verify-routes.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "app" / "api"
FAILED: list[str] = []
COUNT = 0
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}


def check(cond: bool, name: str, detail: str = "") -> None:
    global COUNT
    COUNT += 1
    if not cond:
        FAILED.append(f"{name}{' — ' + detail if detail else ''}")


def exports_of(path: Path) -> set[str]:
    """파일이 export 하는 최상위 심볼 이름."""
    src = path.read_text(encoding="utf-8")
    names: set[str] = set()
    # export function foo / export async function foo / export const foo / export type Foo
    names |= set(re.findall(r"^export\s+(?:async\s+)?function\s+(\w+)", src, re.M))
    names |= set(re.findall(r"^export\s+(?:const|let|var|type|interface|class|enum)\s+(\w+)", src, re.M))
    # export { a, b as c }
    for block in re.findall(r"^export\s*\{([^}]*)\}", src, re.M):
        for piece in block.split(","):
            piece = piece.strip()
            if not piece:
                continue
            names.add(piece.split(" as ")[-1].strip() if " as " in piece else piece)
    return names


def resolve(importer: Path, spec: str) -> Path | None:
    """상대 경로 import 를 실제 파일로 푼다."""
    if not spec.startswith("."):
        return None  # 패키지 import 는 검증 대상 아님
    base = (importer.parent / spec).resolve()
    for cand in (base.with_suffix(".ts"), base.with_suffix(".tsx"),
                 base / "index.ts", base / "index.tsx", base):
        if cand.is_file():
            return cand
    return None


def openapi_paths() -> set[str]:
    spec = ROOT / "docs" / "openapi.yaml"
    if not spec.exists():
        return set()
    return set(re.findall(r"^  (/api/[^\s:]+):", spec.read_text(encoding="utf-8"), re.M))


def route_to_url(path: Path) -> str:
    rel = path.relative_to(ROOT / "app").parent.as_posix()
    return "/" + re.sub(r"\[(\.\.\.)?(\w+)\]", r"{\2}", rel)


print("복구 라우트 정적 검증")
print("=" * 62)

routes = sorted(API.rglob("route.ts"))
shared = sorted(p for p in API.rglob("*.ts") if p.name != "route.ts")
print(f"라우트 {len(routes)}개 · 공용 모듈 {len(shared)}개\n")

for f in routes + shared:
    rel = f.relative_to(ROOT)
    src = f.read_text(encoding="utf-8")

    # 1·2. import 검증
    for spec, names in re.findall(r'import\s*\{([^}]*)\}\s*from\s*"([^"]+)"', src):
        pass  # 순서가 반대인 패턴은 아래에서 처리
    for names, spec in re.findall(r'import\s*\{([^}]*)\}\s*from\s*"([^"]+)"', src):
        target = resolve(f, spec)
        if spec.startswith("."):
            check(target is not None, f"{rel}: import 경로 '{spec}'", "파일 없음")
            if target is None:
                continue
            available = exports_of(target)
            for raw in names.split(","):
                nm = raw.strip().split(" as ")[0].strip()
                if not nm or nm.startswith("type "):
                    nm = nm.replace("type ", "").strip()
                if nm:
                    check(nm in available, f"{rel}: '{nm}' from {spec}", "export 없음")

    # 3. 라우트는 HTTP 메서드를 export 해야 한다
    if f.name == "route.ts":
        handlers = exports_of(f) & METHODS
        check(bool(handlers), f"{rel}: HTTP 메서드 export", "없음")

# 4. openapi 대조
spec_paths = openapi_paths()
file_paths = {route_to_url(r) for r in routes}
if spec_paths:
    for p in sorted(spec_paths - file_paths):
        check(False, f"openapi 명세 '{p}'", "라우트 파일 없음")
    for p in sorted(file_paths - spec_paths):
        # 명세에 없는 라우트는 경고 수준 — openapi 가 전부를 덮지 않는다
        print(f"  참고: {p} 는 openapi.yaml 에 없음")


# 5. AgentPortal 이 컴포넌트에서 가져다 쓰는 심볼이 실제로 export 되는가
portal = ROOT / "app" / "AgentPortal.tsx"
if portal.exists():
    src = portal.read_text(encoding="utf-8")
    for names, spec in re.findall(r'import\s*\{([^}]*)\}\s*from\s*"(\./components/[^"]+)"', src):
        target = resolve(portal, spec)
        check(target is not None, f"AgentPortal: '{spec}'", "컴포넌트 파일 없음")
        if target is None:
            continue
        available = exports_of(target)
        for raw in names.split(","):
            nm = raw.strip().replace("type ", "").split(" as ")[0].strip()
            if nm:
                check(nm in available, f"AgentPortal: '{nm}' from {spec}", "export 없음")

    # 컴포넌트가 import 하는 CSS 가 실제로 있는가 (빌드가 여기서 깨진다)
    for comp in sorted((ROOT / "app" / "components").glob("*.tsx")):
        for css in re.findall(r'import\s+"(\.\/[^"]+\.css)"', comp.read_text(encoding="utf-8")):
            check((comp.parent / css).is_file(), f"{comp.name}: {css}", "CSS 파일 없음")

print()
print("=" * 62)
print(f"검사 {COUNT}건")
if FAILED:
    print(f"실패 {len(FAILED)}건:")
    for x in FAILED:
        print("  ✗", x)
    sys.exit(1)
print("전부 통과")
