// สร้างปฏิทินอัตโนมัติทั้งเดือน — port _showGenerateCalendarDialog (calendar_screen.dart L900-1031)
// เลือกเดือน/ปี + เวลาตั้งต้น → POST /calendar/generate (วันหยุดใน Master Holiday = 0 อัตโนมัติ)
import React, { useState, useEffect } from 'react';
import { Modal, Form, Button, Row, Col } from 'react-bootstrap';

const pad2 = (n) => String(n).padStart(2, '0');

const GenerateCalendarDialog = ({ show, onHide, onSubmit }) => {
  const [month, setMonth] = useState(pad2(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [time, setTime] = useState('1240'); // default เดิม

  // ปีปัจจุบันถึง +5, เดือน 01-12 (เหมือนเดิม)
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() + i));
  const months = Array.from({ length: 12 }, (_, i) => pad2(i + 1));

  useEffect(() => {
    if (show) {
      setMonth(pad2(new Date().getMonth() + 1));
      setYear(String(new Date().getFullYear()));
      setTime('1240');
    }
  }, [show]);

  const handleSave = () => {
    onHide();
    onSubmit({
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      default_time: parseInt(time, 10) || 1240,
    });
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }} className="text-success fw-bold">
          <i className="bi bi-calendar-plus me-2" aria-hidden="true" />
          สร้างปฏิทินอัตโนมัติ
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">
          ระบบจะดึงรายชื่อเครื่องจักรทั้งหมดมาสร้างตารางเวลาในเดือนที่คุณเลือกโดยอัตโนมัติ
        </p>
        <Row className="mb-3">
          <Col>
            <Form.Group>
              <Form.Label>เดือน</Form.Label>
              <Form.Select value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    เดือน {m}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col>
            <Form.Group>
              <Form.Label>ปี</Form.Label>
              <Form.Select value={year} onChange={(e) => setYear(e.target.value)}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    ปี {y}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
        <Form.Group>
          <Form.Label>เวลาทำงานตั้งต้น [min]*</Form.Label>
          <Form.Control
            type="number"
            min="0"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          ยกเลิก
        </Button>
        <Button variant="success" onClick={handleSave}>
          <i className="bi bi-calendar-plus me-1" aria-hidden="true" />
          สร้างปฏิทิน
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default GenerateCalendarDialog;
