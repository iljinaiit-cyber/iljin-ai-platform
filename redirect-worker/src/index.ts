const TARGET_ORIGIN = "https://iljin-ai-works-portal.giosis2486.chatgpt.site";

export default {
  async fetch(request: Request): Promise<Response> {
    const incoming = new URL(request.url);
    const destination = new URL(TARGET_ORIGIN);
    destination.pathname = incoming.pathname;
    destination.search = incoming.search;
    // Proxy instead of redirecting so the public Workers URL stays in the address bar.
    try {
      return await fetch(new Request(destination, request));
    } catch {
      if (incoming.pathname.startsWith("/api/")) {
        return Response.json(
          { error: { code: "UPSTREAM_UNAVAILABLE", message: "AI 서비스 연결이 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해 주세요." } },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
      return new Response("Service temporarily unavailable", { status: 502 });
    }
  },
};
