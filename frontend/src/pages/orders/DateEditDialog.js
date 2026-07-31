import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Spinner } from 'react-bootstrap';

// กล่องเลือกวันที่ใช้ร่วมกัน — Material Ready / Confirm / Release
// props: show, title, label, icon, batch, currentValue, onHide, onSubmit(value) => Promise
// onSubmit ส่งค่า 'YYYY-MM-DD' หรือ '' (ล้างค่า) — parent เป็นคนยิง API
const DateEditDialog = ({ show, title, label, icon, batch, currentValue, onHide, onSubmit }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (show) {
      setValue(currentValue ? String(currentValue).slice(0, 10) : '');
      setSaving(false);
    }
  }, [show, currentValue]);

  const submit = async (nextValue) => {
    setSaving(true);
    try {
      await onSubmit(nextValue);
    } finally {
      setSaving(false);
    }
  };

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
        <Form.Group>
          <Form.Label>{label}</Form.Label>
          <Form.Control
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-danger" onClick={() => submit('')} disabled={saving} className="me-auto">
          <i className="bi bi-x-circle me-1" aria-hidden="true" /> ล้างค่า
        </Button>
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={() => submit(value)} disabled={saving || !value}>
          {saving ? <Spinner animation="border" size="sm" className="me-1" /> : <i className="bi bi-check-lg me-1" aria-hidden="true" />}
          บันทึก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DateEditDialog;
