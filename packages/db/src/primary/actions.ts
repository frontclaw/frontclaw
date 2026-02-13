import { desc, eq } from "drizzle-orm";
import { primaryDB } from ".";
import {
  ConversationCreate,
  ItemCreate,
  MessageCreate,
  conversations,
  items,
  messages,
} from "./schema";

const db = primaryDB;

export const createItem = async (item: ItemCreate) => {
  await db.insert(items).values(item);
};

export const getItems = async () => {
  return await db.select().from(items);
};

export const getItem = async (id: string) => {
  return await db.select().from(items).where(eq(items.id, id));
};

export const updateItem = async (id: string, item: ItemCreate) => {
  return await db.update(items).set(item).where(eq(items.id, id));
};

export const deleteItem = async (id: string) => {
  return await db.delete(items).where(eq(items.id, id));
};

export const createConversation = async (conversation: ConversationCreate) => {
  const [created] = await db
    .insert(conversations)
    .values(conversation)
    .returning();
  return created ?? null;
};

export const getConversations = async (options?: {
  profileId?: string;
  limit?: number;
  offset?: number;
}) => {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  if (options?.profileId) {
    return await db
      .select()
      .from(conversations)
      .where(eq(conversations.profileId, options.profileId))
      .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt))
      .limit(limit)
      .offset(offset);
  }

  return await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt))
    .limit(limit)
    .offset(offset);
};

export const getConversation = async (id: string) => {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return conversation ?? null;
};

export const touchConversation = async (id: string) => {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, id));
};

export const setConversationTitle = async (id: string, title: string) => {
  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, id));
};

export const deleteConversation = async (id: string) => {
  await db.delete(conversations).where(eq(conversations.id, id));
};

export const createMessage = async (message: MessageCreate) => {
  const [created] = await db.insert(messages).values(message).returning();
  return created ?? null;
};

export const getMessages = async (
  conversationId: string,
  options?: { limit?: number; offset?: number },
) => {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  return await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(limit)
    .offset(offset);
};
