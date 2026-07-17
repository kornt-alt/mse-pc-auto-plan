// ตั้งค่าเวลาแบบกลุ่ม — port _showBulkEditCalendarDialog (calendar_screen.dart L690-859)
// เลือกช่วงวัน + machine (เว้นว่าง = ทุกเครื่อง) + available_time → PUT /calendar/bulk_update
import React, { useState, useEffect } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';

const BulkEditDialog = ({ show, onHide, onSubmit }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [machine, setMachine] = useState('');
  const [time, setTime] = useState('0'); // default ปิดเครื่อง = 0 เหมือนเดิม
  const [error, setError] = useState('');

  useEffect(() => {
    if (show) {
      setStartDate('');
      setEndDate('');
      setMachine('');
      setTime('0');
      setError('');
    }
  }, [show]);

  const handleSave = () => {
    if (!startDate || !endDate) {
      setError('⚠️ กรุณาเลือกวันที่ให้ครบ!');
      return;
    }
    if (startDate > endDate) {
      setError('⚠️ วันที่เริ่มต้น ต้องมาก่อนวันที่สิ้นสุด!');
      return;
    }
    onHide();
    onSubmit({
      start_date: startDate,
      end_date: endDate,
      machine: machine.trim() || null, // เว้นว่าง → null (Optional[str] เดิม)
      available_time: parseFloat(time) || 0.0,
    });
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }} className="text-mse fw-bold">
          🗓️ ตั้งค่าเวลาแบบกลุ่ม
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="warning" className="py-2">
            {error}
          </Alert>
        )}
        <Form.Group className="mb-2">
          <Form.Label>วันที่เริ่มต้น*</Form.Label>
          <Form.Control
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>วันที่สิ้นสุด*</Form.Label>
          <Form.Control type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Form.Group>
        <hr />
        <Form.Group className="mb-2">
          <Form.Label>Machine (เว้นว่าง = เปลี่ยนทุกเครื่อง)</Form.Label>
          <Form.Control value={machine} onChange={(e) => setMachine(e.target.value)} />
        </Form.Group>
        <Form.Group>
          <Form.Label>Available Time [min]*</Form.Label>
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
        <Button className="btn-mse" onClick={handleSave}>
          บันทึก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default BulkEditDialog;
