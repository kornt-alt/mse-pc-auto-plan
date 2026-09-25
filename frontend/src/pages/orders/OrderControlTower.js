import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Table, Button, Form, Spinner, Badge, InputGroup,
} from 'react-bootstrap';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { apiCall } from '../../api/client';
import { usePlanData } from '../../context/PlanDataContext';
import PageHeader from '../../components/shared/PageHeader';
import Toolbar from '../../components/shared/Toolbar';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import ConfirmModal from '../../components/shared/ConfirmModal';
import OrderFormDialog from './OrderFormDialog';
import TrackingDialog from './TrackingDialog';
import HistoryDialog from './HistoryDialog';
import DateEditDialog from './DateEditDialog';
import SettingsDialog from './SettingsDialog';
import PlanPreviewDialog from './PlanPreviewDialog';
import CalendarHorizonAlert from '../../components/shared/CalendarHorizonAlert';
import LastRunAlert from './LastRunAlert';
import PlanRunsDialog from './PlanRunsDialog';
import { buildPlanDiff, computeSortByDueDate } from './planDiff';
import { buildPlanDetail, buildMachineSchedule } from './planDetail';
import OrderFilterPanel from './OrderFilterPanel';
import {
  EMPTY_FILTERS, dateFilterActive, countActiveDateFilters, matchOrderDates,
} from './orderFilters';
import { exportXlsx, stampedFilename } from '../../utils/xlsxExport';
import { effectiveArrived } from './planRules';

// meta ของกล่องแก้วันที่ตามชนิด — endpoint / คีย์ body / label
const DATE_EDIT_META = {
  // logKinds: กล่อง Material โชว์ประวัติรวมกับการติ๊ก "Mat'l เข้า" (kind material_arrived) — เรื่องวัตถุดิบเดียวกัน
  material: { endpoint: 'material-date', bodyKey: 'material_ready_date', title: 'วันMaterial เข้า (Material Ready)', label: 'เลือกวันที่Material เข้า', icon: 'bi-box-seam', logKinds: 'material,material_arrived' },
  confirm: { endpoint: 'confirm-date', bodyKey: 'confirm_reply_date', title: 'วัน Confirm ส่งมอบ (VIP)', label: 'เลือกวัน Confirm', icon: 'bi-star-fill' },
  release: { endpoint: 'release-date', bodyKey: 'release_date', title: 'วัน Release งาน', label: 'เลือกวัน Release', icon: 'bi-calendar-check' },
  // ปกติระบบเติมวัน Issue ให้เองตอนรันแผน (start_date ถอยหลังตามจำนวนวันของโมเดล)
  // กล่องนี้คือการแก้มือทับ ซึ่งตั้งธง issue_date_manual กันไม่ให้ replan รอบหน้าทับกลับ
  issue: { endpoint: 'issue-date', bodyKey: 'issue_date', title: 'วัน Issue', label: 'เลือกวัน Issue', icon: 'bi-file-earmark-text' },
};

// ===== helpers =====
const todayMidnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const dueDateInfo = (dueDateStr) => {
  if (!dueDateStr) return { className: '', icon: null };
  const due = new Date(String(dueDateStr).slice(0, 10));
  if (Number.isNaN(due.getTime())) return { className: '', icon: null };
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - todayMidnight()) / 86400000);
  if (diffDays < 0) return { className: 'text-danger fw-bold', icon: 'overdue' };
  if (diffDays <= 2) return { className: 'fw-bold', icon: 'near', style: { color: 'var(--mse-warn)' } };
  return { className: '', icon: null };
};

const formatWip = (wip) => {
  if (!wip || ['-', '0', 'null'].includes(String(wip))) return '-';
  return String(wip);
};

const shortDate = (v) => (v ? String(v).slice(0, 10) : '-');

// issue_date_manual มาจาก DDL รันมือ — ไม่มีคอลัมน์ = undefined = อัตโนมัติ (ไม่ใช่แก้มือ)
// DB คืน BIT เป็น true/false ส่วน JSON เก่า/ไฟล์เทสอาจเป็น 1/0 จึงรับทั้งสองแบบ
const isManualIssueDate = (order) =>
  order?.issue_date_manual === true || Number(order?.issue_date_manual) === 1;

// วันนี้เป็น string 'YYYY-MM-DD' โซนกรุงเทพ (UTC+7 คงที่ ไม่มี DST) — ให้ตรงกับ backend nowBangkok()
// ไม่ใช้เวลาเครื่อง (browser-local) กันเพี้ยนช่วงเที่ยงคืนถ้าเครื่องตั้ง timezone อื่น
const todayDateStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

// marker เล็ก ๆ บอกว่าช่องวันนี้มีประวัติการแก้/ไฟล์แนบกี่รายการ
const logMarker = (n) =>
  Number(n) > 0 ? (
    <i
      className="bi bi-clock-history ms-1 text-muted"
      title={`มีประวัติ/ไฟล์แนบ ${n} รายการ`}
      aria-label={`มีประวัติ/ไฟล์แนบ ${n} รายการ`}
      style={{ fontSize: '0.72rem' }}
    />
  ) : null;

// ⚠️ คอลัมน์ของไฟล์ export เขียนไว้ชัด ๆ ตรงนี้ **ห้าม derive จาก <th> ในตาราง** —
// คอลัมน์ drag handle / Action / Priority เป็นตัวควบคุมบนจอ ไม่ใช่ข้อมูล ถ้าไปดึงจากหัวตาราง
// ไฟล์จะมีคอลัมน์ว่างของปุ่มลากติดไปด้วย (ลำดับที่นี่คือลำดับที่ผู้ใช้เห็น ไม่ต้องตรงกับ <th> เป๊ะ)
const EXPORT_COLUMNS = [
  { key: 'batch', label: 'Batch ID' },
  { key: 'model', label: 'Model' },
  { key: 'description', label: 'Description' },
  { key: 'wip', label: 'WIP', value: (o) => formatWip(o.wip) },
  { key: 'planning_mode', label: 'Delivery mode', value: (o) => (o.planning_mode === 'backward' ? 'Backward' : 'Forward') },
  { key: 'qty', label: 'Qty' },
  { key: 'due_date', label: 'Due Date', value: (o) => shortDate(o.due_date) },
  { key: 'release_date', label: 'Release Date', value: (o) => shortDate(o.release_date) },
  { key: 'issue_date', label: 'Issue Date', value: (o) => shortDate(o.issue_date) },
  { key: 'issue_date_manual', label: 'Issue แก้มือ', value: (o) => (isManualIssueDate(o) ? 'ใช่' : '') },
  { key: 'material_ready_date', label: 'Material', value: (o) => shortDate(o.material_ready_date) },
  { key: 'confirm_reply_date', label: 'Confirm', value: (o) => shortDate(o.confirm_reply_date) },
  { key: 'start_date', label: 'Start', value: (o) => shortDate(o.start_date) },
  { key: 'fg_date', label: 'FG', value: (o) => shortDate(o.fg_date) },
  { key: 'program_notes', label: 'หมายเหตุ' },
  { key: 'priority', label: 'Priority' },
];

