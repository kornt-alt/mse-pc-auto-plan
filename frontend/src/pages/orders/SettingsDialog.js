import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Form, Spinner, Row, Col } from 'react-bootstrap';
import { apiCall } from '../../api/client';

// ตั้งค่า scheduler (ตาราง system_settings แถวเดียว) — ADMIN/PLANNER
// props: show, onHide, onSaved(msg), onError(msg)
const NUMS = [
  { key: 'pack_window_days', label: 'ช่วงรวมออเดอร์ (วัน)', hint: 'ยิ่งมาก ยิ่งมัดรวมออเดอร์ที่ due ใกล้กันเป็นก้อนเดียว' },
  { key: 'min_fragment_time', label: 'เวลาขั้นต่ำต่อวัน (นาที)', hint: 'เวลาว่างต่ำกว่านี้ในหนึ่งวันจะไม่ถูกใช้' },
  { key: 'switch_penalty_minutes', label: 'ค่าปรับเปลี่ยนเครื่อง (นาที)', hint: 'ยอมช้ากว่านี้เพื่ออยู่เครื่องเดิม' },
  { key: 'minor_setup_time', label: 'Setup ย่อย (นาที)', hint: 'setup ที่ลดลงเมื่อใช้ jig เดิม' },
  // max_overlap_percentage มีคอลัมน์ใน DB แต่ engine ระบบใหม่ยังไม่ใช้ (port rule 12) — ไม่โชว์ให้แก้
  // เพื่อไม่ให้เข้าใจผิดว่าปรับแล้วมีผล; ค่ายัง round-trip ผ่าน form เดิมโดยไม่ถูกแตะ
];
const BOOLS = [
  { key: 'enable_heat_deep_plan', label: 'วางแผน Heat แบบเจาะลึก (Deep Plan)' },
  { key: 'enable_stickiness', label: 'พยายามอยู่เครื่องเดิม (Stickiness)' },
];

const SettingsDialog = ({ show, onHide, onSaved, onError }) => {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('/system/settings');
      setForm(data);
    } catch (err) {
      onError(err.message);
      onHide();
    } finally {
      setLoading(false);
    }
  }, [onError, onHide]);

  useEffect(() => {
    if (show) {
      load();
    } else {
      // เคลียร์ตอนปิด กันค่าเก่าแว้บตอนเปิดใหม่ก่อน load() จะเซ็ตค่าใหม่
      setForm(null);
      setLoading(false);
    }
  }, [show, load]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiCall('/system/settings', { method: 'PUT', body: JSON.stringify(form) });
      onSaved('บันทึกการตั้งค่าเรียบร้อย — สั่ง Replan เพื่อให้มีผลกับแผน');
      onHide();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={saving ? undefined : onHide} centered>
      <Modal.Header closeButton={!saving}>
        <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
          <i className="bi bi-sliders me-2" aria-hidden="true" />
          ตั้งค่าการวางแผน (Scheduler)
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading || !form ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
          </div>
        ) : (
          <Form>
            <Row>
              {NUMS.map((f) => (
                <Col xs={12} sm={6} key={f.key} className="mb-3">
                  <Form.Label className="mb-1">{f.label}</Form.Label>
                  <Form.Control
                    type="number"
                    step={f.step || 1}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    disabled={saving}
                  />
                  <Form.Text muted>{f.hint}</Form.Text>
                </Col>
              ))}
            </Row>
            <hr />
            {BOOLS.map((f) => (
              <Form.Check
                key={f.key}
                type="switch"
                id={`set-${f.key}`}
                label={f.label}
                checked={!!form[f.key]}
                onChange={(e) => setField(f.key, e.target.checked)}
                disabled={saving}
                className="mb-2"
              />
            ))}
          </Form>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={handleSave} disabled={saving || loading || !form}>
          {saving ? <Spinner animation="border" size="sm" className="me-1" /> : <i className="bi bi-check-lg me-1" aria-hidden="true" />}
          บันทึก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SettingsDialog;
