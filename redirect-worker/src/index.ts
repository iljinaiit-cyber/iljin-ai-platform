const TARGET_ORIGIN = "https://iljin-ai-works-portal.giosis2486.chatgpt.site";

export default {
  fetch(request: Request): Promise<Response> {
    const incoming = new URL(request.url);
    const destination = new URL(TARGET_ORIGIN);
    destination.pathname = incoming.pathname;
    destination.search = incoming.search;
    // Proxy instead of redirecting so the public Workers URL stays in the address bar.
    return fetch(new Request(destination, request));
  },
};
