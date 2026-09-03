// Dialog ย่อยของหน้า Routing Config — port จาก routing_config_screen.dart (dialog inline หลายตัว)
// ทุก dialog เรียก apiCall เอง แล้วรายงานกลับผ่าน onSaved(message) / onError(message)
// (parent ใช้ toast + refresh) — callbacks จาก parent ต้องเป็น useCallback
import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col, Collapse } from 'react-bootstrap';
import { apiCall } from '../../api/client';
// สูตรตั้งชื่อ jig อัตโนมัติอยู่ที่เดียว — หน้า Jig ใช้ตัวเดียวกันตอนถอดการผูก jig ออก
import { resolveJigId } from './jigNaming';

// ช่องแก้เลข index ด้วยมือ — พับไว้เป็นค่าเริ่มต้น
// ทางปกติของการจัดลำดับคือปุ่ม ▲▼ ในตาราง (POST /routing_config/move ที่สลับสองตารางพร้อมกัน
// ใน transaction เดียว) การพิมพ์เลขเองยังทำได้เพราะบางทีต้องย้ายข้าม flow หรือแก้แถวที่หลุด
// แต่ backend UPDATE ตามที่ส่งไปตรง ๆ ไม่ตรวจอะไร เลขซ้ำ/ข้ามจึงหลุดลง DB ได้เงียบ ๆ
const AdvancedIndexPanel = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="p-0 text-secondary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'} me-1`} aria-hidden="true" />
        แก้ index เอง (ขั้นสูง)
      </Button>
      <Collapse in={open}>
        <div>
          <p className="text-muted small mt-2 mb-1">
            ปกติใช้ปุ่ม ▲▼ ในตารางจัดลำดับแทน — เลขที่ซ้ำหรือข้ามจะทำให้ routing เพี้ยนโดยไม่มีคำเตือน
          </p>
          <Row className="g-2">{children}</Row>
        </div>
      </Collapse>
    </>
  );
};

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

// ค่าพิเศษของดรอปดาวน์ jig — เลือกแล้วสลับกลับไปเป็นช่องพิมพ์อิสระ
const JIG_CUSTOM = '__custom__';

