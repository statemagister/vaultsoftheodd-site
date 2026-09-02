-- =====================================================================
-- Gygax commentary & testimony corpus — v2 schema
--
--   Person -> source family -> documentary object -> testimony unit -> evidence asset
--
-- The canonical record is the TESTIMONY UNIT: one historical act of testimony.
-- Unit size follows the act, not the pages needed to preserve it.
-- "One numbered ENWorld post = one testimony unit" is the ENWorld INGESTION
-- RULE, not the corpus ontology.
--
-- Disciplines enforced structurally (not by convention):
--   * verified transcript can never contain machine text     (CHECK on units)
--   * questions/framing can never enter the transcript index (unit_context)
--   * speaker/subject/relationship always explicit           (CHECK vocab)
--   * reconstructed numbers can never pose as observed       (partial index)
--   * precision is never manufactured                        (date_precision)
--   * FTS indexes cannot drift from their content tables     (triggers)
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- people
CREATE TABLE persons (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  notes TEXT
);

-- -------------------------------------------------------- source family
CREATE TABLE source_families (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,      -- ENWorld Q&A | GameSpy | Private correspondence
                                   -- Dragonsfoot | Dragon | Cyclopeatron
  kind  TEXT NOT NULL CHECK (kind IN
          ('forum','interview','correspondence','periodical',
           'compilation','questionnaire','broadcast','other')),
  notes TEXT
);

-- --------------------------------------------------- documentary object
-- The whole "Q&A with Gary Gygax" thread is ONE object. Our Part I/II/III
-- divisions are preservation segments recorded in `coverage`, because the
-- numbering and conversation run continuously across those boundaries.
CREATE TABLE documentary_objects (
  id             INTEGER PRIMARY KEY,
  family_id      INTEGER NOT NULL REFERENCES source_families(id),
  title          TEXT    NOT NULL,
  object_type    TEXT    NOT NULL CHECK (object_type IN
                   ('forum_thread','interview','letter','article','column',
                    'compilation','questionnaire','other')),
  date_display   TEXT,                 -- exactly as the source renders it
  date_from_value TEXT,                -- normalised ISO 8601, may be partial
  date_to_value   TEXT,
  date_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (date_precision IN
                   ('minute','day','month','year','unknown')),
  date_timezone  TEXT,
  venue          TEXT,
  citation       TEXT,
  identifier     TEXT,
  notes          TEXT,
  UNIQUE(family_id, title)
);

-- ------------------------------------------------------- testimony unit
CREATE TABLE testimony_units (
  id                 INTEGER PRIMARY KEY,
  object_id          INTEGER NOT NULL REFERENCES documentary_objects(id),
  sequence_in_object INTEGER NOT NULL,   -- position within the documentary object
  unit_number        INTEGER NULL,       -- ENWorld #, letter item no., etc.
  unit_number_status TEXT NOT NULL DEFAULT 'unknown' CHECK (unit_number_status IN
                       ('observed','independently_confirmed','inferred','unknown')),

  -- Precision is recorded, never manufactured.
  date_display       TEXT,               -- "03-22-2003, 07:14 PM" etc.
  date_value         TEXT,               -- "2003-03-22T19:14" | "1975-07" | "2002-10"
  date_precision     TEXT NOT NULL DEFAULT 'unknown' CHECK (date_precision IN
                       ('minute','day','month','year','unknown')),
  date_timezone      TEXT,               -- "GMT+2", "UTC", NULL when unknown

  speaker_id         INTEGER REFERENCES persons(id),  -- who produced this testimony
  subject_person_id  INTEGER REFERENCES persons(id),  -- who it is about
  evidence_relationship TEXT NOT NULL DEFAULT 'direct' CHECK (evidence_relationship IN
                       ('direct',
                        'direct_quotation_by_intermediary',
                        'attributed_report',
                        'attributed_paraphrase',
                        'eyewitness_account',
                        'secondary_interpretation',
                        'editorial_or_authorial_inference',
                        'unattributed_institutional_statement',
                        'discovery_only')),
  discourse_mode     TEXT NOT NULL DEFAULT 'unknown' CHECK (discourse_mode IN
                       ('commentary','retrospective_commentary',
                        'in_world','rules_or_game_text','unknown')),

  transcript         TEXT NOT NULL DEFAULT '',   -- ONLY human-verified diplomatic text
  transcript_status  TEXT NOT NULL DEFAULT 'untranscribed'
                       CHECK (transcript_status IN ('untranscribed','verified')),
  completeness       TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (completeness IN ('complete','partial','fragment','unknown')),
  source_type        TEXT,
  source_locator     TEXT,                        -- where the transcript was checked

  -- Structural purity: an untranscribed unit cannot hold text at all;
  -- a verified unit cannot be empty. Machine text has no route in.
  CHECK ( (transcript_status = 'untranscribed' AND transcript = '')
       OR (transcript_status = 'verified'      AND length(transcript) > 0) ),

  -- Duplicate ingestion is structurally impossible, at object scope.
  UNIQUE(object_id, sequence_in_object)
);

