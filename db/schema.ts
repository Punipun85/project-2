import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const contentTypes = [
  "movie",
  "anime",
  "kdrama",
  "series",
  "documentary",
] as const;

export type ContentType = (typeof contentTypes)[number];

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const contentCategories = sqliteTable(
  "content_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("content_categories_slug_unique").on(table.slug)],
);

export const contents = sqliteTable(
  "contents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull(),
    provider: text("provider").notNull(),
    type: text("type", { enum: contentTypes }).notNull(),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    description: text("description").notNull().default(""),
    posterUrl: text("poster_url"),
    backdropUrl: text("backdrop_url"),
    genre: text("genre").notNull().default("[]"),
    themes: text("themes").notNull().default("[]"),
    language: text("language"),
    country: text("country"),
    releaseDate: text("release_date"),
    duration: integer("duration"),
    episodes: integer("episodes"),
    season: text("season"),
    studio: text("studio"),
    sourceMaterial: text("source_material"),
    director: text("director"),
    cast: text("cast").notNull().default("[]"),
    rating: real("rating").notNull().default(0),
    popularity: real("popularity").notNull().default(0),
    embedding: text("embedding"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("contents_provider_external_type_unique").on(
      table.provider,
      table.externalId,
      table.type,
    ),
    index("contents_type_idx").on(table.type),
    index("contents_language_idx").on(table.language),
    index("contents_country_idx").on(table.country),
    index("contents_popularity_idx").on(table.popularity),
  ],
);

export const contentCategoryLinks = sqliteTable(
  "content_category_links",
  {
    contentId: integer("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => contentCategories.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.contentId, table.categoryId] }),
    index("content_category_links_category_idx").on(table.categoryId),
  ],
);

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    favoriteContentTypes: text("favorite_content_types").notNull().default("[]"),
    preferredLanguages: text("preferred_languages").notNull().default("[]"),
    favoriteGenres: text("favorite_genres").notNull().default("[]"),
    favoriteCountries: text("favorite_countries").notNull().default("[]"),
    dislikedGenres: text("disliked_genres").notNull().default("[]"),
    moodProfile: text("mood_profile").notNull().default("{}"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("user_preferences_user_unique").on(table.userId)],
);

export const contentRatings = sqliteTable(
  "content_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: integer("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    rating: real("rating").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("content_ratings_user_content_unique").on(
      table.userId,
      table.contentId,
    ),
    index("content_ratings_content_idx").on(table.contentId),
  ],
);

export const watchHistory = sqliteTable(
  "watch_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: integer("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    progress: real("progress").notNull().default(0),
    status: text("status", {
      enum: ["planned", "watching", "completed", "dropped"],
    })
      .notNull()
      .default("planned"),
    watchedAt: text("watched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("watch_history_user_content_unique").on(
      table.userId,
      table.contentId,
    ),
    index("watch_history_status_idx").on(table.status),
  ],
);

export const watchlist = sqliteTable(
  "watchlist",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: integer("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.contentId] })],
);

export const aiMemory = sqliteTable(
  "ai_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memory: text("memory").notNull(),
    memoryType: text("memory_type").notNull().default("preference"),
    embedding: text("embedding"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("ai_memory_user_idx").on(table.userId)],
);

export const recommendations = sqliteTable(
  "recommendations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: integer("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    contentScore: real("content_score").notNull(),
    collaborativeScore: real("collaborative_score").notNull(),
    finalScore: real("final_score").notNull(),
    reason: text("reason").notNull(),
    modelVersion: text("model_version").notNull().default("universal-hybrid-v1"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("recommendations_user_score_idx").on(table.userId, table.finalScore),
  ],
);
