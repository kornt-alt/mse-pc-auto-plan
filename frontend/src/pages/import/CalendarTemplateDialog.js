// สร้างไฟล์ Calendar template — เลือกช่วงวันที่ + เครื่อง → gen ไฟล์ machine×date เติมวันให้ พร้อมกรอกเวลา
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Form, Row, Col, Spinner, Badge } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { TEMPLATE_SPECS, buildCalendarRows, downloadRows } from '../../utils/importTemplates';

// list วันที่ 'YYYY-MM-DD' ตั้งแต่ from ถึง to (inclusive) — เดินด้วย UTC กัน timezone เลื่อนวัน
const dateRange = (from, to) => {
  const out = [];
  if (!from || !to) return out;
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || d > end) return out;
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
};

const CalendarTemplateDialog = ({ show, onHide }) => {
  const spec = TEMPLATE_SPECS.calendar;
  const [machines, setMachines] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [defaultTime, setDefaultTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadMachines = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiCall('/production/machines');
      const list = data.data || [];
      setMachines(list);
      setSelected(new Set(list)); // default เลือกทั้งหมด
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (show) loadMachines();
  }, [show, loadMachines]);

  const toggle = (m) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  const dates = dateRange(fromDate, toDate);
  const selectedList = machines.filter((m) => selected.has(m));
  const totalRows = dates.length * selectedList.length;
  const canGen = totalRows > 0 && totalRows <= 20000;

  const handleGenerate = () => {
    const rows = buildCalendarRows(selectedList, dates, defaultTime === '' ? '' : Number(defaultTime));
    downloadRows(spec, rows);
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          <i className="bi bi-calendar-range me-2" aria-hidden="true" />
          สร้างไฟล์ Calendar
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <Row className="g-2 mb-3">
          <Col xs={6} md={4}>
            <Form.Label className="small mb-1">วันที่เริ่ม</Form.Label>
            <Form.Control type="date" size="sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Col>
          <Col xs={6} md={4}>
            <Form.Label className="small mb-1">วันที่สิ้นสุด</Form.Label>
            <Form.Control type="date" size="sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Col>
          <Col xs={6} md={4}>
            <Form.Label className="small mb-1">เวลา (นาที) เริ่มต้น</Form.Label>
            <Form.Control
              type="number"
              size="sm"
              placeholder="เว้นว่าง = กรอกเอง"
              value={defaultTime}
              onChange={(e) => setDefaultTime(e.target.value)}
            />
          </Col>
        </Row>

        <div className="d-flex align-items-center justify-content-between mb-1">
          <Form.Label className="small mb-0">เครื่องจักร ({selectedList.length}/{machines.length})</Form.Label>
          <div className="d-flex gap-2">
            <Button size="sm" variant="link" className="p-0" onClick={() => setSelected(new Set(machines))}>
              เลือกทั้งหมด
            </Button>
            <Button size="sm" variant="link" className="p-0" onClick={() => setSelected(new Set())}>
              ล้าง
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="text-center py-3">
            <Spinner size="sm" animation="border" />
          </div>
        ) : (
          <div className="d-flex flex-wrap gap-2 border rounded p-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
            {machines.map((m) => (
              <Form.Check
                key={m}
                type="checkbox"
                id={`cal-mc-${m}`}
                label={m}
                checked={selected.has(m)}
                onChange={() => toggle(m)}
              />
            ))}
            {machines.length === 0 && <span className="text-muted small">ไม่พบเครื่องจักร</span>}
          </div>
        )}

        <div className="mt-3 small">
          {totalRows > 0 ? (
            <Badge bg={canGen ? 'primary' : 'danger'}>
              {dates.length} วัน × {selectedList.length} เครื่อง = {totalRows.toLocaleString()} แถว
            </Badge>
          ) : (
            <span className="text-muted">เลือกช่วงวันที่และเครื่องจักรอย่างน้อย 1 เครื่อง</span>
          )}
          {totalRows > 20000 && <span className="text-danger ms-2">มากเกินไป (จำกัด 20,000 แถว)</span>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>ยกเลิก</Button>
        <Button className="btn-mse" disabled={!canGen} onClick={handleGenerate}>
          <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
          สร้างไฟล์
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default CalendarTemplateDialog;
