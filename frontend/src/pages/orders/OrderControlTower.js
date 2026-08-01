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
import { buildPlanDiff, computeSortByDueDate } from './planDiff';
import { buildPlanDetail } from './planDetail';

// meta ของกล่องแก้วันที่ตามชนิด — endpoint / คีย์ body / label
const DATE_EDIT_META = {
  material: { endpoint: 'material-date', bodyKey: 'material_ready_date', title: 'วันวัตถุดิบเข้า (Material Ready)', label: 'เลือกวันที่วัตถุดิบเข้า', icon: 'bi-box-seam' },
  confirm: { endpoint: 'confirm-date', bodyKey: 'confirm_reply_date', title: 'วัน Confirm ส่งมอบ (VIP)', label: 'เลือกวัน Confirm', icon: 'bi-star-fill' },
  release: { endpoint: 'release-date', bodyKey: 'release_date', title: 'วัน Release งาน', label: 'เลือกวัน Release', icon: 'bi-calendar-check' },
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

// program_notes → chip สี (จาก backend: Please pull in material / Material enough / N/A)
const programNoteChip = (note) => {
  if (!note) return <span className="text-muted">-</span>;
  if (note === 'Please pull in material') {
    return (
      <span className="chip chip-ng" title="วัตถุดิบเข้าช้ากว่าวันเริ่มผลิต">
        <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" /> ดึงวัตถุดิบเข้า
      </span>
    );
  }
  if (note === 'Material enough') {
    return (
      <span className="chip chip-ok" title="วัตถุดิบพร้อมก่อนเริ่มผลิต">
        <i className="bi bi-check-circle-fill" aria-hidden="true" /> วัตถุดิบพร้อม
      </span>
    );
  }
  return <span className="text-muted small">{note}</span>;
};

// แผน "ค้าง" ถ้ามีการแก้ไขหลังวางแผนล่าสุด (เทียบ string 'YYYY-MM-DD HH:MM:SS')
const isPlanOutdated = (lastPlan, lastEdit) => {
  if (lastEdit === '-') return false;
  if (lastPlan === '-') return true;
  return lastEdit > lastPlan;
};

// ===== แถวตาราง (sortable) =====
const SortableRow = ({ order, searchActive, datesLocked, canEditDates, onEdit, onClose, onDelete, onTracking, onMissingAlert, onEditDate }) => {
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
          title={searchActive ? 'ล้างคำค้นหาก่อนจึงจะจัดลำดับได้' : 'ลากเพื่อจัดลำดับ'}
          style={{
            cursor: searchActive ? 'not-allowed' : 'grab',
            color: searchActive ? 'var(--mse-border)' : 'var(--mse-muted)',
          }}
        >
          <i className="bi bi-grip-vertical" aria-hidden="true" />
        </span>
      </td>
      <td className="text-nowrap">
        <Button variant="link" size="sm" className="p-0 me-2 text-primary icon-btn" title="แก้ไข" aria-label="แก้ไข" onClick={() => onEdit(order)}>
          <i className="bi bi-pencil-square" aria-hidden="true" />
        </Button>
        <Button variant="link" size="sm" className="p-0 me-2 text-success icon-btn" title="ปิดจ๊อบ" aria-label="ปิดจ๊อบ" onClick={() => onClose(order)}>
          <i className="bi bi-check-circle" aria-hidden="true" />
        </Button>
        <Button variant="link" size="sm" className="p-0 text-danger icon-btn" title="ลบ" aria-label="ลบ" onClick={() => onDelete(order)}>
          <i className="bi bi-trash" aria-hidden="true" />
        </Button>
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
      <td>
        {(() => {
          const mode = order.planMode || order.plan_mode || 'NEW';
          return (
            <span className={`chip ${mode === 'FIXED' ? 'chip-warn' : 'chip-info'}`}>
              <i className={`bi ${mode === 'FIXED' ? 'bi-lock-fill' : 'bi-unlock'}`} aria-hidden="true" />
              {mode}
            </span>
          );
        })()}
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
          title={canEditDates ? 'แก้วันวัตถุดิบเข้า (Material Ready)' : 'ดูประวัติวันวัตถุดิบเข้า'}
          onClick={() => onEditDate('material', order)}
        >
          {shortDate(order.material_ready_date)}
        </Button>
        {logMarker(order.date_log_counts?.material)}
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
      <td>{programNoteChip(order.program_notes)}</td>
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
  const [timestamps, setTimestamps] = useState({ last_plan: '-', last_edit: '-' });
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
    // settings สำหรับ legend — เงียบถ้าดึงไม่ได้ (legend ใช้ค่า default แทน)
    apiCall('/system/settings').then(setSettings).catch(() => {});
  }, [fetchOrders, fetchTimestamps]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        String(o.batch || '').toLowerCase().includes(q) ||
        String(o.model || '').toLowerCase().includes(q) ||
        String(o.description || '').toLowerCase().includes(q)
    );
  }, [orders, searchQuery]);

  const searchActive = searchQuery.trim() !== '';
  const outdated = isPlanOutdated(timestamps.last_plan, timestamps.last_edit);
  const allFixed = orders.length > 0 && orders.every((o) => (o.plan_mode || 'NEW') === 'FIXED');
  const maxPriority = orders.reduce((max, o) => Math.max(max, o.priority ?? 0), 0);

  // ===== drag reorder (optimistic ในจอ — ยังไม่ persist จนกว่าจะยืนยันใน preview) =====
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (searchActive) {
      showToast('กรุณาล้างคำค้นหา (กด X) ก่อนทำการจัดลำดับใหม่', 'warning');
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
      setPreview((p) => (p && p.mode === mode ? { ...p, loading: false, diff, detail } : p));
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
      setPreview(null);
      showToast('Replan สำเร็จ — กด "ดูแผน" เพื่อไปหน้าวางแผน', 'success');
    } catch (err) {
      planErrorToast(err);
    } finally {
      setIsPlanning(false);
    }
  }, [orders, setFromRunResponse, fetchOrders, fetchTimestamps, showToast, planErrorToast]);

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

  // ---- Lock/Unlock ทั้งหมด: sim ด้วย plan_mode override → preview ผลกระทบ → ยืนยัน → persist mode ----
  const doToggleMode = useCallback(async (target) => {
    setPreviousOrderList(JSON.parse(JSON.stringify(baselineRef.current ?? orders)));
    setIsPlanning(true);
    try {
      await apiCall(`/orders/bulk/mode?target_mode=${target}`, {
        method: 'PUT',
        body: JSON.stringify({ batches: orders.map((o) => o.batch) }),
      });
      baselineRef.current = null;
      await fetchOrders();
      await fetchTimestamps();
      setPreview(null);
      showToast(`เปลี่ยนทั้งหมดเป็น ${target} สำเร็จ — กด Replan เพื่อคำนวณแผนใหม่`, 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setIsPlanning(false);
    }
  }, [orders, fetchOrders, fetchTimestamps, showToast]);

  const handleToggleAllMode = useCallback(() => {
    const target = allFixed ? 'NEW' : 'FIXED';
    const afterModes = {};
    orders.forEach((o) => { afterModes[o.batch] = target; });
    openPreview({
      mode: target === 'FIXED' ? 'lock' : 'unlock',
      beforeRows: orders,
      afterModes,
      planModeOverrides: afterModes,
      onConfirm: () => doToggleMode(target),
    });
  }, [allFixed, orders, openPreview, doToggleMode]);

  // Undo — restore snapshot แล้ว refetch (ไม่ replan อัตโนมัติ; ผู้ใช้กด Replan เอง)
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

        <Button className="btn-mse" onClick={() => setFormOrder(null)} disabled={reorderDirty}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มออเดอร์
        </Button>

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
              <Button variant={allFixed ? 'success' : 'warning'} disabled={busy} onClick={handleToggleAllMode}>
                <i className={`bi ${allFixed ? 'bi-unlock' : 'bi-lock-fill'} me-1`} aria-hidden="true" />
                {allFixed ? 'ปลดล็อกทั้งหมด' : 'ล็อกทั้งหมด'}
              </Button>
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
            </>
          )}
        </Toolbar.End>
      </Toolbar>

      {/* ===== ตาราง orders ===== */}
      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-inbox" aria-hidden="true" />
          <div>ยังไม่มีออเดอร์ในระบบ</div>
          <Button className="btn-mse mt-3" onClick={() => setFormOrder(null)}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มออเดอร์
          </Button>
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
                    <th>Mode</th>
                    <th>Release Date</th>
                    <th>Material</th>
                    <th>Confirm</th>
                    <th>Start</th>
                    <th>FG</th>
                    <th>Notes</th>
                    <th className="text-center">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <SortableRow
                      key={order.batch}
                      order={order}
                      searchActive={searchActive}
                      datesLocked={reorderDirty}
                      canEditDates={canEditDates}
                      onEdit={(o) => setFormOrder(o)}
                      onClose={handleCloseOrder}
                      onDelete={handleDeleteOrder}
                      onTracking={(batch) => setTrackingBatch(batch)}
                      onMissingAlert={handleMissingAlert}
                      onEditDate={(kind, o) => setDateEdit({ kind, order: o })}
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
        title={dateEdit ? DATE_EDIT_META[dateEdit.kind].title : ''}
        label={dateEdit ? DATE_EDIT_META[dateEdit.kind].label : ''}
        icon={dateEdit ? DATE_EDIT_META[dateEdit.kind].icon : ''}
        batch={dateEdit ? dateEdit.order.batch : ''}
        currentValue={dateEdit ? dateEdit.order[DATE_EDIT_META[dateEdit.kind].bodyKey] : ''}
        canEdit={canEditDates}
        onHide={closeDateEdit}
        onSubmit={submitDateEdit}
      />

      <SettingsDialog
        show={showSettings}
        onHide={closeSettings}
        onSaved={onSettingsSaved}
        onError={showErrorToast}
      />

      <PlanPreviewDialog
        show={!!preview}
        mode={preview ? preview.mode : 'replan'}
        diff={preview ? preview.diff : null}
        detail={preview ? preview.detail : null}
        loading={preview ? preview.loading : false}
        settings={settings}
        onConfirm={preview ? preview.onConfirm : undefined}
        onHide={closePreview}
      />

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default OrderControlTower;
