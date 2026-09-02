#!/usr/bin/env node
/*
 * gygax-v2-fixture.mjs — build a SYNTHETIC v2 database plus evidence images to
 * exercise every axis of the schema and renderer.
 *
 * Nothing here is historical. Persons are fictional placeholders and every
 * transcript is explicitly marked FIXTURE. This database is for demonstration
 * and regression only and must never be deployed as the corpus.
 *
 *   node --experimental-sqlite scripts/gygax-v2-fixture.mjs <out.sqlite> <evidence-dir>
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync as zdeflate } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [OUT, EVID] = process.argv.slice(2);
if (!OUT || !EVID) { console.error('Usage: gygax-v2-fixture.mjs <out.sqlite> <evidence-dir>'); process.exit(2); }

// ---- minimal PNG encoder (solid colour), so fixtures are real images -------
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.concat(Array.from({ length: h }, () =>
    Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from([r, g, b])))])));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zdeflate(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

if (existsSync(OUT)) rmSync(OUT);
const db = new DatabaseSync(OUT);
db.exec(readFileSync(join(HERE, 'gygax-v2-schema.sql'), 'utf8'));
db.exec('BEGIN');

// fictional persons — no historical individuals
db.exec(`
INSERT INTO persons(id,name) VALUES
  (1,'FIXTURE Speaker A'),(2,'FIXTURE Witness B'),(3,'FIXTURE Interviewer C');
INSERT INTO source_families(id,name,kind) VALUES
  (1,'FIXTURE Forum','forum'),(2,'FIXTURE Interview Series','interview'),
  (3,'FIXTURE Compilation Blog','compilation'),(4,'FIXTURE Correspondence','correspondence');
INSERT INTO documentary_objects(id,family_id,title,object_type,date_display,date_from_value,date_precision) VALUES
  (1,1,'FIXTURE Q&A thread','forum_thread','2003','2003','year'),
  (2,2,'FIXTURE interview','interview','October 2002','2002-10','month'),
  (3,3,'FIXTURE compilation post','compilation',NULL,NULL,'unknown'),
  (4,4,'FIXTURE letter','letter','12 July 1975','1975-07-12','day');
INSERT INTO coverage(object_id,segment_label,coverage_status,known_loss,detail,sort_order) VALUES
  (1,'Part I','complete',0,'FIXTURE segment',1),
  (1,'Part II','partial',1,'FIXTURE segment with loss',2),
  (2,'Whole','complete',0,'FIXTURE',1),
  (3,'Whole','partial',0,'FIXTURE',1),
  (4,'Whole','complete',0,'FIXTURE',1);
INSERT INTO tags(id,name) VALUES (1,'mapping'),(2,'setting design'),(3,'continuity'),(4,'map');
`);

const insUnit = db.prepare(`INSERT INTO testimony_units
 (id,object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
  speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,
  source_type,source_locator)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

// 1. verified, observed number, minute precision + timezone, direct commentary
insUnit.run(1, 1, 1, 1015, 'observed', '03-22-2003, 07:14 PM', '2003-03-22T19:14', 'minute', 'GMT+2',
  1, null, 'direct', 'commentary',
  'FIXTURE TEXT — not a historical statement. This paragraph mentions mapping and the drawing of dungeon levels so that the transcript dimension can be demonstrated.',
  'verified', 'complete', 'manual_transcription', 'FIXTURE p.104');

// 2. untranscribed PDF card with an INFERRED number colliding with #1015
insUnit.run(2, 1, 2, 1015, 'inferred', null, null, 'unknown', null,
  1, null, 'direct', 'unknown', '', 'untranscribed', 'unknown', 'pdf_text_extraction', 'FIXTURE card 217');

// 3. eyewitness account by a third party about the speaker
insUnit.run(3, 2, 1, null, 'unknown', 'October 2002', '2002-10', 'month', null,
  2, 1, 'eyewitness_account', 'retrospective_commentary',
  'FIXTURE TEXT — not a historical statement. A witness recollection mentioning mapping, recorded to demonstrate that another person’s words never read as the subject’s own.',
  'verified', 'complete', 'manual_transcription', 'FIXTURE interview p.2');

// 4. in-world / rules text, to prove discourse_mode is visible
insUnit.run(4, 1, 3, 1016, 'observed', '03-23-2003', '2003-03-23', 'day', null,
  1, null, 'direct', 'in_world',
  'FIXTURE TEXT — not a historical statement. An in-world passage referring to a dungeon level, present so that discourse mode can be distinguished from commentary.',
  'verified', 'complete', 'manual_transcription', 'FIXTURE p.105');

// 5. verbatim quotation preserved by an intermediary (compilation)
insUnit.run(5, 3, 1, null, 'unknown', null, null, 'unknown', null,
  1, null, 'direct_quotation_by_intermediary', 'commentary',
  'FIXTURE TEXT — not a historical statement. A quotation preserved by a compiler, mentioning mapping, whose primary source has not been recovered.',
  'verified', 'partial', 'compilation_quotation', 'FIXTURE blog');

// 6. letter: ONE act of testimony, several ordered evidence assets
insUnit.run(6, 4, 1, null, 'unknown', '12 July 1975', '1975-07-12', 'day', null,
  1, null, 'direct', 'commentary',
  'FIXTURE TEXT — not a historical statement. A letter demonstrating that one act of testimony may carry several ordered evidence pages.',
  'verified', 'complete', 'manual_transcription', 'FIXTURE letter');

db.exec(`
INSERT INTO unit_tags(unit_id,tag_id) VALUES (1,1),(1,2),(1,3),(3,1),(5,1),(4,4);
INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence) VALUES
  (1,'quoted_question',3,'FIXTURE QUESTION — how did you handle mapping?','verified',1),
  (3,'interviewer_question',3,'FIXTURE QUESTION — what do you remember about the maps?','verified',1);
INSERT INTO annotations(unit_id,annotation_type,note) VALUES
  (1,'note','FIXTURE research annotation.');
INSERT INTO testimony_relations(from_unit_id,to_unit_id,relation_type,assessment,note) VALUES
  (1,3,'same_subject','apparent_contradiction','FIXTURE: witness account differs from the direct statement.'),
  (1,5,'same_subject','elaboration','FIXTURE: quotation elaborates the same point.');
INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text) VALUES
  (1,'Part II','pdf_text_extraction','FIXTURE p.90','FIXTURE DISCOVERY TEXT mentioning mapping, unverified extraction only.');
`);
db.exec('COMMIT');

// ---- evidence assets: one stitched (2 originals), one crop, a 3-page letter -
mkdirSync(EVID, { recursive: true });
const insAsset = db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?,?,?)`);
const insSrc = db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256,capture_date_display,capture_date_value,capture_date_precision) VALUES (?,?,?,?,?,?,?)`);
const addAsset = (unit, path, order, type, w, h, colour, origins) => {
  const buf = png(w, h, colour);
  const full = join(EVID, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buf);
  const info = insAsset.run(unit, path, order, type, sha(buf));
  const id = Number(info.lastInsertRowid);
  for (const o of origins) insSrc.run(id, o.loc, o.type, sha(Buffer.from(o.loc)), o.cd || null, o.cv || null, o.cp || 'unknown');
};
addAsset(1, 'evidence/fixture/unit1015.png', 1, 'stitched', 48, 24, [40, 80, 130],
  [{ loc: 'FIXTURE_IMG_1506.png', type: 'screenshot', cd: '2018', cv: '2018', cp: 'year' },
   { loc: 'FIXTURE_IMG_1507.png', type: 'screenshot', cd: '2018', cv: '2018', cp: 'year' }]);
addAsset(2, 'evidence/fixture/card217.png', 1, 'crop', 32, 20, [130, 90, 40],
  [{ loc: 'FIXTURE_part02.pdf p.90', type: 'pdf_page' }]);
addAsset(3, 'evidence/fixture/witness.png', 1, 'page', 30, 18, [60, 120, 70],
  [{ loc: 'FIXTURE_interview.png', type: 'screenshot' }]);
addAsset(4, 'evidence/fixture/unit1016.png', 1, 'crop', 28, 16, [110, 60, 120], [{ loc: 'FIXTURE_IMG_1510.png', type: 'screenshot' }]);
addAsset(5, 'evidence/fixture/blog.png', 1, 'page', 26, 16, [90, 90, 90], [{ loc: 'FIXTURE_blog.png', type: 'screenshot' }]);
for (let i = 1; i <= 3; i++)
  addAsset(6, `evidence/fixture/letter_p${i}.png`, i, 'scan', 24 + i * 4, 16, [150, 140 - i * 20, 90],
    [{ loc: `FIXTURE_letter_f${i}r.tif`, type: 'scan' }]);

const n = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
console.log('FIXTURE v2 database (synthetic; never deploy):');
console.log(`  units ${n('testimony_units')} · context ${n('unit_context')} · assets ${n('evidence_assets')} · sources ${n('evidence_sources')}`);
console.log(`  tags ${n('tags')} · relations ${n('testimony_relations')} · discovery ${n('discovery_text')} · coverage ${n('coverage')}`);
db.close();
