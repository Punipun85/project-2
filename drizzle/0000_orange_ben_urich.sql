CREATE TABLE `ai_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`memory` text NOT NULL,
	`memory_type` text DEFAULT 'preference' NOT NULL,
	`embedding` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_memory_user_idx` ON `ai_memory` (`user_id`);--> statement-breakpoint
CREATE TABLE `content_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_categories_slug_unique` ON `content_categories` (`slug`);--> statement-breakpoint
CREATE TABLE `content_category_links` (
	`content_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`content_id`, `category_id`),
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `content_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_category_links_category_idx` ON `content_category_links` (`category_id`);--> statement-breakpoint
CREATE TABLE `content_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`rating` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_ratings_user_content_unique` ON `content_ratings` (`user_id`,`content_id`);--> statement-breakpoint
CREATE INDEX `content_ratings_content_idx` ON `content_ratings` (`content_id`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text,
	`description` text DEFAULT '' NOT NULL,
	`poster_url` text,
	`backdrop_url` text,
	`genre` text DEFAULT '[]' NOT NULL,
	`themes` text DEFAULT '[]' NOT NULL,
	`language` text,
	`country` text,
	`release_date` text,
	`duration` integer,
	`episodes` integer,
	`season` text,
	`studio` text,
	`source_material` text,
	`director` text,
	`cast` text DEFAULT '[]' NOT NULL,
	`rating` real DEFAULT 0 NOT NULL,
	`popularity` real DEFAULT 0 NOT NULL,
	`embedding` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contents_provider_external_type_unique` ON `contents` (`provider`,`external_id`,`type`);--> statement-breakpoint
CREATE INDEX `contents_type_idx` ON `contents` (`type`);--> statement-breakpoint
CREATE INDEX `contents_language_idx` ON `contents` (`language`);--> statement-breakpoint
CREATE INDEX `contents_country_idx` ON `contents` (`country`);--> statement-breakpoint
CREATE INDEX `contents_popularity_idx` ON `contents` (`popularity`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`content_score` real NOT NULL,
	`collaborative_score` real NOT NULL,
	`final_score` real NOT NULL,
	`reason` text NOT NULL,
	`model_version` text DEFAULT 'universal-hybrid-v1' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recommendations_user_score_idx` ON `recommendations` (`user_id`,`final_score`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`favorite_content_types` text DEFAULT '[]' NOT NULL,
	`preferred_languages` text DEFAULT '[]' NOT NULL,
	`favorite_genres` text DEFAULT '[]' NOT NULL,
	`favorite_countries` text DEFAULT '[]' NOT NULL,
	`disliked_genres` text DEFAULT '[]' NOT NULL,
	`mood_profile` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_preferences_user_unique` ON `user_preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `watch_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`watched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_history_user_content_unique` ON `watch_history` (`user_id`,`content_id`);--> statement-breakpoint
CREATE INDEX `watch_history_status_idx` ON `watch_history` (`status`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`user_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `content_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade
);
