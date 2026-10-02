import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Form, Button, Row, Col, Spinner, Alert, Table, Badge } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import {
  estimateFlow, estimateFlowTotal, formatDays, diffDays, ownMachinesOf, withStepMachines,
} from './wipEstimate';

const pad2 = (n) => String(n).padStart(2, '0');
// orders.step_machines — key = ชื่อ step แบบ trim+upper (ตรงกับ backend/utils/stepMachines.js + engine)
const stepKeyOf = (name) => String(name ?? '').trim().toUpperCase();
const parsePins = (raw) => {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return Object.fromEntries(
      Object.entries(obj)
        .map(([k, v]) => [stepKeyOf(k), String(v ?? '').trim()])
        .filter(([k, v]) => k && v),
    );
  } catch {
    return {};
  }
};
const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};
// เวลารวมนาที (setup + run) → ข้อความ "เพราะอะไร" ต่อ step
const stepReason = (s) => {
  if (s.is_day_unit) {
    return `lead ${s.lead_days} วัน${s.wait_days ? ` (+รอรอบส่ง ${s.wait_days})` : ''}`;
  }
  if (s.no_timing) return 'ไม่มีข้อมูลเวลา';
  const parts = [];
  if (s.setup_minutes) parts.push(`setup ${Math.round(s.setup_minutes)}`);
  parts.push(`run ${Math.round(s.run_minutes)}`);
  return `${parts.join(' + ')} = ${Math.round(s.total_minutes)} นาที`;
};
// C/T ต่อตัว + ต่อ lot (per-lot = run_minutes); day-unit/ไม่มีเวลา → "—"
// เวลาหยิบจับโชว์แยกในวงเล็บ เพราะ run_minutes รวมมันไปแล้ว — ไม่งั้นเลขต่อตัว × qty
// จะไม่เท่ากับเลขต่อ lot แล้วดูเหมือนคำนวณผิด
const num0 = (n) => Math.round(n).toLocaleString('en-US');
const round2 = (n) => Math.round(n * 100) / 100;
const formatCT = (s) => {
  if (s.is_day_unit || s.no_timing || s.cycle_time == null) return '—';
  const perPiece = round2(s.cycle_time);
  const handling = round2(s.handling_time || 0);
  const head = handling > 0 ? `${perPiece} + ${handling} นาที/ตัว` : `${perPiece} นาที/ตัว`;
  return `${head} · ${num0(s.run_minutes)} นาที/lot`;
};

