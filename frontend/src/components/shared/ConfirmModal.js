import React from 'react';
import { Button, Modal } from 'react-bootstrap';
import PropTypes from 'prop-types';

// ไอคอนหัวเรื่องมาจาก variant ของปุ่มยืนยัน — ไม่ต้องใส่สัญลักษณ์ในข้อความ title
const ICON = {
  danger: { cls: 'bi-exclamation-octagon-fill', color: 'var(--mse-ng)' },
  warning: { cls: 'bi-exclamation-triangle-fill', color: 'var(--mse-warn)' },
  success: { cls: 'bi-check-circle-fill', color: 'var(--mse-ok)' },
  info: { cls: 'bi-info-circle-fill', color: 'var(--mse-info)' },
  primary: { cls: 'bi-question-circle-fill', color: 'var(--mse-primary)' },
};

/**
 * confirm dialog กลาง — รับ object เดียวชื่อ confirm ตามรูปแบบที่ทุกหน้าใช้อยู่แล้ว
 * { title, body, confirmLabel, variant, onConfirm }
 * ปิด dialog ก่อนเรียก onConfirm เสมอ (พฤติกรรมเดิมของหน้า Orders)
 */
const ConfirmModal = ({ confirm, onHide }) => {
  const icon = ICON[confirm?.variant] || ICON.primary;

  return (
    <Modal show={!!confirm} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }} className="d-flex align-items-center gap-2">
          <i className={`bi ${icon.cls}`} style={{ color: icon.color }} aria-hidden="true" />
          {confirm?.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ whiteSpace: 'pre-line' }}>{confirm?.body}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          ยกเลิก
        </Button>
        <Button
          variant={confirm?.variant || 'primary'}
          onClick={() => {
            const action = confirm?.onConfirm;
            onHide();
            if (action) action();
          }}
        >
          {confirm?.confirmLabel || 'ยืนยัน'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

ConfirmModal.propTypes = {
  confirm: PropTypes.shape({
    title: PropTypes.node,
    body: PropTypes.node,
    confirmLabel: PropTypes.string,
    variant: PropTypes.string,
    onConfirm: PropTypes.func,
  }),
  onHide: PropTypes.func.isRequired,
};

export default ConfirmModal;
