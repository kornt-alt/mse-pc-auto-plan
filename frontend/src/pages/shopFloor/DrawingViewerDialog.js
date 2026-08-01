import React, { useState, useEffect } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { API_BASE } from '../../api/client';

// Drawing Viewer — port จาก _openDrawingViewer (shop_floor_screen.dart L475-584)
// เดิมใช้ SfPdfViewer + URL hardcode 127.0.0.1:8000 → ใช้ <iframe> ชี้ /drawings/{model}.pdf
// (zoom ใช้ของ PDF viewer ใน browser) — ไฟล์เสิร์ฟจาก DRAWINGS_DIR ฝั่ง Express
const DrawingViewerDialog = ({ show, model, onHide }) => {
  const [notFound, setNotFound] = useState(false);
  const [checked, setChecked] = useState(false);

  const base = API_BASE.replace(/\/api$/, '');
  const pdfUrl = `${base}/drawings/${encodeURIComponent(model || '')}.pdf`;

  useEffect(() => {
    if (!show || !model) return;
    setChecked(false);
    setNotFound(false);
    // เช็คก่อนว่ามีไฟล์จริง — ไม่เจอโชว์ dialog แจ้ง (เหมือน onDocumentLoadFailed เดิม)
    fetch(pdfUrl, { method: 'HEAD' })
      .then((res) => setNotFound(!res.ok))
      .catch(() => setNotFound(true))
      .finally(() => setChecked(true));
  }, [show, model, pdfUrl]);

  if (!show) return null;

  if (checked && notFound) {
    return (
      <Modal show centered onHide={onHide}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.05rem' }}>
            <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
            ไม่พบไฟล์แบบงาน
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ whiteSpace: 'pre-line' }}>
          {`หาไฟล์ของโมเดล ${model} ไม่เจอใน Server ครับ\n\n(Path: ${pdfUrl})`}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>
            OK
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }

  return (
    <Modal show fullscreen onHide={onHide} contentClassName="bg-dark">
      <Modal.Header closeButton closeVariant="white" className="bg-dark text-white py-2">
        <Modal.Title style={{ fontSize: '1rem' }}>
          <i className="bi bi-rulers me-2" aria-hidden="true" />
          แบบงาน: {model}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-0">
        {checked && (
          <iframe
            src={pdfUrl}
            title={`Drawing ${model}`}
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        )}
      </Modal.Body>
    </Modal>
  );
};

export default DrawingViewerDialog;
