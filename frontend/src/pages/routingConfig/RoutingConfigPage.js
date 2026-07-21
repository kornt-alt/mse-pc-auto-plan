// Routing & Machine Configuration — port จาก routing_config_screen.dart
// ค้นหา model → ตาราง routing/machine พร้อมปุ่มจัดการ + กระดานงานด่วน (missing-models) + wizard สร้าง model
// FIX: รายชื่อเครื่องดึงจาก /production/machines (Flutter เดิม hardcode 8 ตัว)
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  Table,
  Button,
  Form,
  InputGroup,
  Badge,
  Spinner,
  Toast,
  ToastContainer,
  Modal,
} from 'react-bootstrap';
import { Search, Plus, Pencil, Trash2, AlertTriangle, Mail, X, RefreshCw } from 'lucide-react';
import { apiCall } from '../../api/client';
import NewModelWizardDialog from './NewModelWizardDialog';
import {
  EditRoutingDialog,
  EditMachineDialog,
  InsertStepDialog,
  InsertAltDialog,
  AddFlowDialog,
  DeleteFlowDialog,
  BulkSetupGroupDialog,
  ConfirmDeleteDialog,
} from './RoutingDialogs';

const RoutingConfigPage = () => {
  const [searchInput, setSearchInput] = useState('');
  const [searchModel, setSearchModel] = useState('');
  const [routing, setRouting] = useState([]);
  const [machine, setMachine] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const [missingModels, setMissingModels] = useState([]);
  const [showUrgent, setShowUrgent] = useState(false);
  const [machines, setMachines] = useState([]);

  const [toast, setToast] = useState(null); // {message, variant}
  const showToast = useCallback((message, variant = 'success') => {
    setToast({ message, variant });
  }, []);
  const onSaved = useCallback(
    (msg) => {
      showToast(msg);
    },
    [showToast]
  );
  const onError = useCallback((msg) => showToast(msg, 'danger'), [showToast]);

  // dialog state: {type, payload}
  const [dialog, setDialog] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [confirm, setConfirm] = useState(null); // {title, message, run}
  const [confirmBusy, setConfirmBusy] = useState(false);

  const closeDialog = useCallback(() => setDialog(null), []);

  const flows = useMemo(
    () => [...new Set(routing.map((r) => r.flow_index ?? 0))].sort((a, b) => a - b),
    [routing]
  );

  // ===== fetch =====
  const fetchMissing = useCallback(() => {
    apiCall('/routing/missing-models')
      .then((res) => setMissingModels(Array.isArray(res) ? res : []))
      .catch(() => setMissingModels([]));
  }, []);

  useEffect(() => {
    fetchMissing();
    apiCall('/production/machines')
      .then((res) => setMachines(res.data || []))
      .catch(() => setMachines([]));
  }, [fetchMissing]);

  const runSearch = useCallback(async (model) => {
    const q = String(model || '').trim();
    if (!q) {
      setHasSearched(false);
      setRouting([]);
      setMachine([]);
      setSearchModel('');
      return;
    }
    setLoading(true);
    setHasSearched(true);
    setSearchModel(q);
    try {
      const res = await apiCall(`/routing_machine_config?model=${encodeURIComponent(q)}`);
      setRouting(res.routing || []);
      setMachine(res.machine || []);
    } catch (err) {
      setRouting([]);
      setMachine([]);
      showToast(err.message, 'danger');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // refresh หลัง mutation: ค้นซ้ำ model เดิม + โหลดกระดานงานด่วนใหม่
  const refresh = useCallback(() => {
    if (searchModel) runSearch(searchModel);
    fetchMissing();
  }, [searchModel, runSearch, fetchMissing]);

  const afterMutation = useCallback(
    (msg) => {
      onSaved(msg);
      closeDialog();
      refresh();
    },
    [onSaved, closeDialog, refresh]
  );

  const clearSearch = () => {
    setSearchInput('');
    setSearchModel('');
    setHasSearched(false);
    setRouting([]);
    setMachine([]);
  };

  // ===== delete (routing step / machine) ผ่าน confirm modal =====
  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.run();
      onSaved(confirm.successMsg || '✅ ลบสำเร็จ');
      setConfirm(null);
      refresh();
    } catch (err) {
      onError(err.message);
    } finally {
      setConfirmBusy(false);
    }
  };

  const askDeleteRouting = (row) =>
    setConfirm({
      title: 'ลบ Step',
      message: `ยืนยันลบ Step "${row.step_name}" (Flow ${row.flow_index}, Step ${row.step_index})? เครื่องของ Step นี้จะถูกลบด้วย`,
      successMsg: '✅ ลบ Step สำเร็จ',
      run: () => apiCall(`/routing_config/${row.id}`, { method: 'DELETE' }),
    });

  const askDeleteMachine = (row) =>
    setConfirm({
      title: 'ลบเครื่อง',
      message: `ยืนยันลบเครื่อง "${row.machine}" (Flow ${row.flow_index}, Step ${row.step_index}, Alt ${row.alternative_index})?`,
      successMsg: '✅ ลบเครื่องสำเร็จ',
      run: () => apiCall(`/machine_config/${row.id}`, { method: 'DELETE' }),
    });

  // ===== แจ้ง Engineer จากกระดานงานด่วน =====
  const notifyEngineer = async (modelName) => {
    try {
      const res = await apiCall('/alert/missing-routing', {
        method: 'POST',
        body: JSON.stringify({ batch_id: '-', model_name: modelName }),
      });
      showToast(res.message || '✅ ส่งอีเมลแล้ว');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  return (
    <Container fluid className="pb-4">
      <h4 className="text-mse fw-bold mb-3">Routing &amp; Machine Configuration</h4>

      {/* ===== toolbar ===== */}
      <Row className="g-2 align-items-center mb-3">
        <Col xs="auto">
          <InputGroup style={{ width: 320 }}>
            <Form.Control
              placeholder="ค้นหา Model เช่น KT16184-3..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch(searchInput)}
            />
            <Button className="btn-mse" onClick={() => runSearch(searchInput)}>
              <Search size={16} className="me-1" />
              ค้นหา
            </Button>
          </InputGroup>
        </Col>
        <Col xs="auto">
          <Button
            variant="success"
            onClick={() => setShowWizard(true)}
          >
            <Plus size={16} className="me-1" />
            เพิ่ม Model ใหม่
          </Button>
        </Col>
        {missingModels.length > 0 && (
          <Col xs="auto">
            <Button variant="outline-danger" onClick={() => setShowUrgent(true)}>
              <AlertTriangle size={16} className="me-1" />
              งานด่วน
              <Badge bg="danger" pill className="ms-1">
                {missingModels.length}
              </Badge>
            </Button>
          </Col>
        )}
        {searchModel && (
          <Col xs="auto">
            <Button variant="outline-secondary" size="sm" onClick={clearSearch}>
              <X size={14} className="me-1" />
              ล้างค่า
            </Button>
          </Col>
        )}
        {searchModel && (
          <Col xs="auto">
            <Button variant="outline-secondary" size="sm" onClick={refresh} title="รีเฟรช">
              <RefreshCw size={14} />
            </Button>
          </Col>
        )}
      </Row>

      {loading && (
        <div className="text-center my-3">
          <Spinner animation="border" className="text-mse" />
        </div>
      )}

      {/* ===== กระดานงานด่วน (เมื่อยังไม่ค้นหา) ===== */}
      {!hasSearched && !loading && missingModels.length > 0 && (
        <Card className="mb-4 border-danger" style={{ maxWidth: 900 }}>
          <Card.Header className="bg-danger text-white fw-bold">
            <AlertTriangle size={18} className="me-2" />
            🚨 URGENT: Model รอสร้าง Routing Master ({missingModels.length})
          </Card.Header>
          <Card.Body className="p-0">
            <Table hover className="mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Model</th>
                  <th>Description</th>
                  <th className="text-end">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {missingModels.map((m) => (
                  <tr key={m.model}>
                    <td className="fw-bold">{m.model}</td>
                    <td className="text-muted">{m.description || '-'}</td>
                    <td className="text-end">
                      <Button
                        size="sm"
                        variant="success"
                        className="me-1"
                        onClick={() => {
                          setSearchInput(m.model);
                          runSearch(m.model);
                        }}
                      >
                        จัดการ Master
                      </Button>
                      <Button size="sm" variant="outline-danger" onClick={() => notifyEngineer(m.model)}>
                        <Mail size={14} className="me-1" />
                        แจ้ง Engineer
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {/* ===== ผลค้นหา ===== */}
      {hasSearched && !loading && routing.length === 0 && machine.length === 0 && (
        <div className="text-center text-danger fw-bold my-4">
          ไม่พบ Model "{searchModel}" ในระบบ ❌ — กด "เพิ่ม Model ใหม่" เพื่อสร้าง
        </div>
      )}

      {hasSearched && (routing.length > 0 || machine.length > 0) && (
        <Row className="g-3">
          {/* Routing */}
          <Col lg={5}>
            <Card>
              <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span className="fw-bold text-teal">1. Routing Config ({searchModel})</span>
                <div className="d-flex gap-1 flex-wrap">
                  <Button size="sm" variant="outline-primary" onClick={() => setDialog({ type: 'setup' })}>
                    Setup Group
                  </Button>
                  <Button size="sm" variant="outline-success" onClick={() => setDialog({ type: 'insertStep' })}>
                    <Plus size={12} /> Step
                  </Button>
                  <Button size="sm" variant="outline-success" onClick={() => setDialog({ type: 'addFlow' })}>
                    <Plus size={12} /> Flow
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => setDialog({ type: 'deleteFlow' })}>
                    <Trash2 size={12} /> Flow
                  </Button>
                </div>
              </Card.Header>
              <Card.Body className="p-0">
                <Table size="sm" hover className="mb-0 align-middle">
                  <thead className="table-light">
                    <tr>
                      <th>Flow</th>
                      <th>Step</th>
                      <th>Step Name</th>
                      <th>Setup Group</th>
                      <th className="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routing.map((r) => (
                      <tr key={r.id}>
                        <td>{r.flow_index}</td>
                        <td>{r.step_index}</td>
                        <td>{r.step_name}</td>
                        <td>{r.setup_group}</td>
                        <td className="text-end text-nowrap">
                          <Pencil
                            size={15}
                            role="button"
                            className="text-primary me-2"
                            onClick={() => setDialog({ type: 'editRouting', row: r })}
                          />
                          <Trash2
                            size={15}
                            role="button"
                            className="text-danger"
                            onClick={() => askDeleteRouting(r)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>

          {/* Machine */}
          <Col lg={7}>
            <Card>
              <Card.Header className="fw-bold">2. Machine Config ({searchModel})</Card.Header>
              <Card.Body className="p-0">
                <Table size="sm" hover className="mb-0 align-middle">
                  <thead className="table-light">
                    <tr>
                      <th>Flow</th>
                      <th>Step</th>
                      <th>Alt</th>
                      <th>Machine</th>
                      <th>Cycle</th>
                      <th>Setup</th>
                      <th>Jig</th>
                      <th className="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machine.map((m) => (
                      <tr key={m.id}>
                        <td>{m.flow_index}</td>
                        <td>{m.step_index}</td>
                        <td>{m.alternative_index}</td>
                        <td className="fw-semibold">{m.machine}</td>
                        <td>{m.cycle_time}</td>
                        <td>{m.setup_time}</td>
                        <td>{m.jig_id}</td>
                        <td className="text-end text-nowrap">
                          <Plus
                            size={15}
                            role="button"
                            className="text-success me-2"
                            title="เพิ่มเครื่องสำรอง (Alt)"
                            onClick={() => setDialog({ type: 'insertAlt', step: m })}
                          />
                          <Pencil
                            size={15}
                            role="button"
                            className="text-primary me-2"
                            onClick={() => setDialog({ type: 'editMachine', row: m })}
                          />
                          <Trash2
                            size={15}
                            role="button"
                            className="text-danger"
                            onClick={() => askDeleteMachine(m)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* ===== dialogs ===== */}
      <EditRoutingDialog
        show={dialog?.type === 'editRouting'}
        row={dialog?.row}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <EditMachineDialog
        show={dialog?.type === 'editMachine'}
        row={dialog?.row}
        machines={machines}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <InsertStepDialog
        show={dialog?.type === 'insertStep'}
        model={searchModel}
        flows={flows}
        machines={machines}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <InsertAltDialog
        show={dialog?.type === 'insertAlt'}
        model={searchModel}
        step={dialog?.step}
        machines={machines}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <AddFlowDialog
        show={dialog?.type === 'addFlow'}
        model={searchModel}
        machines={machines}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <DeleteFlowDialog
        show={dialog?.type === 'deleteFlow'}
        model={searchModel}
        flows={flows}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <BulkSetupGroupDialog
        show={dialog?.type === 'setup'}
        model={searchModel}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <ConfirmDeleteDialog
        show={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        busy={confirmBusy}
        onHide={() => setConfirm(null)}
        onConfirm={runConfirm}
      />

      <NewModelWizardDialog
        show={showWizard}
        initialModelName={searchInput}
        machines={machines}
        onHide={() => setShowWizard(false)}
        onError={onError}
        onSuccess={(newName) => {
          setShowWizard(false);
          showToast('✅ สร้าง Model ใหม่สำเร็จ!');
          setSearchInput(newName);
          runSearch(newName);
          fetchMissing();
        }}
      />

      {/* ===== urgent summary modal (จาก toolbar) ===== */}
      <Modal show={showUrgent} onHide={() => setShowUrgent(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }} className="text-danger">
            <AlertTriangle size={20} className="me-2" />
            URGENT: งานด่วนจากฝ่ายวางแผน
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted">Model ที่ยังไม่มี Routing Master ({missingModels.length} รายการ)</p>
          <Table hover size="sm" className="align-middle">
            <tbody>
              {missingModels.map((m) => (
                <tr key={m.model}>
                  <td className="fw-bold">{m.model}</td>
                  <td className="text-muted small">{m.description || '-'}</td>
                  <td className="text-end">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setShowUrgent(false);
                        setSearchInput(m.model);
                        runSearch(m.model);
                      }}
                    >
                      จัดการ
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Modal.Body>
      </Modal>

      {/* ===== toast ===== */}
      <ToastContainer position="bottom-end" className="p-3">
        {toast && (
          <Toast
            bg={toast.variant}
            onClose={() => setToast(null)}
            show
            delay={3500}
            autohide
          >
            <Toast.Body className={toast.variant === 'warning' ? '' : 'text-white'}>
              {toast.message}
            </Toast.Body>
          </Toast>
        )}
      </ToastContainer>
    </Container>
  );
};

export default RoutingConfigPage;
