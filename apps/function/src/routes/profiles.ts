import { ProfileSchema } from "@workspace/schema/profile";
import type { Hono } from "hono";
import { ZodError } from "zod";

export function registerProfileRoutes(app: Hono) {
  app.post("/api/v1/profiles", async (c) => {
    try {
      const body = await c.req.json();
      const profile = await ProfileSchema.parseAsync(body);

      return c.json({
        success: true,
        message: "Profile created successfully!",
        profile,
      });
    } catch (error) {
      console.error(error);

      if (error instanceof SyntaxError) {
        return c.json({ success: false, message: "Invalid JSON provided" }, 400);
      }

      if (error instanceof ZodError) {
        return c.json(
          {
            success: false,
            message: "Invalid payload provided",
            errors: error.issues,
          },
          400,
        );
      }

      return c.json(
        { success: false, message: "Failed to create profile!" },
        500,
      );
    }
  });

  app.get("/api/v1/profiles", (c) => {
    return c.json({
      success: true,
      message: "Profiles fetched successfully!",
      profiles: [],
    });
  });

  app.get("/api/v1/profiles/:id", (c) => {
    return c.json({ success: true, message: "Profile fetched successfully!" });
  });

  app.put("/api/v1/profiles/:id", (c) => {
    return c.json({ success: true, message: "Profile updated successfully!" });
  });

  app.delete("/api/v1/profiles/:id", (c) => {
    return c.json({ success: true, message: "Profile deleted successfully!" });
  });
}