// Dialog เพิ่ม/แก้ไข Order — โครง 3 โซนตามหน้าจอเดิม (order_management_screen.dart)
const OrderFormDialog = ({ show, onHide, order, maxPriority, onSaved, onError }) => {
  const isEditing = !!order;

  const [form, setForm] = useState({});
  const [modelSteps, setModelSteps] = useState([]); // จาก GET /orders/model-info
  const [modelInfo, setModelInfo] = useState(null); // ทั้งก้อน (steps + calendar + settings) สำหรับประมาณเวลา
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [isWip, setIsWip] = useState(false);
  const [wipFlow, setWipFlow] = useState(null);
  const [wipStepIndex, setWipStepIndex] = useState(null);
  const [wipMachine, setWipMachine] = useState('');
  // เครื่องที่ล็อกเองรายขั้นตอน { 'STEP NAME': machine } — ว่าง = ให้ระบบเลือก (engine: pinnedMachine)
  const [stepMachines, setStepMachines] = useState({});
  const [showDetail, setShowDetail] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [realPlanDate, setRealPlanDate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [validated, setValidated] = useState(false);

  const fetchModelInfo = useCallback(async (modelName, presetOrder = null) => {
    if (!modelName) return;
    setLoadingInfo(true);
    try {
      const data = await apiCall(`/orders/model-info/${encodeURIComponent(modelName.trim())}`);
      const steps = data.found ? data.steps : [];
      setModelSteps(steps);
      setModelInfo(data.found ? data : null);
      setRealPlanDate(null);
      // auto-fill Description จาก product_master เฉพาะตอนกดค้นหาเอง (presetOrder == null);
      // ตอนแก้ order เดิมคงค่า description ที่บันทึกไว้ (ไม่ทับ)
      if (!presetOrder && data.description != null) {
        setForm((prev) => ({ ...prev, description: data.description }));
      }
      // ตอน edit: map ค่า WIP เดิมกลับเข้า dropdown (ถ้ายังอยู่ในลิสต์)
      if (presetOrder) {
        const flow = presetOrder.wip_flow_index ?? null;
        const stepIdx = presetOrder.wip_start_step_index ?? null;
        setWipFlow(flow);
        setWipStepIndex(stepIdx);
        const step = steps.find((s) => s.flow_index === flow && s.step_index === stepIdx);
        // ขั้นตอนแรก (manual flow): wip_machine = เครื่องของขั้นตอนนั้นเอง ไม่ใช่เครื่องของขั้นตอนก่อนหน้า
        const machines = !step ? [] : stepIdx === 0 ? ownMachinesOf(step) : step.previous_machines;
        setWipMachine(machines.includes(presetOrder.wip_machine) ? presetOrder.wip_machine : '');
        // เครื่องรายขั้นตอนที่เคยล็อก — เก็บเฉพาะที่ยังเป็นตัวเลือกของขั้นนั้นใน flow นี้
        const saved = parsePins(presetOrder.step_machines);
        // order เก่าที่ล็อกแค่เครื่องขั้นแรก (wip_machine) ก่อนมีตารางนี้ → ยกมาเป็นแถวแรก
        if (stepIdx === 0 && step && presetOrder.wip_machine && !saved[stepKeyOf(step.step_name)]) {
          saved[stepKeyOf(step.step_name)] = presetOrder.wip_machine;
        }
        const pins = {};
        for (const st of steps.filter((x) => x.flow_index === flow)) {
          const k = stepKeyOf(st.step_name);
          if (saved[k] && ownMachinesOf(st).includes(saved[k])) pins[k] = saved[k];
        }
        setStepMachines(pins);
      }
    } catch (err) {
      onError && onError(err.message);
      setModelSteps([]);
      setModelInfo(null);
    } finally {
      setLoadingInfo(false);
    }
  }, [onError]);

  useEffect(() => {
    if (!show) return;
    setValidated(false);
    setModelSteps([]);
    setModelInfo(null);
    setWipFlow(null);
    setWipStepIndex(null);
    setWipMachine('');
    setStepMachines({});
    setShowDetail(false);
    setRealPlanDate(null);

    if (order) {
      setForm({
        batch: order.batch || '',
        model: order.model || '',
        description: order.description || '',
        qty: order.qty ?? '',
        priority: order.priority ?? 99,
        due_date: (order.due_date || '').slice(0, 10),
        plan_mode: ['NEW', 'FIXED'].includes(order.plan_mode) ? order.plan_mode : 'NEW',
        planning_mode: order.planning_mode === 'backward' ? 'backward' : 'forward',
        release_date: (order.release_date || '').slice(0, 10),
        wip_finish_date: (order.wip_finish_date || '').slice(0, 10),
      });
      // flow_locked = เคยเลือกเส้นทางเอง (รวม Flow 0 ที่ขั้นตอนแรก ซึ่งค่า index เป็น 0/0 เหมือนไม่ได้เลือก)
      const hasWip =
        (order.wip_flow_index ?? 0) > 0 || (order.wip_start_step_index ?? 0) > 0 ||
        order.flow_locked === true || Number(order.flow_locked) === 1;
      setIsWip(hasWip);
      fetchModelInfo(order.model, order);
    } else {
      const today = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      setForm({
        batch: '',
        model: '',
        description: '',
        qty: '',
        priority: (maxPriority || 0) + 1,
        due_date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
        plan_mode: 'NEW',
        planning_mode: 'forward',
        release_date: '',
        wip_finish_date: '',
      });
      setIsWip(false);
    }
  }, [show, order, maxPriority, fetchModelInfo]);

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const flowOptions = [...new Set(modelSteps.map((s) => s.flow_index))].sort((a, b) => a - b);
  // แสดงชื่อ step ทั้งหมดของ flow แบบเต็ม ไม่ตัด (ผู้ใช้ต้องเห็นครบทุก step ตอนเลือก)
  const flowPreview = (f) =>
    modelSteps.filter((s) => s.flow_index === f).map((s) => s.step_name).join(' > ');
  // ขั้นตอนแรกสุด (step 0) = เลือกเส้นทางเอง (manual flow) ของ order ที่ยังไม่ผลิต — ไม่ใช่ WIP
  // ไม่มีเครื่อง/วันจบของขั้นตอนก่อนหน้า และบันทึกเป็น flow_locked = 1 ให้ Flow 0 ล็อกได้ด้วย
  const stepOptions = modelSteps.filter((s) => s.flow_index === wipFlow && s.step_index >= 0);
  const selectedStep = stepOptions.find((s) => s.step_index === wipStepIndex);
  const isManualStart = isWip && wipStepIndex === 0;
  // WIP จริง: เลือก "เครื่องของขั้นตอนก่อนหน้า" · ขั้นตอนแรก: เลือก "เครื่องที่จะทำขั้นตอนนี้" (ไม่บังคับ)
  // — engine ล็อกเครื่องนั้นเครื่องเดียว ว่าง = ให้ระบบเลือกเอง
  const machineOptions = !selectedStep
    ? []
    : wipStepIndex === 0 ? ownMachinesOf(selectedStep) : selectedStep.previous_machines;
  // ตารางล็อกเครื่องรายขั้นตอน: ขั้นที่ยังต้องทำ (ตั้งแต่ process ที่เลือกเป็นต้นไป)
  const pinSteps = useMemo(
    () => (wipStepIndex === null ? [] : stepOptions.filter((st) => st.step_index >= wipStepIndex)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelSteps, wipFlow, wipStepIndex],
  );
  // ค่าที่ใช้จริง = เฉพาะขั้นที่แสดงอยู่ (ขั้นที่ทำเสร็จไปแล้วไม่ต้องล็อก)
  const activePins = useMemo(() => {
    const out = {};
    for (const st of pinSteps) {
      const k = stepKeyOf(st.step_name);
      if (stepMachines[k]) out[k] = stepMachines[k];
    }
    return out;
  }, [stepMachines, pinSteps]);
  const pinCount = Object.keys(activePins).length;
  const setPin = (stepName, mac) =>
    setStepMachines((prev) => {
      const next = { ...prev };
      if (mac) next[stepKeyOf(stepName)] = mac;
      else delete next[stepKeyOf(stepName)];
      return next;
    });
  // manual flow: เครื่องของขั้นตอนแรก = แถวแรกของตาราง (บันทึกลง wip_machine ด้วย — pack key / firstMachine เดิม)
  const firstPin = isManualStart && selectedStep ? activePins[stepKeyOf(selectedStep.step_name)] || '' : '';

  const qtyNum = parseFloat(form.qty);

  // เวลารวมต่อ flow (สำหรับ label ใน dropdown) — anchor = วันจบ WIP ถ้ามี ไม่งั้นวันนี้
  const flowTotals = useMemo(() => {
    const map = {};
    if (!modelInfo || !(qtyNum > 0)) return map;
    const now = todayStr();
    const anchor = form.wip_finish_date || now;
    for (const f of flowOptions) {
      const est = estimateFlowTotal(modelInfo, f, qtyNum, anchor, now);
      if (est) map[f] = est;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelInfo, qtyNum, form.wip_finish_date]);

  // ประมาณการ "เหลือกี่วัน" จาก process ที่เลือก (คิดงานตัวเดียวโดด ๆ)
  const estimate = useMemo(() => {
    if (!modelInfo || !isWip) return null;
    if (wipFlow === null || wipStepIndex === null || !(qtyNum > 0)) return null;
    // manual flow ไม่มีวันจบ WIP → นับจากวัน Release หรือวันนี้
    const anchorDate = wipStepIndex === 0 ? (form.release_date || todayStr()) : form.wip_finish_date;
    if (!anchorDate) return null;
    // ล็อกเครื่องรายขั้นตอนไว้ → คิดเวลาด้วย cycle/setup/handling ของเครื่องนั้น ไม่ใช่เครื่องหลัก
    const info = pinCount > 0
      ? { ...modelInfo, steps: withStepMachines(modelInfo.steps, wipFlow, activePins) }
      : modelInfo;
    return estimateFlow(info, {
      flowIndex: wipFlow, startStepIndex: wipStepIndex, qty: qtyNum,
      anchorDate, today: todayStr(),
    });
  }, [modelInfo, isWip, wipFlow, wipStepIndex, activePins, pinCount, form.wip_finish_date, form.release_date, qtyNum]);

  // เทียบ finish vs due → ข้อความ/สี
  const dueCompare = (() => {
    if (!estimate || estimate.insufficient || !form.due_date || !estimate.finish_date) return null;
    const d = diffDays(form.due_date, estimate.finish_date);
    if (d > 0) return { late: true, text: `ช้ากว่า Due ${d} วัน` };
    return { late: false, text: d < 0 ? `เร็วกว่า Due ${-d} วัน` : 'ทันเวลาพอดี' };
  })();

  // ตรวจกับแผนจริง (simulation) — เฉพาะ order ที่บันทึกแล้ว, อิงค่า WIP ที่บันทึก
  const handleVerify = async () => {
    setVerifying(true);
    setRealPlanDate(null);
    try {
      const res = await apiCall('/schedule/replan', {
        method: 'POST',
        body: JSON.stringify({ is_simulation: true }),
      });
      const row = (res.report || []).find((r) => String(r.Batch) === String(order.batch));
      setRealPlanDate(row ? (row.FinishDate || '-') : 'ไม่พบในแผน');
    } catch (err) {
      onError && onError(err.message);
      setRealPlanDate('ตรวจไม่สำเร็จ');
    } finally {
      setVerifying(false);
    }
  };

  const handleSave = async () => {
    setValidated(true);
    if (!form.batch.trim() || !form.model.trim() || form.qty === '' || !form.due_date) return;
    if (isWip && (wipFlow === null || wipStepIndex === null)) return;
    if (isWip && !isManualStart && (!wipMachine || !form.wip_finish_date)) return;

    const payload = {
      batch: form.batch.trim(),
      model: form.model.trim(),
      description: form.description || null,
      qty: parseFloat(form.qty) || 0,
      due_date: form.due_date,
      priority: parseInt(form.priority) || 99,
      plan_mode: form.plan_mode,
      planning_mode: form.planning_mode,
      release_date: form.release_date || null,
      wip_flow_index: isWip ? wipFlow : 0,
      wip_start_step_index: isWip ? wipStepIndex : 0,
      // ขั้นตอนแรก: wip_machine = เครื่องของขั้นตอนแรกที่ล็อก (แถวแรกของตาราง, ว่าง = ให้ระบบเลือก)
      wip_machine: !isWip ? null : isManualStart ? firstPin || null : wipMachine || null,
      // เครื่องที่ล็อกเองรายขั้นตอน — {} = ไม่ล็อก (backend เก็บเป็น NULL)
      step_machines: isWip ? activePins : {},
      wip_finish_date: isWip && !isManualStart ? form.wip_finish_date : null,
      flow_locked: isWip ? 1 : 0,
    };

    setSaving(true);
    try {
      if (isEditing) {
        await apiCall(`/orders/${encodeURIComponent(order.batch)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiCall('/orders', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved(isEditing ? 'แก้ไขสำเร็จ' : 'เพิ่มสำเร็จ');
    } catch (err) {
      onError && onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const invalid = (cond) => (validated && cond ? { isInvalid: true } : {});

  return (
    <Modal show={show} onHide={onHide} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title className="text-mse">
          {isEditing ? 'แก้ไข Order' : 'เพิ่ม Order ใหม่'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          {/* โซน 1: ข้อมูลหลัก */}
          <h6 className="text-mse fw-bold">1. ข้อมูลหลัก (Basic Info)</h6>
          <hr className="mt-1" />
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Batch ID *</Form.Label>
                <Form.Control
                  value={form.batch || ''}
                  disabled={isEditing}
                  onChange={(e) => setField('batch', e.target.value)}
                  {...invalid(!form.batch?.trim())}
                />
                <Form.Control.Feedback type="invalid">ระบุ Batch</Form.Control.Feedback>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Model *</Form.Label>
                <div className="d-flex gap-1">
                  <Form.Control
                    value={form.model || ''}
                    onChange={(e) => {
                      setField('model', e.target.value);
                      // แก้ model → ล้างข้อมูล WIP dropdowns (ตามหน้าจอเดิม)
                      setModelSteps([]);
                      setModelInfo(null);
                      setRealPlanDate(null);
                      setWipFlow(null);
                      setWipStepIndex(null);
                      setWipMachine('');
                    }}
                    {...invalid(!form.model?.trim())}
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={() => fetchModelInfo(form.model)}
                    disabled={loadingInfo}
                    title="โหลดข้อมูล Routing ของ Model"
                  >
                    {loadingInfo ? <Spinner animation="border" size="sm" /> : <i className="bi bi-search" aria-hidden="true" />}
                  </Button>
                </div>
                {validated && !form.model?.trim() && (
                  <div className="invalid-feedback d-block">ระบุ Model</div>
                )}
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <Form.Label>Description (รายละเอียด)</Form.Label>
                <Form.Control
                  value={form.description || ''}
                  onChange={(e) => setField('description', e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Qty *</Form.Label>
                <Form.Control
                  type="number"
                  value={form.qty ?? ''}
                  onChange={(e) => setField('qty', e.target.value)}
                  {...invalid(form.qty === '')}
                />
                <Form.Control.Feedback type="invalid">ระบุ Qty</Form.Control.Feedback>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Priority (Drag to reorder)</Form.Label>
                <Form.Control value={form.priority ?? ''} readOnly className="bg-light" />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Due Date *</Form.Label>
                <Form.Control
                  type="date"
                  value={form.due_date || ''}
                  onChange={(e) => setField('due_date', e.target.value)}
                  {...invalid(!form.due_date)}
                />
                <Form.Control.Feedback type="invalid">ระบุ Date</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          {/* โซน 2: การวางแผน */}
          <h6 className="text-mse fw-bold mt-4">2. การวางแผน (Planning Config)</h6>
          <hr className="mt-1" />
          <Row className="g-3">
            <Col md={4}>
              <Form.Group>
                <Form.Label>Plan Mode</Form.Label>
                <Form.Select
                  value={form.plan_mode || 'NEW'}
                  onChange={(e) => setField('plan_mode', e.target.value)}
                >
                  <option value="NEW">NEW</option>
                  <option value="FIXED">FIXED</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Direction</Form.Label>
                <Form.Select
                  value={form.planning_mode || 'forward'}
                  onChange={(e) => setField('planning_mode', e.target.value)}
                >
                  <option value="forward">Forward</option>
                  <option value="backward">Backward</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Release Date</Form.Label>
                <Form.Control
                  type="date"
                  value={form.release_date || ''}
                  onChange={(e) => setField('release_date', e.target.value)}
                  placeholder="Default = Today"
                />
              </Form.Group>
            </Col>
          </Row>

          {/* โซน 3: WIP */}
          <div className="d-flex align-items-center mt-4">
            <h6 className="text-mse fw-bold mb-0 me-3">3. รายละเอียด WIP (Smart Selection)</h6>
            <Form.Check
              type="switch"
              id="wip-switch"
              label={isWip ? 'Enable' : 'Disable'}
              checked={isWip}
              onChange={(e) => setIsWip(e.target.checked)}
            />
          </div>
          <hr className="mt-1" />
          {!isWip ? (
            <p className="text-muted text-center my-3">
              ปิดใช้งาน WIP (ระบบจะเริ่มวางแผนจากขั้นตอนแรกสุด)
            </p>
          ) : modelSteps.length === 0 ? (
            <Alert variant="warning" className="py-2">
              กำลังโหลดข้อมูล หรือ กดปุ่มค้นหาเพื่อโหลดข้อมูล Model ก่อน
            </Alert>
          ) : (
            <>
            <Row className="g-3">
              <Col md={4}>
                <Form.Group>
                  <Form.Label>1. Select Flow</Form.Label>
                  <Form.Select
                    value={wipFlow ?? ''}
                    onChange={(e) => {
                      const f = e.target.value === '' ? null : parseInt(e.target.value);
                      setWipFlow(f);
                      setWipStepIndex(null);
                      setWipMachine('');
                      setStepMachines({});
                    }}
                    {...invalid(isWip && wipFlow === null)}
                  >
                    <option value="">-- เลือก Flow --</option>
                    {flowOptions.map((f) => (
                      <option key={f} value={f}>
                        Flow {f}: {flowPreview(f)}
                        {flowTotals[f] ? ` (${formatDays(flowTotals[f].days_from_today)})` : ''}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Control.Feedback type="invalid">ระบุ Flow</Form.Control.Feedback>
                  {wipFlow !== null && (
                    <div className="text-muted small mt-1" style={{ wordBreak: 'break-word' }}>
                      Flow {wipFlow}: {flowPreview(wipFlow)}
                      {flowTotals[wipFlow] ? ` (${formatDays(flowTotals[wipFlow].days_from_today)})` : ''}
                    </div>
                  )}
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label>2. Select Process</Form.Label>
                  <Form.Select
                    value={wipStepIndex ?? ''}
                    onChange={(e) => {
                      const s = e.target.value === '' ? null : parseInt(e.target.value);
                      setWipStepIndex(s);
                      setWipMachine('');
                    }}
                    disabled={wipFlow === null}
                    {...invalid(isWip && wipStepIndex === null)}
                  >
                    <option value="">-- เลือก Process --</option>
                    {stepOptions.map((s) => (
                      <option key={`${s.flow_index}_${s.step_index}`} value={s.step_index}>
                        {s.step_name} (Step: {s.step_index})
                        {s.step_index === 0 ? ' — เริ่มต้น ยังไม่ผลิต' : ''}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Control.Feedback type="invalid">ระบุ Process</Form.Control.Feedback>
                </Form.Group>
              </Col>
              {/* manual flow: เครื่องของขั้นตอนแรกย้ายไปอยู่แถวแรกของตาราง "4." ข้างล่าง */}
              {!isManualStart && (
              <Col md={4}>
                <Form.Group>
                  <Form.Label>3. Last Machine</Form.Label>
                  <Form.Select
                    value={wipMachine}
                    onChange={(e) => setWipMachine(e.target.value)}
                    disabled={wipStepIndex === null}
                    {...invalid(isWip && !isManualStart && !wipMachine)}
                  >
                    <option value="">-- เลือกเครื่อง --</option>
                    {machineOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Control.Feedback type="invalid">ระบุ Machine</Form.Control.Feedback>
                </Form.Group>
              </Col>
              )}
              <Col md={4}>
                <Form.Group>
                  <Form.Label>WIP Finish Date</Form.Label>
                  <Form.Control
                    type="date"
                    value={isManualStart ? '' : form.wip_finish_date || ''}
                    onChange={(e) => setField('wip_finish_date', e.target.value)}
                    disabled={isManualStart}
                    {...invalid(isWip && !isManualStart && !form.wip_finish_date)}
                  />
                  <Form.Control.Feedback type="invalid">ระบุวันที่จบ</Form.Control.Feedback>
                </Form.Group>
              </Col>
            </Row>

            {isManualStart && (
              <div className="text-muted small mt-2">
                <i className="bi bi-signpost-split text-mse me-1" aria-hidden="true" />
                ล็อกเส้นทาง Flow {wipFlow} ตั้งแต่ขั้นตอนแรก (ยังไม่ผลิต ไม่ใช่ WIP)
                {' '}— ลำดับคิวและ forward/backward เป็นไปตามที่ตั้งไว้
              </div>
            )}

            {pinSteps.length > 0 && (
              <div className="mt-3">
                <div className="fw-bold small mb-1">
                  4. เครื่องที่ใช้แต่ละขั้นตอน{' '}
                  <span className="text-muted fw-normal">(ไม่บังคับ — ว่าง = ให้ระบบเลือก)</span>
                </div>
                <Table size="sm" bordered className="align-middle mb-1">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 70 }}>Step</th>
                      <th>ขั้นตอน</th>
                      <th style={{ width: '45%' }}>เครื่อง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pinSteps.map((st) => {
                      const own = ownMachinesOf(st);
                      const value = activePins[stepKeyOf(st.step_name)] || '';
                      return (
                        <tr key={`${st.flow_index}_${st.step_index}`}>
                          <td className="num">{st.step_index}</td>
                          <td>{st.step_name}</td>
                          <td>
                            <Form.Select
                              size="sm"
                              aria-label={`เครื่องของขั้นตอน ${st.step_name}`}
                              value={value}
                              onChange={(e) => setPin(st.step_name, e.target.value)}
                            >
                              <option value="">
                                -- ให้ระบบเลือก --{own.length > 1 ? ` (${own.length} เครื่อง)` : ''}
                              </option>
                              {own.map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </Form.Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                <div className="text-muted small">
                  <i className="bi bi-pin-angle me-1" aria-hidden="true" />
                  {pinCount > 0
                    ? `ล็อกเครื่อง ${pinCount} ขั้นตอน — engine ใช้เครื่องนั้นเท่านั้น (ทับการเลือกจากยอดผลิตจริง/แผนเดิม) · ขั้นที่ว่าง engine เลือกเอง`
                    : 'ยังไม่ได้ล็อกเครื่อง — engine เลือกเครื่องเองทุกขั้นตอน'}
                </div>
              </div>
            )}

            {estimate && (
              <div className="mt-3 p-2 rounded border bg-light position-relative">
                {/* overlay ระหว่างโหลดแผนจริง (replan ช้าได้หลายวินาที) */}
                {verifying && (
                  <div
                    className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center bg-white bg-opacity-75 rounded"
                    style={{ zIndex: 5 }}
                  >
                    <Spinner animation="border" className="text-mse mb-2" />
                    <span className="small text-muted">กำลังโหลดแผนจริง อาจใช้เวลาสักครู่...</span>
                  </div>
                )}
                {/* สรุป 1 บรรทัด (โชว์เสมอเมื่อเลือกครบ) */}
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <span>
                    <i className="bi bi-hourglass-split text-mse me-1" aria-hidden="true" />
                    เหลืออีก{estimate.insufficient ? ' มากกว่า ' : ' '}
                    <strong>{formatDays(estimate.days_from_today)}</strong>
                  </span>
                  {!estimate.insufficient && estimate.finish_date && (
                    <span>
                      · เสร็จประมาณ <strong className="num">{estimate.finish_date}</strong>
                      {dueCompare && (
                        <Badge bg={dueCompare.late ? 'danger' : 'success'} className="ms-2">
                          {dueCompare.text}
                        </Badge>
                      )}
                    </span>
                  )}
                  {estimate.total_downtime_days > 0 && (
                    <span className="text-muted">
                      · ข้ามวันหยุด/เครื่องหยุด {estimate.total_downtime_days} วัน
                    </span>
                  )}
                  <Button
                    variant="link"
                    size="sm"
                    className="ms-auto p-0 text-decoration-none"
                    onClick={() => setShowDetail((v) => !v)}
                  >
                    {showDetail ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
                    <i className={`bi ms-1 bi-chevron-${showDetail ? 'up' : 'down'}`} aria-hidden="true" />
                  </Button>
                </div>

                {/* คำเตือน */}
                {estimate.insufficient && (
                  <Alert variant="warning" className="py-1 px-2 mt-2 mb-0 small">
                    ปฏิทินมีถึง {estimate.horizon || '-'} — ประมาณการอาจไม่ครบ กรุณาสร้างปฏิทินเพิ่ม
                  </Alert>
                )}
                {estimate.no_timing && (
                  <div className="text-danger small mt-1">
                    * บาง step ไม่มีข้อมูลเวลา (ตั้งค่า cycle_time ใน machine_config)
                  </div>
                )}
                {estimate.nominal && !estimate.insufficient && (
                  <div className="text-muted small mt-1">
                    * บาง step ไม่มีปฏิทิน ใช้ค่าประมาณ ~1240 นาที/วัน
                  </div>
                )}

                {/* ตารางละเอียดต่อ step */}
                {showDetail && (
                  <Table size="sm" bordered className="mt-2 mb-1 align-middle small">
                    <thead>
                      <tr className="text-muted">
                        <th>Process</th>
                        <th>เครื่อง</th>
                        <th>C/T</th>
                        <th>เวลา (เพราะอะไร)</th>
                        <th className="text-end">≈ วัน</th>
                        <th>เริ่ม → เสร็จ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimate.steps.map((s, i) => (
                        <tr
                          key={`${s.step_index}_${i}`}
                          className={
                            i === 0 ? 'table-primary' : s.is_day_unit ? 'table-warning' : ''
                          }
                        >
                          <td>
                            {s.step_name}
                            {i === 0 && <span className="text-mse"> (เริ่ม WIP)</span>}
                          </td>
                          <td>{s.machine || '-'}</td>
                          <td className="num">{formatCT(s)}</td>
                          <td>{stepReason(s)}</td>
                          <td className="text-end num">
                            {formatDays(s.working_days)}
                          </td>
                          <td className="num">
                            {s.start_date} → {s.finish_date}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}

                {/* ปุ่มตรวจกับแผนจริง */}
                <div className="d-flex align-items-center gap-2 mt-2 pt-2 border-top">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={handleVerify}
                    disabled={verifying || !isEditing}
                    title={isEditing ? '' : 'บันทึกก่อนจึงตรวจกับแผนจริงได้'}
                  >
                    {verifying ? <Spinner animation="border" size="sm" /> : 'ตรวจกับแผนจริง'}
                  </Button>
                  {realPlanDate && (
                    <span className="small">
                      แผนจริง: <strong className="num">{realPlanDate}</strong>{' '}
                      <span className="text-muted">(อิงค่าที่บันทึกแล้ว)</span>
                    </span>
                  )}
                  <span className="text-muted small ms-auto">
                    ประมาณการ (ถ้าเครื่องว่าง) · คิดจากเครื่องหลัก
                  </span>
                </div>
              </div>
            )}
            </>
          )}
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={handleSave} disabled={saving}>
          {saving ? <Spinner animation="border" size="sm" /> : 'บันทึก'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default OrderFormDialog;
