"use client";

import { useEffect } from "react";

// 모든 버튼의 미세한 반응을 한 곳에서 제공한다. 기능별로 이벤트를 중복 등록하지 않는다.
export function InteractionFeedback() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest("button, [role='button']") as HTMLElement | null;
      if (!target || target.hasAttribute("disabled") || reducedMotion.matches) return;

      target.classList.remove("interaction-tap");
      window.requestAnimationFrame(() => target.classList.add("interaction-tap"));
      if ("vibrate" in navigator) navigator.vibrate(8);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