-- Only genuinely established numbers are constrained. Inferred / unknown /
-- NULL numbers coexist and are reconciled explicitly, never silently.
CREATE UNIQUE INDEX ux_units_established_number
  ON testimony_units(object_id, unit_number)
  WHERE unit_number IS NOT NULL
    AND unit_number_status IN ('observed','independently_confirmed');

CREATE INDEX ix_units_object   ON testimony_units(object_id);
CREATE INDEX ix_units_speaker  ON testimony_units(speaker_id);
CREATE INDEX ix_units_number   ON testimony_units(unit_number);

-- ---------------------------------------------- context (never transcript)
-- Interviewer questions, quoted forum questions, editorial framing. Bound to
-- the answer, searchable, but never indexed as the speaker's own words.
CREATE TABLE unit_context (
  id           INTEGER PRIMARY KEY,
  unit_id      INTEGER NOT NULL REFERENCES testimony_units(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN
                 ('interviewer_question','quoted_question','editorial_framing',
                  'headnote','caption')),
  speaker_id   INTEGER REFERENCES persons(id),
  text         TEXT NOT NULL DEFAULT '',
  text_status  TEXT NOT NULL DEFAULT 'untranscribed'
                 CHECK (text_status IN ('untranscribed','verified')),
  sequence     INTEGER NOT NULL DEFAULT 1,
  CHECK ( (text_status = 'untranscribed' AND text = '')
       OR (text_status = 'verified'      AND length(text) > 0) ),
  UNIQUE(unit_id, sequence)
);

-- ------------------------------------------------------------- evidence
CREATE TABLE evidence_assets (
  id            INTEGER PRIMARY KEY,
  unit_id       INTEGER NOT NULL REFERENCES testimony_units(id) ON DELETE CASCADE,
  asset_path    TEXT    NOT NULL UNIQUE,  -- evidence/enworld/unit1015.jpg
  display_order INTEGER NOT NULL DEFAULT 1,
  asset_type    TEXT    NOT NULL CHECK (asset_type IN ('crop','stitched','page','scan')),
  sha256        TEXT    NOT NULL,         -- SHA-256 of the PLAINTEXT derivative
  UNIQUE(unit_id, display_order)
);

-- One derivative may descend from several untouched originals; several
-- derivatives may descend from the same original page.
CREATE TABLE evidence_sources (
  id                     INTEGER PRIMARY KEY,
  asset_id               INTEGER NOT NULL REFERENCES evidence_assets(id) ON DELETE CASCADE,
  original_locator       TEXT    NOT NULL,   -- IMG_1506.png | "GameSpy p.2" | "f.3r"
  original_type          TEXT CHECK (original_type IN
                           ('screenshot','pdf_page','scan','photograph','other')),
  original_sha256        TEXT,               -- audit hash; original stays OFFLINE
  -- when the preservation copy was made (e.g. a 2018 archive capture)
  capture_date_display   TEXT,
  capture_date_value     TEXT,
  capture_date_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (capture_date_precision IN
                           ('minute','day','month','year','unknown'))
);

-- --------------------------------------------- classification / research
CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE          -- controlled vocabulary; matched EXACTLY
);

