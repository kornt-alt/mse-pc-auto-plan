import React, { useCallback, useState } from 'react';
import { Toast, ToastContainer } from 'react-bootstrap';
import PropTypes from 'prop-types';

// ไอคอนนำหน้าข้อความมาจาก variant ที่เดียว — หน้าอื่นไม่ต้องใส่สัญลักษณ์ในสตริงเอง
const ICON = {
  success: 'bi-check-circle-fill',
  danger: 'bi-x-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
};

/**
 * state ของ toast + ตัวสั่งแสดง
 * showToast/hideToast ห่อ useCallback ไว้ — reference ต้องนิ่ง เพราะถูกส่งต่อเข้า dialog
 * (callback ที่เปลี่ยนทุก render ทำให้ useEffect init ของ dialog ยิงซ้ำแล้วฟอร์มรีเซ็ตกลางคัน)
 */
export const useToast = () => {
  const [toast, setToast] = useState(null);

  const showToast = useCallback(
    (message, variant = 'success') => setToast({ message, variant }),
    [],
  );

  const hideToast = useCallback(() => setToast(null), []);

  return { toast, showToast, hideToast };
};

const ToastHost = ({ toast, onClose, delay = 3500 }) => (
  <ToastContainer position="bottom-end" className="p-3" style={{ position: 'fixed', zIndex: 2000 }}>
    <Toast show={!!toast} onClose={onClose} delay={delay} autohide bg={toast?.variant}>
      <Toast.Body className={toast?.variant === 'warning' ? '' : 'text-white'}>
        <span className="d-flex align-items-start gap-2">
          <i className={`bi ${ICON[toast?.variant] || ICON.success} mt-1`} aria-hidden="true" />
          <span>{toast?.message}</span>
        </span>
      </Toast.Body>
    </Toast>
  </ToastContainer>
);

ToastHost.propTypes = {
  toast: PropTypes.shape({
    message: PropTypes.node,
    variant: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
  delay: PropTypes.number,
};

export default ToastHost;