// แผน "ค้าง" ถ้ามีการแก้ไขหลังวางแผนล่าสุด (เทียบ string 'YYYY-MM-DD HH:MM:SS')
const isPlanOutdated = (lastPlan, lastEdit) => {
  if (lastEdit === '-') return false;
  if (lastPlan === '-') return true;
  return lastEdit > lastPlan;
};

// ===== แถวตาราง (sortable) =====
const SortableRow = ({ order, today, dragLocked, datesLocked, canPlan, canEditDates, canEditMaterial, onEdit, onClose, onDelete, onTracking, onMissingAlert, onEditDate, onToggleArrived }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: order.batch,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    backgroundColor: order.isReadyToClose ? 'rgba(40, 167, 69, 0.15)' : undefined,
    opacity: isDragging ? 0.6 : 1,
  };

  const due = dueDateInfo(order.due_date);

  return (
    <tr ref={setNodeRef} style={style}>
      <td className="text-center align-middle">
        <span
          {...attributes}
          {...listeners}
          title={!canPlan ? 'ไม่มีสิทธิ์จัดลำดับ' : dragLocked ? 'ล้างคำค้นหา/ตัวกรองก่อนจึงจะจัดลำดับได้' : 'ลากเพื่อจัดลำดับ'}
          style={{
            cursor: dragLocked ? 'not-allowed' : 'grab',
            color: dragLocked ? 'var(--mse-border)' : 'var(--mse-muted)',
          }}
        >
          <i className="bi bi-grip-vertical" aria-hidden="true" />
        </span>
      </td>
      <td className="text-nowrap">
        {canPlan && (<>
        <Button variant="link" size="sm" className="p-0 me-2 text-primary icon-btn" title="แก้ไข" aria-label="แก้ไข" onClick={() => onEdit(order)}>
          <i className="bi bi-pencil-square" aria-hidden="true" />
        </Button>
        <Button variant="link" size="sm" className="p-0 me-2 text-success icon-btn" title="ปิดจ๊อบ" aria-label="ปิดจ๊อบ" onClick={() => onClose(order)}>
          <i className="bi bi-check-circle" aria-hidden="true" />
        </Button>
        <Button variant="link" size="sm" className="p-0 text-danger icon-btn" title="ลบ" aria-label="ลบ" onClick={() => onDelete(order)}>
          <i className="bi bi-trash" aria-hidden="true" />
        </Button>
        </>)}
      </td>
      <td>
        <Button
          variant="link"
          size="sm"
          className="p-0 fw-bold text-decoration-underline num"
          onClick={() => onTracking(order.batch)}
        >
          {order.batch}
        </Button>
        {order.is_new ? <span className="chip chip-ng ms-1">ใหม่</span> : null}
      </td>
      <td>
        {order.model}
        {order.is_missing_routing ? (
          order.has_actual_master ? (
            <i
              className="bi bi-envelope-check text-success ms-1"
              title="Engineer จัดทำ Master เรียบร้อยแล้ว"
            />
          ) : !canPlan ? (
            <i className="bi bi-question-circle-fill text-warning ms-1" title="ยังไม่มี Routing" aria-hidden="true" />
          ) : (
            <Button
              variant="link"
              size="sm"
              className="p-0 ms-1 text-warning icon-btn"
              title="แจ้ง Engineer ว่ายังไม่มี Routing"
              aria-label="แจ้ง Engineer ว่ายังไม่มี Routing"
              onClick={() => onMissingAlert(order)}
            >
              <i className="bi bi-question-circle-fill" aria-hidden="true" />
            </Button>
          )
        ) : null}
      </td>
      <td className="text-truncate" style={{ maxWidth: 200 }} title={order.description || ''}>
        {order.description || '-'}
      </td>
      <td className="num">{formatWip(order.wip)}</td>
      <td>{order.planning_mode === 'backward' ? 'Backward' : 'Forward'}</td>
      <td className="num">{order.qty}</td>
      <td className={`num ${due.className}`} style={due.style}>
        {due.icon === 'overdue' && (
          <i className="bi bi-exclamation-triangle-fill me-1" title="เลยกำหนดส่ง" />
        )}
        {due.icon === 'near' && <i className="bi bi-clock-fill me-1" title="ใกล้ถึงกำหนดส่ง" />}
        {String(order.due_date || '').slice(0, 10)}
      </td>
       <td className="num">
        <Button
          variant="link"
          size="sm"
          className="p-0 text-decoration-none num"
          disabled={datesLocked}
          title={canEditMaterial ? 'แก้วัน Issue' : 'ดูประวัติวัน Issue'}
          onClick={() => onEditDate('issue', order)}
        >
          {shortDate(order.issue_date)}
        </Button>
        {/* ⚠️ ต้องเทียบค่าให้ชัด ไม่ใช่ truthy — เครื่องที่ยังไม่ได้รัน DDL จะไม่มีคีย์นี้ (undefined)
            ซึ่งต้องแปลว่า "อัตโนมัติ" ไม่ใช่ "แก้มือ" ไม่งั้นทุกแถวจะติดป้ายผิด */}
        {isManualIssueDate(order) && (
          <i
            className="bi bi-pencil-fill ms-1 text-muted"
            style={{ fontSize: '0.7em' }}
            title="แก้ด้วยมือ — จัดแผนรอบหน้าจะไม่ทับค่านี้"
            aria-hidden="true"
          />
        )}
        {logMarker(order.date_log_counts?.issue)}
      </td>
      <td className="num">
        <Button
          variant="link"
          size="sm"
          className={`p-0 text-decoration-none num ${order.release_date ? 'fw-bold text-mse' : 'text-muted'}`}
          disabled={datesLocked}
          title={canEditDates ? 'แก้วัน Release งาน' : 'ดูประวัติวัน Release'}
          onClick={() => onEditDate('release', order)}
        >
          {order.release_date ? shortDate(order.release_date) : '-'}
        </Button>
        {logMarker(order.date_log_counts?.release)}
      </td>
      <td className="num">
        <Button
          variant="link"
          size="sm"
          className="p-0 text-decoration-none num"
          disabled={datesLocked}
          title={canEditMaterial ? 'แก้วันMaterial เข้า (Material Ready)' : 'ดูประวัติวันMaterial เข้า'}
          onClick={() => onEditDate('material', order)}
        >
          {shortDate(order.material_ready_date)}
        </Button>
        {/* รวมจำนวนการติ๊ก "Mat'l เข้า" ด้วย เพราะกดเข้าไปแล้วเห็น timeline เดียวกัน */}
        {logMarker((Number(order.date_log_counts?.material) || 0)
          + (Number(order.date_log_counts?.material_arrived) || 0))}
      </td>
      <td className="num">
        <Button
          variant="link"
          size="sm"
          className={`p-0 text-decoration-none num ${order.confirm_reply_date ? 'fw-bold text-mse' : 'text-muted'}`}
          disabled={datesLocked}
          title={canEditDates ? 'แก้วัน Confirm ส่งมอบ (VIP)' : 'ดูประวัติวัน Confirm'}
          onClick={() => onEditDate('confirm', order)}
        >
          {order.confirm_reply_date ? shortDate(order.confirm_reply_date) : '-'}
        </Button>
        {logMarker(order.date_log_counts?.confirm)}
      </td>
      <td className="num">{shortDate(order.start_date)}</td>
      <td className="num">{shortDate(order.fg_date)}</td>
      <td className="text-center">
        {(() => {
          const ok = effectiveArrived(order, today);
          return (
            <Form.Select
              size="sm"
              value={ok ? 'ok' : 'notok'}
              disabled={datesLocked || !canEditMaterial}
              title={canEditMaterial
                ? 'Mat\'l OK = ยืนยันของเข้า (ปลดการรอ เริ่มได้เลย) · ยังไม่เข้า/ผิดปกติ = คงรอวันวัตถุดิบ'
                : 'ดูสถานะ Material เข้า'}
              aria-label="สถานะ Material เข้า"
              onChange={(e) => onToggleArrived(order, e.target.value === 'ok')}
              style={{
                minWidth: 120,
                fontWeight: 600,
                color: ok ? '#0f5132' : '#842029',
                borderColor: ok ? '#198754' : '#dc3545',
                backgroundColor: ok ? 'rgba(25,135,84,0.10)' : 'rgba(220,53,69,0.10)',
              }}
            >
              <option value="ok">Mat&apos;l OK</option>
              <option value="notok">ยังไม่เข้า/ผิดปกติ</option>
            </Form.Select>
          );
        })()}
        {order.program_notes === 'Please pull in material' && (
          <i
            className="bi bi-exclamation-triangle-fill text-danger ms-1"
            title="ดึงวัตถุดิบเข้า — วัตถุดิบยังไม่พร้อม/เข้าช้ากว่าวันเริ่มผลิต"
            aria-hidden="true"
          />
        )}
      </td>
      <td className="text-center">
        <Badge bg={(order.priority ?? 99) < 10 ? 'danger' : 'secondary'} pill>
          {order.priority ?? 99}
        </Badge>
      </td>
    </tr>
  );
};

