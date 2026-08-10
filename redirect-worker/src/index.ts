const TARGET_ORIGIN = "https://iljin-ai-works-portal.giosis2486.chatgpt.site";

export default {
  fetch(request: Request): Response {
    const incoming = new URL(request.url);
    const destination = new URL(TARGET_ORIGIN);
    destination.pathname = incoming.pathname;
    destination.search = incoming.search;
    return Response.redirect(destination, 302);
  },
};
