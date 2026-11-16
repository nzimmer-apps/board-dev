import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile, parseCsv, parseIcs, parseText, sameKey } from './importer.ts';

test('Board JSON backup: fields come back, other people\'s attachments do not', () => {
  const json = JSON.stringify({
    exported_at: '2026-11-16T00:00:00Z',
    items: [
      { id: 'a', body: 'dart league', tags: ['Sport'], due_at: '2026-11-17T01:00:00Z', all_day: false, kind: 'event', repeat: { freq: 'weekly', interval: 1, days: [1, 4] }, remind_offsets: [120, 480], duration_min: 180, created_at: '2026-11-01T10:00:00Z', source: 'app' },
      { id: 'b', body: 'photo', image_path: 'me/x.jpg', ocr_text: 'hello' },
      { id: 'c', body: 'their photo', image_path: 'someone-else/y.jpg' },
      { id: 'd', body: '' },
      { id: 'e', body: '', file_path: 'me/agenda.pdf', file_type: 'pdf', file_name: 'agenda.pdf' },
    ],
  });
  const p = parseFile('board-2026-11-16.json', json, 'me/');
  assert.equal(p.kind, 'Board backup');
  assert.equal(p.rows.length, 4);
  assert.equal(p.dropped, 1);
  const [a, b, c, e] = p.rows;
  assert.equal(e.body, '');
  assert.equal(e.file_path, 'me/agenda.pdf');
  assert.deepEqual(a.tags, ['sport']);
  assert.deepEqual(a.repeat, { freq: 'weekly', interval: 1, days: [1, 4] });
  assert.equal(a.duration_min, 180);
  assert.equal(a.source, 'import');
  assert.equal('id' in a, false);
  assert.equal(b.image_path, 'me/x.jpg');
  assert.equal(c.image_path, null);
  // Someone else's attachment can't come along, so the note keeps a readable title instead.
  assert.equal(parseFile('b.json', JSON.stringify([{ body: '', file_path: 'x/a.pdf', file_name: 'a.pdf' }]), 'me/').rows[0].body, 'a.pdf');
});

test('Google Keep note with a checklist and labels', () => {
  const keep = JSON.stringify({
    title: 'Groceries', isPinned: true, isArchived: false, isTrashed: false,
    listContent: [{ text: 'milk', isChecked: false }, { text: 'eggs', isChecked: true }],
    labels: [{ name: 'Home Stuff' }], createdTimestampUsec: 1763290000000000,
  });
  const p = parseFile('Groceries.json', keep);
  assert.equal(p.kind, 'Google Keep');
  assert.equal(p.rows[0].body, 'Groceries\n[ ] milk\n[x] eggs');
  assert.deepEqual(p.rows[0].tags, ['home-stuff']);
  assert.equal(p.rows[0].pinned, true);
  assert.equal(parseFile('t.json', JSON.stringify({ textContent: 'gone', isTrashed: true })).rows.length, 0);
});

test('Board CSV, including quoted commas, newlines and formula guards', () => {
  const csv = '﻿created,text,tags,date,all_day,length_minutes,kind,location,done\r\n' +
    '2026-11-01 10:00,"Lunch, with ""Sam""",work food,2026-11-20 13:00,false,90,event,Cafe,false\r\n' +
    '2026-11-02 09:00,"two\nlines",,,false,,,,true\r\n' +
    "2026-11-03 09:00,'=not a formula,,,,,,,\r\n";
  const p = parseCsv(csv);
  assert.equal(p.rows.length, 3);
  assert.equal(p.rows[0].body, 'Lunch, with "Sam"');
  assert.deepEqual(p.rows[0].tags, ['work', 'food']);
  assert.equal(new Date(p.rows[0].due_at!).getHours(), 13);
  assert.equal(p.rows[0].duration_min, 90);
  assert.equal(p.rows[1].body, 'two\nlines');
  assert.equal(p.rows[1].done, true);
  assert.equal(p.rows[2].body, '=not a formula');
});

test('calendar file: times, all-day, lengths, repeats, skipped dates, cancelled', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'DTSTART:20261205T010000Z', 'DTEND:20261205T020000Z', 'SUMMARY:Parade of', '  Lights', 'LOCATION:Denver\\, CO', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261225', 'SUMMARY:Christmas Eve', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;TZID=America/Chicago:20261116T190000', 'DTEND;TZID=America/Chicago:20261116T220000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'EXDATE;TZID=America/Chicago:20261119T190000', 'SUMMARY:Darts', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20261201T100000', 'SUMMARY:Called off', 'STATUS:CANCELLED', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const p = parseIcs(ics);
  assert.equal(p.rows.length, 3);
  assert.equal(p.dropped, 1);
  const [parade, xmas, darts] = p.rows;
  assert.equal(parade.body, 'Parade of Lights');
  assert.equal(parade.due_at, '2026-12-05T01:00:00.000Z');
  assert.equal(parade.duration_min, 60);
  assert.equal(parade.location, 'Denver, CO');
  assert.equal(xmas.all_day, true);
  assert.equal(xmas.duration_min, undefined);
  assert.deepEqual(darts.repeat, { freq: 'weekly', interval: 1, days: [1, 4], skip: ['2026-11-19'] });
  assert.equal(new Date(darts.due_at!).getHours(), 19);
  assert.equal(darts.duration_min, 180);
});

test('Markdown export and plain text', () => {
  const md = '# Board export\n\n_3 notes_\n\n## #work\n\n- [ ] send invoice\n  _📅 2026-11-20 09:00_\n- call bank\n  second line\n\n## Untagged\n\n- buy milk\n';
  const p = parseText(md);
  assert.deepEqual(p.rows.map((r) => [r.body, r.tags]), [
    ['send invoice', ['work']], ['call bank\nsecond line', ['work']], ['buy milk', []],
  ]);
  const t = parseText('first idea\nstill first\n\nsecond idea\n');
  assert.deepEqual(t.rows.map((r) => r.body), ['first idea\nstill first', 'second idea']);
});

test('duplicate check ignores spacing and case', () => {
  assert.equal(sameKey({ body: 'Buy  milk ', due_at: null }), sameKey({ body: 'buy milk' }));
  assert.notEqual(sameKey({ body: 'x', due_at: '2026-11-20T10:00:00Z' }), sameKey({ body: 'x', due_at: null }));
  assert.notEqual(sameKey({ body: '', image_path: 'me/1.jpg' }), sameKey({ body: '', image_path: 'me/2.jpg' }));
});