CREATE TABLE unit_tags (
  unit_id INTEGER NOT NULL REFERENCES testimony_units(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (unit_id, tag_id)
);

CREATE TABLE annotations (
  id              INTEGER PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES testimony_units(id) ON DELETE CASCADE,
  annotation_type TEXT,
  note            TEXT
);

-- Source-neutral related testimony. Structural link + analytical assessment,
-- kept apart so the classification never reads as a property of the source.
CREATE TABLE testimony_relations (
  id            INTEGER PRIMARY KEY,
  from_unit_id  INTEGER NOT NULL REFERENCES testimony_units(id) ON DELETE CASCADE,
  to_unit_id    INTEGER NOT NULL REFERENCES testimony_units(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'same_subject' CHECK (relation_type IN
                  ('same_subject','same_event','responds_to','cross_reference')),
  assessment    TEXT NOT NULL DEFAULT 'unresolved' CHECK (assessment IN
                  ('consistent','elaboration','changed_position','different_context',
                   'apparent_contradiction','unresolved')),
  note          TEXT,
  CHECK (from_unit_id <> to_unit_id),
  UNIQUE(from_unit_id, to_unit_id, relation_type)
);

CREATE INDEX ix_relations_from ON testimony_relations(from_unit_id);
CREATE INDEX ix_relations_to   ON testimony_relations(to_unit_id);

-- ---------------------------------- discovery layer (never quotable text)
CREATE TABLE discovery_text (
  id             INTEGER PRIMARY KEY,
  object_id      INTEGER REFERENCES documentary_objects(id),
  segment_label  TEXT,                 -- e.g. "Part III" (preservation segment)
  source_type    TEXT CHECK (source_type IN
                   ('pdf_text_extraction','screenshot_ocr','compilation_quotation','other')),
  source_locator TEXT,
  text           TEXT,
  unit_id        INTEGER NULL REFERENCES testimony_units(id)
);

CREATE INDEX ix_discovery_object ON discovery_text(object_id);

-- ------------------------------------- coverage: segments WITHIN an object
-- Describes which stretches of a single documentary object survive, are
-- partial, or are known lost. Parts I..XIII are segments here, not objects.
CREATE TABLE coverage (
  id              INTEGER PRIMARY KEY,
  object_id       INTEGER NOT NULL REFERENCES documentary_objects(id),
  segment_label   TEXT NOT NULL,          -- "Part III"
  segment_kind    TEXT NOT NULL DEFAULT 'preservation_part' CHECK (segment_kind IN
                    ('preservation_part','page_range','date_range','other')),
  number_from     INTEGER,                -- unit-number range, when known
  number_to       INTEGER,
  locator_from    TEXT,                   -- page/locator range
  locator_to      TEXT,
  coverage_status TEXT NOT NULL CHECK (coverage_status IN
                    ('complete','partial','missing','unknown')),
  known_loss      INTEGER NOT NULL DEFAULT 0 CHECK (known_loss IN (0,1)),
  detail          TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(object_id, segment_label)
);

-- =====================================================================
-- Full-text indexes: three separate corpora, never merged.
--   units_fts     verified transcript      (quotation-grade)
--   context_fts   questions and framing    (not the speaker's own words)
--   discovery_fts extraction/OCR           (finding aid only)
-- =====================================================================
CREATE VIRTUAL TABLE units_fts USING fts5(
  transcript, content='testimony_units', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2');

CREATE VIRTUAL TABLE context_fts USING fts5(
  text, content='unit_context', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2');

CREATE VIRTUAL TABLE discovery_fts USING fts5(
  text, content='discovery_text', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2');

-- ---- synchronisation triggers: the indexes cannot drift from their tables
CREATE TRIGGER units_fts_ai AFTER INSERT ON testimony_units BEGIN
  INSERT INTO units_fts(rowid, transcript) VALUES (new.id, new.transcript);
END;
CREATE TRIGGER units_fts_ad AFTER DELETE ON testimony_units BEGIN
  INSERT INTO units_fts(units_fts, rowid, transcript) VALUES('delete', old.id, old.transcript);
END;
CREATE TRIGGER units_fts_au AFTER UPDATE ON testimony_units BEGIN
  INSERT INTO units_fts(units_fts, rowid, transcript) VALUES('delete', old.id, old.transcript);
  INSERT INTO units_fts(rowid, transcript) VALUES (new.id, new.transcript);
END;

CREATE TRIGGER context_fts_ai AFTER INSERT ON unit_context BEGIN
  INSERT INTO context_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER context_fts_ad AFTER DELETE ON unit_context BEGIN
  INSERT INTO context_fts(context_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER context_fts_au AFTER UPDATE ON unit_context BEGIN
  INSERT INTO context_fts(context_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO context_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER discovery_fts_ai AFTER INSERT ON discovery_text BEGIN
  INSERT INTO discovery_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER discovery_fts_ad AFTER DELETE ON discovery_text BEGIN
  INSERT INTO discovery_fts(discovery_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER discovery_fts_au AFTER UPDATE ON discovery_text BEGIN
  INSERT INTO discovery_fts(discovery_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO discovery_fts(rowid, text) VALUES (new.id, new.text);
END;
