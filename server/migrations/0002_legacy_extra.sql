-- UI-only data the original Gallivanter screens keep per record
-- (legacy notes/timeline arrays, activity counters, display labels).
ALTER TABLE records ADD COLUMN extra TEXT NOT NULL DEFAULT '{}';
