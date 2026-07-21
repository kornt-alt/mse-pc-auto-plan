// Calendar — port จาก OLD_BACKUP/frontend/lib/screens/calendar_screen.dart
// ตารางไม่โหลดอัตโนมัติ (ค้นหาก่อน), แก้เวลารายแถว/แบบกลุ่ม, สร้างปฏิทินทั้งเดือน,
// จัดการ Master Holiday, ปุ่ม Replan เปิดเมื่อ hasChanges
// FIX ที่จงใจแก้:
//   - ปุ่ม Replan มี confirm dialog ก่อนรัน (user เลือก 2026-07-17 — เดิมรันทันที)
//   - bulk update ตั้ง hasChanges ด้วย (เดิมลืม — แก้เวลาแบบกลุ่มแล้วปุ่ม Replan ไม่เปิด)
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Button, Form, Table, Spinner, Modal, Toast, ToastContainer, InputGroup,
} from 'react-bootstrap';
import { Search, Pencil, CalendarRange, Sparkles, PartyPopper, RefreshCw } from 'lucide-react';
import { apiCall } from '../../api/client';
import { usePlanData } from '../../context/PlanDataContext';
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
  const [toast, setToast] = useState(null); // {message, variant}

  const navigate = useNavigate();
  const { setFromRunResponse } = usePlanData();

  const showToast = useCallback((message, variant = 'success') => {
    setToast({ message, variant });
  }, []);
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
      showToast('✅ อัปเดตเวลาสำเร็จ! กรุณากดปุ่ม Replan เพื่ออัปเดตแผนผลิต', 'warning');
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
        showToast('✅ อัปเดตเวลาสำเร็จ!');
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
        showToast(`✅ สร้างปฏิทินสำเร็จ! เพิ่มข้อมูลใหม่ ${data.created_records ?? 0} แถว`);
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
      {/* ===== toolbar ===== */}
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
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
          <Search size={14} className="me-1" />
          ค้นหา
        </Button>
        <Button size="sm" variant="info" className="text-white" onClick={() => setShowBulk(true)}>
          <CalendarRange size={14} className="me-1" />
          ตั้งค่าแบบกลุ่ม
        </Button>
        <Button size="sm" variant="success" onClick={() => setShowGenerate(true)}>
          <Sparkles size={14} className="me-1" />
          สร้างปฏิทิน
        </Button>
        <Button size="sm" variant="warning" onClick={() => setShowHoliday(true)}>
          <PartyPopper size={14} className="me-1" />
          Master Holiday
        </Button>
        {filtersDirty && (
          <Button size="sm" variant="secondary" onClick={handleClear}>
            ล้างค่า
          </Button>
        )}

        <div className="ms-auto d-flex align-items-center gap-2">
          {hasChanges && (
            <span className="text-danger fw-bold">⚠️ กรุณากดปุ่ม</span>
          )}
          <Button
            size="sm"
            disabled={!hasChanges || isReplanning}
            onClick={handleReplan}
            style={
              hasChanges && !isReplanning
                ? { backgroundColor: '#f57c00', borderColor: '#f57c00' }
                : {}
            }
          >
            {isReplanning ? (
              <>
                <Spinner size="sm" animation="border" className="me-1" /> กำลังประมวลผล...
              </>
            ) : (
              <>
                <RefreshCw size={14} className="me-1" /> Replan
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ===== ตาราง ===== */}
      <div style={{ position: 'relative' }}>
        {tableData.length === 0 && !isLoading ? (
          <div className="text-center mt-5">
            <h5 className="text-secondary fw-bold">
              กรุณาพิมพ์ชื่อ Machine แล้วกดค้นหา 🔍 (ปฏิทินอาจยังไม่ได้ทำ)
            </h5>
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
                  <td>{row.date ?? '-'}</td>
                  <td
                    role="button"
                    onClick={() => row.id && openEditDialog(row)}
                    title="คลิกเพื่อแก้ไข"
                  >
                    <span className="fw-bold text-primary">{row.available_time ?? 0}</span>{' '}
                    <Pencil size={14} className="text-secondary ms-1" />
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

      {/* ===== confirm modal ===== */}
      <Modal show={!!confirm} onHide={() => setConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>{confirm?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ whiteSpace: 'pre-line' }}>{confirm?.body}</Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            ยกเลิก
          </Button>
          <Button
            variant={confirm?.variant || 'primary'}
            onClick={() => {
              const action = confirm?.onConfirm;
              setConfirm(null);
              if (action) action();
            }}
          >
            {confirm?.confirmLabel || 'ยืนยัน'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ===== toast ===== */}
      <ToastContainer position="bottom-end" className="p-3" style={{ position: 'fixed', zIndex: 2000 }}>
        <Toast show={!!toast} onClose={() => setToast(null)} delay={3500} autohide bg={toast?.variant}>
          <Toast.Body className={toast?.variant === 'warning' ? '' : 'text-white'}>
            {toast?.message}
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </Container>
  );
};

export default CalendarPage;
