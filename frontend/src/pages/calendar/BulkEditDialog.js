// ตั้งค่าเวลาแบบกลุ่ม — port _showBulkEditCalendarDialog (calendar_screen.dart L690-859)
// เลือกช่วงวัน + machine (เว้นว่าง = ทุกเครื่อง) + available_time
//
// ⚠️ ไม่ได้ยิง PUT /calendar/bulk_update แล้ว — ไดอะล็อกกาง (เครื่อง × วัน) เป็น cells เองแล้วให้
// หน้าเพจยิง PUT /calendar/cells (upsert ตัวเดียวกับกริด) เพราะ bulk_update เป็น UPDATE อย่างเดียว
// ช่วงวันที่ยังไม่มีแถวใน calendar_config จึงเคยได้ updated_count = 0 แบบเงียบ ๆ
//
// การจับคู่ชื่อเครื่องย้ายมาอยู่ฝั่ง client ทั้งหมด (เดิม backend เทียบ `machine = @machine` แบบ
// exact กับข้อความที่พิมพ์เอง — พิมพ์ไม่ครบ = แก้ 0 แถว) จึงเป็นดรอปดาวน์จากรายการจริงแทน
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import {
  expandDateRange,
  rangeDayCount,
  excludeDates,
  buildBulkCells,
  MAX_CELLS_PER_REQUEST,
  MAX_RANGE_DAYS,
} from './calendarMatrix';

