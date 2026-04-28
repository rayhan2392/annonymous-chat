import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: varchar('id', { length: 25 }).primaryKey(), // usr_...
  username: varchar('username', { length: 24 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rooms = pgTable('rooms', {
  id: varchar('id', { length: 25 }).primaryKey(), // room_...
  name: varchar('name', { length: 32 }).notNull().unique(),
  createdBy: varchar('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: varchar('id', { length: 25 }).primaryKey(), // msg_...
  roomId: varchar('room_id')
    .references(() => rooms.id, { onDelete: 'cascade' })
    .notNull(),
  username: varchar('username').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
