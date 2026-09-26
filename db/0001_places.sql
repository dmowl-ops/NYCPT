CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  place_id TEXT,
  name TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  category TEXT NOT NULL CHECK (category IN ('food', 'culture', 'walk', 'shop')),
  area TEXT NOT NULL DEFAULT '',
  google_types_json TEXT,
  photo_url TEXT,
  enrichment_status TEXT NOT NULL DEFAULT 'link_only',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_places_source_url ON places(source_url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_places_place_id ON places(place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_places_category_created_at ON places(category, created_at);
PRAGMA optimize;
