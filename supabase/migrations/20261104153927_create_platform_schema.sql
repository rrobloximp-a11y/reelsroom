CREATE TABLE channels (
  id text PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  is_admin boolean NOT NULL DEFAULT false,
  coins integer NOT NULL DEFAULT 1000,
  avatar_version integer NOT NULL DEFAULT 0,
  banner_version integer NOT NULL DEFAULT 0,
  banned boolean NOT NULL DEFAULT false,
  ban_reason text NOT NULL DEFAULT '',
  bonus_subscribers integer NOT NULL DEFAULT 0,
  frame text NOT NULL DEFAULT '',
  theme text NOT NULL DEFAULT '',
  owned_cosmetics jsonb NOT NULL DEFAULT '[]'::jsonb,
  seen_gift_id integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE videos (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 0,
  size_bytes bigint NOT NULL,
  mime_type text NOT NULL,
  chunk_size integer NOT NULL,
  chunk_count integer NOT NULL,
  has_thumbnail smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'uploading',
  views integer NOT NULL DEFAULT 0,
  bonus_likes integer NOT NULL DEFAULT 0,
  is_short boolean NOT NULL DEFAULT false,
  promoted_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX videos_channel_idx ON videos (channel_id);
CREATE INDEX videos_published_idx ON videos (published_at);

CREATE TABLE comments (
  id serial PRIMARY KEY,
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_video_idx ON comments (video_id);

CREATE TABLE reactions (
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  value smallint NOT NULL,
  PRIMARY KEY (video_id, channel_id)
);

CREATE TABLE subscriptions (
  subscriber_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, channel_id)
);
CREATE INDEX subs_channel_idx ON subscriptions (channel_id);

CREATE TABLE video_views (
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, viewer_key, day)
);

CREATE TABLE coin_purchases (
  session_id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  coins integer NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coin_purchases_channel_idx ON coin_purchases (channel_id);

CREATE TABLE posts (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  has_image smallint NOT NULL DEFAULT 0,
  poll_options jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_channel_idx ON posts (channel_id);
CREATE INDEX posts_created_idx ON posts (created_at);

CREATE TABLE post_likes (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, channel_id)
);

CREATE TABLE post_votes (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  option smallint NOT NULL,
  PRIMARY KEY (post_id, channel_id)
);

CREATE TABLE post_comments (
  id serial PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_comments_post_idx ON post_comments (post_id);

CREATE TABLE coin_gifts (
  id serial PRIMARY KEY,
  amount integer NOT NULL,
  message text NOT NULL DEFAULT '',
  recipients integer NOT NULL DEFAULT 0,
  created_by text REFERENCES channels(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_reports (
  id serial PRIMARY KEY,
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  reporter_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX video_reports_video_reporter_idx ON video_reports (video_id, reporter_id);
CREATE INDEX video_reports_status_idx ON video_reports (status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channels','videos','comments','reactions','subscriptions','video_views','coin_purchases','posts','post_likes','post_votes','post_comments','coin_gifts','site_settings','video_reports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;

INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', false) ON CONFLICT (id) DO NOTHING;
