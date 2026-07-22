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

const formatReleaseDate = (value) => {
  if (!value || value === 'none') return '-';
  const d = new Date(String(value).slice(0, 10));
  if (Number.isNaN(d.getTime())) return '-';
  d.setHours(0, 0, 0, 0);
  return d > todayMidnight() ? String(value).slice(0, 10) : '-';
};

const formatWip = (wip) => {
  if (!wip || ['-', '0', 'null'].includes(String(wip))) return '-';
  return String(wip);
};

// แผน "ค้าง" ถ้ามีการแก้ไขหลังวางแผนล่าสุด (เทียบ string 'YYYY-MM-DD HH:MM:SS')
const isPlanOutdated = (lastPlan, lastEdit) => {
  if (lastEdit === '-') return false;
  if (lastPlan === '-') return true;
  return lastEdit > lastPlan;
};

// ===== แถวตาราง (sortable) =====
const SortableRow = ({ order, searchActive, onEdit, onClose, onDelete, onTracking, onMissingAlert }) => {
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
      <td className="num">{formatReleaseDate(order.release_date)}</td>
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

  // snapshot สำหรับ Undo — เก็บก่อนรัน Initial Plan/Replan
  const [previousOrderList, setPreviousOrderList] = useState(null);
  // baseline = สภาพ orders ตอนโหลดครั้งแรก (deep copy) ใช้เป็น snapshot ของ Replan
  // (order_management_screen.dart L122-123)
  const baselineRef = useRef(null);
  const [isPlanning, setIsPlanning] = useState(false);

  const navigate = useNavigate();
  const { setFromRunResponse } = usePlanData();

  const [formOrder, setFormOrder] = useState(undefined); // undefined=ปิด, null=สร้าง, object=แก้ไข
  const [trackingBatch, setTrackingBatch] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirm, setConfirm] = useState(null); // {title, body, confirmLabel, variant, onConfirm}

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { toast, showToast, hideToast } = useToast();

  // ต้อง stable — ถ้าเป็น inline function จะทำให้ useEffect ใน OrderFormDialog รีเซ็ตฟอร์มทุก re-render
  const showErrorToast = useCallback((msg) => showToast(msg, 'danger'), [showToast]);

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

  // ===== drag reorder =====
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (searchActive) {
      showToast('กรุณาล้างคำค้นหา (กด X) ก่อนทำการจัดลำดับใหม่', 'warning');
      return;
    }

    const oldIndex = orders.findIndex((o) => o.batch === active.id);
    const newIndex = orders.findIndex((o) => o.batch === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // optimistic: ย้ายแถว + renumber priority = 1..n ทั้งลิสต์ (ตามหน้าจอเดิม)
    const moved = arrayMove(orders, oldIndex, newIndex).map((o, i) => ({ ...o, priority: i + 1 }));
    setOrders(moved);

    try {
      await apiCall('/orders/reorder', {
        method: 'PUT',
        body: JSON.stringify({
          updates: moved.map((o) => ({ batch: o.batch, priority: o.priority })),
        }),
      });
      fetchTimestamps();
    } catch {
      showToast('บันทึกไม่สำเร็จ', 'danger');
    }
  };

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

  const handleToggleAllMode = () => {
    const target = allFixed ? 'NEW' : 'FIXED';
    setConfirm({
      title: target === 'FIXED' ? 'ล็อกแผนทั้งหมด (All FIXED)' : 'ปลดล็อกแผนทั้งหมด (All NEW)',
      body: `ต้องการเปลี่ยนสถานะทุกออเดอร์เป็น ${target} ใช่หรือไม่?`,
      confirmLabel: 'ยืนยัน',
      variant: target === 'FIXED' ? 'warning' : 'success',
      onConfirm: async () => {
        try {
          await apiCall(`/orders/bulk/mode?target_mode=${target}`, {
            method: 'PUT',
            body: JSON.stringify({ batches: orders.map((o) => o.batch) }),
          });
          showToast(`เปลี่ยนทั้งหมดเป็น ${target} สำเร็จ`);
          fetchOrders();
        } catch (err) {
          showToast(err.message, 'danger');
        }
      },
    });
  };

  const handleSortByDueDate = () => {
    setConfirm({
      title: 'เรียงลำดับ Priority ใหม่',
      body:
        'ระบบจะทำการเรียงลำดับ Priority ของทุกออเดอร์ใหม่ โดยยึดตาม Due Date จากวันที่ใกล้ที่สุดไปไกลที่สุด\n\nต้องการดำเนินการต่อหรือไม่?',
      confirmLabel: 'ยืนยัน',
      variant: 'primary',
      onConfirm: async () => {
        try {
          await apiCall('/orders/bulk/sort-priority', { method: 'PUT' });
          showToast('เรียงลำดับ Priority สำเร็จ');
          fetchOrders();
        } catch (err) {
          showToast(err.message, 'danger');
        }
      },
    });
  };

  // ===== scheduler actions (Phase 2) =====
  // 409 (มีการวางแผนซ้อน) → warning / อื่นๆ → danger
  const planErrorToast = useCallback(
    (err) => {
      const msg = String(err.message || err);
      showToast(msg, msg.includes('กำลังทำงานอยู่') ? 'warning' : 'danger');
    },
    [showToast],
  );

  // Initial Plan (order_management_screen.dart L332-383)
  const runInitialPlan = async () => {
    setPreviousOrderList(JSON.parse(JSON.stringify(orders))); // snapshot ก่อนคำนวณ
    setIsPlanning(true);
    showToast('กำลังคำนวณ Initial Plan...', 'info');
    try {
      const decoded = await apiCall('/schedule/run', { method: 'POST' });
      setFromRunResponse(decoded.data ?? [], decoded.report ?? []);
      fetchTimestamps();
      navigate('/planning');
    } catch (err) {
      planErrorToast(err);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleInitialPlan = () => {
    // กล่องเตือนสีแดงเดิม (order_management_screen.dart L1064-1128)
    setConfirm({
      title: 'ยืนยันการรัน Initial Plan',
      body: 'คุณต้องการล้างแผนการผลิตทั้งหมดใช่หรือไม่?',
      confirmLabel: 'ยืนยัน (ล้างแผน)',
      variant: 'danger',
      onConfirm: runInitialPlan,
    });
  };

  // Replan (order_management_screen.dart L386-442) — snapshot จาก baseline (deep copy)
  const runReplan = async (saveHistory = true) => {
    if (saveHistory) {
      setPreviousOrderList(JSON.parse(JSON.stringify(baselineRef.current ?? [])));
    }
    setIsPlanning(true);
    showToast('กำลังคำนวณ Replan (ล็อกเวลา FIXED)...', 'info');
    try {
      const decoded = await apiCall('/schedule/replan', { method: 'POST' });
      setFromRunResponse(decoded.data ?? [], decoded.report ?? []);
      fetchTimestamps();
      navigate('/planning');
    } catch (err) {
      planErrorToast(err);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleReplan = () => {
    // FIX: ของเก่ารันทันทีไม่มี confirm — user เลือกเพิ่ม dialog (2026-07-16)
    setConfirm({
      title: 'ยืนยันการรัน Replan',
      body: 'ระบบจะคำนวณแผนการผลิตใหม่ทั้งหมด (ล็อกเวลาเฉพาะออเดอร์ FIXED)\n\nต้องการดำเนินการต่อหรือไม่?',
      confirmLabel: 'ยืนยัน Replan',
      variant: 'info',
      onConfirm: () => runReplan(true),
    });
  };

  // Undo (order_management_screen.dart L270-329): restore -> refetch -> auto-replan
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
      setPreviousOrderList(null);
      showToast('⏪ โหลดแผนเดิมสำเร็จ! กำลังคำนวณตารางใหม่...', 'warning');
      // หน่วงให้เห็นว่าตารางกลับเป็นของเดิมก่อน (เหมือนเดิม 1.5 วิ) แล้ว replan อัตโนมัติ
      await new Promise((r) => setTimeout(r, 1500));
      await runReplan(false); // auto-replan ไม่เก็บ history และไม่ต้อง confirm
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setIsPlanning(false);
    }
  };

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

        <Button className="btn-mse" onClick={() => setFormOrder(null)}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มออเดอร์
        </Button>

        <Toolbar.End>
          <Button variant={allFixed ? 'success' : 'warning'} onClick={handleToggleAllMode}>
            <i className={`bi ${allFixed ? 'bi-unlock' : 'bi-lock-fill'} me-1`} aria-hidden="true" />
            {allFixed ? 'ปลดล็อกทั้งหมด' : 'ล็อกทั้งหมด'}
          </Button>
          <Button
            variant="warning"
            disabled={!previousOrderList || isPlanning}
            onClick={handleUndo}
          >
            <i className="bi bi-arrow-90deg-left me-1" aria-hidden="true" /> ย้อนกลับ
          </Button>
          <Button variant="danger" disabled={isPlanning} onClick={handleInitialPlan}>
            {isPlanning ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
            )}
            Initial Plan
          </Button>
          <Button variant="info" disabled={isPlanning} className="text-white" onClick={handleReplan}>
            {isPlanning ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <i className="bi bi-magic me-1" aria-hidden="true" />
            )}
            Replan
          </Button>
          <Button variant="outline-primary" disabled={isPlanning} onClick={handleSortByDueDate}>
            <i className="bi bi-arrow-down-up me-1" aria-hidden="true" /> เรียงตาม Due Date
          </Button>
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
                    <th className="text-center">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <SortableRow
                      key={order.batch}
                      order={order}
                      searchActive={searchActive}
                      onEdit={(o) => setFormOrder(o)}
                      onClose={handleCloseOrder}
                      onDelete={handleDeleteOrder}
                      onTracking={(batch) => setTrackingBatch(batch)}
                      onMissingAlert={handleMissingAlert}
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

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default OrderControlTower;
