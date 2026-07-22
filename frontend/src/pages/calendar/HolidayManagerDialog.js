// จัดการวันหยุดประจำปี (Master Holiday) — port _showHolidayManagerDialog
// (calendar_screen.dart L1064-1274): ฟอร์มเพิ่ม (auto ชื่อ Sat/Sun/Traditional ตามวันในสัปดาห์)
// + รายการวันหยุดพร้อมปุ่มลบ
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Form, Button, Row, Col, Spinner, ListGroup } from 'react-bootstrap';
import { apiCall } from '../../api/client';

const HolidayManagerDialog = ({ show, onHide, onError }) => {
  const [holidays, setHolidays] = useState(null); // null = กำลังโหลด
  const [date, setDate] = useState('');
  const [desc, setDesc] = useState('');

  const loadHolidays = useCallback(async () => {
    try {
      setHolidays(await apiCall('/holiday'));
    } catch (err) {
      setHolidays([]);
      if (onError) onError(err.message);
    }
  }, [onError]);

  useEffect(() => {
    if (show) {
      setHolidays(null);
      setDesc('');
      loadHolidays();
      // date คงค่าที่เลือกล่าสุดไว้ (เหมือน _lastSelectedHolidayDate เดิม)
    }
  }, [show, loadHolidays]);

  // เลือกวันแล้วเติมชื่ออัตโนมัติ: เสาร์=Sat, อาทิตย์=Sun, อื่นๆ=Traditional (เหมือนเดิม)
  const handleDateChange = (e) => {
    const v = e.target.value;
    setDate(v);
    if (v) {
      const weekday = new Date(`${v}T00:00:00`).getDay(); // 0=อาทิตย์, 6=เสาร์
      setDesc(weekday === 6 ? 'Sat' : weekday === 0 ? 'Sun' : 'Traditional');
    }
  };

  const handleAdd = async () => {
    if (!date || !desc.trim()) return;
    try {
      await apiCall('/holiday', {
        method: 'POST',
        body: JSON.stringify({ date, description: desc }),
      });
      setDesc('');
      loadHolidays();
    } catch (err) {
      if (onError) onError(err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await apiCall(`/holiday/${id}`, { method: 'DELETE' });
      loadHolidays();
    } catch (err) {
      if (onError) onError(err.message);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          <i className="bi bi-calendar-event me-2" aria-hidden="true" />
          จัดการวันหยุดประจำปี
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* ฟอร์มเพิ่มวันหยุด */}
        <div className="border rounded p-3 mb-3" style={{ background: 'var(--mse-warn-bg)' }}>
          <div className="fw-bold text-warning-emphasis mb-2">
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            เพิ่มวันหยุดใหม่
          </div>
          <Row className="g-2 mb-2">
            <Col>
              <Form.Control type="date" value={date} onChange={handleDateChange} />
            </Col>
            <Col>
              <Form.Control
                placeholder="ชื่อวันหยุด*"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </Col>
          </Row>
          <Button
            size="sm"
            variant="warning"
            disabled={!date || !desc.trim()}
            onClick={handleAdd}
          >
            บันทึกวันหยุด
          </Button>
        </div>

        {/* รายการวันหยุด */}
        <div className="fw-bold mb-2">รายการวันหยุดที่บันทึกไว้</div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {holidays === null ? (
            <div className="text-center py-4">
              <Spinner animation="border" size="sm" />
            </div>
          ) : holidays.length === 0 ? (
            <div className="text-center text-muted py-4">ยังไม่มีข้อมูลวันหยุด</div>
          ) : (
            <ListGroup variant="flush">
              {holidays.map((h) => (
                <ListGroup.Item
                  key={h.id}
                  className="d-flex align-items-center justify-content-between py-2"
                >
                  <div className="d-flex align-items-center gap-2">
                    <i className="bi bi-calendar-check text-success" aria-hidden="true" />
                    <div>
                      <div className="fw-bold">{h.description}</div>
                      <div className="text-muted small">{h.date}</div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    title="ลบวันหยุด"
                    aria-label={`ลบวันหยุด ${h.description}`}
                    onClick={() => handleDelete(h.id)}
                  >
                    <i className="bi bi-trash" aria-hidden="true" />
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          ปิดหน้าต่าง
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default HolidayManagerDialog;
