// สร้างไฟล์ Machine Config / Routing template แบบมี wizard — ระบุกี่ flow, flow ละกี่ step,
// (Machine) step มี alternative กี่เครื่อง → gen โครง index 0-based ให้ ผู้ใช้แค่เติมเครื่อง/cycle/setup
import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Card, Badge, InputGroup } from 'react-bootstrap';
import { TEMPLATE_SPECS, buildConfigRows, downloadRows } from '../../utils/importTemplates';

const newStep = () => ({ alts: 1 });
const newFlow = () => ({ steps: [newStep(), newStep()] });

const ConfigTemplateDialog = ({ show, onHide, specKey, withAlternatives }) => {
  const spec = TEMPLATE_SPECS[specKey];
  const [model, setModel] = useState('');
  const [flows, setFlows] = useState([newFlow()]);

  useEffect(() => {
    if (show) {
      setModel('');
      setFlows([newFlow()]);
    }
  }, [show]);

  const updateFlow = (idx, updater) =>
    setFlows((prev) => prev.map((f, i) => (i === idx ? updater(f) : f)));

  // ปรับจำนวน step ของ flow (คงค่า alt เดิมเท่าที่มี, เติมใหม่ = 1 เครื่อง)
  const setStepCount = (flowIdx, count) => {
    const n = Math.max(1, Math.min(50, Number(count) || 1));
    updateFlow(flowIdx, (f) => {
      const steps = f.steps.slice(0, n);
      while (steps.length < n) steps.push(newStep());
      return { ...f, steps };
    });
  };

  const setAlt = (flowIdx, stepIdx, val) => {
    const n = Math.max(1, Math.min(20, Number(val) || 1));
    updateFlow(flowIdx, (f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === stepIdx ? { ...s, alts: n } : s)),
    }));
  };

  const totalRows = flows.reduce(
    (sum, f) => sum + f.steps.reduce((s, st) => s + (withAlternatives ? Math.max(1, st.alts) : 1), 0),
    0
  );
  const canGen = model.trim() !== '' && totalRows > 0;

  const handleGenerate = () => {
    downloadRows(spec, buildConfigRows({ withAlternatives }, model.trim(), flows));
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          <i className="bi bi-diagram-3 me-2" aria-hidden="true" />
          สร้างไฟล์ {spec.title} (โครงสร้าง)
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label className="small mb-1">Model</Form.Label>
          <Form.Control
            size="sm"
            placeholder="เช่น MDL-123"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Form.Group>

        <p className="small text-muted mb-2">
          กำหนดว่าโมเดลนี้มีกี่ flow (สายการผลิต), แต่ละ flow มีกี่ step
          {withAlternatives && ' และแต่ละ step ใช้ได้กี่เครื่อง (alternative)'} — ระบบจะสร้าง index ให้อัตโนมัติ
        </p>

        {flows.map((flow, fi) => (
          <Card key={fi} className="mb-2">
            <Card.Body className="py-2">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span className="fw-semibold">Flow {fi} <span className="text-muted small">(สายที่ {fi + 1})</span></span>
                <div className="d-flex align-items-center gap-2">
                  <InputGroup size="sm" style={{ width: 160 }}>
                    <InputGroup.Text>Step</InputGroup.Text>
                    <Form.Control
                      type="number"
                      min={1}
                      max={50}
                      value={flow.steps.length}
                      onChange={(e) => setStepCount(fi, e.target.value)}
                    />
                  </InputGroup>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    disabled={flows.length <= 1}
                    onClick={() => setFlows((prev) => prev.filter((_, i) => i !== fi))}
                    title="ลบ Flow"
                    aria-label={`ลบ Flow ${fi}`}
                  >
                    <i className="bi bi-trash" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {withAlternatives && (
                <div className="d-flex flex-wrap gap-2">
                  {flow.steps.map((st, si) => (
                    <InputGroup key={si} size="sm" style={{ width: 150 }}>
                      <InputGroup.Text>S{si} เครื่อง</InputGroup.Text>
                      <Form.Control
                        type="number"
                        min={1}
                        max={20}
                        value={st.alts}
                        onChange={(e) => setAlt(fi, si, e.target.value)}
                      />
                    </InputGroup>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>
        ))}

        <Button size="sm" variant="outline-primary" onClick={() => setFlows((prev) => [...prev, newFlow()])}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          เพิ่ม Flow
        </Button>

        <div className="mt-3">
          <Badge bg={canGen ? 'primary' : 'secondary'}>รวม {totalRows} แถว</Badge>
          {model.trim() === '' && <span className="text-danger small ms-2">กรุณากรอก Model</span>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>ยกเลิก</Button>
        <Button className="btn-mse" disabled={!canGen} onClick={handleGenerate}>
          <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
          สร้างไฟล์
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ConfigTemplateDialog;
