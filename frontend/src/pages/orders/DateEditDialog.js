import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Form, Spinner } from 'react-bootstrap';
import { apiCall, apiDownload } from '../../api/client';

// กล่องเลือกวันที่ใช้ร่วมกัน — Material Ready / Confirm / Release
// props: show, title, label, icon, batch, kind, logKinds, currentValue, canEdit, onHide,
//        onSubmit({ value, note, file }) => Promise    (parent เป็นคนยิง API เป็น FormData)
// canEdit=false (เช่น MFG) → ดูประวัติ + ดาวน์โหลดได้ แต่แก้/แนบไม่ได้
// logKinds = date_kind ที่จะดึงมาแสดงในประวัติ (คั่นคอมมา) — default = kind ของช่องนั้นเอง
//   กล่อง Material ส่ง 'material,material_arrived' เพื่อรวม timeline การติ๊ก "Mat'l เข้า" ไว้ที่เดียวกัน

// whitelist ต้องตรงกับ backend/utils/attachments.js (backend คือด่านจริง อันนี้แค่เตือนก่อนกด)
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];
const ACCEPT_ATTR = ALLOWED_EXT.join(',') + ',image/*';

const checkFile = (file) => {
  if (!file) return null;
  const name = String(file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  if (!ALLOWED_EXT.includes(ext)) return `รองรับเฉพาะไฟล์: ${ALLOWED_EXT.join(', ')}`;
  if (file.size > MAX_FILE_SIZE) return 'ไฟล์ใหญ่เกิน 25 MB';
  return null;
};

const fmtBytes = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(0)} KB`;
  return `${(num / 1024 / 1024).toFixed(1)} MB`;
};

const fmtWhen = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : '');

// แถว date_kind='material_arrived' เก็บ "สถานะการติ๊ก Mat'l เข้า" ใน date_value ไม่ใช่วันที่
// (โค้ด ASCII ฝั่ง DB → ข้อความไทยตรงนี้ที่เดียว) — ค่าที่ไม่รู้จักโชว์ดิบไว้ ดีกว่าหายไปเงียบ ๆ
// ข้อความ/สีต้องตรงกับ dropdown ในคอลัมน์ "Mat'l เข้า" (เขียว = Mat'l OK, แดง = ยังไม่เข้า/ผิดปกติ)
// ไม่งั้นสถานะเดียวกันจะคนละสีระหว่างตารางกับกล่องประวัติ
const ARRIVED_LABEL = {
  ARRIVED: { text: "Mat'l OK", chip: 'chip-ok' },
  NOT_ARRIVED: { text: 'ยังไม่เข้า/ผิดปกติ', chip: 'chip-ng' },
  AUTO: { text: 'กลับเป็นอัตโนมัติ', chip: 'chip-muted' },
};

const DateEditDialog = ({
  show, title, label, icon, batch, kind, logKinds, currentValue, canEdit = true, onHide, onSubmit,
}) => {
  const original = currentValue ? String(currentValue).slice(0, 10) : '';
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [dlError, setDlError] = useState('');

  const wantKinds = logKinds || kind;

  const loadHistory = useCallback(async () => {
    if (!batch || !wantKinds) return;
    setLoadingHistory(true);
    try {
      const rows = await apiCall(
        `/orders/${encodeURIComponent(batch)}/date-log?kind=${encodeURIComponent(wantKinds)}`,
      );
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setHistory([]); // ตารางอาจยังไม่ถูกสร้าง — โชว์ว่าไม่มีประวัติ
    } finally {
      setLoadingHistory(false);
    }
  }, [batch, wantKinds]);

  useEffect(() => {
    if (show) {
      setValue(currentValue ? String(currentValue).slice(0, 10) : '');
      setNote('');
      setFile(null);
      setFileError('');
      setDlError('');
      setSaving(false);
      loadHistory();
    }
  }, [show, currentValue, loadHistory]);

  const onPickFile = (e) => {
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    const err = checkFile(f);
    if (err) {
      setFileError(err);
      setFile(null);
      e.target.value = '';
      return;
    }
    setFileError('');
    setFile(f);
  };

  const submit = async (nextValue) => {
    setSaving(true);
    try {
      await onSubmit({ value: nextValue, note: note.trim(), file });
      await loadHistory(); // รีเฟรชประวัติหลังบันทึก (parent เป็นคนปิด dialog เมื่อสำเร็จ)
    } finally {
      setSaving(false);
    }
  };

  const download = async (entry) => {
    setDlError('');
    try {
      await apiDownload(`/orders/attachments/${entry.id}/download`, entry.file_name);
    } catch (e) {
      // โชว์เหตุผล (เช่นโฟลเดอร์ไฟล์แนบยังไม่ตั้ง/ไฟล์หาย) — ไม่งั้นกดแล้วเงียบ วินิจฉัยไม่ได้
      setDlError(e.message || 'ดาวน์โหลดไฟล์ไม่สำเร็จ');
    }
  };

  const dateChanged = value !== original;
  const hasExtra = note.trim() !== '' || !!file;
  const canSave = canEdit && !saving && value !== '' && (dateChanged || hasExtra);
  const canClear = canEdit && !saving && (original !== '' || hasExtra);

  return (
    <Modal show={show} onHide={saving ? undefined : onHide} centered>
      <Modal.Header closeButton={!saving}>
        <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
          <i className={`bi ${icon || 'bi-calendar-event'} me-2`} aria-hidden="true" />
          {title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="text-muted small mb-2">
          Batch: <span className="num fw-bold">{batch}</span>
        </div>

        {canEdit ? (
          <>
            <Form.Group className="mb-3">
              <Form.Label>{label}</Form.Label>
              <Form.Control
                type="date"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={saving}
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>หมายเหตุ (Note)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เหตุผล/รายละเอียด (ไม่บังคับ)"
                disabled={saving}
              />
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>แนบไฟล์/รูปภาพ (ไม่บังคับ)</Form.Label>
              <Form.Control
                type="file"
                accept={ACCEPT_ATTR}
                onChange={onPickFile}
                disabled={saving}
                isInvalid={!!fileError}
              />
              <Form.Text className="text-muted">
                รูป, PDF หรือ Office ขนาดไม่เกิน 25 MB
              </Form.Text>
              {fileError && <div className="text-danger small mt-1">{fileError}</div>}
            </Form.Group>
          </>
        ) : (
          <div className="text-muted small mb-2">
            <i className="bi bi-eye me-1" aria-hidden="true" /> โหมดดูอย่างเดียว — ดูประวัติและดาวน์โหลดไฟล์ได้
          </div>
        )}

        {/* ===== ประวัติการแก้ (append-only) ===== */}
        <hr className="my-2" />
        <div className="fw-bold small mb-2">
          <i className="bi bi-clock-history me-1" aria-hidden="true" /> ประวัติการแก้
        </div>
        {dlError && <div className="text-danger small mb-2">{dlError}</div>}
        {loadingHistory ? (
          <div className="text-center py-2"><Spinner animation="border" size="sm" /></div>
        ) : history.length === 0 ? (
          <div className="text-muted small">ยังไม่มีประวัติ</div>
        ) : (
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {history.map((h) => (
              <div key={h.id} className="border rounded p-2 mb-2 bg-light">
                <div className="d-flex justify-content-between align-items-start">
                  {h.date_kind === 'material_arrived' ? (
                    // แถวติ๊ก "Mat'l เข้า" — date_value เป็นสถานะ ไม่ใช่วันที่ จึงไม่ใช้คลาส .num
                    <span className={`chip ${(ARRIVED_LABEL[h.date_value] || {}).chip || 'chip-muted'}`}>
                      <i className="bi bi-box-seam me-1" aria-hidden="true" />
                      {(ARRIVED_LABEL[h.date_value] || {}).text || h.date_value}
                    </span>
                  ) : (
                    <span className="num fw-bold">{h.date_value || 'ล้างค่า'}</span>
                  )}
                  <span className="text-muted" style={{ fontSize: 'var(--fs-tiny, 0.75rem)' }}>
                    {fmtWhen(h.created_at)}
                  </span>
                </div>
                <div className="small">
                  <i className="bi bi-person me-1" aria-hidden="true" />
                  {h.display_name || h.created_by_name || '-'}
                </div>
                {h.note && <div className="small text-muted mt-1">{h.note}</div>}
                {h.has_file && (
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 mt-1 text-decoration-none"
                    onClick={() => download(h)}
                    title="ดาวน์โหลดไฟล์แนบ"
                  >
                    <i className="bi bi-paperclip me-1" aria-hidden="true" />
                    {h.file_name || 'ไฟล์แนบ'}
                    {h.file_size ? <span className="text-muted ms-1">({fmtBytes(h.file_size)})</span> : null}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        {canEdit && (
          <Button variant="outline-danger" onClick={() => submit('')} disabled={!canClear} className="me-auto">
            <i className="bi bi-x-circle me-1" aria-hidden="true" /> ล้างค่า
          </Button>
        )}
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>
          {canEdit ? 'ยกเลิก' : 'ปิด'}
        </Button>
        {canEdit && (
          <Button className="btn-mse" onClick={() => submit(value)} disabled={!canSave}>
            {saving ? <Spinner animation="border" size="sm" className="me-1" /> : <i className="bi bi-check-lg me-1" aria-hidden="true" />}
            บันทึก
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default DateEditDialog;