// ===== ช่อง Jig: เลือกจากทะเบียน jig_master หรือพิมพ์รหัสใหม่ =====
//
// ⚠️ การเลือก jig ที่ใช้ร่วมกันได้ **เปลี่ยนผลการคำนวณแผน** ไม่ใช่แค่ป้ายกำกับ:
// engine.getSmartSetupTime() ลดเวลา setup เหลือ minor setup เมื่องานติดกันบนเครื่องเดียวกัน
// ใช้ jig เดียวกัน — ถ้าของจริงต้องเปลี่ยน jig อยู่ดี แผนจะสั้นกว่าความจริงแบบเงียบ ๆ
// จึงต้องมีข้อความใต้ช่องบอกตรง ๆ ทุกครั้งที่เลือก jig ที่ใช้ร่วมกัน
//
// ⚠️ `is_shared` **ไม่ได้กรองรายการในดรอปดาวน์** — มันคุมแค่ป้ายกำกับกับข้อความเตือนใต้ช่อง
// (เคยคิดจะกรอง jig ที่ is_shared = 0 ออกเมื่ออยู่คนละโมเดล แต่ทำไม่ได้ด้วยข้อมูลที่มี:
//  `GET /jig` คืนแค่ *จำนวน* ที่ใช้อยู่ ไม่ได้คืนรายชื่อโมเดล และ `EditMachineDialog`
//  ไม่ได้รับ `model` เข้ามาเลย จะกรองต้องแก้ทั้ง payload ของ endpoint และ signature ของไดอะล็อก)
// ตัวที่กันความผิดพลาดจริงตอนนี้คือข้อความเตือน ไม่ใช่การกรอง — อย่าเขียนเอกสารว่ามันกรอง
const JigSelect = ({ value, jigs, onChange, disabled }) => {
  const list = Array.isArray(jigs) ? jigs : [];
  const known = list.some((j) => j.jig_id === value);
  // ไม่มีทะเบียนเลย (ยังไม่รัน DDL) → กลับไปเป็นช่องพิมพ์เปล่าเหมือนเดิม ไม่ขวางการทำงาน
  const [custom, setCustom] = useState(list.length === 0 || (!!value && !known));

  const selected = list.find((j) => j.jig_id === value);

  if (custom) {
    return (
      <>
        <Form.Control
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="เว้นว่างเพื่อให้ระบบตั้งชื่อให้อัตโนมัติ"
        />
        {list.length > 0 && (
          <Button variant="link" size="sm" className="p-0 mt-1" onClick={() => setCustom(false)}>
            เลือกจากทะเบียน Jig แทน
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <Form.Select
        value={known ? value : ''}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === JIG_CUSTOM) {
            setCustom(true);
            onChange('');
            return;
          }
          onChange(e.target.value);
        }}
      >
        <option value="">-- ให้ระบบตั้งชื่อให้อัตโนมัติ --</option>
        {list.map((j) => (
          <option key={j.jig_id} value={j.jig_id}>
            {j.jig_id}
            {j.jig_name ? ` — ${j.jig_name}` : ''}
            {j.is_shared ? ' (ใช้ร่วมกันได้)' : ''}
          </option>
        ))}
        <option value={JIG_CUSTOM}>+ พิมพ์รหัสจิ๊กใหม่</option>
      </Form.Select>
      {selected?.is_shared ? (
        <Form.Text className="text-warning-emphasis">
          <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true" />
          จิ๊กตัวนี้ใช้ร่วมกันได้ — งานที่ใช้จิ๊กเดียวกันลงเครื่องเดียวกันติดกันจะคิดเวลาตั้งเครื่อง
          แบบสั้น (ค่า minor setup ในหน้าตั้งค่า) เลือกเมื่อของจริงไม่ต้องเปลี่ยนจิ๊กเท่านั้น
        </Form.Text>
      ) : (
        <Form.Text muted>
          เว้นว่าง = ระบบตั้งชื่อเฉพาะของขั้นตอนนี้ให้ (ไม่ได้ส่วนลดเวลาตั้งเครื่อง)
        </Form.Text>
      )}
    </>
  );
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
      onSaved('บันทึก Routing แล้ว');
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
          <i className="bi bi-pencil-square me-2" aria-hidden="true" />
          แก้ไขขั้นตอนการผลิต
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-2 mb-3">
          <Col xs={12}>
            <Form.Label className="small">ชื่อขั้นตอน</Form.Label>
            <Form.Control
              value={form.step_name}
              onChange={(e) => setForm((f) => ({ ...f, step_name: e.target.value }))}
            />
          </Col>
          <Col xs={12}>
            <Form.Label className="small">กลุ่มการตั้งเครื่อง (Setup Group)</Form.Label>
            <Form.Control
              value={form.setup_group}
              onChange={(e) => setForm((f) => ({ ...f, setup_group: e.target.value }))}
            />
          </Col>
        </Row>
        <AdvancedIndexPanel>
          <Col xs={6}>
            <Form.Label className="small">เลขกำกับสายการผลิต</Form.Label>
            <Form.Control
              type="number"
              value={form.flow_index}
              onChange={(e) => setForm((f) => ({ ...f, flow_index: e.target.value }))}
            />
          </Col>
          <Col xs={6}>
            <Form.Label className="small">เลขกำกับขั้นตอน</Form.Label>
            <Form.Control
              type="number"
              value={form.step_index}
              onChange={(e) => setForm((f) => ({ ...f, step_index: e.target.value }))}
            />
          </Col>
        </AdvancedIndexPanel>
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
export const EditMachineDialog = ({ show, row, machines, jigs, onHide, onSaved, onError }) => {
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
        handling_time: row.handling_time ?? 0,
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
          handling_time: toFloat(form.handling_time),
          setup_time: toFloat(form.setup_time),
          jig_id: form.jig_id,
        }),
      });
      onSaved('บันทึก Machine Config แล้ว');
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
          <i className="bi bi-pencil-square me-2" aria-hidden="true" />
          แก้ไขเครื่องจักร
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-2 mb-3">
          <Col xs={12}>
            <Form.Label className="small">เครื่องจักร</Form.Label>
            <MachineSelect
              value={form.machine}
              machines={machines}
              onChange={(v) => setForm((f) => ({ ...f, machine: v }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">เวลาต่อชิ้น (นาที)</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.cycle_time}
              onChange={(e) => setForm((f) => ({ ...f, cycle_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small" title="ระบบบวกเข้ากับเวลาต่อชิ้นตอนคำนวณแผน">
              เวลาหยิบจับ (นาที/ชิ้น)
            </Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.handling_time}
              onChange={(e) => setForm((f) => ({ ...f, handling_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">เวลาตั้งเครื่อง (นาที)</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.setup_time}
              onChange={(e) => setForm((f) => ({ ...f, setup_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">รหัสจิ๊ก</Form.Label>
            <JigSelect
              value={form.jig_id}
              jigs={jigs}
              onChange={(v) => setForm((f) => ({ ...f, jig_id: v }))}
            />
          </Col>
        </Row>
        <AdvancedIndexPanel>
          <Col xs={4}>
            <Form.Label className="small">เลขกำกับสายการผลิต</Form.Label>
            <Form.Control
              type="number"
              value={form.flow_index}
              onChange={(e) => setForm((f) => ({ ...f, flow_index: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">เลขกำกับขั้นตอน</Form.Label>
            <Form.Control
              type="number"
              value={form.step_index}
              onChange={(e) => setForm((f) => ({ ...f, step_index: e.target.value }))}
            />
          </Col>
          <Col xs={4}>
            <Form.Label className="small">ลำดับเครื่องสำรอง</Form.Label>
            <Form.Control
              type="number"
              value={form.alternative_index}
              onChange={(e) => setForm((f) => ({ ...f, alternative_index: e.target.value }))}
            />
          </Col>
        </AdvancedIndexPanel>
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

// ===== แทรกขั้นตอน (POST /routing_config/insert_step) =====
// defaults = insertStepDefaults(flow) จาก routingTree.js — { flowIndex, stepIndex, setupGroup, steps }
// ค่าเริ่มต้นคือ "ต่อท้าย flow ที่กด + Step มา" (ของเดิม default step_index = 0 = แทรกหัวสุดเสมอ)
export const InsertStepDialog = ({ show, model, defaults, machines, jigs, onHide, onSaved, onError }) => {
  const [form, setForm] = useState({
    flow_index: 0,
    step_index: 0,
    step_name: '',
    setup_group: '',
    machine: '',
    cycle_time: 1,
    // เวลาหยิบจับเริ่มที่ 0 ไม่ใช่ 1 — ค่าเริ่มต้น 0 คือ "ไม่มีเวลาหยิบจับ" = พฤติกรรมเดิมของระบบ
    handling_time: 0,
    setup_time: 1,
    jig_id: '',
  });
  const [busy, setBusy] = useState(false);

  const appendIndex = defaults?.stepIndex ?? 0;
  const existingSteps = defaults?.steps ?? [];

  useEffect(() => {
    if (show) {
      setForm({
        flow_index: defaults?.flowIndex ?? 0,
        step_index: defaults?.stepIndex ?? 0,
        step_name: '',
        setup_group: defaults?.setupGroup ?? '',
        machine: '',
        cycle_time: 1,
        handling_time: 0,
        setup_time: 1,
        jig_id: '',
      });
    }
  }, [show, defaults]);

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
          handling_time: toFloat(form.handling_time),
          setup_time: toFloat(form.setup_time),
          jig_id: resolveJigId(form.jig_id, model, form.machine, form.step_index),
        }),
      });
      onSaved('แทรกขั้นตอน แล้ว');
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
          <i className="bi bi-plus-lg me-2" aria-hidden="true" />
          แทรกขั้นตอน ใหม่ ({model}) — Flow {form.flow_index}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-2">
          <Col xs={12}>
            <Form.Label className="small">ตำแหน่ง</Form.Label>
            {/* เลือกตำแหน่งจากรายการ step จริง แทนการพิมพ์เลข index เอง
                (insert_step เลื่อน step ตั้งแต่เลขนี้ลง 1 ตำแหน่ง — "แทรกก่อน Step N" จึงส่ง N ไปตรง ๆ) */}
            <Form.Select
              value={form.step_index}
              onChange={(e) => setForm((f) => ({ ...f, step_index: e.target.value }))}
            >
              <option value={appendIndex}>ต่อท้ายสายการผลิตนี้ (เป็นขั้นสุดท้าย)</option>
              {existingSteps.map((s) => (
                <option key={s.stepIndex} value={s.stepIndex}>
                  แทรกก่อน Step {s.stepIndex}
                  {s.stepName ? ` — ${s.stepName}` : ''}
                </option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">
              Step ตั้งแต่ตำแหน่งที่เลือกจะถูกเลื่อนลง 1 ตำแหน่ง
            </Form.Text>
          </Col>
          <Col xs={6}>
            <Form.Label className="small">ชื่อขั้นตอน</Form.Label>
            <Form.Control
              value={form.step_name}
              onChange={(e) => setForm((f) => ({ ...f, step_name: e.target.value }))}
            />
          </Col>
          <Col xs={6}>
            <Form.Label className="small">กลุ่มการตั้งเครื่อง (Setup Group)</Form.Label>
            <Form.Control
              value={form.setup_group}
              onChange={(e) => setForm((f) => ({ ...f, setup_group: e.target.value }))}
            />
          </Col>
          <Col xs={12}>
            <Form.Label className="small">เครื่องหลักของขั้นนี้</Form.Label>
            <MachineSelect
              value={form.machine}
              machines={machines}
              onChange={(v) => setForm((f) => ({ ...f, machine: v }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">เวลาต่อชิ้น (นาที)</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.cycle_time}
              onChange={(e) => setForm((f) => ({ ...f, cycle_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small" title="ระบบบวกเข้ากับเวลาต่อชิ้นตอนคำนวณแผน">
              เวลาหยิบจับ (นาที/ชิ้น)
            </Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.handling_time}
              onChange={(e) => setForm((f) => ({ ...f, handling_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">เวลาตั้งเครื่อง (นาที)</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.setup_time}
              onChange={(e) => setForm((f) => ({ ...f, setup_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">รหัสจิ๊ก</Form.Label>
            <JigSelect
              value={form.jig_id}
              jigs={jigs}
              onChange={(v) => setForm((f) => ({ ...f, jig_id: v }))}
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
// primary = เครื่องหลัก (alt ต่ำสุด) ของ step นั้น — ใช้ prefill cycle/setup
// เพราะเครื่องสำรองของ step เดียวกันเกือบทุกครั้งใช้เวลาใกล้เคียงตัวหลัก (ของเดิมเริ่มที่ 1 เสมอ)
export const InsertAltDialog = ({ show, model, step, primary, machines, jigs, onHide, onSaved, onError }) => {
  const [form, setForm] = useState({ machine: '', cycle_time: 1, handling_time: 0, setup_time: 1, jig_id: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (show) {
      setForm({
        machine: '',
        cycle_time: primary?.cycleTime ?? 1,
        handling_time: primary?.handlingTime ?? 0,
        setup_time: primary?.setupTime ?? 1,
        jig_id: '',
      });
    }
  }, [show, primary]);

  const save = async () => {
    setBusy(true);
    try {
      await apiCall('/machine_config/insert_alt', {
        method: 'POST',
        body: JSON.stringify({
          model,
          // step มาจาก routingTree.js (คีย์ camelCase) ไม่ใช่แถวดิบจาก DB แล้ว
          flow_index: step?.flowIndex ?? 0,
          step_index: step?.stepIndex ?? 0,
          machine: form.machine,
          cycle_time: toFloat(form.cycle_time),
          handling_time: toFloat(form.handling_time),
          setup_time: toFloat(form.setup_time),
          jig_id: resolveJigId(form.jig_id, model, form.machine, step?.stepIndex),
        }),
      });
      onSaved('เพิ่มเครื่องสำรองแล้ว');
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
          <i className="bi bi-plus-lg me-2" aria-hidden="true" />
          เพิ่มเครื่องสำรอง (Flow {step?.flowIndex}, Step {step?.stepIndex})
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {primary ? (
          <p className="text-muted small">
            ค่าเริ่มต้นคัดลอกจากเครื่องหลัก <strong>{primary.machine}</strong> (Alt {primary.altIndex})
          </p>
        ) : null}
        <Row className="g-2">
          <Col xs={12}>
            <Form.Label className="small">เครื่องจักร</Form.Label>
            <MachineSelect
              value={form.machine}
              machines={machines}
              onChange={(v) => setForm((f) => ({ ...f, machine: v }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">เวลาต่อชิ้น (นาที)</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.cycle_time}
              onChange={(e) => setForm((f) => ({ ...f, cycle_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small" title="ระบบบวกเข้ากับเวลาต่อชิ้นตอนคำนวณแผน">
              เวลาหยิบจับ (นาที/ชิ้น)
            </Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.handling_time}
              onChange={(e) => setForm((f) => ({ ...f, handling_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">เวลาตั้งเครื่อง (นาที)</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="any"
              value={form.setup_time}
              onChange={(e) => setForm((f) => ({ ...f, setup_time: e.target.value }))}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label className="small">รหัสจิ๊ก</Form.Label>
            <JigSelect
              value={form.jig_id}
              jigs={jigs}
              onChange={(v) => setForm((f) => ({ ...f, jig_id: v }))}
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

// ===== เพิ่มสายการผลิต ใหม่ (POST /routing_config/add_flow) =====
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
      onSaved('เพิ่มสายการผลิต ใหม่แล้ว');
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
          <i className="bi bi-plus-lg me-2" aria-hidden="true" />
          เพิ่มสายการผลิต ใหม่ ({model})
        </Modal.Title>
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
          เพิ่มสายการผลิต
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// ===== ลบสายการผลิต (DELETE /routing_config/delete_flow?model=&flow_index=&is_last_flow=) =====
export const DeleteFlowDialog = ({ show, model, flows, defaultFlowIndex, onHide, onSaved, onError }) => {
  const [flowIndex, setFlowIndex] = useState('');
  const [busy, setBusy] = useState(false);

  // เปิดจากปุ่ม "ลบสายการผลิต" ของ flow ไหน ก็เลือก flow นั้นไว้ให้เลย (ยังเปลี่ยนได้จากดรอปดาวน์)
  useEffect(() => {
    if (!show) return;
    if (defaultFlowIndex !== null && defaultFlowIndex !== undefined) {
      setFlowIndex(String(defaultFlowIndex));
      return;
    }
    setFlowIndex(flows?.length ? String(flows[0]) : '');
  }, [show, flows, defaultFlowIndex]);

  // ตรงกับ Dart (routing_config_screen.dart L1386): isLastFlow = distinct flow_index <= 1
  // backend branch is_last_flow=true จะยุบทั้ง model เหลือ flow 0/step 0 — ต้องเป็น "flow เดียวที่เหลือ" เท่านั้น
  const isLastFlow = (flows?.length ?? 0) <= 1;

  const save = async () => {
    setBusy(true);
    try {
      const qs = `model=${encodeURIComponent(model)}&flow_index=${toInt(flowIndex)}&is_last_flow=${isLastFlow}`;
      await apiCall(`/routing_config/delete_flow?${qs}`, { method: 'DELETE' });
      onSaved(`ลบสายการผลิต ${flowIndex} แล้ว`);
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
          <i className="bi bi-trash me-2" aria-hidden="true" />
          ลบสายการผลิต ({model})
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Label className="small">เลือกสายการผลิตที่จะลบ</Form.Label>
        <Form.Select value={flowIndex} onChange={(e) => setFlowIndex(e.target.value)}>
          {(flows ?? []).map((f) => (
            <option key={f} value={f}>
              Flow {f}
            </option>
          ))}
        </Form.Select>
        <p className="text-muted small mt-2">
          {isLastFlow
            ? 'เป็น Flow สุดท้าย — ระบบจะยุบเหลือ Step เดียว (flow 0)'
            : 'Flow ที่มากกว่าจะถูกเลื่อนลำดับลง 1'}
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button variant="danger" onClick={save} disabled={busy || flowIndex === ''}>
          ลบสายการผลิต
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
      onSaved('แก้ Setup Group แล้ว');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>Setup Group ของ Product Master ({model})</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* จุดที่คนเข้าใจผิดบ่อย: คอลัมน์นี้คนละตัวกับ setup_group ที่โชว์ในตาราง Routing */}
        <div className="alert alert-info py-2 small">
          <i className="bi bi-info-circle-fill me-2" aria-hidden="true" />
          แก้ <code>setup_group</code> ในตาราง <strong>product_master</strong> ของ model นี้ —
          <strong> คนละคอลัมน์</strong>กับ Setup Group ที่แสดงในแต่ละ Step (อันนั้นอยู่ในตาราง{' '}
          <code>routing_config</code> แก้ได้จากปุ่มแก้ไข Step) ค่าในตารางจึงจะไม่เปลี่ยนตามการบันทึกนี้
        </div>
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
