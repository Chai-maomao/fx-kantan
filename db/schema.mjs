import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const leaderboardEntries = sqliteTable('leaderboard_entries', {
  browserId: text('browser_id').primaryKey(),
  displayName: text('display_name').notNull(),
  snapshot: text('snapshot').notNull(),
  score: real('score').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});
