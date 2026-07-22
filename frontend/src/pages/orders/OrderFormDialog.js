import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Form, Button, Row, Col, Spinner, Alert } from 'react-bootstrap';
import { apiCall } from '../../api/client';

// Dialog เพิ่ม/แก้ไข Order — โครง 3 โซนตามหน้าจอเดิม (order_management_screen.dart)
const OrderFormDialog = ({ show, onHide, order, maxPriority, onSaved, onError }) => {
  const isEditing = !!order;

  const [form, setForm] = useState({});
  const [modelSteps, setModelSteps] = useState([]); // จาก GET /orders/model-info
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [isWip, setIsWip] = useState(false);
  const [wipFlow, setWipFlow] = useState(null);
  const [wipStepIndex, setWipStepIndex] = useState(null);
  const [wipMachine, setWipMachine] = useState('');
  const [saving, setSaving] = useState(false);
  const [validated, setValidated] = useState(false);

  const fetchModelInfo = useCallback(async (modelName, presetOrder = null) => {
    if (!modelName) return;
    setLoadingInfo(true);
    try {
      const data = await apiCall(`/orders/model-info/${encodeURIComponent(modelName.trim())}`);
      const steps = data.found ? data.steps : [];
      setModelSteps(steps);
      // ตอน edit: map ค่า WIP เดิมกลับเข้า dropdown (ถ้ายังอยู่ในลิสต์)
      if (presetOrder) {
        const flow = presetOrder.wip_flow_index ?? null;
        const stepIdx = presetOrder.wip_start_step_index ?? null;
        setWipFlow(flow);
        setWipStepIndex(stepIdx);
        const step = steps.find((s) => s.flow_index === flow && s.step_index === stepIdx);
        const machines = step ? step.previous_machines : [];
        setWipMachine(machines.includes(presetOrder.wip_machine) ? presetOrder.wip_machine : '');
      }
    } catch (err) {
      onError && onError(err.message);
      setModelSteps([]);
    } finally {
      setLoadingInfo(false);
    }
  }, [onError]);

  useEffect(() => {
    if (!show) return;
    setValidated(false);
    setModelSteps([]);
    setWipFlow(null);
    setWipStepIndex(null);
    setWipMachine('');

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
      const hasWip =
        (order.wip_flow_index ?? 0) > 0 || (order.wip_start_step_index ?? 0) > 0;
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
  const flowPreview = (f) => {
    const names = modelSteps.filter((s) => s.flow_index === f).map((s) => s.step_name).join(' > ');
    return names.length > 50 ? `${names.slice(0, 50)}...` : names;
  };
  const stepOptions = modelSteps.filter((s) => s.flow_index === wipFlow && s.step_index > 0);
  const selectedStep = stepOptions.find((s) => s.step_index === wipStepIndex);
  const machineOptions = selectedStep ? selectedStep.previous_machines : [];

  const handleSave = async () => {
    setValidated(true);
    if (!form.batch.trim() || !form.model.trim() || form.qty === '' || !form.due_date) return;
    if (isWip && (wipFlow === null || wipStepIndex === null || !wipMachine || !form.wip_finish_date)) return;

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
      wip_machine: isWip ? wipMachine : null,
      wip_finish_date: isWip ? form.wip_finish_date : null,
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
                    }}
                    {...invalid(isWip && wipFlow === null)}
                  >
                    <option value="">-- เลือก Flow --</option>
                    {flowOptions.map((f) => (
                      <option key={f} value={f}>
                        Flow {f}: {flowPreview(f)}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Control.Feedback type="invalid">ระบุ Flow</Form.Control.Feedback>
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
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Control.Feedback type="invalid">ระบุ Process</Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label>3. Last Machine</Form.Label>
                  <Form.Select
                    value={wipMachine}
                    onChange={(e) => setWipMachine(e.target.value)}
                    disabled={wipStepIndex === null}
                    {...invalid(isWip && !wipMachine)}
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
              <Col md={4}>
                <Form.Group>
                  <Form.Label>WIP Finish Date</Form.Label>
                  <Form.Control
                    type="date"
                    value={form.wip_finish_date || ''}
                    onChange={(e) => setField('wip_finish_date', e.target.value)}
                    {...invalid(isWip && !form.wip_finish_date)}
                  />
                  <Form.Control.Feedback type="invalid">ระบุวันที่จบ</Form.Control.Feedback>
                </Form.Group>
              </Col>
            </Row>
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
