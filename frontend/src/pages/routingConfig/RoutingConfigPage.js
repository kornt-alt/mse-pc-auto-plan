// Routing & Machine Configuration — port จาก routing_config_screen.dart
// ค้นหา model → มุมมองเดียว Flow > Step > เครื่อง + กระดานงานด่วน (missing-models) + wizard สร้าง model
// FIX: รายชื่อเครื่องดึงจาก /production/machines (Flutter เดิม hardcode 8 ตัว)
//
// การแสดงผลถูกรื้อจาก "สองตารางวางข้างกัน" (Routing ซ้าย / Machine ขวา ที่ต้องกวาดตาจับคู่
// flow_index+step_index เอง) มาเป็น tree เดียว — ตรรกะการรวมอยู่ใน routingTree.js (pure)
// และการวาดอยู่ใน RoutingTreeView.js
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Container,
  Card,
  Table,
  Button,
  Form,
  InputGroup,
  Badge,
  Spinner,
  Modal,
  ListGroup,
} from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import Toolbar from '../../components/shared/Toolbar';
import ConfirmModal from '../../components/shared/ConfirmModal';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import NewModelWizardDialog from './NewModelWizardDialog';
import RoutingTreeView from './RoutingTreeView';
import { buildRoutingTree, insertStepDefaults, primaryMachineOf } from './routingTree';
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

const RECENT_KEY = 'routingConfig.recentModels';
const RECENT_MAX = 8;