const BulkEditDialog = ({
  show,
  onHide,
  onSubmit,
  machines = [],      // ตัวเลือกในดรอปดาวน์ (รวมเครื่องที่มีแถวปฏิทินค้างแต่ไม่อยู่ใน machine_config)
  activeMachines = [], // ตัวที่ "ทุกเครื่อง" กางออก — machine_config เท่านั้น
  holidayDates = new Set(),
}) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [machine, setMachine] = useState('');
  const [time, setTime] = useState('0'); // default ปิดเครื่อง = 0 เหมือนเดิม
  const [includeHolidays, setIncludeHolidays] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (show) {
      setStartDate('');
      setEndDate('');
      setMachine('');
      setTime('0');
      setIncludeHolidays(false);
      setError('');
    }
  }, [show]);

  // เครื่องที่จะโดนจริง — ⚠️ ช่องว่าง = activeMachines ไม่ใช่ machines
  // machines เป็น union ที่รวมเครื่องซึ่งถูกถอดออกจาก routing ไปแล้วแต่ยังมีแถวปฏิทินค้างอยู่
  // (ดู buildMatrix ใน calendarMatrix.js) สมัยเป็น UPDATE-only ไม่มีพิษเพราะแตะได้แค่แถวที่มีอยู่
  // แต่ตอนนี้เป็น upsert — "ทุกเครื่อง" จะไปสร้างแถวใหม่ให้เครื่องที่เลิกใช้แล้วยาวตลอดช่วง
  // POST /calendar/generate เลี่ยงเรื่องนี้ด้วยการอ่าน machine_config ตรง ๆ เหมือนกัน
  const targetMachines = useMemo(
    () => (machine ? [machine] : activeMachines),
    [machine, activeMachines]
  );

  // พรีวิวผลกระทบ — คำนวณสดทุกครั้งที่แก้ฟอร์ม เพื่อไม่ให้เกิดเคส "กดแล้วเงียบ" อีก
  const preview = useMemo(() => {
    const dayCount = rangeDayCount(startDate, endDate);
    if (dayCount === 0) return null;
    if (dayCount > MAX_RANGE_DAYS) return { tooWide: true, dayCount };

    const allDates = expandDateRange(startDate, endDate);
    const dates = includeHolidays ? allDates : excludeDates(allDates, holidayDates);
    return {
      tooWide: false,
      dayCount,
      usableDays: dates.length,
      skipped: allDates.length - dates.length,
      machineCount: targetMachines.length,
      cellCount: targetMachines.length * dates.length,
      dates,
    };
  }, [startDate, endDate, includeHolidays, holidayDates, targetMachines]);

  const handleSave = () => {
    if (!startDate || !endDate) {
      setError('กรุณาเลือกวันที่ให้ครบ');
      return;
    }
    if (startDate > endDate) {
      setError('วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด');
      return;
    }
    if (!preview) {
      setError('วันที่ไม่ถูกต้อง');
      return;
    }
    if (preview.tooWide) {
      setError(`ช่วงนี้กว้าง ${preview.dayCount} วัน เกิน ${MAX_RANGE_DAYS} วันต่อครั้ง — แบ่งเป็นสองช่วง`);
      return;
    }
    if (preview.machineCount === 0) {
      setError('ยังไม่มีข้อมูลเครื่องจักร');
      return;
    }
    if (preview.cellCount === 0) {
      setError('ช่วงนี้ไม่มีวันให้แก้ (เป็นวันหยุดทั้งช่วง) — ติ๊ก "รวมวันหยุด" ถ้าต้องการสั่ง OT');
      return;
    }
    if (preview.cellCount > MAX_CELLS_PER_REQUEST) {
      setError(
        `ช่วงนี้ = ${preview.cellCount} ช่อง เกิน ${MAX_CELLS_PER_REQUEST} ช่องต่อครั้ง — แบ่งเป็นสองช่วง หรือเลือกทีละเครื่อง`
      );
      return;
    }

    const value = parseFloat(time);
    if (!Number.isFinite(value) || value < 0) {
      setError('เวลาต้องเป็นตัวเลขและไม่ติดลบ');
      return;
    }

    onHide();
    onSubmit(buildBulkCells(targetMachines, preview.dates, value));
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }} className="text-mse fw-bold">
          <i className="bi bi-calendar-range me-2" aria-hidden="true" />
          ตั้งค่าเวลาแบบกลุ่ม
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="warning" className="py-2">
            {error}
          </Alert>
        )}
        {/* controlId ผูก label เข้ากับ input ให้เอง — ทั้ง screen reader และเทสอ่านได้ */}
        <Form.Group className="mb-2" controlId="bulk-start-date">
          <Form.Label>วันที่เริ่มต้น*</Form.Label>
          <Form.Control
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Form.Group>
        <Form.Group className="mb-3" controlId="bulk-end-date">
          <Form.Label>วันที่สิ้นสุด*</Form.Label>
          <Form.Control type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Form.Group>
        <hr />
        <Form.Group className="mb-2" controlId="bulk-machine">
          <Form.Label>Machine</Form.Label>
          <Form.Select value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">ทุกเครื่อง ({activeMachines.length} เครื่อง)</option>
            {machines.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-2" controlId="bulk-time">
          <Form.Label>Available Time [min]*</Form.Label>
          <Form.Control
            type="number"
            min="0"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Form.Group>
        <Form.Check
          type="checkbox"
          id="bulk-include-holidays"
          label="รวมวันหยุดด้วย (Master Holiday)"
          checked={includeHolidays}
          onChange={(e) => setIncludeHolidays(e.target.checked)}
        />

        {/* พรีวิวจำนวนช่องที่จะโดน — ตัวที่บอกล่วงหน้าว่ากดแล้วจะเกิดอะไรขึ้นจริง ๆ */}
        {preview && !preview.tooWide && (
          <div className="mt-3 p-2 rounded" style={{ background: 'var(--mse-surface-2, #f5f5f5)' }}>
            <div className="fw-bold">
              <i className="bi bi-info-circle me-1" aria-hidden="true" />
              จะมีผล {preview.machineCount} เครื่อง × {preview.usableDays} วัน ={' '}
              <span className="num">{preview.cellCount}</span> ช่อง
            </div>
            {preview.skipped > 0 && (
              <div className="text-secondary" style={{ fontSize: 'var(--fs-meta)' }}>
                ข้ามวันหยุด {preview.skipped} วัน
              </div>
            )}
            <div className="text-secondary" style={{ fontSize: 'var(--fs-meta)' }}>
              ช่องที่ยังไม่มีในปฏิทินจะถูกสร้างให้
            </div>
          </div>
        )}
        {preview && preview.tooWide && (
          <div className="chip chip-warn mt-3">
            ช่วงกว้าง {preview.dayCount} วัน เกิน {MAX_RANGE_DAYS} วันต่อครั้ง
          </div>
        )}
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
