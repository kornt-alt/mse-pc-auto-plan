// JigStatusDialog — แจ้ง jig พัง / ส่งซ่อม / ซ่อมเสร็จ (ADMIN/PLANNER/MFG)
// callbacks ที่รับเข้ามาต้อง stable (useCallback ฝั่ง parent) ไม่งั้น useEffect ด้านล่าง
// จะรีเซ็ตฟอร์มกลางคันตอนผู้ใช้กำลังพิมพ์ — กติกาเดียวกับไดอะล็อกอื่นทั้งโปรเจกต์
import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { JIG_STATUSES, STATUS_META, normStatus, validateStatusForm } from './jigStatus';

// canPreview แยกจากสิทธิ์แจ้งสถานะโดยตั้งใจ — ปุ่มดูผลกระทบยิง POST /schedule/replan
// ซึ่งเป็น writeRoles (ADMIN/PLANNER) ส่วน MFG แจ้ง jig พังได้แต่ไม่ใช่คนรันแผน
// ถ้าโชว์ปุ่มให้ MFG จะได้ 403 ทุกครั้ง (และไม่ควรเปิด /schedule/replan ให้ MFG เพื่อแก้ —
// endpoint นั้นถือ mutex + markEdit ของการวางแผนจริง)
const JigStatusDialog = ({ show, jig, todayStr, busy, canPreview, onSave, onPreview, onHide }) => {
  const [form, setForm] = useState({ status: 'AVAILABLE', unavailable_from: '', unavailable_to: '', note: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!show || !jig) return;
    setForm({
      status: normStatus(jig.status),
      unavailable_from: jig.unavailable_from || '',
      unavailable_to: jig.unavailable_to || '',
      note: jig.note || '',
    });
    setError('');
  }, [show, jig]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isBack = normStatus(form.status) === 'AVAILABLE';

  const guard = (fn) => () => {
    const msg = validateStatusForm(form);
    setError(msg);
    if (!msg) fn(form);
  };

  return (
    <Modal show={show} onHide={busy ? undefined : onHide} centered>
      <Modal.Header closeButton={!busy}>
        <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
          <i className="bi bi-tools me-2" aria-hidden="true" />
          สถานะ Jig — {jig?.jig_id}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label className="small">สถานะ</Form.Label>
          <Form.Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {JIG_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </Form.Select>
        </Form.Group>

        {isBack ? (
          <div className="alert alert-success py-2 small mb-0">
            <i className="bi bi-check-circle-fill me-1" aria-hidden="true" />
            บันทึกว่าใช้งานได้แล้ว — ช่วงวันที่แจ้งไว้เดิมจะถูกล้างทิ้ง และงานที่ถูกเลื่อนเพราะ jig นี้
            จะกลับมาวางแผนได้ตามปกติเมื่อ Replan ครั้งถัดไป
          </div>
        ) : (
          <>
            <Row className="g-2 mb-2">
              <Col xs={6}>
                <Form.Label className="small">เริ่มใช้ไม่ได้</Form.Label>
                <Form.Control
                  type="date"
                  value={form.unavailable_from}
                  onChange={(e) => set('unavailable_from', e.target.value)}
                />
                <Form.Text muted>ไม่ระบุ = ตั้งแต่วันนี้ ({todayStr})</Form.Text>
              </Col>
              <Col xs={6}>
                <Form.Label className="small">กลับมาใช้ได้</Form.Label>
                <Form.Control
                  type="date"
                  value={form.unavailable_to}
                  onChange={(e) => set('unavailable_to', e.target.value)}
                />
                <Form.Text muted>ไม่ระบุ = ยังไม่รู้กำหนด</Form.Text>
              </Col>
            </Row>

            {/* กำหนดกลับสำคัญกว่าที่คนคาด — engine วนเฉพาะวันที่มีในปฏิทิน
                ไม่ระบุกำหนดกลับ = งานอาจหลุดออกจากแผนทั้งใบ ไม่ใช่แค่เลื่อน */}
            {!String(form.unavailable_to || '').trim() && (
              <div className="alert alert-warning py-2 small">
                <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true" />
                ยังไม่ระบุวันกลับมาใช้ได้ — งานที่ต้องใช้ jig นี้และไม่มีเครื่องอื่นทำแทนได้
                จะ<b>หลุดออกจากแผน</b> ไม่ใช่แค่เลื่อนวัน ถ้าพอรู้กำหนดคร่าว ๆ ให้ใส่ไว้ก่อน
              </div>
            )}

            <Form.Group className="mt-2">
              <Form.Label className="small">หมายเหตุ (ไม่บังคับ)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="เช่น ส่งซ่อมที่ร้าน / รออะไหล่"
              />
            </Form.Group>
          </>
        )}

        {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between">
        {canPreview ? (
          <Button variant="outline-secondary" onClick={guard(onPreview)} disabled={busy}>
            <i className="bi bi-graph-up-arrow me-1" aria-hidden="true" />
            ดูผลกระทบต่อแผน
          </Button>
        ) : (
          <span />
        )}
        <div>
          <Button variant="secondary" className="me-2" onClick={onHide} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={guard(onSave)} disabled={busy}>
            บันทึก
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default JigStatusDialog;
