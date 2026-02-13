import { primaryActions as pDB } from "@workspace/db";
import { ItemSchema } from "@workspace/schema/item";
import type { Hono } from "hono";
import { ZodError } from "zod";

export function registerItemRoutes(app: Hono) {
  app.post("/api/v1/items", async (c) => {
    try {
      const body = await c.req.json();
      const item = await ItemSchema.parseAsync(body);

      await pDB.createItem(item);

      return c.json({
        success: true,
        message: "Item ingested successfully!",
        item,
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

      return c.json({ success: false, message: "Failed to ingest item!" }, 500);
    }
  });

  app.get("/api/v1/items", async (c) => {
    try {
      const items = await pDB.getItems();
      return c.json({
        success: true,
        message: "Items fetched successfully!",
        items,
      });
    } catch (error) {
      console.error(error);
      return c.json({ success: false, message: "Failed to fetch items!" }, 500);
    }
  });

  app.get("/api/v1/items/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const item = await pDB.getItem(id);
      return c.json({
        success: true,
        message: "Item fetched successfully!",
        item,
      });
    } catch (error) {
      console.error(error);
      return c.json({ success: false, message: "Failed to fetch item!" }, 500);
    }
  });

  app.put("/api/v1/items/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const item = await ItemSchema.parseAsync(body);

      await pDB.updateItem(id, item);
      return c.json({
        success: true,
        message: "Item updated successfully!",
        item,
      });
    } catch (error) {
      console.error(error);
      return c.json({ success: false, message: "Failed to update item!" }, 500);
    }
  });

  app.delete("/api/v1/items/:id", async (c) => {
    try {
      const id = c.req.param("id");
      await pDB.deleteItem(id);
      return c.json({ success: true, message: "Item deleted successfully!" });
    } catch (error) {
      console.error(error);
      return c.json({ success: false, message: "Failed to delete item!" }, 500);
    }
  });
}
