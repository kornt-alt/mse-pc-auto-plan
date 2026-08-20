// Calendar — grid เครื่อง × วัน ของทั้งเดือน (เดิมเป็น list แบน 3 คอลัมน์ที่ต้องค้นทีละเครื่อง)
// port ตั้งต้นมาจาก OLD_BACKUP/frontend/lib/screens/calendar_screen.dart
// FIX ที่จงใจแก้:
//   - ปุ่ม Replan มี confirm dialog ก่อนรัน (user เลือก 2026-07-17 — เดิมรันทันที)
//   - bulk update ตั้ง hasChanges ด้วย (เดิมลืม — แก้เวลาแบบกลุ่มแล้วปุ่ม Replan ไม่เปิด)
//   - โหลดเดือนปัจจุบันทันทีที่เปิดหน้า (เดิมต้องพิมพ์ชื่อเครื่องแล้วกดค้นหาก่อนถึงจะเห็นอะไร)
//   - ช่อง Machine กลายเป็นตัวกรองฝั่ง client ไม่ยิง API ใหม่และไม่ล้างตารางทิ้ง
//   - ไดอะล็อก "ตั้งค่าแบบกลุ่ม" สร้างแถวที่ยังไม่มีได้ + ข้ามวันหยุดให้โดยดีฟอลต์
//
// การเขียนค่าใช้ PUT /calendar/cells (upsert) ทุกทาง — ทั้งแก้ช่องเดียว ลากเลือกหลายช่อง และ
// ไดอะล็อกตั้งค่าแบบกลุ่ม เพราะเป็นทางเดียวที่แก้ช่องซึ่ง "ยังไม่มีแถวใน calendar_config" ได้
// (PUT /calendar/:id ต้องมี id อยู่ก่อน, PUT /calendar/bulk_update เป็น UPDATE อย่างเดียว)
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Button, Form, Spinner, InputGroup } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { usePlanData } from '../../context/PlanDataContext';
import PageHeader from '../../components/shared/PageHeader';
import Toolbar from '../../components/shared/Toolbar';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import ConfirmModal from '../../components/shared/ConfirmModal';
import BulkEditDialog from './BulkEditDialog';
import GenerateCalendarDialog from './GenerateCalendarDialog';
import HolidayManagerDialog from './HolidayManagerDialog';
import CalendarGrid from './CalendarGrid';
import {
  buildMonthDays,
  buildMatrix,
  filterMachines,
  summarizeSelection,
  toCellsPayload,
  holidayDateSet,
} from './calendarMatrix';
import './calendar.css';

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

  const [calendarRows, setCalendarRows] = useState([]);
  const [machineList, setMachineList] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isReplanning, setIsReplanning] = useState(false);

  const [selection, setSelection] = useState([]);
  const [bulkValue, setBulkValue] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showHoliday, setShowHoliday] = useState(false);
  const [confirm, setConfirm] = useState(null); // {title, body, confirmLabel, variant, onConfirm}

  const navigate = useNavigate();
  const { setFromRunResponse } = usePlanData();

  const { toast, showToast, hideToast } = useToast();
  const showErrorToast = useCallback((msg) => showToast(msg, 'danger'), [showToast]);

  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }, []);
  // MFG เข้าหน้านี้ได้แต่ดูอย่างเดียว (backend กัน write ไว้ที่ ADMIN/PLANNER อยู่แล้ว = ด่านจริง)
  const canEdit = !!currentUser && ['ADMIN', 'PLANNER'].includes(currentUser.role);

  // ===== โหลดข้อมูล =====
  // ⚠️ month ต้อง zero-pad เสมอ — GET /calendar ทำ `date LIKE 'YYYY-MM-%'` กับสตริง 'YYYY-MM-DD'
  //    ส่ง month=8 จะได้ 0 แถวแบบเงียบ ๆ (ค่าจาก <Form.Select> เป็น '08' อยู่แล้ว)
  const loadAll = useCallback(
    async (year, month) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ year, month });
        const [cal, machines, holi] = await Promise.all([
          apiCall(`/calendar?${params.toString()}`),
          apiCall('/production/machines'),
          apiCall('/holiday'),
        ]);
        setCalendarRows(Array.isArray(cal) ? cal : []);
        setMachineList(Array.isArray(machines?.data) ? machines.data : []);
        setHolidays(Array.isArray(holi) ? holi : []);
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  const refresh = useCallback(
    () => loadAll(selectedYear, selectedMonth),
    [loadAll, selectedYear, selectedMonth]
  );

  // โหลดทันทีที่เปิดหน้า และทุกครั้งที่เปลี่ยนเดือน/ปี
  useEffect(() => {
    loadAll(selectedYear, selectedMonth);
  }, [loadAll, selectedYear, selectedMonth]);

  // เปลี่ยนเดือน/ปี/ตัวกรอง = ล้างสิ่งที่เลือกค้างไว้
  // (anchor/focus เป็น index ของชุดที่แสดงอยู่ ถ้าไม่ล้างจะชี้ไปยังลิสต์ที่ไม่มีอยู่แล้ว)
  useEffect(() => {
    setSelection([]);
  }, [searchMachine, selectedYear, selectedMonth]);

  // ===== ข้อมูลที่ derive จาก state (ตรรกะอยู่ใน calendarMatrix.js ทั้งหมด) =====
  const days = useMemo(
    () => buildMonthDays(selectedYear, selectedMonth, holidays),
    [selectedYear, selectedMonth, holidays]
  );
  const { machines: allMachines, cellByKey } = useMemo(
    () => buildMatrix(calendarRows, machineList),
    [calendarRows, machineList]
  );
  const machines = useMemo(
    () => filterMachines(allMachines, searchMachine),
    [allMachines, searchMachine]
  );
  const selectionInfo = useMemo(
    () => summarizeSelection(selection, cellByKey),
    [selection, cellByKey]
  );
  // วันหยุดทุกปี (GET /holiday ไม่กรองปี) — ไดอะล็อกตั้งค่าแบบกลุ่มเลือกช่วงข้ามเดือนได้จึงต้องใช้ชุดเต็ม
  // ไม่ใช่ `days` ที่กรองเฉพาะเดือนที่แสดงอยู่
  const holidayDates = useMemo(() => holidayDateSet(holidays), [holidays]);

  const filtersDirty =
    searchMachine !== '' || selectedMonth !== currentMonth() || selectedYear !== currentYear();

  const handleClear = () => {
    setSearchMachine('');
    setSelectedYear(currentYear());
    setSelectedMonth(currentMonth());
  };

  // ===== เขียนค่า (PUT /calendar/cells — upsert) =====
  const saveCells = useCallback(
    async (cells, successMsg) => {
      setIsLoading(true);
      try {
        const data = await apiCall('/calendar/cells', {
          method: 'PUT',
          body: JSON.stringify({ cells }),
        });
        await refresh();
        setHasChanges(true);
        const created = data?.inserted ? ` (สร้างใหม่ ${data.inserted} ช่อง)` : '';
        showToast(`${successMsg}${created} — กดปุ่ม Replan เพื่อคำนวณแผนใหม่`, 'warning');
        return true;
      } catch (err) {
        showToast(err.message, 'danger');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [refresh, showToast]
  );

  const handleCommitCell = useCallback(
    (machine, date, value) =>
      saveCells([{ machine, date, available_time: value }], `อัปเดต ${machine} วันที่ ${date} แล้ว`),
    [saveCells]
  );

  const handleApplySelection = async () => {
    const value = parseFloat(bulkValue);
    if (Number.isNaN(value) || value < 0) {
      showToast('ใส่เวลาเป็นตัวเลขไม่ติดลบก่อน', 'warning');
      return;
    }
    const ok = await saveCells(
      toCellsPayload(selection, value),
      `ตั้งค่า ${selection.length} ช่องเป็น ${value} นาทีแล้ว`
    );
    if (ok) {
      setSelection([]);
      setBulkValue('');
    }
  };

  // ===== ตั้งค่าเวลาแบบกลุ่ม — ไดอะล็อกกาง (เครื่อง × วัน) มาแล้ว ที่นี่แค่ยืนยันแล้วเขียน =====
  // ใช้ saveCells ตัวเดียวกับกริด (PUT /calendar/cells) ทางเขียนจึงมีทางเดียวจริง ๆ
  const handleBulkApply = useCallback(
    (cells) => {
      const write = () =>
        saveCells(cells, `ตั้งค่าเวลาแบบกลุ่ม ${cells.length} ช่องแล้ว`);

      // ช่วงกว้าง ๆ ยืนยันอีกชั้น — ดีฟอลต์ของไดอะล็อกคือ 0 นาที เผลอกดทีเดียวได้ทั้งไตรมาส
      if (cells.length > 500) {
        setConfirm({
          title: 'ยืนยันการตั้งค่าแบบกลุ่ม',
          body: `จะเขียนทับเวลาที่ใช้ได้ ${cells.length} ช่อง (ช่องที่ยังไม่มีในปฏิทินจะถูกสร้างให้)\n\nต้องการดำเนินการต่อหรือไม่?`,
          confirmLabel: 'ยืนยัน',
          variant: 'warning',
          onConfirm: write,
        });
        return;
      }
      write();
    },
    [saveCells]
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

  // ปิดหน้าต่างวันหยุดแล้วโหลดใหม่ — วันหยุดมีผลกับการไฮไลต์คอลัมน์ในตาราง
  const closeHoliday = useCallback(() => {
    setShowHoliday(false);
    refresh();
  }, [refresh]);

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
            {canEdit && (
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
            )}
          </>
        }
      />

      {/* ===== toolbar ===== */}
      <Toolbar>
        <span className="fw-bold">Machine</span>
        <InputGroup style={{ maxWidth: 180 }}>
          <Form.Control
            size="sm"
            placeholder="กรองชื่อเครื่อง..."
            value={searchMachine}
            onChange={(e) => setSearchMachine(e.target.value)}
          />
        </InputGroup>

        <span className="fw-bold">เดือน</span>
        <Form.Select
          size="sm"
          style={{ maxWidth: 100 }}
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
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
          onChange={(e) => setSelectedYear(e.target.value)}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Form.Select>

        <Button size="sm" className="btn-mse" onClick={refresh} title="โหลดข้อมูลใหม่">
          <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
          รีเฟรช
        </Button>
        {canEdit && (
          <>
            {/* กันเปิดตอนยังโหลดไม่เสร็จ — machineList ยังว่าง ดรอปดาวน์จะขึ้น "ทุกเครื่อง (0 เครื่อง)"
                แล้วเด้งข้อความว่าไม่มีข้อมูลเครื่องจักร ซึ่งไม่จริง */}
            <Button
              size="sm"
              variant="info"
              className="text-white"
              disabled={isLoading}
              onClick={() => setShowBulk(true)}
            >
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
          </>
        )}
        {filtersDirty && (
          <Button size="sm" variant="outline-secondary" onClick={handleClear}>
            ล้างค่า
          </Button>
        )}
        <Toolbar.End>
          <span className="text-secondary" style={{ fontSize: 'var(--fs-meta)' }}>
            {machines.length} เครื่อง · {days.length} วัน
          </span>
        </Toolbar.End>
      </Toolbar>

      {/* ===== แถบเลือกหลายช่อง ===== */}
      {selection.length > 0 && (
        <div className="cal-selection-bar">
          <span className="fw-bold">
            <i className="bi bi-check2-square me-1" aria-hidden="true" />
            เลือกอยู่ {selectionInfo.count} ช่อง
          </span>
          {selectionInfo.missing > 0 && (
            <span className="chip chip-warn">
              ยังไม่มีในปฏิทิน {selectionInfo.missing} ช่อง (จะถูกสร้างให้)
            </span>
          )}
          <InputGroup size="sm" style={{ maxWidth: 200 }}>
            <Form.Control
              type="number"
              min="0"
              // ทุกช่องที่เลือกมีค่าเท่ากันอยู่แล้ว → โชว์ค่านั้นเป็น placeholder ให้รู้ว่ากำลังแก้จากอะไร
              placeholder={
                selectionInfo.sameValue === null
                  ? 'เวลา [นาที]'
                  : `เดิม ${selectionInfo.sameValue} นาที`
              }
              aria-label="เวลาที่ใช้ได้ของช่องที่เลือก"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplySelection()}
            />
            <Button className="btn-mse" onClick={handleApplySelection}>
              ตั้งค่า
            </Button>
          </InputGroup>
          <Button size="sm" variant="outline-secondary" onClick={() => setSelection([])}>
            ยกเลิกการเลือก
          </Button>
        </div>
      )}

      {/* ===== ตาราง ===== */}
      <div style={{ position: 'relative' }}>
        {machines.length === 0 && !isLoading ? (
          <div className="empty-state">
            <i className="bi bi-calendar-x" aria-hidden="true" />
            <div>
              {allMachines.length === 0
                ? 'ยังไม่มีข้อมูลเครื่องจักร'
                : 'ไม่พบเครื่องที่ตรงกับตัวกรอง'}
            </div>
            <div className="small">
              {allMachines.length === 0
                ? 'ตรวจว่าอัปโหลด machine_config แล้วหรือยัง'
                : 'ลองล้างช่องกรองชื่อเครื่อง'}
            </div>
          </div>
        ) : (
          <>
            {calendarRows.length === 0 && !isLoading && (
              <div className="chip chip-warn mb-2">
                <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
                เดือนนี้ยังไม่มีปฏิทิน — กด &quot;สร้างปฏิทิน&quot; หรือใส่เลขในช่องที่ต้องการได้เลย
              </div>
            )}
            <CalendarGrid
              days={days}
              machines={machines}
              cellByKey={cellByKey}
              canEdit={canEdit}
              selection={selection}
              onSelectionChange={setSelection}
              onCommitCell={handleCommitCell}
            />
            <div className="text-secondary mt-2" style={{ fontSize: 'var(--fs-meta)' }}>
              {canEdit ? (
                <>
                  <i className="bi bi-info-circle me-1" aria-hidden="true" />
                  คลิกช่องเพื่อแก้เลข · ลากคลุมเพื่อเลือกหลายช่อง · คลิกหัวคอลัมน์ = ทั้งวัน ·
                  คลิกชื่อเครื่อง = ทั้งเดือน · Esc = ยกเลิก · &quot;—&quot; คือวันที่ยังไม่มีในปฏิทิน
                </>
              ) : (
                <>
                  <i className="bi bi-eye me-1" aria-hidden="true" />
                  สิทธิ์ของคุณดูได้อย่างเดียว
                </>
              )}
            </div>
          </>
        )}
        {isLoading && (
          <div
            className="d-flex align-items-center justify-content-center"
            style={{
              position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)', minHeight: 120,
              zIndex: 5,
            }}
          >
            <Spinner animation="border" className="text-mse" />
          </div>
        )}
      </div>

      {/* ===== dialogs ===== */}
      <BulkEditDialog
        show={showBulk}
        onHide={() => setShowBulk(false)}
        onSubmit={handleBulkApply}
        machines={allMachines}
        activeMachines={machineList}
        holidayDates={holidayDates}
      />
      <GenerateCalendarDialog
        show={showGenerate}
        onHide={() => setShowGenerate(false)}
        onSubmit={handleGenerate}
      />
      <HolidayManagerDialog show={showHoliday} onHide={closeHoliday} onError={showErrorToast} />

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default CalendarPage;