// ===== หน้าหลัก Order Control Tower =====
const OrderControlTower = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilters, setDateFilters] = useState(EMPTY_FILTERS); // ตัวกรองช่วงวันที่ 6 คอลัมน์
  const [showFilters, setShowFilters] = useState(false); // เปิด/ปิดแผงตัวกรอง
  const [timestamps, setTimestamps] = useState({ last_plan: '-', last_edit: '-' });
  const [horizon, setHorizon] = useState(null);
  const [lastRun, setLastRun] = useState(null); // สรุปการรันแผนล่าสุดจาก plan_runs (null = ไม่มี/ยังไม่รัน DDL)
  const [showRuns, setShowRuns] = useState(false); // ไดอะล็อกประวัติแผน
  const [settings, setSettings] = useState(null); // system_settings — ใช้ทำ legend ใน preview

  // snapshot สำหรับ Undo — เก็บก่อนยืนยัน Replan/เรียง/บันทึกลำดับ
  const [previousOrderList, setPreviousOrderList] = useState(null);
  // baseline = สภาพ orders ตอนโหลดครั้งแรก (deep copy) ใช้เป็น snapshot ของ Replan
  const baselineRef = useRef(null);
  // สภาพ orders ก่อนเริ่มลากรอบนี้ (ใช้เป็น "ก่อน" ของ preview + snapshot Undo ของการบันทึกลำดับ)
  const preReorderRef = useRef(null);
  const [isPlanning, setIsPlanning] = useState(false);

  // มีการลากจัดลำดับที่ยังไม่บันทึก (optimistic ในจอ ยังไม่ persist)
  const [reorderDirty, setReorderDirty] = useState(false);
  // preview dialog: { mode:'replan'|'sort'|'drag'|'lock'|'unlock', loading, diff, detail, onConfirm }
  const [preview, setPreview] = useState(null);

  const navigate = useNavigate();
  const { setFromRunResponse } = usePlanData();

  const [formOrder, setFormOrder] = useState(undefined); // undefined=ปิด, null=สร้าง, object=แก้ไข
  const [trackingBatch, setTrackingBatch] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirm, setConfirm] = useState(null); // {title, body, confirmLabel, variant, onConfirm}
  const [dateEdit, setDateEdit] = useState(null); // { kind:'material'|'confirm'|'release', order }
  const [showSettings, setShowSettings] = useState(false);

  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }, []);
  const canManageSettings = !!currentUser && ['ADMIN', 'PLANNER'].includes(currentUser.role);
  // PCMC (=PLANNER) หรือ ADMIN เท่านั้นที่แก้/แนบวันได้ — MFG เปิดดูประวัติ+ดาวน์โหลดได้อย่างเดียว
  const canEditDates = !!currentUser && ['ADMIN', 'PLANNER'].includes(currentUser.role);
  // MC (Material Control) เข้าหน้านี้ได้แต่แก้ได้เฉพาะวัน material / Mat'l เข้า / วัน Issue (backend: orders.js materialRoles)
  const canEditMaterial = !!currentUser && ['ADMIN', 'PLANNER', 'MC'].includes(currentUser.role);
  // ปุ่มที่เปลี่ยนแผน/ออเดอร์ (เพิ่ม/แก้/ปิด/ลบ, ลากจัดลำดับ, Replan, เรียง Due, Undo) — backend guard ด้วย writeRoles อยู่แล้ว
  // ซ่อนไว้ไม่ให้ MC กดแล้วเจอแค่ 403
  const canPlan = canEditDates;
  const today = todayDateStr(); // คำนวณครั้งเดียวต่อ render แล้วส่งให้ทุกแถว (เลี่ยง Intl ต่อแถว)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { toast, showToast, hideToast } = useToast();

  // ต้อง stable — ถ้าเป็น inline function จะทำให้ useEffect ใน OrderFormDialog รีเซ็ตฟอร์มทุก re-render
  const showErrorToast = useCallback((msg) => showToast(msg, 'danger'), [showToast]);
  // stable onHide สำหรับ dialog ที่มี useEffect init ผูกกับ prop เหล่านี้
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeDateEdit = useCallback(() => setDateEdit(null), []);
  const onSettingsSaved = useCallback((msg) => {
    showToast(msg);
    apiCall('/system/settings').then(setSettings).catch(() => {}); // อัปเดต legend
  }, [showToast]);

  // 409 (มีการวางแผนซ้อน) → warning / อื่นๆ → danger
  const planErrorToast = useCallback(
    (err) => {
      const msg = String(err.message || err);
      showToast(msg, msg.includes('กำลังทำงานอยู่') ? 'warning' : 'danger');
    },
    [showToast],
  );

  // ปฏิทินเหลือถึงเมื่อไหร่ — เตือนก่อนงานจะเริ่มหลุด (capacity_warning เห็นตอนหลุดไปแล้ว)
  // เงียบถ้าดึงไม่ได้: เป็นคำเตือนเสริม ไม่ควรทำให้หน้าใช้ไม่ได้
  const fetchHorizon = useCallback(async () => {
    try {
      setHorizon(await apiCall('/system/calendar-horizon'));
    } catch {
      /* ไม่โชว์แถบเตือน */
    }
  }, []);

  // งานที่วางไม่ลงของแผนล่าสุด — เก็บใน plan_runs ฝั่ง backend จึงรอด refresh/คนอื่นเปิดหน้า
  // เงียบถ้าดึงไม่ได้ (503 = ยังไม่ได้รัน DDL): เป็นคำเตือนเสริม เหมือน fetchHorizon
  const fetchLastRun = useCallback(async () => {
    try {
      const runs = await apiCall('/schedule/runs?limit=1&detail=1');
      setLastRun(Array.isArray(runs) && runs.length > 0 ? runs[0] : null);
    } catch {
      setLastRun(null);
    }
  }, []);

  const fetchTimestamps = useCallback(async () => {
    try {
      const data = await apiCall('/system/timestamps');
      setTimestamps(data);
    } catch {
      /* แสดง '-' ต่อไป */
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('/orders');
      setOrders(data);
      if (!baselineRef.current || baselineRef.current.length === 0) {
        baselineRef.current = JSON.parse(JSON.stringify(data));
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchOrders();
    fetchTimestamps();
    fetchHorizon();
    fetchLastRun();
    // settings สำหรับ legend — เงียบถ้าดึงไม่ได้ (legend ใช้ค่า default แทน)
    apiCall('/system/settings').then(setSettings).catch(() => {});
  }, [fetchOrders, fetchTimestamps, fetchHorizon, fetchLastRun]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = orders;
    if (q) {
      list = list.filter(
        (o) =>
          String(o.batch || '').toLowerCase().includes(q) ||
          String(o.model || '').toLowerCase().includes(q) ||
          String(o.description || '').toLowerCase().includes(q)
      );
    }
    if (dateFilterActive(dateFilters)) {
      list = list.filter((o) => matchOrderDates(o, dateFilters));
    }
    return list;
  }, [orders, searchQuery, dateFilters]);

  const searchActive = searchQuery.trim() !== '';
  // ตัวกรองใด ๆ (ค้นหา หรือ วันที่) กำลังทำงาน → ล็อกการลากจัดลำดับ
  const filterActive = searchActive || dateFilterActive(dateFilters);
  const activeDateCount = countActiveDateFilters(dateFilters);

  const handleFilterChange = useCallback(
    (key, patch) => setDateFilters((f) => ({ ...f, [key]: { ...f[key], ...patch } })),
    []
  );
  const resetDateFilters = useCallback(() => setDateFilters(EMPTY_FILTERS), []);
  const outdated = isPlanOutdated(timestamps.last_plan, timestamps.last_edit);
  const maxPriority = orders.reduce((max, o) => Math.max(max, o.priority ?? 0), 0);

  // ===== drag reorder (optimistic ในจอ — ยังไม่ persist จนกว่าจะยืนยันใน preview) =====
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (!canPlan) return;
    if (filterActive) {
      showToast('กรุณาล้างคำค้นหา/ตัวกรองก่อนทำการจัดลำดับใหม่', 'warning');
      return;
    }

    const oldIndex = orders.findIndex((o) => o.batch === active.id);
    const newIndex = orders.findIndex((o) => o.batch === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // จำสภาพก่อนลากรอบแรก ไว้เป็น "ก่อน" ของ preview + snapshot Undo
    if (!reorderDirty) {
      preReorderRef.current = JSON.parse(JSON.stringify(orders));
    }
    const moved = arrayMove(orders, oldIndex, newIndex).map((o, i) => ({ ...o, priority: i + 1 }));
    setOrders(moved);
    setReorderDirty(true);
  };

  const cancelReorder = useCallback(async () => {
    setReorderDirty(false);
    preReorderRef.current = null;
    await fetchOrders(); // คืนลำดับจริงจาก DB
    showToast('ยกเลิกการจัดลำดับแล้ว', 'info');
  }, [fetchOrders, showToast]);

  // ===== date edit (Material / Confirm / Release) =====
  // onSubmit ส่ง { value, note, file } — ยิงเป็น FormData (multipart) เพื่อแนบไฟล์ได้
  const submitDateEdit = useCallback(async ({ value, note, file }) => {
    if (!dateEdit) return;
    const { kind, order } = dateEdit;
    const meta = DATE_EDIT_META[kind];
    try {
      const fd = new FormData();
      // append '' ตรง ๆ สำหรับล้างค่า — อย่าใช้ value||null (FormData.append(key,null) ส่ง string "null" → 400)
      fd.append(meta.bodyKey, value == null ? '' : value);
      if (note) fd.append('note', note);
      if (file) fd.append('file', file);
      const res = await apiCall(`/orders/${encodeURIComponent(order.batch)}/${meta.endpoint}`, {
        method: 'PUT',
        body: fd,
      });
      setOrders((prev) => prev.map((o) => {
        if (o.batch !== order.batch) return o;
        const upd = { ...o, [meta.bodyKey]: res[meta.bodyKey] ?? (value || null) };
        if (kind === 'material' && res.program_notes !== undefined) upd.program_notes = res.program_notes;
        // bump ตัวนับ marker ถ้า backend บันทึก log สำเร็จ
        if (res.log_entry) {
          const counts = { ...(o.date_log_counts || {}) };
          counts[kind] = (Number(counts[kind]) || 0) + 1;
          upd.date_log_counts = counts;
        }
        return upd;
      }));
      fetchTimestamps();
      setDateEdit(null);
      showToast('บันทึกวันที่เรียบร้อย');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }, [dateEdit, fetchTimestamps, showToast]);

  // ===== dropdown สถานะ Material (material_arrived) — OK(true)=ปลด material floor เริ่มได้เลย /
  // ยังไม่เข้า(false)=คงรอวันวัตถุดิบ. กระทบแผน (backend markEdit) → "แผนค้าง" เตือนให้ Replan =====
  const handleToggleArrived = useCallback(async (order, checked) => {
    const prevArrived = order.material_arrived;
    const prevNote = order.program_notes;
    // optimistic — ตั้ง override ชัดเจน (true/false); revert ถ้า API พลาด
    setOrders((prev) => prev.map((o) => (o.batch === order.batch ? { ...o, material_arrived: checked } : o)));
    try {
      const res = await apiCall(`/orders/${encodeURIComponent(order.batch)}/material-arrived`, {
        method: 'PUT',
        body: JSON.stringify({ material_arrived: checked }),
      });
      // ซิงก์ program_notes ที่ backend คำนวณใหม่ (ป้ายเตือน "ดึงวัตถุดิบเข้า" ในเซลล์เดียวกัน)
      setOrders((prev) => prev.map((o) => {
        if (o.batch !== order.batch) return o;
        const upd = { ...o, material_arrived: res.material_arrived, program_notes: res.program_notes };
        // bump ตัวนับ marker ถ้า backend บันทึก log สำเร็จ (log_entry ว่าง = ค่าไม่เปลี่ยน หรือยังไม่มีตาราง)
        if (res.log_entry) {
          const counts = { ...(o.date_log_counts || {}) };
          counts.material_arrived = (Number(counts.material_arrived) || 0) + 1;
          upd.date_log_counts = counts;
        }
        return upd;
      }));
      fetchTimestamps();
    } catch (err) {
      setOrders((prev) => prev.map((o) => (o.batch === order.batch
        ? { ...o, material_arrived: prevArrived, program_notes: prevNote }
        : o)));
      showToast(err.message, 'danger');
    }
  }, [fetchTimestamps, showToast]);

  // ===== preview dialog control =====
  const closePreview = useCallback(() => setPreview(null), []);

  // รัน simulation (ไม่บันทึก) แล้วเปิด preview พร้อม diff + detail — ใช้ร่วมทุกโหมด
  const openPreview = useCallback(async ({
    mode, beforeRows, afterPriorities, afterModes, planModeOverrides, onConfirm,
  }) => {
    setPreview({ mode, loading: true, diff: null, detail: null, onConfirm });
    try {
      const body = { is_simulation: true };
      if (afterPriorities) body.priority_overrides = afterPriorities;
      if (planModeOverrides) body.plan_mode_overrides = planModeOverrides;
      const decoded = await apiCall('/schedule/replan', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const diff = buildPlanDiff({
        beforeRows,
        afterReport: decoded.report ?? [],
        afterPriorities: afterPriorities ?? null,
        afterModes: afterModes ?? null,
      });
      // deep detail: เครื่อง/process กินเวลาเท่าไหร่ + คอขวด (จาก decoded.data)
      const detail = buildPlanDetail(decoded.data ?? []);
      // มุมกลับ: เครื่องไหนรัน batch ไหนบ้าง (แท็บ "เครื่องจักร")
      const machineSchedule = buildMachineSchedule(decoded.data ?? []);
      setPreview((p) => (p && p.mode === mode
        ? {
          ...p,
          loading: false,
          diff,
          detail,
          machineSchedule,
          capacityWarning: decoded.capacity_warning,
          // step ที่ทุกเครื่องติด jig ที่ใช้ไม่ได้ — ให้ PlanPreviewDialog อธิบายแทนคำว่า No Capacity
          blockedSteps: decoded.blocked_steps ?? [],
          // งานที่วางไม่ลง พร้อมเหตุผล/เครื่องทางเลือก — แท็บ "ทางเลือก" ในไดอะล็อก
          unplanned: decoded.unplanned ?? [],
        }
        : p));
    } catch (err) {
      setPreview(null);
      planErrorToast(err);
    }
  }, [planErrorToast]);

  // ---- Replan: sim → preview → ยืนยัน → replan จริง (ไม่เด้งหน้า Planning) ----
  const doReplan = useCallback(async () => {
    setPreviousOrderList(JSON.parse(JSON.stringify(baselineRef.current ?? orders)));
    setIsPlanning(true);
    try {
      const decoded = await apiCall('/schedule/replan', { method: 'POST' });
      setFromRunResponse(decoded.data ?? [], decoded.report ?? []);
      baselineRef.current = null;
      await fetchOrders();
      await fetchTimestamps();
      await fetchHorizon(); // แผนใหม่กินปฏิทินไปอีก — เช็คว่ายังเหลือพอไหม
      await fetchLastRun();
      setPreview(null);
      const cw = decoded.capacity_warning;
      if (cw) {
        showToast(
          `⚠️ ปฏิทินอาจไม่พอ: วางแผนไม่ได้ ${cw.unplanned_count} งาน`
          + (cw.last_calendar_date ? ` (ปฏิทินถึง ${cw.last_calendar_date})` : '')
          + ' — กรุณาสร้างปฏิทินเพิ่มแล้ว Replan อีกครั้ง',
          'warning',
        );
      } else {
        showToast('Replan สำเร็จ — กด "ดูแผน" เพื่อไปหน้าวางแผน', 'success');
      }
    } catch (err) {
      planErrorToast(err);
    } finally {
      setIsPlanning(false);
    }
  }, [orders, setFromRunResponse, fetchOrders, fetchTimestamps, fetchHorizon, fetchLastRun, showToast, planErrorToast]);

  // ---- ย้อนกลับแผน: เลือกรุ่นในประวัติ → preview (ไม่ใช่ sim — แผนรุ่นนั้นถูกเก็บไว้แล้ว) → ยืนยัน → rollback ----
  const doRollback = useCallback(async (runId) => {
    setPreviousOrderList(JSON.parse(JSON.stringify(baselineRef.current ?? orders)));
    setIsPlanning(true);
    try {
      const decoded = await apiCall(`/schedule/runs/${runId}/rollback`, { method: 'POST' });
      setFromRunResponse(decoded.data ?? [], decoded.report ?? []);
      baselineRef.current = null;
      await fetchOrders();
      await fetchTimestamps();
      await fetchLastRun();
      setPreview(null);
      showToast(decoded.message || `ย้อนกลับไปแผนรุ่น #${runId} แล้ว`, 'success');
    } catch (err) {
      planErrorToast(err);
    } finally {
      setIsPlanning(false);
    }
  }, [orders, setFromRunResponse, fetchOrders, fetchTimestamps, fetchLastRun, showToast, planErrorToast]);

  const handlePickRun = useCallback(async (run) => {
    setShowRuns(false);
    setPreview({ mode: 'rollback', loading: true, diff: null, detail: null, onConfirm: () => doRollback(run.id) });
    try {
      const decoded = await apiCall(`/schedule/runs/${run.id}`);
      // "ก่อน" = ออเดอร์ตอนนี้ · "หลัง" = FG ของแผนรุ่นนั้น — ใช้ buildPlanDiff ตัวเดียวกับ Replan
      const diff = buildPlanDiff({ beforeRows: orders, afterReport: decoded.report ?? [] });
      const cmp = decoded.compare || { closed: [], notInRun: [] };
      const when = String(run.created_at ?? '').replace('T', ' ').slice(0, 16);
      const notices = [
        `แผนรุ่น #${run.id} — ยืนยันแล้วจะเขียนแผนนี้กลับเป็นแผนปัจจุบันทันที โดยไม่รัน engine ใหม่`,
        // rollback ไม่ได้รัน engine → ยอดผลิตที่สแกนหลังจากรุ่นนั้นไม่ถูกนับ (แผนจะยังมีขั้นตอนที่ทำไปแล้ว)
        `ยอดผลิตที่บันทึกหลัง ${when} ไม่ถูกนำมาคิดในแผนที่ย้อนกลับ — ควรกด Replan หลังย้อนกลับเพื่อให้แผนตรงกับหน้างาน`,
      ];
      if (cmp.notInRun.length > 0) {
        // ออเดอร์กลุ่มนี้ไม่อยู่ใน order_dates ของรุ่นนั้น → rollback ไม่แตะวันของมัน (คงวันจากแผนปัจจุบัน) แต่ไม่มีแถวในแผน
        notices.push(`ออเดอร์ ${cmp.notInRun.length} รายการไม่มีในแผนรุ่นนั้น (เพิ่มทีหลัง/หลุดแผน) — ตาราง Orders จะยังโชว์วันเริ่ม-เสร็จจากแผนปัจจุบัน แต่จะไม่อยู่ในคิวเครื่อง/หน้า Planning จนกว่าจะ Replan: ${cmp.notInRun.slice(0, 10).join(', ')}${cmp.notInRun.length > 10 ? ' …' : ''}`);
      }
      if (cmp.closed.length > 0) {
        notices.push(`ออเดอร์ที่ปิด/ลบไปแล้ว ${cmp.closed.length} รายการจะถูกตัดออกจากแผนที่ย้อนกลับ`);
      }
      setPreview((p) => (p && p.mode === 'rollback'
        ? {
          ...p,
          loading: false,
          diff,
          detail: buildPlanDetail(decoded.data ?? []),
          machineSchedule: buildMachineSchedule(decoded.data ?? []),
          capacityWarning: decoded.run?.capacity_warning ?? null,
          blockedSteps: decoded.run?.blocked_steps ?? [],
          unplanned: decoded.run?.unplanned ?? [],
          notices,
        }
        : p));
    } catch (err) {
      setPreview(null);
      showToast(err.message, 'danger');
    }
  }, [orders, doRollback, showToast]);

  const handleReplan = useCallback(() => {
    openPreview({ mode: 'replan', beforeRows: orders, onConfirm: doReplan });
  }, [openPreview, orders, doReplan]);

  // ---- เรียงตาม Due Date: คำนวณลำดับใหม่ client-side → sim → preview → ยืนยัน → persist ----
  const doSort = useCallback(async () => {
    setPreviousOrderList(JSON.parse(JSON.stringify(baselineRef.current ?? orders)));
    setIsPlanning(true);
    try {
      await apiCall('/orders/bulk/sort-priority', { method: 'PUT' });
      baselineRef.current = null;
      await fetchOrders();
      await fetchTimestamps();
      setPreview(null);
      showToast('เรียงลำดับ Priority สำเร็จ — กด Replan เพื่อคำนวณแผนใหม่', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setIsPlanning(false);
    }
  }, [orders, fetchOrders, fetchTimestamps, showToast]);

  const handleSortByDueDate = useCallback(() => {
    const afterPriorities = computeSortByDueDate(orders);
    openPreview({ mode: 'sort', beforeRows: orders, afterPriorities, onConfirm: doSort });
  }, [openPreview, orders, doSort]);

  // ---- บันทึกลำดับ (จากการลาก): sim → preview → ยืนยัน → persist reorder ----
  const doSaveReorder = useCallback(async () => {
    const updates = orders.map((o, i) => ({ batch: o.batch, priority: i + 1 }));
    setPreviousOrderList(JSON.parse(JSON.stringify(preReorderRef.current ?? [])));
    setIsPlanning(true);
    try {
      await apiCall('/orders/reorder', { method: 'PUT', body: JSON.stringify({ updates }) });
      setReorderDirty(false);
      preReorderRef.current = null;
      baselineRef.current = null;
      await fetchOrders();
      await fetchTimestamps();
      setPreview(null);
      showToast('บันทึกลำดับสำเร็จ — กด Replan เพื่อคำนวณแผนใหม่', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setIsPlanning(false);
    }
  }, [orders, fetchOrders, fetchTimestamps, showToast]);

  const handleSaveReorder = useCallback(() => {
    const afterPriorities = {};
    orders.forEach((o, i) => { afterPriorities[o.batch] = i + 1; });
    openPreview({
      mode: 'drag',
      beforeRows: preReorderRef.current ?? orders,
      afterPriorities,
      onConfirm: doSaveReorder,
    });
  }, [openPreview, orders, doSaveReorder]);

  // ===== actions =====
  const handleCloseOrder = (order) => {
    setConfirm({
      title: 'ยืนยันการปิดจ๊อบ',
      body: `คุณต้องการปิดจ๊อบ ${order.batch} และย้ายเข้าสู่ประวัติ (History) ใช่หรือไม่?`,
      confirmLabel: 'ยืนยันปิดจ๊อบ',
      variant: 'success',
      onConfirm: async () => {
        try {
          await apiCall(`/orders/${encodeURIComponent(order.batch)}/close`, { method: 'PUT' });
          showToast(`ปิดจ๊อบ ${order.batch} เรียบร้อยแล้ว`);
          fetchOrders();
          fetchTimestamps();
        } catch (err) {
          showToast(err.message, 'danger');
        }
      },
    });
  };

  // Phase 6: แจ้ง Engineer ว่า model นี้ยังไม่มี Routing (ผู้รับ resolve จาก DB ฝั่ง backend)
  const handleMissingAlert = async (order) => {
    try {
      const res = await apiCall('/alert/missing-routing', {
        method: 'POST',
        body: JSON.stringify({ batch_id: order.batch, model_name: order.model }),
      });
      showToast(res.message || 'ส่งอีเมลแจ้ง Engineer แล้ว');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleDeleteOrder = (order) => {
    setConfirm({
      title: 'ยืนยันการลบออเดอร์',
      body: `คุณต้องการลบออเดอร์ Batch: ${order.batch} ใช่หรือไม่?\n(ข้อมูลจะถูกลบออกจากระบบทันที)`,
      confirmLabel: 'ลบเลย',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await apiCall(`/orders/${encodeURIComponent(order.batch)}`, { method: 'DELETE' });
          showToast('ลบออเดอร์สำเร็จ');
          fetchOrders();
        } catch (err) {
          showToast(err.message, 'danger');
        }
      },
    });
  };

  // Undo — restore snapshot แล้ว refetch (ไม่ replan อัตโนมัติ; ผู้ใช้กด Replan เอง)
  // Export "ตามที่เห็นบนจอ" — filteredOrders คือผลหลังค้นหา/ตัวกรอง เรียงตามลำดับปัจจุบัน
  const handleExport = useCallback(() => {
    if (filteredOrders.length === 0) return;
    exportXlsx(stampedFilename('orders', today), 'Orders', EXPORT_COLUMNS, filteredOrders);
    showToast(`บันทึกไฟล์ Excel ${filteredOrders.length} รายการแล้ว`);
  }, [filteredOrders, today, showToast]);

  const handleUndo = async () => {
    if (!previousOrderList) return;
    setIsPlanning(true);
    try {
      await apiCall('/orders/bulk/restore', {
        method: 'POST',
        body: JSON.stringify(previousOrderList),
      });
      baselineRef.current = null; // ให้ fetchOrders จำ baseline ใหม่จากข้อมูลที่เพิ่ง restore
      await fetchOrders();
      await fetchTimestamps();
      setPreviousOrderList(null);
      showToast('⏪ คืนลำดับเดิมสำเร็จ — กด Replan เพื่อคำนวณแผนใหม่', 'warning');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setIsPlanning(false);
    }
  };

  const busy = isPlanning || !!preview;

  return (
    <Container fluid className="pb-4">
      <PageHeader
        icon="bi-list-check"
        title="Order Management"
        subtitle="จัดลำดับความสำคัญของออเดอร์ แล้วสั่งคำนวณแผนการผลิต"
        status={
          <div className="d-flex align-items-center gap-3 border rounded bg-white px-3 py-1">
            <span
              className={`chip ${outdated ? 'chip-ng' : 'chip-ok'}`}
              title={outdated ? 'มีการแก้ไขหลังวางแผนล่าสุด' : 'แผนเป็นปัจจุบัน'}
            >
              <i className={`bi ${outdated ? 'bi-exclamation-circle-fill' : 'bi-check-circle-fill'}`} />
              {outdated ? 'แผนไม่เป็นปัจจุบัน' : 'แผนเป็นปัจจุบัน'}
            </span>
            <small className="fw-bold text-mse num">Last plan: {timestamps.last_plan}</small>
            <small className="fw-bold num" style={{ color: 'var(--mse-warn)' }}>
              Last edit: {timestamps.last_edit}
            </small>
          </div>
        }
        actions={
          <>
            <Button
              variant="outline-primary"
              title="ดูแผนล่าสุด"
              aria-label="ดูแผนล่าสุด"
              onClick={() => navigate('/planning')}
            >
              <i className="bi bi-calendar3 me-1" aria-hidden="true" /> ดูแผน
            </Button>
            {canManageSettings && (
              <Button
                variant="outline-secondary"
                title="ตั้งค่าการวางแผน"
                aria-label="ตั้งค่าการวางแผน"
                onClick={() => setShowSettings(true)}
              >
                <i className="bi bi-sliders" aria-hidden="true" />
              </Button>
            )}
            {canManageSettings && (
              <Button
                variant="outline-secondary"
                title="ประวัติแผน (เทียบ / ย้อนกลับ)"
                aria-label="ประวัติแผน"
                onClick={() => setShowRuns(true)}
              >
                <i className="bi bi-layers-half" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="outline-secondary"
              title="ประวัติการผลิต"
              aria-label="ประวัติการผลิต"
              onClick={() => setShowHistory(true)}
            >
              <i className="bi bi-clock-history" aria-hidden="true" />
            </Button>
            <Button
              variant="outline-secondary"
              title="รีเฟรช"
              aria-label="รีเฟรช"
              onClick={() => {
                fetchOrders();
                fetchTimestamps();
              }}
            >
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
            </Button>
          </>
        }
      />

      {/* เตือนก่อนงานจะเริ่มหลุด — capacity_warning เห็นก็ต่อเมื่อหลุดไปแล้ว */}
      <CalendarHorizonAlert horizon={horizon} onGoToCalendar={() => navigate('/calendar')} />
      {/* งานที่วางไม่ลงของแผนล่าสุด — เดิมหายไปพร้อม dialog ของ Replan */}
      <LastRunAlert run={lastRun} />

      {/* ===== toolbar ===== */}
      <Toolbar>
        <InputGroup style={{ maxWidth: 320 }}>
          <InputGroup.Text>
            <i className="bi bi-search" aria-hidden="true" />
          </InputGroup.Text>
          <Form.Control
            placeholder="ค้นหา Batch หรือ Model..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchActive && (
            <Button variant="outline-secondary" onClick={() => setSearchQuery('')} title="ล้างคำค้นหา" aria-label="ล้างคำค้นหา">
              <i className="bi bi-x-lg" aria-hidden="true" />
            </Button>
          )}
        </InputGroup>

        <Button
          variant={showFilters || activeDateCount ? 'primary' : 'outline-primary'}
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          title="ตัวกรองวันที่"
        >
          <i className="bi bi-funnel me-1" aria-hidden="true" /> ตัวกรอง
          {activeDateCount > 0 && (
            <Badge bg="light" text="dark" className="ms-1">{activeDateCount}</Badge>
          )}
        </Button>

        {canPlan && (
          <Button className="btn-mse" onClick={() => setFormOrder(null)} disabled={reorderDirty}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มออเดอร์
          </Button>
        )}

        <Toolbar.End>
          {reorderDirty ? (
            <>
              <span className="chip chip-warn align-self-center">
                <i className="bi bi-exclamation-circle" aria-hidden="true" /> มีลำดับที่ยังไม่บันทึก
              </span>
              <Button variant="primary" disabled={busy} onClick={handleSaveReorder}>
                {isPlanning ? (
                  <Spinner animation="border" size="sm" className="me-1" />
                ) : (
                  <i className="bi bi-eye me-1" aria-hidden="true" />
                )}
                ดูผล &amp; บันทึกลำดับ
              </Button>
              <Button variant="outline-secondary" disabled={busy} onClick={cancelReorder}>
                <i className="bi bi-x-lg me-1" aria-hidden="true" /> ยกเลิก
              </Button>
            </>
          ) : (
            <>
              {canPlan && (<>
              <Button
                variant="warning"
                disabled={!previousOrderList || busy}
                onClick={handleUndo}
              >
                <i className="bi bi-arrow-90deg-left me-1" aria-hidden="true" /> ย้อนกลับ
              </Button>
              <Button variant="info" disabled={busy} className="text-white" onClick={handleReplan}>
                {isPlanning ? (
                  <Spinner animation="border" size="sm" className="me-1" />
                ) : (
                  <i className="bi bi-magic me-1" aria-hidden="true" />
                )}
                Replan
              </Button>
              <Button variant="outline-primary" disabled={busy} onClick={handleSortByDueDate}>
                <i className="bi bi-arrow-down-up me-1" aria-hidden="true" /> เรียงตาม Due Date
              </Button>
              </>)}
              <Button
                variant="outline-success"
                disabled={busy || filteredOrders.length === 0}
                onClick={handleExport}
                title="บันทึกรายการที่เห็นอยู่เป็นไฟล์ Excel"
              >
                <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" /> Export Excel
              </Button>
            </>
          )}
        </Toolbar.End>
      </Toolbar>

      {showFilters && (
        <OrderFilterPanel
          filters={dateFilters}
          onChange={handleFilterChange}
          onReset={resetDateFilters}
          activeCount={activeDateCount}
        />
      )}

      {/* ===== ตาราง orders ===== */}
      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-inbox" aria-hidden="true" />
          <div>ยังไม่มีออเดอร์ในระบบ</div>
          {canPlan && (
            <Button className="btn-mse mt-3" onClick={() => setFormOrder(null)}>
              <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มออเดอร์
            </Button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={filteredOrders.map((o) => o.batch)}
              strategy={verticalListSortingStrategy}
            >
              <Table hover size="sm" className="align-middle bg-white">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th style={{ width: 90 }}>Action</th>
                    <th>Batch ID</th>
                    <th>Model</th>
                    <th>Description</th>
                    <th>WIP</th>
                    <th>Delivery mode</th>
                    <th>Qty</th>
                    <th>Due Date</th>
                    <th>Issue Date</th>
                    <th>Release Date</th>
                    <th>Material</th>
                    <th>Confirm</th>
                    <th>Start</th>
                    <th>FG</th>
                    <th className="text-center">Mat'l เข้า</th>
                    <th className="text-center">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <SortableRow
                      key={order.batch}
                      order={order}
                      today={today}
                      dragLocked={filterActive || !canPlan}
                      datesLocked={reorderDirty}
                      canPlan={canPlan}
                      canEditDates={canEditDates}
                      canEditMaterial={canEditMaterial}
                      onEdit={(o) => setFormOrder(o)}
                      onClose={handleCloseOrder}
                      onDelete={handleDeleteOrder}
                      onTracking={(batch) => setTrackingBatch(batch)}
                      onMissingAlert={handleMissingAlert}
                      onEditDate={(kind, o) => setDateEdit({ kind, order: o })}
                      onToggleArrived={handleToggleArrived}
                    />
                  ))}
                </tbody>
              </Table>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* ===== dialogs ===== */}
      <OrderFormDialog
        show={formOrder !== undefined}
        order={formOrder || null}
        maxPriority={maxPriority}
        onHide={() => setFormOrder(undefined)}
        onSaved={(msg) => {
          setFormOrder(undefined);
          showToast(msg);
          fetchOrders();
          fetchTimestamps();
        }}
        onError={showErrorToast}
      />

      <TrackingDialog
        show={!!trackingBatch}
        batchId={trackingBatch}
        onHide={() => setTrackingBatch(null)}
      />

      <HistoryDialog
        show={showHistory}
        onHide={() => setShowHistory(false)}
        onOpenTracking={(batch) => {
          setShowHistory(false);
          setTrackingBatch(batch);
        }}
      />

      <DateEditDialog
        show={!!dateEdit}
        kind={dateEdit ? dateEdit.kind : ''}
        logKinds={dateEdit ? DATE_EDIT_META[dateEdit.kind].logKinds : ''}
        title={dateEdit ? DATE_EDIT_META[dateEdit.kind].title : ''}
        label={dateEdit ? DATE_EDIT_META[dateEdit.kind].label : ''}
        icon={dateEdit ? DATE_EDIT_META[dateEdit.kind].icon : ''}
        batch={dateEdit ? dateEdit.order.batch : ''}
        currentValue={dateEdit ? dateEdit.order[DATE_EDIT_META[dateEdit.kind].bodyKey] : ''}
        canEdit={dateEdit && ['material', 'issue'].includes(dateEdit.kind) ? canEditMaterial : canEditDates}
        onHide={closeDateEdit}
        onSubmit={submitDateEdit}
      />

      <SettingsDialog
        show={showSettings}
        onHide={closeSettings}
        onSaved={onSettingsSaved}
        onError={showErrorToast}
      />

      <PlanRunsDialog
        show={showRuns}
        onHide={() => setShowRuns(false)}
        onPick={handlePickRun}
        canRollback={canManageSettings}
      />

      <PlanPreviewDialog
        show={!!preview}
        mode={preview ? preview.mode : 'replan'}
        diff={preview ? preview.diff : null}
        detail={preview ? preview.detail : null}
        machineSchedule={preview ? preview.machineSchedule : null}
        capacityWarning={preview ? preview.capacityWarning : null}
        blockedSteps={preview ? preview.blockedSteps ?? [] : []}
        unplanned={preview ? preview.unplanned ?? [] : []}
        notices={preview ? preview.notices ?? [] : []}
        loading={preview ? preview.loading : false}
        settings={settings}
        todayStr={today}
        onConfirm={preview ? preview.onConfirm : undefined}
        onHide={closePreview}
      />

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default OrderControlTower;
