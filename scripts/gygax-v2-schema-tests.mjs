#!/usr/bin/env node
/*
 * gygax-v2-schema-tests.mjs — proves the v2 schema enforces its disciplines
 * structurally rather than by convention.
 *
 *   node --experimental-sqlite scripts/gygax-v2-schema-tests.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};
const rejects = (name, fn) => {
  try { fn(); ok(name, false, 'was ACCEPTED but should be rejected'); }
  catch (e) { ok(name, true); }
};
const accepts = (name, fn) => {
  try { fn(); ok(name, true); } catch (e) { ok(name, false, e.message); }
};

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(HERE, 'gygax-v2-schema.sql'), 'utf8'));

// fixtures (clearly synthetic; no historical claims)
db.exec(`
  INSERT INTO persons(id,name) VALUES (1,'FIXTURE Speaker A'),(2,'FIXTURE Speaker B');
  INSERT INTO source_families(id,name,kind) VALUES (1,'FIXTURE Family','forum');
  INSERT INTO documentary_objects(id,family_id,title,object_type)
    VALUES (1,1,'FIXTURE Thread','forum_thread'),(2,1,'FIXTURE Other','forum_thread');
`);
const insUnit = (o) => db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,transcript,transcript_status,
   speaker_id,evidence_relationship,discourse_mode)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(
    o.object_id ?? 1, o.seq, o.num ?? null, o.numst ?? 'unknown',
    o.transcript ?? '', o.tstatus ?? 'untranscribed',
    o.speaker ?? 1, o.rel ?? 'direct', o.mode ?? 'unknown');

console.log('Transcript purity (machine text has no route into the canonical record):');
rejects('untranscribed unit cannot hold text',
  () => insUnit({ seq: 900, transcript: 'OCR leakage', tstatus: 'untranscribed' }));
rejects('verified unit cannot be empty',
  () => insUnit({ seq: 901, transcript: '', tstatus: 'verified' }));
accepts('untranscribed + empty is allowed',
  () => insUnit({ seq: 1, transcript: '', tstatus: 'untranscribed' }));
accepts('verified + text is allowed',
  () => insUnit({ seq: 2, transcript: 'verified diplomatic text', tstatus: 'verified' }));
rejects('unknown transcript_status rejected (no ocr-draft)',
  () => insUnit({ seq: 902, transcript: 'x', tstatus: 'ocr-draft' }));

console.log('\nControlled vocabularies:');
rejects('bad evidence_relationship rejected', () => insUnit({ seq: 903, rel: 'hearsay' }));
accepts('editorial_or_authorial_inference accepted',
  () => insUnit({ seq: 3, rel: 'editorial_or_authorial_inference' }));
accepts('unattributed_institutional_statement accepted',
  () => insUnit({ seq: 4, rel: 'unattributed_institutional_statement' }));
rejects('bad discourse_mode rejected', () => insUnit({ seq: 904, mode: 'satire' }));
accepts('in_world discourse_mode accepted', () => insUnit({ seq: 5, mode: 'in_world' }));
rejects('bad unit_number_status rejected', () => insUnit({ seq: 905, numst: 'guessed' }));
rejects('bad date_precision rejected', () => db.prepare(
  `INSERT INTO testimony_units(object_id,sequence_in_object,date_precision) VALUES (1,906,'decade')`).run());
accepts('minute precision + timezone accepted', () => db.prepare(
  `INSERT INTO testimony_units(object_id,sequence_in_object,date_display,date_value,date_precision,date_timezone)
   VALUES (1,6,'03-22-2003, 07:14 PM','2003-03-22T19:14','minute','GMT+2')`).run());
accepts('month-only precision accepted (no manufactured day)', () => db.prepare(
  `INSERT INTO testimony_units(object_id,sequence_in_object,date_display,date_value,date_precision)
   VALUES (1,7,'July 1975','1975-07','month')`).run());

console.log('\nIdentity and duplicate ingestion:');
rejects('duplicate sequence_in_object rejected (same object)', () => insUnit({ seq: 1 }));
accepts('same sequence in a DIFFERENT object allowed', () => insUnit({ object_id: 2, seq: 1 }));
accepts('observed #1015 accepted', () => insUnit({ seq: 10, num: 1015, numst: 'observed' }));
rejects('second observed #1015 in same object rejected',
  () => insUnit({ seq: 11, num: 1015, numst: 'observed' }));
accepts('inferred #1015 may coexist with observed #1015 (reconciled explicitly)',
  () => insUnit({ seq: 12, num: 1015, numst: 'inferred' }));
accepts('a second inferred #1015 also allowed (curation state, not corruption)',
  () => insUnit({ seq: 13, num: 1015, numst: 'inferred' }));

console.log('\nRelated testimony:');
rejects('unit cannot relate to itself', () => db.prepare(
  `INSERT INTO testimony_relations(from_unit_id,to_unit_id) VALUES (1,1)`).run());
accepts('same_subject + apparent_contradiction accepted', () => db.prepare(
  `INSERT INTO testimony_relations(from_unit_id,to_unit_id,relation_type,assessment)
   VALUES (1,2,'same_subject','apparent_contradiction')`).run());
rejects('bad assessment rejected', () => db.prepare(
  `INSERT INTO testimony_relations(from_unit_id,to_unit_id,assessment) VALUES (2,3,'probably_fine')`).run());

console.log('\nFTS synchronisation (external content cannot drift):');
const uCount = (q) => db.prepare('SELECT count(*) c FROM units_fts WHERE units_fts MATCH ?').get(q).c;
const cCount = (q) => db.prepare('SELECT count(*) c FROM context_fts WHERE context_fts MATCH ?').get(q).c;
const dCount = (q) => db.prepare('SELECT count(*) c FROM discovery_text f JOIN discovery_fts x ON x.rowid=f.id WHERE discovery_fts MATCH ?').get(q).c;
db.prepare(`INSERT INTO testimony_units(object_id,sequence_in_object,transcript,transcript_status)
            VALUES (1,20,'zorkmid appears here','verified')`).run();
ok('insert trigger indexes new transcript', uCount('zorkmid') === 1);
db.prepare(`UPDATE testimony_units SET transcript='grue appears instead' WHERE sequence_in_object=20 AND object_id=1`).run();
ok('update trigger removes the old term', uCount('zorkmid') === 0);
ok('update trigger indexes the new term', uCount('grue') === 1);
db.prepare(`DELETE FROM testimony_units WHERE sequence_in_object=20 AND object_id=1`).run();
ok('delete trigger removes the row from the index', uCount('grue') === 0);

console.log('\nContext is bound to the answer but never in the transcript index:');
const unitId = db.prepare('SELECT id FROM testimony_units WHERE object_id=1 AND sequence_in_object=2').get().id;
db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status)
            VALUES (?,'interviewer_question',2,'What about xyzzy mapping?','verified')`).run(unitId);
ok('question is searchable in context_fts', cCount('xyzzy') === 1);
ok('question is NOT in the transcript index', uCount('xyzzy') === 0);
rejects('untranscribed context cannot hold text', () => db.prepare(
  `INSERT INTO unit_context(unit_id,context_type,text,text_status,sequence)
   VALUES (?,'headnote','leak','untranscribed',9)`).run(unitId));

console.log('\nDiscovery layer is separate from the transcript index:');
db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,text)
            VALUES (1,'Part III','pdf_text_extraction','plugh discovered in extraction')`).run();
ok('discovery text searchable in discovery_fts', dCount('plugh') === 1);
ok('discovery text NOT in transcript index', uCount('plugh') === 0);

console.log('\nFTS integrity + coverage segments:');
accepts('units_fts integrity-check', () => db.exec(`INSERT INTO units_fts(units_fts) VALUES('integrity-check')`));
accepts('context_fts integrity-check', () => db.exec(`INSERT INTO context_fts(context_fts) VALUES('integrity-check')`));
accepts('discovery_fts integrity-check', () => db.exec(`INSERT INTO discovery_fts(discovery_fts) VALUES('integrity-check')`));
accepts('coverage segment within an object', () => db.prepare(
  `INSERT INTO coverage(object_id,segment_label,number_from,number_to,coverage_status,known_loss)
   VALUES (1,'Part III',1001,1500,'partial',0)`).run());
rejects('duplicate segment label in same object rejected', () => db.prepare(
  `INSERT INTO coverage(object_id,segment_label,coverage_status) VALUES (1,'Part III','partial')`).run());
rejects('bad coverage_status rejected', () => db.prepare(
  `INSERT INTO coverage(object_id,segment_label,coverage_status) VALUES (1,'Part IV','mostly')`).run());

db.close();
console.log(`\n${fails ? fails + ' FAILURE(S)' : 'ALL PASS'}`);
process.exit(fails ? 1 : 0);
