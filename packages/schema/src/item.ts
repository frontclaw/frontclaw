import z from "zod";

export const ItemSchema = z.object({
  externalId: z.string().describe("ID from your CMS/Shopify/etc"),
  title: z.string().describe("Title of the item"),
  description: z.string().describe("Description of the item"),
  contentBody: z.string().describe("Content body of the item"),
  metadata: z.object({}).optional().describe("Metadata of the item"),
  category: z.string().optional().describe("Category of the item"),
  tags: z.array(z.string()).optional().default([]).describe("Tags of the item"),
  embedding: z.array(z.number()).optional().describe("Embedding of the item"),
  status: z
    .string()
    .optional()
    .default("active")
    .describe("Status of the item"),
});
export type Item = z.infer<typeof ItemSchema>;
