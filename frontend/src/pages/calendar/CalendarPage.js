// Calendar — port จาก OLD_BACKUP/frontend/lib/screens/calendar_screen.dart
// ตารางไม่โหลดอัตโนมัติ (ค้นหาก่อน), แก้เวลารายแถว/แบบกลุ่ม, สร้างปฏิทินทั้งเดือน,
// จัดการ Master Holiday, ปุ่ม Replan เปิดเมื่อ hasChanges
// FIX ที่จงใจแก้:
//   - ปุ่ม Replan มี confirm dialog ก่อนรัน (user เลือก 2026-07-17 — เดิมรันทันที)
//   - bulk update ตั้ง hasChanges ด้วย (เดิมลืม — แก้เวลาแบบกลุ่มแล้วปุ่ม Replan ไม่เปิด)
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Button, Form, Table, Spinner, Modal, InputGroup,
} from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { usePlanData } from '../../context/PlanDataContext';
import PageHeader from '../../components/shared/PageHeader';
import Toolbar from '../../components/shared/Toolbar';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import ConfirmModal from '../../components/shared/ConfirmModal';
import BulkEditDialog from './BulkEditDialog';
import GenerateCalendarDialog from './GenerateCalendarDialog';
import HolidayManagerDialog from './HolidayManagerDialog';

const pad2 = (n) => String(n).padStart(2, '0');
const currentYear = () => String(new Date().getFullYear());
const currentMonth = () => pad2(new Date().getMonth() + 1);

const MONTHS = [
  { val: '01', name: 'JAN' }, { val: '02', name: 'FEB' }, { val: '03', name: 'MAR' },
  { val: '04', name: 'APR' }, { val: '05', name: 'MAY' }, { val: '06', name: 'JUN' },
  { val: '07', name: 'JUL' }, { val: '08', name: 'AUG' }, { val: '09', name: 'SEP' },
  { val: '10', name: 'OCT' }, { val: '11', name: 'NOV' }, { val: '12', name: 'DEC' },
];

// ปี -2 ถึง +7 จากปีปัจจุบัน (เหมือน _years เดิม)
const YEARS = Array.from({ length: 10 }, (_, i) => String(new Date().getFullYear() - 2 + i));