const readRecents = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const RoutingConfigPage = () => {
  const [searchInput, setSearchInput] = useState('');
  const [searchModel, setSearchModel] = useState('');
  const [routing, setRouting] = useState([]);
  const [machine, setMachine] = useState([]);
  const [wipRefs, setWipRefs] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const [missingModels, setMissingModels] = useState([]);
  const [showUrgent, setShowUrgent] = useState(false);
  const [machines, setMachines] = useState([]);
  const [jigs, setJigs] = useState([]);

  // autocomplete
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [recents, setRecents] = useState(readRecents);
  const blurTimer = useRef(null);

  const { toast, showToast, hideToast } = useToast();
  const onSaved = useCallback(
    (msg) => {
      showToast(msg);
    },
    [showToast]
  );
  const onError = useCallback((msg) => showToast(msg, 'danger'), [showToast]);

  // MFG เข้าหน้านี้ได้ (readRoles มี MFG) แต่ mutation ทุกตัวเป็น ADMIN/PLANNER —
  // ซ่อนปุ่มไม่ให้กดแล้วเจอ 403 (backend ยังเป็นด่านจริง อันนี้แค่มารยาทฝั่ง UI เหมือนหน้า Calendar)
  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }, []);
  const canEdit = !!currentUser && ['ADMIN', 'PLANNER'].includes(currentUser.role);

  // dialog state: {type, payload}
  const [dialog, setDialog] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [confirm, setConfirm] = useState(null); // {title, message, run} — ของ ConfirmDeleteDialog
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [ask, setAsk] = useState(null); // {title, body, confirmLabel, variant, onConfirm} — ConfirmModal

  const closeDialog = useCallback(() => setDialog(null), []);

  const tree = useMemo(() => buildRoutingTree(routing, machine), [routing, machine]);
  const flows = useMemo(() => tree.flows.map((f) => f.flowIndex), [tree]);

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
    // ทะเบียน jig สำหรับดรอปดาวน์ในไดอะล็อก — ตาราง jig_master สร้างด้วย DDL รันมือ
    // ยังไม่มีก็ไม่เป็นไร ช่อง Jig จะกลับไปเป็นช่องพิมพ์เปล่าเหมือนเดิม
    apiCall('/jig')
      .then((res) => setJigs(Array.isArray(res) ? res : []))
      .catch(() => setJigs([]));
  }, [fetchMissing]);

  const pushRecent = useCallback((model) => {
    setRecents((prev) => {
      const next = [model, ...prev.filter((m) => m !== model)].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* โควตาเต็ม — ไม่เป็นไร */ }
      return next;
    });
  }, []);

  const runSearch = useCallback(async (model) => {
    const q = String(model || '').trim();
    setShowSuggest(false);
    if (!q) {
      setHasSearched(false);
      setRouting([]);
      setMachine([]);
      setWipRefs(0);
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
      setWipRefs(res.wip_refs || 0);
      if ((res.routing || []).length > 0) pushRecent(q);
    } catch (err) {
      setRouting([]);
      setMachine([]);
      setWipRefs(0);
      showToast(err.message, 'danger');
    } finally {
      setLoading(false);
    }
  }, [showToast, pushRecent]);

  // ===== autocomplete: /routing/search-master (LIKE model หรือ description) =====
  // ⚠️ endpoint นั้นคืนเฉพาะ model ที่ **มี** routing อยู่แล้ว ซึ่งตัด model ที่คนอยากมาสร้าง routing
  // ให้ทิ้งพอดี — จึงเอา missingModels (โหลดไว้แล้ว) มาผสมฝั่ง client แล้วติดป้ายให้
  useEffect(() => {
    const kw = searchInput.trim();
    if (!kw) {
      setSuggestions([]);
      return undefined;
    }
    const t = setTimeout(() => {
      apiCall(`/routing/search-master?keyword=${encodeURIComponent(kw)}`)
        .then((res) => setSuggestions(Array.isArray(res) ? res : []))
        .catch(() => setSuggestions([]));
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const suggestList = useMemo(() => {
    const kw = searchInput.trim().toLowerCase();
    const withRouting = suggestions.map((s) => ({ ...s, hasRouting: true }));
    const seen = new Set(withRouting.map((s) => s.model));
    // missingModels อาจเป็นลิสต์ว่างอย่างถูกต้อง (ควิร์ก NOT IN + NULL ที่ backend คงไว้ 1:1)
    const withoutRouting = (missingModels || [])
      .filter((m) => !seen.has(m.model))
      .filter((m) => {
        if (!kw) return true;
        return (
          String(m.model || '').toLowerCase().includes(kw) ||
          String(m.description || '').toLowerCase().includes(kw)
        );
      })
      .map((m) => ({ ...m, hasRouting: false }));
    return [...withRouting, ...withoutRouting].slice(0, 12);
  }, [suggestions, missingModels, searchInput]);

  const pickSuggestion = useCallback(
    (model) => {
      setSearchInput(model);
      setShowSuggest(false);
      runSearch(model);
    },
    [runSearch]
  );

  // เมนูแนะนำปิดตอน blur แต่ต้องหน่วงก่อน ไม่งั้นคลิกรายการไม่ติด (blur มาก่อน click)
  const handleBlur = useCallback(() => {
    blurTimer.current = setTimeout(() => setShowSuggest(false), 150);
  }, []);
  const handleFocus = useCallback(() => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setShowSuggest(true);
  }, []);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

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
    setWipRefs(0);
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

  const askDeleteRouting = useCallback(
    (step) =>
      setConfirm({
        title: 'ลบ Step',
        message: `ยืนยันลบ Step "${step.stepName}" (Flow ${step.flowIndex}, Step ${step.stepIndex})? เครื่องของ Step นี้จะถูกลบด้วย`,
        successMsg: 'ลบ Step แล้ว',
        run: () => apiCall(`/routing_config/${step.id}`, { method: 'DELETE' }),
      }),
    []
  );

  const askDeleteMachine = useCallback(
    (mc) =>
      setConfirm({
        title: 'ลบเครื่อง',
        message: `ยืนยันลบเครื่อง "${mc.machine}" (Flow ${mc.flowIndex}, Step ${mc.stepIndex}, Alt ${mc.altIndex})?`,
        successMsg: 'ลบเครื่องแล้ว',
        run: () => apiCall(`/machine_config/${mc.id}`, { method: 'DELETE' }),
      }),
    []
  );

  // ===== เปิด/ปิดเครื่อง (is_active) =====
  // "เครื่องนี้ทำโมเดลนี้ไม่ได้ถาวร" — คนละเรื่องกับเครื่องเสียชั่วคราว (นั่นใช้ปฏิทิน = 0)
  // ถามยืนยันเฉพาะตอนปิด เพราะปิดแล้วแผนจะเลิกใช้เครื่องนี้ทันทีตั้งแต่ Replan ครั้งถัดไป
  const handleToggleActive = useCallback(
    (mc) => {
      if (mc.isActive) {
        setConfirm({
          title: 'ปิดใช้งานเครื่อง',
          message:
            `ยืนยันปิดใช้งาน "${mc.machine}" สำหรับ Model ${searchModel}?\n\n`
            + 'ระบบจะไม่วางแผนงานของโมเดลนี้ลงเครื่องดังกล่าวอีก (ค่า Cycle/Setup/Jig ยังถูกเก็บไว้ '
            + 'เปิดกลับได้ทุกเมื่อ) — ใช้กับกรณี "เครื่องนี้ทำโมเดลนี้ไม่ได้ถาวร" เท่านั้น '
            + 'ถ้าเป็นเครื่องเสียชั่วคราว ให้ตั้งเวลาว่างเป็น 0 ที่หน้า Calendar แทน',
          successMsg: 'ปิดใช้งานเครื่องแล้ว',
          run: () => apiCall(`/machine_config/${mc.id}/active`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: false }),
          }),
        });
        return;
      }
      apiCall(`/machine_config/${mc.id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: true }),
      })
        .then(() => {
          onSaved('เปิดใช้งานเครื่องแล้ว');
          refresh();
        })
        .catch((err) => onError(err.message));
    },
    [searchModel, onSaved, onError, refresh]
  );

  // ===== เลื่อนลำดับ (POST /routing_config/move) =====
  const doMove = useCallback(
    async (level, flowIndex, stepIndex, direction) => {
      try {
        const res = await apiCall('/routing_config/move', {
          method: 'POST',
          body: JSON.stringify({
            model: searchModel,
            level,
            flow_index: flowIndex,
            step_index: stepIndex,
            direction,
          }),
        });
        onSaved(res.message || 'เลื่อนลำดับแล้ว');
        refresh();
      } catch (err) {
        onError(err.message);
      }
    },
    [searchModel, onSaved, onError, refresh]
  );

  // batch ที่ตรึงตำแหน่ง WIP ไว้ด้วยเลข flow/step จะชี้ผิดขั้นหลังเลื่อน — ถามก่อน (ไม่บล็อก ไม่ cascade)
  const guardedMove = useCallback(
    (level, flowIndex, stepIndex, direction, label) => {
      if (wipRefs > 0) {
        setAsk({
          title: 'ยืนยันการเลื่อนลำดับ',
          body:
            `Model นี้มี ${wipRefs} batch ที่ตรึงตำแหน่ง WIP ไว้ด้วยเลข Flow/Step\n` +
            `การเลื่อน ${label} จะทำให้เลขที่ตรึงไว้ชี้คนละขั้นตอน (ระบบไม่ได้ตามไปแก้ให้)\n\n` +
            'ยอดผลิตและการปิดจบงานผูกกับ "ชื่อ" Step ไม่ใช่เลข จึงไม่กระทบ',
          confirmLabel: 'เลื่อนเลย',
          variant: 'warning',
          onConfirm: () => doMove(level, flowIndex, stepIndex, direction),
        });
        return;
      }
      doMove(level, flowIndex, stepIndex, direction);
    },
    [wipRefs, doMove]
  );

  const handleMoveStep = useCallback(
    (step, direction) =>
      guardedMove('step', step.flowIndex, step.stepIndex, direction, `Step "${step.stepName}"`),
    [guardedMove]
  );

  const handleMoveFlow = useCallback(
    (flowIndex, direction) => guardedMove('flow', flowIndex, 0, direction, `Flow ${flowIndex}`),
    [guardedMove]
  );

  // ===== เปิด dialog จาก tree (พร้อมค่าตั้งต้นของ flow/step ที่กด) =====
  const handleAddStep = useCallback(
    (flow) => setDialog({ type: 'insertStep', defaults: insertStepDefaults(flow) }),
    []
  );
  const handleAddAlt = useCallback(
    (step) => setDialog({ type: 'insertAlt', step, primary: primaryMachineOf(step) }),
    []
  );
  const handleEditStep = useCallback((step) => setDialog({ type: 'editRouting', row: step.row }), []);
  const handleEditMachine = useCallback((mc) => setDialog({ type: 'editMachine', row: mc.row }), []);
  const handleDeleteFlow = useCallback(
    (flowIndex) => setDialog({ type: 'deleteFlow', flowIndex }),
    []
  );

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

  const showEmptySuggest = !searchInput.trim();

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
        <div style={{ position: 'relative', width: 360 }}>
          <InputGroup>
            <Form.Control
              placeholder="ค้นหา Model หรือ Description เช่น KT161..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setShowSuggest(true);
              }}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch(searchInput);
                if (e.key === 'Escape') setShowSuggest(false);
              }}
              aria-label="ค้นหา Model"
            />
            <Button className="btn-mse" onClick={() => runSearch(searchInput)}>
              <i className="bi bi-search me-1" aria-hidden="true" />
              ค้นหา
            </Button>
          </InputGroup>

          {showSuggest && (suggestList.length > 0 || (showEmptySuggest && recents.length > 0)) && (
            <ListGroup
              className="shadow-sm"
              style={{ position: 'absolute', zIndex: 1050, width: '100%', maxHeight: 320, overflowY: 'auto' }}
            >
              {showEmptySuggest && recents.length > 0 && (
                <>
                  <ListGroup.Item disabled className="py-1 small text-muted">
                    เปิดล่าสุด
                  </ListGroup.Item>
                  {recents.map((m) => (
                    <ListGroup.Item action key={`recent-${m}`} onClick={() => pickSuggestion(m)}>
                      <i className="bi bi-clock-history me-2 text-muted" aria-hidden="true" />
                      {m}
                    </ListGroup.Item>
                  ))}
                </>
              )}
              {suggestList.map((s) => (
                <ListGroup.Item action key={s.model} onClick={() => pickSuggestion(s.model)}>
                  <div className="d-flex justify-content-between align-items-center gap-2">
                    <span>
                      <span className="fw-bold">{s.model}</span>
                      {s.description ? (
                        <span className="text-muted small ms-2">{s.description}</span>
                      ) : null}
                    </span>
                    {!s.hasRouting && <span className="chip chip-warn">ยังไม่มี Routing</span>}
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </div>

        {canEdit && (
          <Button variant="success" onClick={() => setShowWizard(true)}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            เพิ่ม Model ใหม่
          </Button>
        )}
        {searchModel && (
          <>
            {canEdit && (
              <>
                <Button size="sm" variant="outline-primary" onClick={() => setDialog({ type: 'setup' })}>
                  Setup Group
                </Button>
                <Button size="sm" variant="outline-success" onClick={() => setDialog({ type: 'addFlow' })}>
                  <i className="bi bi-plus-lg me-1" aria-hidden="true" /> Flow
                </Button>
              </>
            )}
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
          {canEdit && (
            <div className="small">กดปุ่ม &quot;เพิ่ม Model ใหม่&quot; เพื่อสร้าง Routing</div>
          )}
        </div>
      )}

      {hasSearched && !loading && (routing.length > 0 || machine.length > 0) && (
        <>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className="fw-bold text-mse" style={{ fontSize: '1.05rem' }}>
              {searchModel}
            </span>
            <span className="chip chip-muted">{tree.flows.length} Flow</span>
            {!canEdit && <span className="chip chip-info">ดูอย่างเดียว</span>}
          </div>
          <RoutingTreeView
            tree={tree}
            model={searchModel}
            canEdit={canEdit}
            wipRefs={wipRefs}
            onMoveStep={handleMoveStep}
            onMoveFlow={handleMoveFlow}
            onAddStep={handleAddStep}
            onDeleteFlow={handleDeleteFlow}
            onEditStep={handleEditStep}
            onDeleteStep={askDeleteRouting}
            onAddAlt={handleAddAlt}
            onEditMachine={handleEditMachine}
            onDeleteMachine={askDeleteMachine}
            onToggleActive={handleToggleActive}
          />
        </>
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
        jigs={jigs}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <InsertStepDialog
        show={dialog?.type === 'insertStep'}
        model={searchModel}
        defaults={dialog?.defaults}
        machines={machines}
        jigs={jigs}
        onHide={closeDialog}
        onSaved={afterMutation}
        onError={onError}
      />
      <InsertAltDialog
        show={dialog?.type === 'insertAlt'}
        model={searchModel}
        step={dialog?.step}
        primary={dialog?.primary}
        machines={machines}
        jigs={jigs}
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
        defaultFlowIndex={dialog?.flowIndex}
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
      <ConfirmModal confirm={ask} onHide={() => setAsk(null)} />

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
