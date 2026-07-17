import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Table, Button, Form, Modal, Spinner, Badge,
  Toast, ToastContainer, InputGroup,
} from 'react-bootstrap';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, Pencil, CheckCircle, Trash2, Search, X, PlusSquare,
  Lock, Unlock, Undo2, RotateCcw, Wand2, ArrowDownUp, History, RefreshCw,
  AlertTriangle, Clock, MailCheck,
} from 'lucide-react';
import { apiCall } from '../../api/client';
import { usePlanData } from '../../context/PlanDataContext';
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
  if (diffDays <= 2) return { className: 'fw-bold', icon: 'near', style: { color: '#f57c00' } };
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
          style={{ cursor: searchActive ? 'not-allowed' : 'grab', color: searchActive ? '#dee2e6' : '#6c757d' }}
        >
          <GripVertical size={16} />
        </span>
      </td>
      <td className="text-nowrap">
        <Button variant="link" size="sm" className="p-0 me-1 text-primary" title="แก้ไข" onClick={() => onEdit(order)}>
          <Pencil size={15} />
        </Button>
        <Button variant="link" size="sm" className="p-0 me-1 text-success" title="ปิดจ๊อบ" onClick={() => onClose(order)}>
          <CheckCircle size={15} />
        </Button>
        <Button variant="link" size="sm" className="p-0 text-danger" title="ลบ" onClick={() => onDelete(order)}>
          <Trash2 size={15} />
        </Button>
      </td>
      <td>
        <Button
          variant="link"
          size="sm"
          className="p-0 fw-bold text-decoration-underline"
          onClick={() => onTracking(order.batch)}
        >
          {order.batch}
        </Button>
        {order.is_new ? <span className="text-danger fw-bold ms-1">New</span> : null}
      </td>
      <td>
        {order.model}
        {order.is_missing_routing ? (
          order.has_actual_master ? (
            <MailCheck size={15} className="text-success ms-1" title="Engineer จัดทำ Master เรียบร้อยแล้ว ✅" />
          ) : (
            <Button
              variant="link"
              size="sm"
              className="p-0 ms-1"
              title="แจ้ง Engineer (เปิดใช้งาน Phase 6)"
              onClick={onMissingAlert}
            >
              ❓
            </Button>
          )
        ) : null}
      </td>
      <td className="text-truncate" style={{ maxWidth: 200 }} title={order.description || ''}>
        {order.description || '-'}
      </td>
      <td>{formatWip(order.wip)}</td>
      <td>{order.planning_mode === 'backward' ? 'Backward' : 'Forward'}</td>
      <td>{order.qty}</td>
      <td className={due.className} style={due.style}>
        {due.icon === 'overdue' && <AlertTriangle size={14} className="me-1" />}
        {due.icon === 'near' && <Clock size={14} className="me-1" />}
        {String(order.due_date || '').slice(0, 10)}
      </td>
      <td>{order.planMode || order.plan_mode || 'NEW'}</td>
      <td>{formatReleaseDate(order.release_date)}</td>
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
  const [toast, setToast] = useState(null); // {message, variant}

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const showToast = useCallback((message, variant = 'success') => {
    setToast({ message, variant });
  }, []);

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
          showToast(`✅ ปิดจ๊อบ ${order.batch} เรียบร้อยแล้ว`);
          fetchOrders();
          fetchTimestamps();
        } catch (err) {
          showToast(err.message, 'danger');
        }
      },
    });
  };

  const handleDeleteOrder = (order) => {
    setConfirm({
      title: 'ยืนยันการลบ 🗑️',
      body: `คุณต้องการลบออเดอร์ Batch: ${order.batch} ใช่หรือไม่?\n(ข้อมูลจะถูกลบออกจากระบบทันที)`,
      confirmLabel: 'ลบเลย',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await apiCall(`/orders/${encodeURIComponent(order.batch)}`, { method: 'DELETE' });
          showToast('✅ ลบออเดอร์สำเร็จ');
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
      title: target === 'FIXED' ? '🔒 ล็อกแผนทั้งหมด (All FIXED)' : '🔓 ปลดล็อกแผนทั้งหมด (All NEW)',
      body: `ต้องการเปลี่ยนสถานะทุกออเดอร์เป็น ${target} ใช่หรือไม่?`,
      confirmLabel: 'ยืนยัน',
      variant: target === 'FIXED' ? 'warning' : 'success',
      onConfirm: async () => {
        try {
          await apiCall(`/orders/bulk/mode?target_mode=${target}`, {
            method: 'PUT',
            body: JSON.stringify({ batches: orders.map((o) => o.batch) }),
          });
          showToast(`✅ เปลี่ยนทั้งหมดเป็น ${target} สำเร็จ`);
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
          showToast('✅ เรียงลำดับ Priority สำเร็จ!');
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
      title: '⚠️ ยืนยันการรัน Initial Plan',
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
      {/* ===== toolbar ===== */}
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <InputGroup style={{ maxWidth: 320 }}>
          <InputGroup.Text>
            <Search size={15} />
          </InputGroup.Text>
          <Form.Control
            placeholder="ค้นหา Batch หรือ Model..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchActive && (
            <Button variant="outline-secondary" onClick={() => setSearchQuery('')}>
              <X size={15} />
            </Button>
          )}
        </InputGroup>

        <Button className="btn-mse" onClick={() => setFormOrder(null)}>
          <PlusSquare size={16} className="me-1" /> New Order
        </Button>

        {/* status panel */}
        <div className="d-flex align-items-center gap-3 border rounded bg-white px-3 py-1">
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              backgroundColor: outdated ? '#ff5252' : '#28a745',
              boxShadow: `0 0 8px ${outdated ? 'rgba(255,82,82,0.4)' : 'rgba(40,167,69,0.4)'}`,
              display: 'inline-block',
            }}
            title={outdated ? 'มีการแก้ไขหลังวางแผนล่าสุด' : 'แผนเป็นปัจจุบัน'}
          />
          <small className="fw-bold text-primary">Last plan: {timestamps.last_plan}</small>
          <small className="fw-bold" style={{ color: '#ff5722' }}>
            Last Edit: {timestamps.last_edit}
          </small>
        </div>

        <div className="ms-auto d-flex gap-2 flex-wrap">
          <Button variant={allFixed ? 'success' : 'warning'} size="sm" onClick={handleToggleAllMode}>
            {allFixed ? <Unlock size={15} className="me-1" /> : <Lock size={15} className="me-1" />}
            {allFixed ? 'All NEW' : 'All FIXED'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!previousOrderList || isPlanning}
            onClick={handleUndo}
            style={previousOrderList && !isPlanning ? { backgroundColor: '#f57c00', borderColor: '#f57c00' } : {}}
          >
            <Undo2 size={15} className="me-1" /> Undo
          </Button>
          <Button variant="danger" size="sm" disabled={isPlanning} onClick={handleInitialPlan}>
            {isPlanning ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <RotateCcw size={15} className="me-1" />
            )}
            Initial Plan
          </Button>
          <Button
            variant="info"
            size="sm"
            disabled={isPlanning}
            className="text-white"
            onClick={handleReplan}
          >
            {isPlanning ? (
              <Spinner animation="border" size="sm" className="me-1" />
            ) : (
              <Wand2 size={15} className="me-1" />
            )}
            Replan
          </Button>
          <Button
            size="sm"
            style={{ backgroundColor: '#7b1fa2', borderColor: '#7b1fa2' }}
            disabled={isPlanning}
            onClick={handleSortByDueDate}
          >
            <ArrowDownUp size={15} className="me-1" /> Sort by Due Date
          </Button>
          <Button variant="outline-secondary" size="sm" title="ประวัติการผลิต" onClick={() => setShowHistory(true)}>
            <History size={15} />
          </Button>
          <Button variant="outline-secondary" size="sm" title="รีเฟรช" onClick={() => { fetchOrders(); fetchTimestamps(); }}>
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>

      {/* ===== ตาราง orders ===== */}
      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-center text-muted py-5">ยังไม่มี Order (กด New Order เพื่อเพิ่ม)</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={filteredOrders.map((o) => o.batch)}
              strategy={verticalListSortingStrategy}
            >
              <Table hover size="sm" className="align-middle">
                <thead style={{ backgroundColor: '#e8eaf6' }}>
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
                      onMissingAlert={() =>
                        showToast('ระบบส่งอีเมลแจ้ง Engineer จะเปิดใช้งานใน Phase 6', 'warning')
                      }
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

export default OrderControlTower;
