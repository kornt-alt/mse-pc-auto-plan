const test = require('node:test');
const assert = require('node:assert');
const { formatBytes, summarize, readAttachmentStats } = require('../attachmentStats');

test('formatBytes: ไล่หน่วยขึ้นตามขนาด', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(512), '512 B');
  assert.strictEqual(formatBytes(1024), '1.0 KB');
  assert.strictEqual(formatBytes(16 * 1024 * 1024), '16.0 MB');
  assert.strictEqual(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
});

test('formatBytes: ค่าเพี้ยน/ติดลบ → "-" (ไม่โชว์ NaN บนหน้าเว็บ)', () => {
  for (const bad of [null, undefined, 'abc', -1, NaN, Infinity]) {
    assert.strictEqual(formatBytes(bad), '-', `${String(bad)} ควรได้ "-"`);
  }
});

test('summarize: รวมขนาด + หาไฟล์ใหญ่สุด + ช่วงเวลา', () => {
  const out = summarize([
    { size: 100, mtimeMs: 3000 },
    { size: 900, mtimeMs: 1000 },
    { size: 24, mtimeMs: 2000 },
  ]);
  assert.strictEqual(out.file_count, 3);
  assert.strictEqual(out.total_bytes, 1024);
  assert.strictEqual(out.total_readable, '1.0 KB');
  assert.strictEqual(out.largest_bytes, 900);
  assert.strictEqual(out.oldest_mtime, 1000);
  assert.strictEqual(out.newest_mtime, 3000);
});

test('summarize: ลิสต์ว่าง → เลขศูนย์ ไม่ใช่ NaN/undefined', () => {
  const out = summarize([]);
  assert.strictEqual(out.file_count, 0);
  assert.strictEqual(out.total_bytes, 0);
  assert.strictEqual(out.largest_bytes, 0);
  assert.strictEqual(out.oldest_mtime, null);
  assert.strictEqual(out.newest_mtime, null);
  assert.deepStrictEqual(summarize(), summarize([]));
});

test('summarize: ข้ามรายการที่ size ใช้ไม่ได้', () => {
  const out = summarize([{ size: 10, mtimeMs: 1 }, { size: 'x' }, null, undefined]);
  assert.strictEqual(out.file_count, 1);
  assert.strictEqual(out.total_bytes, 10);
});

test('readAttachmentStats: ไม่ได้ตั้ง dir → configured=false ไม่ throw', async () => {
  const out = await readAttachmentStats('');
  assert.strictEqual(out.configured, false);
  assert.strictEqual(out.exists, false);
  assert.strictEqual(out.file_count, 0);
  assert.match(out.note, /ORDER_ATTACHMENTS_DIR/);
});

test('readAttachmentStats: dir ไม่มีจริง → exists=false ไม่ throw (ADMIN ต้องไม่เจอ 500)', async () => {
  const out = await readAttachmentStats('D:/__ไม่มีโฟลเดอร์นี้แน่นอน__/x');
  assert.strictEqual(out.configured, true);
  assert.strictEqual(out.exists, false);
  assert.strictEqual(out.total_bytes, 0);
  assert.ok(out.note);
});

test('readAttachmentStats: dir จริง → นับไฟล์ได้ (ใช้โฟลเดอร์ของโปรเจกต์เอง)', async () => {
  const out = await readAttachmentStats(__dirname);
  assert.strictEqual(out.configured, true);
  assert.strictEqual(out.exists, true);
  assert.ok(out.file_count >= 1, 'ควรเจอไฟล์เทสอย่างน้อยตัวเอง');
  assert.ok(out.total_bytes > 0);
  assert.notStrictEqual(out.total_readable, '-');
});