const CalendarPage = () => {
  const [searchMachine, setSearchMachine] = useState('');
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [tableData, setTableData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isReplanning, setIsReplanning] = useState(false);

  const [editRow, setEditRow] = useState(null); // {id, machine, date} — modal แก้เวลารายแถว
  const [editTime, setEditTime] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showHoliday, setShowHoliday] = useState(false);
  const [confirm, setConfirm] = useState(null); // {title, body, confirmLabel, variant, onConfirm}

  const navigate = useNavigate();
  const { setFromRunResponse } = usePlanData();

  const { toast, showToast, hideToast } = useToast();
  const showErrorToast = useCallback((msg) => showToast(msg, 'danger'), [showToast]);

  const fetchCalendarData = useCallback(
    async (machine, year, month) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ machine, year, month });
        const data = await apiCall(`/calendar?${params.toString()}`);
        setTableData(data);
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  const refresh = useCallback(
    () => fetchCalendarData(searchMachine, selectedYear, selectedMonth),
    [fetchCalendarData, searchMachine, selectedYear, selectedMonth]
  );

  // เปลี่ยนเงื่อนไขค้นหา = เคลียร์ตาราง (เหมือนเดิม — บังคับกดค้นหาใหม่)
  const handleMachineChange = (value) => {
    setSearchMachine(value);
    setTableData([]);
  };
  const handleMonthChange = (value) => {
    setSelectedMonth(value);
    setTableData([]);
  };
  const handleYearChange = (value) => {
    setSelectedYear(value);
    setTableData([]);
  };

  const filtersDirty =
    searchMachine !== '' || selectedMonth !== currentMonth() || selectedYear !== currentYear();

  const handleClear = () => {
    setSearchMachine('');
    setSelectedYear(currentYear());
    setSelectedMonth(currentMonth());
    fetchCalendarData('', currentYear(), currentMonth());
  };

  // ===== แก้เวลารายแถว (PUT /calendar/:id) =====
  const openEditDialog = (row) => {
    setEditRow(row);
    setEditTime(String(row.available_time ?? '0'));
  };

  const saveEditTime = async () => {
    const newTime = parseFloat(editTime);
    const row = editRow;
    setEditRow(null);
    if (!row || Number.isNaN(newTime)) return;
    setIsLoading(true);
    try {
      await apiCall(`/calendar/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({ available_time: newTime }),
      });
      await refresh();
      setHasChanges(true);
      showToast('อัปเดตเวลาแล้ว กดปุ่ม Replan เพื่อคำนวณแผนใหม่', 'warning');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setIsLoading(false);
    }
  };

  // ===== แก้เวลาแบบกลุ่ม (PUT /calendar/bulk_update) =====
  const handleBulkUpdate = useCallback(
    async (payload) => {
      setIsLoading(true);
      try {
        await apiCall('/calendar/bulk_update', { method: 'PUT', body: JSON.stringify(payload) });
        await refresh();
        setHasChanges(true); // FIX: เดิมไม่ set — bulk ก็เปลี่ยน capacity เหมือนแก้รายแถว
        showToast('อัปเดตเวลาแบบกลุ่มแล้ว');
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        setIsLoading(false);
      }
    },
    [refresh, showToast]
  );

  // ===== สร้างปฏิทินทั้งเดือน (POST /calendar/generate) =====
  const handleGenerate = useCallback(
    async (payload) => {
      setIsLoading(true);
      try {
        const data = await apiCall('/calendar/generate', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        await refresh();
        showToast(`สร้างปฏิทินแล้ว เพิ่มข้อมูลใหม่ ${data.created_records ?? 0} แถว`);
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        setIsLoading(false);
      }
    },
    [refresh, showToast]
  );

  // ===== Replan (POST /schedule/replan) — สำเร็จแล้วพุ่งไปหน้า Planning เหมือนเดิม =====
  const runReplan = async () => {
    setIsReplanning(true);
    showToast('กำลังคำนวณ Replan รอสักครู่...', 'info');
    try {
      const decoded = await apiCall('/schedule/replan', { method: 'POST' });
      setHasChanges(false);
      setFromRunResponse(decoded.data ?? [], decoded.report ?? []);
      navigate('/planning');
    } catch (err) {
      const msg = String(err.message || err);
      showToast(msg, msg.includes('กำลังทำงานอยู่') ? 'warning' : 'danger');
    } finally {
      setIsReplanning(false);
    }
  };

  const handleReplan = () => {
    // FIX: เดิมรันทันที — user เลือกเพิ่ม confirm dialog (เหมือนหน้า Orders)
    setConfirm({
      title: 'ยืนยันการรัน Replan',
      body: 'ระบบจะคำนวณแผนการผลิตใหม่ทั้งหมด (ล็อกเวลาเฉพาะออเดอร์ FIXED)\n\nต้องการดำเนินการต่อหรือไม่?',
      confirmLabel: 'ยืนยัน Replan',
      variant: 'info',
      onConfirm: runReplan,
    });
  };

  return (
    <Container fluid className="pb-4">
      <PageHeader
        icon="bi-calendar-range"
        title="Calendar"
        subtitle="กำหนดเวลาทำงานที่ใช้ได้ของเครื่องจักรรายวัน"
        actions={
          <>
            {hasChanges && (
              <span className="chip chip-warn">
                <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
                แก้ไขแล้วยังไม่ได้คำนวณแผนใหม่
              </span>
            )}
            <Button
              variant={hasChanges ? 'warning' : 'secondary'}
              disabled={!hasChanges || isReplanning}
              onClick={handleReplan}
            >
              {isReplanning ? (
                <>
                  <Spinner size="sm" animation="border" className="me-1" /> กำลังประมวลผล...
                </>
              ) : (
                <>
                  <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" /> Replan
                </>
              )}
            </Button>
          </>
        }
      />

      {/* ===== toolbar ===== */}
      <Toolbar>
        <span className="fw-bold">Machine</span>
        <InputGroup style={{ maxWidth: 180 }}>
          <Form.Control
            size="sm"
            placeholder="เช่น NL9..."
            value={searchMachine}
            onChange={(e) => handleMachineChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && refresh()}
          />
        </InputGroup>

        <span className="fw-bold">เดือน</span>
        <Form.Select
          size="sm"
          style={{ maxWidth: 100 }}
          value={selectedMonth}
          onChange={(e) => handleMonthChange(e.target.value)}
        >
          {MONTHS.map((m) => (
            <option key={m.val} value={m.val}>
              {m.name}
            </option>
          ))}
        </Form.Select>

        <span className="fw-bold">ปี</span>
        <Form.Select
          size="sm"
          style={{ maxWidth: 100 }}
          value={selectedYear}
          onChange={(e) => handleYearChange(e.target.value)}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Form.Select>

        <Button size="sm" className="btn-mse" onClick={refresh}>
          <i className="bi bi-search me-1" aria-hidden="true" />
          ค้นหา
        </Button>
        <Button size="sm" variant="info" className="text-white" onClick={() => setShowBulk(true)}>
          <i className="bi bi-calendar-range me-1" aria-hidden="true" />
          ตั้งค่าแบบกลุ่ม
        </Button>
        <Button size="sm" variant="success" onClick={() => setShowGenerate(true)}>
          <i className="bi bi-calendar-plus me-1" aria-hidden="true" />
          สร้างปฏิทิน
        </Button>
        <Button size="sm" variant="warning" onClick={() => setShowHoliday(true)}>
          <i className="bi bi-calendar-event me-1" aria-hidden="true" />
          วันหยุดประจำปี
        </Button>
        {filtersDirty && (
          <Button size="sm" variant="outline-secondary" onClick={handleClear}>
            ล้างค่า
          </Button>
        )}
      </Toolbar>

      {/* ===== ตาราง ===== */}
      <div style={{ position: 'relative' }}>
        {tableData.length === 0 && !isLoading ? (
          <div className="empty-state">
            <i className="bi bi-calendar-x" aria-hidden="true" />
            <div>พิมพ์ชื่อเครื่องจักรแล้วกดค้นหา</div>
            <div className="small">ถ้าค้นแล้วไม่พบข้อมูล แปลว่ายังไม่ได้สร้างปฏิทินของเดือนนั้น</div>
          </div>
        ) : (
          <Table bordered hover size="sm" style={{ maxWidth: 720 }}>
            <thead className="table-light">
              <tr>
                <th>Machine</th>
                <th>Date</th>
                <th>AvailableTime [min]</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((row) => (
                <tr key={row.id}>
                  <td>{row.machine ?? '-'}</td>
                  <td className="num">{row.date ?? '-'}</td>
                  <td
                    role="button"
                    onClick={() => row.id && openEditDialog(row)}
                    title="คลิกเพื่อแก้ไข"
                  >
                    <span className="fw-bold text-mse num">{row.available_time ?? 0}</span>{' '}
                    <i className="bi bi-pencil-square text-secondary ms-1" aria-hidden="true" />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {isLoading && (
          <div
            className="d-flex align-items-center justify-content-center"
            style={{
              position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)', minHeight: 120,
            }}
          >
            <Spinner animation="border" className="text-mse" />
          </div>
        )}
      </div>

      {/* ===== dialog แก้เวลารายแถว ===== */}
      <Modal show={!!editRow} onHide={() => setEditRow(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>
            แก้ไขเวลา: {editRow?.machine}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-2">วันที่: {editRow?.date}</div>
          <Form.Group>
            <Form.Label>Available Time [min]</Form.Label>
            <Form.Control
              type="number"
              value={editTime}
              autoFocus
              onChange={(e) => setEditTime(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveEditTime()}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditRow(null)}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={saveEditTime}>
            บันทึก
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ===== dialogs ===== */}
      <BulkEditDialog show={showBulk} onHide={() => setShowBulk(false)} onSubmit={handleBulkUpdate} />
      <GenerateCalendarDialog
        show={showGenerate}
        onHide={() => setShowGenerate(false)}
        onSubmit={handleGenerate}
      />
      <HolidayManagerDialog
        show={showHoliday}
        onHide={() => setShowHoliday(false)}
        onError={showErrorToast}
      />

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default CalendarPage;
