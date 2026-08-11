CREATE TABLE `email_verification_requests` (
  `email` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `department` text NOT NULL,
  `note` text,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `password_iterations` integer NOT NULL,
  `token_hash` text NOT NULL,
  `expires_at` text NOT NULL,
  `sent_count` integer NOT NULL DEFAULT 0,
  `last_sent_at` text,
  `bootstrap_admin` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_verification_requests_expires_idx`
  ON `email_verification_requests` (`expires_at`);
