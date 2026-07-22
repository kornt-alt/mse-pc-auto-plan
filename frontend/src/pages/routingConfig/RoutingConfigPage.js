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
  Modal,
} from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import Toolbar from '../../components/shared/Toolbar';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
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

  const { toast, showToast, hideToast } = useToast();
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
      onSaved(confirm.successMsg || 'ลบสำเร็จ');
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
      successMsg: 'ลบ Step แล้ว',
      run: () => apiCall(`/routing_config/${row.id}`, { method: 'DELETE' }),
    });

  const askDeleteMachine = (row) =>
    setConfirm({
      title: 'ลบเครื่อง',
      message: `ยืนยันลบเครื่อง "${row.machine}" (Flow ${row.flow_index}, Step ${row.step_index}, Alt ${row.alternative_index})?`,
      successMsg: 'ลบเครื่องแล้ว',
      run: () => apiCall(`/machine_config/${row.id}`, { method: 'DELETE' }),
    });

  // ===== แจ้ง Engineer จากกระดานงานด่วน =====
  const notifyEngineer = async (modelName) => {
    try {
      const res = await apiCall('/alert/missing-routing', {
        method: 'POST',
        // ไม่มี batch อ้างอิงจากกระดานงานด่วน — backend จะใส่ข้อความ "ไม่ระบุ Batch" ให้เอง
        body: JSON.stringify({ batch_id: null, model_name: modelName }),
      });
      showToast(res.message || 'ส่งอีเมลแจ้ง Engineer แล้ว');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  return (
    <Container fluid className="pb-4">
      <PageHeader
        icon="bi-signpost-split"
        title="Routing Config"
        subtitle="ขั้นตอนการผลิตและเครื่องจักรที่ใช้ได้ของแต่ละ Model"
        actions={
          missingModels.length > 0 && (
            <Button variant="outline-danger" onClick={() => setShowUrgent(true)}>
              <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true" />
              งานด่วน
              <Badge bg="danger" pill className="ms-1">
                {missingModels.length}
              </Badge>
            </Button>
          )
        }
      />

      {/* ===== toolbar ===== */}
      <Toolbar>
        <InputGroup style={{ width: 320 }}>
          <Form.Control
            placeholder="ค้นหา Model เช่น KT16184-3..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch(searchInput)}
          />
          <Button className="btn-mse" onClick={() => runSearch(searchInput)}>
            <i className="bi bi-search me-1" aria-hidden="true" />
            ค้นหา
          </Button>
        </InputGroup>
        <Button variant="success" onClick={() => setShowWizard(true)}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          เพิ่ม Model ใหม่
        </Button>
        {searchModel && (
          <>
            <Button variant="outline-secondary" onClick={clearSearch}>
              <i className="bi bi-x-lg me-1" aria-hidden="true" />
              ล้างค่า
            </Button>
            <Button variant="outline-secondary" onClick={refresh} title="รีเฟรช" aria-label="รีเฟรช">
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
            </Button>
          </>
        )}
      </Toolbar>

      {loading && (
        <div className="text-center my-3">
          <Spinner animation="border" className="text-mse" />
        </div>
      )}

      {/* ===== กระดานงานด่วน (เมื่อยังไม่ค้นหา) ===== */}
      {!hasSearched && !loading && missingModels.length > 0 && (
        <Card className="mb-4 border-danger" style={{ maxWidth: 900 }}>
          <Card.Header className="bg-danger text-white fw-bold">
            <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
            งานด่วน: Model ที่ยังไม่มี Routing Master ({missingModels.length})
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
                        <i className="bi bi-envelope me-1" aria-hidden="true" />
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
        <div className="empty-state">
          <i className="bi bi-search" aria-hidden="true" />
          <div className="fw-bold text-danger">ไม่พบ Model &quot;{searchModel}&quot; ในระบบ</div>
          <div className="small">กดปุ่ม &quot;เพิ่ม Model ใหม่&quot; เพื่อสร้าง Routing</div>
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
                    <i className="bi bi-plus-lg me-1" aria-hidden="true" /> Step
                  </Button>
                  <Button size="sm" variant="outline-success" onClick={() => setDialog({ type: 'addFlow' })}>
                    <i className="bi bi-plus-lg me-1" aria-hidden="true" /> Flow
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => setDialog({ type: 'deleteFlow' })}>
                    <i className="bi bi-trash me-1" aria-hidden="true" /> Flow
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
                        <td className="num">{r.flow_index}</td>
                        <td className="num">{r.step_index}</td>
                        <td>{r.step_name}</td>
                        <td>{r.setup_group}</td>
                        <td className="text-end text-nowrap">
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 me-3 text-primary icon-btn"
                            title="แก้ไข Step"
                            aria-label={`แก้ไข Step ${r.step_name}`}
                            onClick={() => setDialog({ type: 'editRouting', row: r })}
                          >
                            <i className="bi bi-pencil-square" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 text-danger icon-btn"
                            title="ลบ Step"
                            aria-label={`ลบ Step ${r.step_name}`}
                            onClick={() => askDeleteRouting(r)}
                          >
                            <i className="bi bi-trash" aria-hidden="true" />
                          </Button>
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
                        <td className="num">{m.flow_index}</td>
                        <td className="num">{m.step_index}</td>
                        <td className="num">{m.alternative_index}</td>
                        <td className="fw-semibold">{m.machine}</td>
                        <td className="num">{m.cycle_time}</td>
                        <td className="num">{m.setup_time}</td>
                        <td>{m.jig_id}</td>
                        <td className="text-end text-nowrap">
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 me-3 text-success icon-btn"
                            title="เพิ่มเครื่องสำรอง (Alt)"
                            aria-label={`เพิ่มเครื่องสำรองของ ${m.machine}`}
                            onClick={() => setDialog({ type: 'insertAlt', step: m })}
                          >
                            <i className="bi bi-plus-lg" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 me-3 text-primary icon-btn"
                            title="แก้ไขเครื่องจักร"
                            aria-label={`แก้ไข ${m.machine}`}
                            onClick={() => setDialog({ type: 'editMachine', row: m })}
                          >
                            <i className="bi bi-pencil-square" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 text-danger icon-btn"
                            title="ลบเครื่องจักร"
                            aria-label={`ลบ ${m.machine}`}
                            onClick={() => askDeleteMachine(m)}
                          >
                            <i className="bi bi-trash" aria-hidden="true" />
                          </Button>
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
          showToast('สร้าง Model ใหม่แล้ว');
          setSearchInput(newName);
          runSearch(newName);
          fetchMissing();
        }}
      />

      {/* ===== urgent summary modal (จาก toolbar) ===== */}
      <Modal show={showUrgent} onHide={() => setShowUrgent(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }} className="text-danger">
            <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
            งานด่วนจากฝ่ายวางแผน
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

      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default RoutingConfigPage;
