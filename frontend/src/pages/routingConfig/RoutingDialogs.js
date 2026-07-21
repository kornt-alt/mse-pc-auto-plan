// Dialog ย่อยของหน้า Routing Config — port จาก routing_config_screen.dart (dialog inline หลายตัว)
// ทุก dialog เรียก apiCall เอง แล้วรายงานกลับผ่าน onSaved(message) / onError(message)
// (parent ใช้ toast + refresh) — callbacks จาก parent ต้องเป็น useCallback
import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { apiCall } from '../../api/client';

// dropdown เครื่องจักร — รับ list จาก parent (parent ดึง /production/machines ครั้งเดียว)
const MachineSelect = ({ value, machines, onChange, disabled }) => (
  <Form.Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
    <option value="">-- เลือกเครื่อง --</option>
    {machines.map((m) => (
      <option key={m} value={m}>
        {m}
      </option>
    ))}
    {/* ค่าปัจจุบันไม่อยู่ใน list (เครื่องเก่า) — ยังโชว์ได้ */}
    {value && !machines.includes(value) ? <option value={value}>{value}</option> : null}
  </Form.Select>
);

const toInt = (v) => parseInt(v, 10) || 0;
const toFloat = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ===== แก้ไข Routing step (PUT /routing_config/:id) =====
export const EditRoutingDialog = ({ show, row, onHide, onSaved, onError }) => {
  const [form, setForm] = useState({ flow_index: 0, step_index: 0, step_name: '', setup_group: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show && row) {
      setForm({
        flow_index: row.flow_index ?? 0,
        step_index: row.step_index ?? 0,
        step_name: row.step_name ?? '',
        setup_group: row.setup_group ?? '',
      });
    }
  }, [show, row]);

  const save = async () => {
    setBusy(true);
    try {
      await apiCall(`/routing_config/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          flow_index: toInt(form.flow_index),
          step_index: toInt(form.step_index),
          step_name: form.step_name,
          setup_group: form.setup_group,
        }),
      });
      onSaved('✅ บันทึก Routing สำเร็จ!');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>✏️ แก้ไข Routing</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-2">
          <Col xs={6}>
            <Form.Label className="small">Flow Index</Form.Label>
            <Form.Control
              type="number"
              value={form.flow_index}
              onChange={(e) => setForm((f) => ({ ...f, flow_index: e.target.value }))}
            />
          </Col>
          <Col xs={6}>
            <Form.Label className="small">Step Index</Form.Label>
            <Form.Control
              type="number"
              value={form.step_index}
              onChange={(e) => setForm((f) => ({ ...f, step_index: e.target.value }))}
            />
          </Col>
          <Col xs={12}>
            <Form.Label className="small">Step Name</Form.Label>
            <Form.Control
              value={form.step_name}
              onChange={(e) => setForm((f) => ({ ...f, step_name: e.target.value }))}
            />
          </Col>
          <Col xs={12}>
            <Form.Label className="small">Setup Group</Form.Label>
            <Form.Control
              value={form.setup_group}
              onChange={(e) => setForm((f) => ({ ...f, setup_group: e.target.value }))}
            />
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={save} disabled={busy}>
          บันทึก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== แก้ไข Machine config (PUT /machine_config/:id) =====
export const EditMachineDialog = ({ show, row, machines, onHide, onSaved, onError }) => {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show && row) {
      setForm({
        flow_index: row.flow_index ?? 0,
        step_index: row.step_index ?? 0,
        alternative_index: row.alternative_index ?? 0,
        machine: row.machine ?? '',
        cycle_time: row.cycle_time ?? 0,
        setup_time: row.setup_time ?? 0,
        jig_id: row.jig_id ?? '',
      });
    }
  }, [show, row]);

  const save = async () => {
    setBusy(true);
    try {
      await apiCall(`/machine_config/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          flow_index: toInt(form.flow_index),
          step_index: toInt(form.step_index),
          alternative_index: toInt(form.alternative_index),
          machine: form.machine,
          cycle_time: toFloat(form.cycle_time),
          setup_time: toFloat(form.setup_time),
          jig_id: form.jig_id,
        }),
      });
      onSaved('✅ บันทึก Machine Config สำเร็จ!');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>✏️ แก้ไข Machine Config</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-2">
          <Col xs={4}>
            <Form.Label className="small">Flow</Form.Label>
            <Form.Control
              type="number"
              value={form.flow_index}
              onChange={(e) => setForm((f) => ({ ...f, flow_index: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Step</Form.Label>
            <Form.Control
              type="number"
              value={form.step_index}
              onChange={(e) => setForm((f) => ({ ...f, step_index: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Alt</Form.Label>
            <Form.Control
              type="number"
              value={form.alternative_index}
              onChange={(e) => setForm((f) => ({ ...f, alternative_index: e.target.value }))}
            />
          </Col>
          <Col xs={12}>
            <Form.Label className="small">Machine</Form.Label>
            <MachineSelect
              value={form.machine}
              machines={machines}
              onChange={(v) => setForm((f) => ({ ...f, machine: v }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Cycle Time</Form.Label>
            <Form.Control
              type="number"
              value={form.cycle_time}
              onChange={(e) => setForm((f) => ({ ...f, cycle_time: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Setup Time</Form.Label>
            <Form.Control
              type="number"
              value={form.setup_time}
              onChange={(e) => setForm((f) => ({ ...f, setup_time: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Jig ID</Form.Label>
            <Form.Control
              value={form.jig_id}
              onChange={(e) => setForm((f) => ({ ...f, jig_id: e.target.value }))}
            />
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={save} disabled={busy}>
          บันทึก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== แทรก Step (POST /routing_config/insert_step) =====
export const InsertStepDialog = ({ show, model, flows, machines, onHide, onSaved, onError }) => {
  const [form, setForm] = useState({
    flow_index: 0,
    step_index: 0,
    step_name: '',
    setup_group: '',
    machine: '',
    cycle_time: 1,
    setup_time: 1,
    jig_id: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) {
      setForm({
        flow_index: flows?.[0] ?? 0,
        step_index: 0,
        step_name: '',
        setup_group: '',
        machine: '',
        cycle_time: 1,
        setup_time: 1,
        jig_id: '',
      });
    }
  }, [show, flows]);

  const save = async () => {
    setBusy(true);
    try {
      await apiCall('/routing_config/insert_step', {
        method: 'POST',
        body: JSON.stringify({
          model,
          flow_index: toInt(form.flow_index),
          step_index: toInt(form.step_index),
          step_name: form.step_name,
          setup_group: form.setup_group,
          machine: form.machine,
          cycle_time: toFloat(form.cycle_time),
          setup_time: toFloat(form.setup_time),
          jig_id: form.jig_id,
        }),
      });
      onSaved('✅ แทรก Step สำเร็จ!');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>➕ แทรก Step ใหม่ ({model})</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">Step ตั้งแต่ตำแหน่งนี้จะถูกเลื่อนลง 1 ตำแหน่ง</p>
        <Row className="g-2">
          <Col xs={6}>
            <Form.Label className="small">Flow Index</Form.Label>
            <Form.Control
              type="number"
              value={form.flow_index}
              onChange={(e) => setForm((f) => ({ ...f, flow_index: e.target.value }))}
            />
          </Col>
          <Col xs={6}>
            <Form.Label className="small">Step Index (ตำแหน่งแทรก)</Form.Label>
            <Form.Control
              type="number"
              value={form.step_index}
              onChange={(e) => setForm((f) => ({ ...f, step_index: e.target.value }))}
            />
          </Col>
          <Col xs={6}>
            <Form.Label className="small">Step Name</Form.Label>
            <Form.Control
              value={form.step_name}
              onChange={(e) => setForm((f) => ({ ...f, step_name: e.target.value }))}
            />
          </Col>
          <Col xs={6}>
            <Form.Label className="small">Setup Group</Form.Label>
            <Form.Control
              value={form.setup_group}
              onChange={(e) => setForm((f) => ({ ...f, setup_group: e.target.value }))}
            />
          </Col>
          <Col xs={12}>
            <Form.Label className="small">Machine (Alt 0)</Form.Label>
            <MachineSelect
              value={form.machine}
              machines={machines}
              onChange={(v) => setForm((f) => ({ ...f, machine: v }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Cycle Time</Form.Label>
            <Form.Control
              type="number"
              value={form.cycle_time}
              onChange={(e) => setForm((f) => ({ ...f, cycle_time: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Setup Time</Form.Label>
            <Form.Control
              type="number"
              value={form.setup_time}
              onChange={(e) => setForm((f) => ({ ...f, setup_time: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Jig ID</Form.Label>
            <Form.Control
              value={form.jig_id}
              onChange={(e) => setForm((f) => ({ ...f, jig_id: e.target.value }))}
            />
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={save} disabled={busy || !form.machine}>
          แทรก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== เพิ่มเครื่องสำรอง (POST /machine_config/insert_alt) =====
export const InsertAltDialog = ({ show, model, step, machines, onHide, onSaved, onError }) => {
  const [form, setForm] = useState({ machine: '', cycle_time: 1, setup_time: 1, jig_id: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) setForm({ machine: '', cycle_time: 1, setup_time: 1, jig_id: '' });
  }, [show]);

  const save = async () => {
    setBusy(true);
    try {
      await apiCall('/machine_config/insert_alt', {
        method: 'POST',
        body: JSON.stringify({
          model,
          flow_index: step?.flow_index ?? 0,
          step_index: step?.step_index ?? 0,
          machine: form.machine,
          cycle_time: toFloat(form.cycle_time),
          setup_time: toFloat(form.setup_time),
          jig_id: form.jig_id,
        }),
      });
      onSaved('✅ เพิ่มเครื่องสำรองสำเร็จ!');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          ➕ เพิ่มเครื่องสำรอง (Flow {step?.flow_index}, Step {step?.step_index})
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-2">
          <Col xs={12}>
            <Form.Label className="small">Machine</Form.Label>
            <MachineSelect
              value={form.machine}
              machines={machines}
              onChange={(v) => setForm((f) => ({ ...f, machine: v }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Cycle Time</Form.Label>
            <Form.Control
              type="number"
              value={form.cycle_time}
              onChange={(e) => setForm((f) => ({ ...f, cycle_time: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Setup Time</Form.Label>
            <Form.Control
              type="number"
              value={form.setup_time}
              onChange={(e) => setForm((f) => ({ ...f, setup_time: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">Jig ID</Form.Label>
            <Form.Control
              value={form.jig_id}
              onChange={(e) => setForm((f) => ({ ...f, jig_id: e.target.value }))}
            />
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={save} disabled={busy || !form.machine}>
          เพิ่ม
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== เพิ่ม Flow ใหม่ (POST /routing_config/add_flow) =====
export const AddFlowDialog = ({ show, model, machines, onHide, onSaved, onError }) => {
  const [machine, setMachine] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) setMachine('');
  }, [show]);

  const save = async () => {
    setBusy(true);
    try {
      await apiCall('/routing_config/add_flow', {
        method: 'POST',
        body: JSON.stringify({ model, machine }),
      });
      onSaved('✅ เพิ่ม Flow ใหม่สำเร็จ!');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>➕ เพิ่ม Flow ใหม่ ({model})</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">ระบบจะสร้าง Step แรก "1ST" ให้อัตโนมัติ</p>
        <Form.Label className="small">เครื่องเริ่มต้น</Form.Label>
        <MachineSelect value={machine} machines={machines} onChange={setMachine} />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={save} disabled={busy || !machine}>
          เพิ่ม Flow
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== ลบ Flow (DELETE /routing_config/delete_flow?model=&flow_index=&is_last_flow=) =====
export const DeleteFlowDialog = ({ show, model, flows, onHide, onSaved, onError }) => {
  const [flowIndex, setFlowIndex] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) setFlowIndex(flows?.length ? String(flows[0]) : '');
  }, [show, flows]);

  // ตรงกับ Dart (routing_config_screen.dart L1386): isLastFlow = distinct flow_index <= 1
  // backend branch is_last_flow=true จะยุบทั้ง model เหลือ flow 0/step 0 — ต้องเป็น "flow เดียวที่เหลือ" เท่านั้น
  const isLastFlow = (flows?.length ?? 0) <= 1;

  const save = async () => {
    setBusy(true);
    try {
      const qs = `model=${encodeURIComponent(model)}&flow_index=${toInt(flowIndex)}&is_last_flow=${isLastFlow}`;
      await apiCall(`/routing_config/delete_flow?${qs}`, { method: 'DELETE' });
      onSaved(`✅ ลบ Flow ${flowIndex} สำเร็จ!`);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }} className="text-danger">
          🗑️ ลบ Flow ({model})
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Label className="small">เลือก Flow ที่จะลบ</Form.Label>
        <Form.Select value={flowIndex} onChange={(e) => setFlowIndex(e.target.value)}>
          {(flows ?? []).map((f) => (
            <option key={f} value={f}>
              Flow {f}
            </option>
          ))}
        </Form.Select>
        <p className="text-muted small mt-2">
          {isLastFlow
            ? '⚠️ เป็น Flow สุดท้าย — ระบบจะยุบเหลือ Step เดียว (flow 0)'
            : 'Flow ที่มากกว่าจะถูกเลื่อนลำดับลง 1'}
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button variant="danger" onClick={save} disabled={busy || flowIndex === ''}>
          ลบ Flow
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== แก้ Setup Group ทั้ง model (PUT /product_master/update_setup/:model) =====
export const BulkSetupGroupDialog = ({ show, model, onHide, onSaved, onError }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) setValue('');
  }, [show]);

  const save = async () => {
    setBusy(true);
    try {
      await apiCall(`/product_master/update_setup/${encodeURIComponent(model)}`, {
        method: 'PUT',
        body: JSON.stringify({ new_setup_group: value }),
      });
      onSaved('✅ แก้ Setup Group สำเร็จ!');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>Change Setup Group ({model})</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">อัปเดต setup_group ในตาราง product_master ของ model นี้</p>
        <Form.Label className="small">Setup Group ใหม่</Form.Label>
        <Form.Control value={value} onChange={(e) => setValue(e.target.value)} />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={save} disabled={busy || !value}>
          บันทึก
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== confirm ลบทั่วไป (routing step / machine) =====
export const ConfirmDeleteDialog = ({ show, title, message, onHide, onConfirm, busy }) => (
  <Modal show={show} onHide={onHide} centered>
    <Modal.Header closeButton>
      <Modal.Title style={{ fontSize: '1.1rem' }} className="text-danger">
        {title || 'ยืนยันการลบ'}
      </Modal.Title>
    </Modal.Header>
    <Modal.Body>{message}</Modal.Body>
    <Modal.Footer>
      <Button variant="secondary" onClick={onHide} disabled={busy}>
        ยกเลิก
      </Button>
      <Button variant="danger" onClick={onConfirm} disabled={busy}>
        ลบ
      </Button>
    </Modal.Footer>
  </Modal>
);

export { MachineSelect };
