
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        database: Boolean(env.DB)
      });
    }

    return env.ASSETS.fetch(request);
  }
};
