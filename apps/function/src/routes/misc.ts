import type { Hono } from "hono";

export function registerMiscRoutes(app: Hono) {
  app.get("/api/v1/autocomplete", (c) => {
    return c.json({
      success: true,
      message: "Autocomplete fetched successfully!",
      suggestions: [],
    });
  });

  app.post("/api/v1/webhooks", (c) => {
    return c.json({ success: true, message: "Webhook processed successfully!" });
  });
}
