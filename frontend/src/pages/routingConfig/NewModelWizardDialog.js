// Wizard สร้าง Model ใหม่ — port จาก NewModelWizardDialog (routing_config_screen.dart L2426+)
// ขั้นตอน: ตั้งชื่อ model (เช็คซ้ำ) → เลือก model ตระกูลเดียวกันมา copy routing (recommend-copy /
//   search-master) → แก้ template → bulk_create
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Form, Row, Col, Table, Badge, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { MachineSelect } from './RoutingDialogs';

const emptyRouting = () => ({ flow_index: 0, step_index: 0, step_name: '', setup_group: '' });
const emptyMachine = () => ({
  flow_index: 0,
  step_index: 0,
  alternative_index: 0,
  machine: '',
  cycle_time: 1,
  handling_time: 0, // เวลาหยิบจับ — 0 = ไม่มี = พฤติกรรมเดิม (ต่างจาก cycle/setup ที่เริ่มที่ 1)
  setup_time: 1,
  jig_id: '1', // default ตาม wizard เดิม (dart L2617/L2731) — ห้ามเป็น '' เพราะ engine จะมองเป็น jig '-' ร่วมกัน
});
const toInt = (v) => parseInt(v, 10) || 0;
const toFloat = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const NewModelWizardDialog = ({ show, initialModelName, machines, onHide, onSuccess, onError }) => {
  const [newModel, setNewModel] = useState('');
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [checking, setChecking] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [targetDesc, setTargetDesc] = useState('');
  const [sourceModel, setSourceModel] = useState('');
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const [routingList, setRoutingList] = useState([]);
  const [machineList, setMachineList] = useState([]);
  const [busy, setBusy] = useState(false);

  // reset ทุกครั้งที่เปิด + โหลด recommendation จากชื่อเริ่มต้น
  useEffect(() => {
    if (!show) return;
    const init = (initialModelName || '').trim();
    setNewModel(init);
    setIsDuplicate(false);
    setKeyword('');
    setSearchResults([]);
    setRecommendations([]);
    setTargetDesc('');
    setSourceModel('');
    setRoutingList([]);
    setMachineList([]);
    if (init) {
      apiCall(`/routing/recommend-copy/${encodeURIComponent(init)}`)
        .then((res) => {
          setTargetDesc(res.target_description || '');
          setRecommendations(res.recommendations || []);
        })
        .catch(() => {});
    }
  }, [show, initialModelName]);

  // เช็คชื่อซ้ำ (debounce)
  useEffect(() => {
    if (!show) return;
    const name = newModel.trim();
    if (!name) {
      setIsDuplicate(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(() => {
      apiCall(`/routing_machine_config/check_duplicate/${encodeURIComponent(name)}`)
        .then((res) => setIsDuplicate(!!res.is_duplicate))
        .catch(() => setIsDuplicate(false))
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [newModel, show]);

  const doSearch = useCallback(async () => {
    const kw = keyword.trim();
    if (!kw) return;
    try {
      const res = await apiCall(`/routing/search-master?keyword=${encodeURIComponent(kw)}`);
      setSearchResults(Array.isArray(res) ? res : []);
    } catch (err) {
      onError(err.message);
    }
  }, [keyword, onError]);

  // เลือก source → โหลด routing/machine มาเป็น template
  const loadTemplate = useCallback(
    async (model) => {
      setSourceModel(model);
      setLoadingTemplate(true);
      try {
        const res = await apiCall(`/routing_machine_config?model=${encodeURIComponent(model)}`);
        setRoutingList(
          (res.routing || []).map((r) => ({
            flow_index: r.flow_index ?? 0,
            step_index: r.step_index ?? 0,
            step_name: r.step_name ?? '',
            setup_group: r.setup_group ?? '',
          }))
        );
        setMachineList(
          (res.machine || []).map((m) => ({
            flow_index: m.flow_index ?? 0,
            step_index: m.step_index ?? 0,
            alternative_index: m.alternative_index ?? 0,
            machine: m.machine ?? '',
            cycle_time: m.cycle_time ?? 1,
            handling_time: m.handling_time ?? 0,
            setup_time: m.setup_time ?? 1,
            jig_id: m.jig_id ?? '1', // ตาม wizard เดิม L2830 (row ที่ไม่มี jig → '1')
          }))
        );
      } catch (err) {
        onError(err.message);
      } finally {
        setLoadingTemplate(false);
      }
    },
    [onError]
  );

  const updateRouting = (i, key, val) =>
    setRoutingList((list) => list.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const updateMachine = (i, key, val) =>
    setMachineList((list) => list.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)));

  const save = async () => {
    setBusy(true);
    try {
      await apiCall('/routing_machine_config/bulk_create', {
        method: 'POST',
        body: JSON.stringify({
          new_model: newModel.trim(),
          routing_list: routingList.map((r) => ({
            flow_index: toInt(r.flow_index),
            step_index: toInt(r.step_index),
            step_name: r.step_name,
            setup_group: r.setup_group,
          })),
          machine_list: machineList.map((m) => ({
            flow_index: toInt(m.flow_index),
            step_index: toInt(m.step_index),
            alternative_index: toInt(m.alternative_index),
            machine: m.machine,
            cycle_time: toFloat(m.cycle_time),
            handling_time: toFloat(m.handling_time),
            setup_time: toFloat(m.setup_time),
            // กัน jig ว่างหลุดลง DB (ว่าง → engine มองเป็น '-' ร่วมกันทุกงาน → setup เพี้ยน)
            jig_id: String(m.jig_id ?? '').trim() || '1',
          })),
        }),
      });
      onSuccess(newModel.trim());
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    !busy && newModel.trim() && !isDuplicate && !checking && routingList.length > 0;

  return (
    <Modal show={show} onHide={onHide} size="xl" centered backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.15rem' }} className="text-mse">
          <i className="bi bi-plus-lg me-2" aria-hidden="true" />
          สร้าง Model ใหม่
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* 1. ชื่อ model */}
        <Row className="g-2 align-items-end mb-3">
          <Col md={5}>
            <Form.Label className="small fw-bold">ชื่อ Model ใหม่</Form.Label>
            <Form.Control
              value={newModel}
              isInvalid={isDuplicate}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="เช่น KT16184-3"
            />
            {checking ? (
              <Form.Text className="text-muted">กำลังตรวจสอบ...</Form.Text>
            ) : isDuplicate ? (
              <Form.Text className="text-danger">
                <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true" />
                มี Model นี้ในระบบแล้ว
              </Form.Text>
            ) : newModel.trim() ? (
              <Form.Text className="text-success">
                <i className="bi bi-check-circle-fill me-1" aria-hidden="true" />
                ใช้ชื่อนี้ได้
              </Form.Text>
            ) : null}
          </Col>
          {targetDesc ? (
            <Col md={7}>
              <span className="text-muted small">Description: {targetDesc}</span>
            </Col>
          ) : null}
        </Row>

        {/* 2. เลือกต้นแบบมา copy */}
        <div className="border rounded p-2 mb-3 bg-light">
          <div className="fw-bold small mb-2">คัดลอก Routing จาก Model ตระกูลเดียวกัน (ไม่บังคับ)</div>
          {recommendations.length > 0 && (
            <div className="mb-2">
              <span className="small text-muted me-2">แนะนำ:</span>
              {recommendations.map((r) => (
                <Button
                  key={r.model}
                  size="sm"
                  variant={sourceModel === r.model ? 'success' : 'outline-success'}
                  className="me-1 mb-1"
                  onClick={() => loadTemplate(r.model)}
                  title={r.description}
                >
                  {r.model}
                </Button>
              ))}
            </div>
          )}
          <Row className="g-2 align-items-center">
            <Col md={6} className="d-flex gap-2">
              <Form.Control
                size="sm"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                placeholder="ค้นหา model/description อื่น"
              />
              <Button size="sm" variant="outline-secondary" onClick={doSearch}>
                <i className="bi bi-search" aria-hidden="true" />
              </Button>
            </Col>
            <Col md={6}>
              {searchResults.map((r) => (
                <Button
                  key={r.model}
                  size="sm"
                  variant={sourceModel === r.model ? 'primary' : 'outline-primary'}
                  className="me-1 mb-1"
                  onClick={() => loadTemplate(r.model)}
                  title={r.description}
                >
                  {r.model}
                </Button>
              ))}
            </Col>
          </Row>
          {loadingTemplate && (
            <div className="mt-2">
              <Spinner size="sm" animation="border" className="me-2" />
              กำลังโหลด template...
            </div>
          )}
          {sourceModel && !loadingTemplate && (
            <div className="mt-2 small">
              คัดลอกจาก <Badge bg="secondary">{sourceModel}</Badge> — แก้ไขได้ก่อนบันทึก
            </div>
          )}
        </div>

        {/* 3. template editable */}
        <Row>
          <Col md={5}>
            <div className="d-flex justify-content-between align-items-center mb-1">
              <span className="fw-bold small text-teal">Routing ({routingList.length})</span>
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => setRoutingList((l) => [...l, emptyRouting()])}
              >
                <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มแถว
              </Button>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <Table size="sm" bordered className="align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: 45 }}>Flow</th>
                    <th style={{ width: 45 }}>Step</th>
                    <th>Name</th>
                    <th>Setup</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {routingList.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={r.flow_index}
                          onChange={(e) => updateRouting(i, 'flow_index', e.target.value)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={r.step_index}
                          onChange={(e) => updateRouting(i, 'step_index', e.target.value)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          value={r.step_name}
                          onChange={(e) => updateRouting(i, 'step_name', e.target.value)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          value={r.setup_group}
                          onChange={(e) => updateRouting(i, 'setup_group', e.target.value)}
                        />
                      </td>
                      <td className="text-center">
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0 text-danger icon-btn"
                          title="ลบแถวนี้"
                          aria-label="ลบแถวนี้"
                          onClick={() => setRoutingList((l) => l.filter((_, idx) => idx !== i))}
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Col>
          <Col md={7}>
            <div className="d-flex justify-content-between align-items-center mb-1">
              <span className="fw-bold small">Machine ({machineList.length})</span>
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => setMachineList((l) => [...l, emptyMachine()])}
              >
                <i className="bi bi-plus-lg me-1" aria-hidden="true" /> เพิ่มแถว
              </Button>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <Table size="sm" bordered className="align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: 40 }}>F</th>
                    <th style={{ width: 40 }}>S</th>
                    <th style={{ width: 40 }}>Alt</th>
                    <th>Machine</th>
                    <th style={{ width: 55 }} title="เวลาต่อชิ้น (นาที)">Cyc</th>
                    <th style={{ width: 55 }} title="เวลาหยิบจับ (นาที/ชิ้น)">Hnd</th>
                    <th style={{ width: 55 }} title="เวลาตั้งเครื่อง (นาที)">Set</th>
                    <th style={{ width: 45 }}>Jig</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {machineList.map((m, i) => (
                    <tr key={i}>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={m.flow_index}
                          onChange={(e) => updateMachine(i, 'flow_index', e.target.value)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={m.step_index}
                          onChange={(e) => updateMachine(i, 'step_index', e.target.value)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={m.alternative_index}
                          onChange={(e) => updateMachine(i, 'alternative_index', e.target.value)}
                        />
                      </td>
                      <td>
                        <MachineSelect
                          value={m.machine}
                          machines={machines}
                          onChange={(v) => updateMachine(i, 'machine', v)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={m.cycle_time}
                          onChange={(e) => updateMachine(i, 'cycle_time', e.target.value)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={m.handling_time}
                          onChange={(e) => updateMachine(i, 'handling_time', e.target.value)}
                          aria-label="เวลาหยิบจับ (นาที/ชิ้น)"
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          type="number"
                          value={m.setup_time}
                          onChange={(e) => updateMachine(i, 'setup_time', e.target.value)}
                        />
                      </td>
                      <td>
                        <Form.Control
                          size="sm"
                          value={m.jig_id}
                          onChange={(e) => updateMachine(i, 'jig_id', e.target.value)}
                        />
                      </td>
                      <td className="text-center">
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0 text-danger icon-btn"
                          title="ลบแถวนี้"
                          aria-label="ลบแถวนี้"
                          onClick={() => setMachineList((l) => l.filter((_, idx) => idx !== i))}
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" onClick={save} disabled={!canSave}>
          {busy ? 'กำลังบันทึก...' : 'สร้าง Model'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default NewModelWizardDialog;
