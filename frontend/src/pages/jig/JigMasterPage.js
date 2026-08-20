// Jig Master — ทะเบียน jig + แจ้งพัง/ส่งซ่อมเป็นช่วงวัน (ADMIN/PLANNER/MFG)
//
// ทำไมถึงมีหน้านี้: ระบบเดิมไม่มีแนวคิด "jig พัง" เลย พังจริงขึ้นมาแผนก็ยังสั่งเครื่องนั้น
// ทำโมเดลนั้นอยู่ ทางแก้เดียวคือไปลบแถว machine_config ทิ้ง (เสียค่า cycle/setup ที่ตั้งไว้)
//
// สิทธิ์แยกสองชั้นโดยตั้งใจ — **MFG แจ้งพังได้** เพราะคนที่รู้ก่อนคือหน้างาน
// แต่แก้ทะเบียน (ชื่อ / is_shared / ลบ) ยังเป็น ADMIN/PLANNER · backend คือด่านจริง
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Card, Table, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import Toolbar from '../../components/shared/Toolbar';
import ConfirmModal from '../../components/shared/ConfirmModal';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import useTableFilter from '../../components/shared/useTableFilter';
import TableFilterBar from '../../components/shared/TableFilterBar';
import TablePagination from '../../components/shared/TablePagination';
import PlanPreviewDialog from '../orders/PlanPreviewDialog';
import { buildPlanDiff } from '../orders/planDiff';
import { buildPlanDetail, buildMachineSchedule } from '../orders/planDetail';
import JigStatusDialog from './JigStatusDialog';
import JigAssignDialog from './JigAssignDialog';
import {
  STATUS_META, normStatus, blockState, describeWindow, effectiveLabel, buildJigOverride,
} from './jigStatus';

// เวลาไทยเสมอ ไม่ใช่ timezone ของเครื่อง client — ตัวเดียวกับ OrderControlTower.js:67
const todayDateStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

// ⚠️ ต้องเป็น module constant ไม่ใช่ useMemo — useTableFilter ผูกกับ identity ของ FIELDS
// options ใส่ไว้ครบทุกตัวเลือก เพื่อให้ยังเลือกกรองได้แม้ไม่มีแถวไหนตรงเลย
const FILTER_FIELDS = [
  { key: 'jig_id', label: 'รหัส Jig', type: 'text', width: 200 },
  { key: 'jig_name', label: 'ชื่อ/รายละเอียด', type: 'text', width: 200 },
  {
    key: 'status_label',
    label: 'สถานะ',
    type: 'select',
    options: ['ใช้งานได้', 'พัง', 'ส่งซ่อม/บำรุงรักษา'],
    value: (r) => STATUS_META[normStatus(r.status)].label,
    width: 170,
  },
  {
    key: 'shared_label',
    label: 'ใช้ข้ามโมเดล',
    type: 'select',
    options: ['ใช้ร่วมกันได้', 'เฉพาะโมเดลเดียว'],
    value: (r) => (r.is_shared ? 'ใช้ร่วมกันได้' : 'เฉพาะโมเดลเดียว'),
    width: 170,
  },
];

const emptyForm = () => ({ jig_id: '', jig_name: '', is_shared: false });

const JigMasterPage = () => {
  const [jigs, setJigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(null); // null | {} (เพิ่ม) | jig (แก้)
  const [form, setForm] = useState(emptyForm());
  const [statusFor, setStatusFor] = useState(null); // jig ที่กำลังแจ้งสถานะ
  const [assignFor, setAssignFor] = useState(null); // jig ที่กำลังตั้งค่าการใช้งาน
  const [confirm, setConfirm] = useState(null);
  const [preview, setPreview] = useState(null);

  const { toast, showToast, hideToast } = useToast();
  const today = todayDateStr();

  // MFG เข้าหน้านี้ได้และกดแจ้งสถานะได้ แต่แก้ทะเบียนไม่ได้ (backend เป็นด่านจริง)
  const role = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}').role || '';
    } catch {
      return '';
    }
  }, []);
  const canEditRegistry = role === 'ADMIN' || role === 'PLANNER';
  const canEditStatus = canEditRegistry || role === 'MFG';

  const load = useCallback(() => {
    setLoading(true);
    apiCall('/jig')
      .then((res) => setJigs(Array.isArray(res) ? res : []))
      .catch((err) => showToast(err.message, 'danger'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- ทะเบียน (ADMIN/PLANNER) ----
  const saveRegistry = async () => {
    const jigId = form.jig_id.trim();
    if (!jigId || jigId === '-') {
      showToast("กรุณาระบุรหัส jig (ห้ามว่างและห้ามใช้ '-')", 'danger');
      return;
    }
    setBusy(true);
    try {
      if (editing && editing.jig_id) {
        await apiCall(`/jig/${encodeURIComponent(editing.jig_id)}`, {
          method: 'PUT',
          body: JSON.stringify({ jig_name: form.jig_name, is_shared: form.is_shared }),
        });
        showToast('บันทึกแล้ว');
      } else {
        await apiCall('/jig', { method: 'POST', body: JSON.stringify({ ...form, jig_id: jigId }) });
        showToast('เพิ่ม jig แล้ว');
      }
      setEditing(null);
      load();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const askDelete = (jig) => setConfirm({
    title: 'ยืนยันการลบ',
    body: `ลบ jig "${jig.jig_id}" ออกจากทะเบียน?`
      + (jig.usage_count > 0 ? `\n\n⚠️ ถูกใช้อยู่ ${jig.usage_count} รายการใน Routing Config — ระบบจะปฏิเสธ` : ''),
    confirmLabel: 'ลบ',
    variant: 'danger',
    onConfirm: async () => {
      try {
        await apiCall(`/jig/${encodeURIComponent(jig.jig_id)}`, { method: 'DELETE' });
        showToast('ลบแล้ว');
        load();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    },
  });

  // ---- สถานะ (ADMIN/PLANNER/MFG) ----
  const saveStatus = useCallback(async (statusForm) => {
    if (!statusFor) return;
    setBusy(true);
    try {
      await apiCall(`/jig/${encodeURIComponent(statusFor.jig_id)}/status`, {
        method: 'PUT',
        body: JSON.stringify(statusForm),
      });
      showToast('บันทึกสถานะแล้ว — กด Replan ที่หน้า Orders เพื่อให้แผนสะท้อนการเปลี่ยนแปลง');
      setStatusFor(null);
      load();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  }, [statusFor, showToast, load]);

  // ---- ตั้งค่าการใช้งาน (ADMIN/PLANNER) ----
  // callbacks ต้อง stable — ไดอะล็อกใช้ onError ใน useEffect ตอนโหลดรายการที่ผูกอยู่เดิม
  const onAssignSaved = useCallback((msg) => {
    setAssignFor(null);
    showToast(`${msg} — กด Replan ที่หน้า Orders เพื่อให้แผนสะท้อนการเปลี่ยนแปลง`);
    load();
  }, [showToast, load]);
  // ⚠️ ต่างจาก onAssignSaved ตรงที่ **ไม่ปิดไดอะล็อก** — การลบแถวเป็นขั้นระหว่างทาง
  // ถ้าปิดจอ ของที่ผู้ใช้ปลดติ๊กค้างไว้จะหายทั้งหมดตอนเปิดใหม่ (effect ตอน mount รีเซ็ต selection)
  // แต่ยัง load() เพื่อให้เลข "ใช้กับ" ในตารางข้างหลังตรงกับความจริงทันที
  const onAssignDeleted = useCallback((msg) => {
    showToast(msg);
    load();
  }, [showToast, load]);
  const onAssignError = useCallback((msg) => showToast(msg, 'danger'), [showToast]);
  const closeAssign = useCallback(() => setAssignFor(null), []);

  // ดูผลกระทบก่อนบันทึก: simulation ล้วน ไม่เขียนอะไรลง DB
  // jig_overrides ส่งไปตัวเดียว — backend merge ทับ jig_master รายตัว ตัวอื่นที่พังจริงยังอยู่ครบ
  const openPreview = useCallback(async (statusForm) => {
    if (!statusFor) return;
    setPreview({ loading: true, diff: null, detail: null, pendingForm: statusForm });
    try {
      // ฝั่ง "ก่อน" ของ diff คือ orders.fg_date ปัจจุบัน — buildPlanDiff ต้องการแถว orders จริง
      const orders = await apiCall('/orders');
      const decoded = await apiCall('/schedule/replan', {
        method: 'POST',
        body: JSON.stringify({
          is_simulation: true,
          jig_overrides: [buildJigOverride(statusFor.jig_id, statusForm)],
        }),
      });
      const diff = buildPlanDiff({
        beforeRows: Array.isArray(orders) ? orders : (orders?.data ?? []),
        afterReport: decoded.report ?? [],
        afterPriorities: null,
        afterModes: null,
      });
      setPreview((p) => (p ? {
        ...p,
        loading: false,
        diff,
        detail: buildPlanDetail(decoded.data ?? []),
        machineSchedule: buildMachineSchedule(decoded.data ?? []),
        capacityWarning: decoded.capacity_warning,
        blockedSteps: decoded.blocked_steps ?? [],
        // งานที่วางไม่ลง พร้อมเหตุผล/เครื่องทางเลือก — แท็บ "ทางเลือก" ในไดอะล็อก
        unplanned: decoded.unplanned ?? [],
      } : p));
    } catch (err) {
      setPreview(null);
      showToast(err.message, 'danger');
    }
  }, [statusFor, showToast]);

  const table = useTableFilter(jigs, FILTER_FIELDS, { pageSize: 20 });

  // นับจากชุดเต็มเสมอ ไม่ใช่ชุดที่กรองแล้ว — ไม่งั้นพอกรองอยู่ตัวเลขจะหลอกตา
  const blockedNow = jigs.filter((j) => blockState(j, today) === 'blocked').length;
  const endedPending = jigs.filter((j) => blockState(j, today) === 'ended').length;

  return (
    <Container className="pb-4" style={{ maxWidth: 1100 }}>
      <PageHeader
        icon="bi-tools"
        title="Jig Master"
        subtitle="ทะเบียน jig และสถานะพัง/ส่งซ่อม — jig ที่ใช้ไม่ได้จะถูกกันออกจากแผนตามช่วงวันที่ระบุ"
        status={blockedNow > 0 ? <span className="chip-ng">ใช้ไม่ได้ตอนนี้ {blockedNow} ตัว</span> : null}
        actions={canEditRegistry ? (
          <Button
            size="sm"
            className="btn-mse"
            onClick={() => { setForm(emptyForm()); setEditing({}); }}
          >
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            เพิ่ม Jig
          </Button>
        ) : null}
      />

      {endedPending > 0 && (
        <div className="alert alert-warning py-2 small d-flex align-items-center gap-2">
          <i className="bi bi-clock-history" aria-hidden="true" />
          <span>
            มี {endedPending} ตัวที่เลยวันกลับมาใช้ได้แล้วแต่ยังค้างสถานะพัง/ส่งซ่อมอยู่ —
            แผนไม่ได้กันวันข้างหน้าไว้แล้ว (ช่วงที่ระบุจบไปแล้ว) แต่ตารางยังโชว์เป็นสีแดง
            และถ้ามีคนมาแก้ช่วงวันต่อจากนี้จะสับสน กด &quot;ซ่อมเสร็จ&quot; เพื่อปิดเรื่อง
          </span>
        </div>
      )}

      <Toolbar>
        <TableFilterBar
          id="jig-filter"
          fields={FILTER_FIELDS}
          filters={table.filters}
          options={table.options}
          activeCount={table.activeCount}
          onChange={table.setFilter}
          onReset={table.resetFilters}
        />
      </Toolbar>

      <Card>
        <Card.Header className="fw-bold">
          {table.activeCount > 0
            ? `Jig ที่ตรงฟิลเตอร์ (${table.filteredCount} จาก ${table.total})`
            : `Jig ทั้งหมด (${table.total})`}
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center my-3">
              <Spinner animation="border" className="text-mse" />
            </div>
          ) : (
            <Table hover className="mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>รหัส Jig</th>
                  <th>ชื่อ/รายละเอียด</th>
                  <th>สถานะ</th>
                  <th>ช่วงที่ใช้ไม่ได้</th>
                  <th className="text-center">ใช้กับ</th>
                  <th>อัปเดตโดย</th>
                  <th className="text-end">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-3">
                      {table.activeCount > 0
                        ? 'ไม่มี jig ตรงกับฟิลเตอร์ที่เลือก'
                        : 'ยังไม่มี jig ในทะเบียน — รัน DDL seed หรือกด "เพิ่ม Jig"'}
                    </td>
                  </tr>
                ) : (
                  table.rows.map((j) => {
                    const meta = STATUS_META[normStatus(j.status)];
                    const state = blockState(j, today);
                    return (
                      <tr key={j.jig_id} className={state === 'blocked' ? 'table-warning' : undefined}>
                        <td className="num fw-semibold">{j.jig_id}</td>
                        <td className="text-muted">{j.jig_name || '-'}</td>
                        <td>
                          <span className={meta.chip}>
                            <i className={`bi ${meta.icon} me-1`} aria-hidden="true" />
                            {meta.label}
                          </span>
                          {state !== 'ok' && state !== 'blocked' && (
                            <div className="small text-muted mt-1">{effectiveLabel(j, today)}</div>
                          )}
                        </td>
                        <td className="num small">{describeWindow(j, today) || '-'}</td>
                        <td className="text-center num">
                          {/* กดที่ตัวเลขเพื่อดู/จัดการว่าใช้กับอะไรบ้าง — เดิมบอกแค่จำนวน
                              ไม่มีทางรู้ว่าเป็นรายการไหน นอกจากไล่ค้นทีละโมเดล
                              MFG กดได้ด้วย (อ่านอย่างเดียว) เพราะเป็นคนแจ้งจิ๊กพังและต้องตอบว่ากระทบอะไร */}
                          {j.usage_count > 0 ? (
                            <Button
                              size="sm"
                              variant="link"
                              className="p-0"
                              onClick={() => setAssignFor(j)}
                              title={`ดูว่า ${j.jig_id} ใช้กับขั้นตอน/เครื่องไหนบ้าง`}
                              aria-label={`ดูรายการที่ใช้ ${j.jig_id}`}
                            >
                              {`${j.usage_count} รายการ / ${j.model_count} โมเดล`}
                            </Button>
                          ) : (
                            <span className="text-muted">ไม่ถูกใช้</span>
                          )}
                        </td>
                        <td className="small text-muted">{j.updated_by || '-'}</td>
                        <td className="text-end text-nowrap">
                          {canEditStatus && (
                            <Button
                              size="sm"
                              variant="link"
                              className="p-0 me-3 icon-btn"
                              title="แจ้งสถานะ (พัง / ส่งซ่อม / ซ่อมเสร็จ)"
                              aria-label={`แจ้งสถานะของ ${j.jig_id}`}
                              onClick={() => setStatusFor(j)}
                            >
                              <i className="bi bi-wrench-adjustable" aria-hidden="true" />
                            </Button>
                          )}
                          {canEditRegistry && (
                            <>
                              <Button
                                size="sm"
                                variant="link"
                                className="p-0 me-3 text-success icon-btn"
                                title="ตั้งค่าการใช้งาน (ใช้กับเครื่อง/Step ไหนบ้าง)"
                                aria-label={`ตั้งค่าการใช้งานของ ${j.jig_id}`}
                                onClick={() => setAssignFor(j)}
                              >
                                <i className="bi bi-diagram-3" aria-hidden="true" />
                              </Button>
                              <Button
                                size="sm"
                                variant="link"
                                className="p-0 me-3 text-primary icon-btn"
                                title="แก้ไขทะเบียน"
                                aria-label={`แก้ไขทะเบียนของ ${j.jig_id}`}
                                onClick={() => {
                                  setForm({
                                    jig_id: j.jig_id,
                                    jig_name: j.jig_name || '',
                                    is_shared: !!j.is_shared,
                                  });
                                  setEditing(j);
                                }}
                              >
                                <i className="bi bi-pencil-square" aria-hidden="true" />
                              </Button>
                              <Button
                                size="sm"
                                variant="link"
                                className="p-0 text-danger icon-btn"
                                title="ลบออกจากทะเบียน"
                                aria-label={`ลบ ${j.jig_id}`}
                                onClick={() => askDelete(j)}
                              >
                                <i className="bi bi-trash" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {!loading && table.filteredCount > 0 && (
        <TablePagination
          id="jig"
          unit="ตัว"
          page={table.page}
          pageCount={table.pageCount}
          pageSize={table.pageSize}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          from={table.from}
          to={table.to}
          filteredCount={table.filteredCount}
          total={table.total}
        />
      )}

      {/* ทะเบียน: เพิ่ม/แก้ */}
      <Modal show={!!editing} onHide={() => setEditing(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>
            {editing && editing.jig_id ? `แก้ไขทะเบียน — ${editing.jig_id}` : 'เพิ่ม Jig'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-2">
            <Form.Label className="small">รหัส Jig</Form.Label>
            <Form.Control
              value={form.jig_id}
              disabled={!!(editing && editing.jig_id)}
              onChange={(e) => setForm((f) => ({ ...f, jig_id: e.target.value }))}
            />
            {editing && editing.jig_id && (
              <Form.Text muted>เปลี่ยนรหัสไม่ได้ — Routing Config อ้างถึงรหัสนี้อยู่</Form.Text>
            )}
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label className="small">ชื่อ/รายละเอียด (ไม่บังคับ)</Form.Label>
            <Form.Control
              value={form.jig_name}
              onChange={(e) => setForm((f) => ({ ...f, jig_name: e.target.value }))}
            />
          </Form.Group>
          <Form.Check
            type="switch"
            id="jig-is-shared"
            label="ใช้ได้หลายโมเดล (shared)"
            checked={form.is_shared}
            onChange={(e) => setForm((f) => ({ ...f, is_shared: e.target.checked }))}
          />
          {/* getSmartSetupTime (engine.js:138) ลดเวลา setup เมื่องานติดกันบนเครื่องเดียวกันใช้ jig เดียวกัน
              การติ๊กช่องนี้จึงเปลี่ยนผลการคำนวณแผน ไม่ใช่แค่ป้ายกำกับ */}
          <div className="alert alert-info py-2 small mt-3 mb-0">
            <i className="bi bi-info-circle me-1" aria-hidden="true" />
            ติ๊กไว้เมื่อ jig ตัวนี้ <b>ถอดไปใช้กับโมเดลอื่นได้จริง</b> — เมื่อสองงานที่ใช้ jig เดียวกัน
            ลงเครื่องเดียวกันติดกัน ระบบจะคิดเวลา setup แบบสั้น (ค่า <b>minor setup</b> ในหน้าตั้งค่า)
            ถ้าของจริงต้องเปลี่ยน jig อยู่ดี แผนจะสั้นกว่าความจริง
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={saveRegistry} disabled={busy}>
            บันทึก
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ตั้งค่าการใช้งาน — callbacks ต้อง stable ไม่งั้น useEffect ในไดอะล็อกจะโหลดใหม่กลางคัน */}
      <JigAssignDialog
        show={!!assignFor}
        jig={assignFor}
        busy={busy}
        readOnly={!canEditRegistry}
        onSaved={onAssignSaved}
        onDeleted={onAssignDeleted}
        onError={onAssignError}
        onHide={closeAssign}
      />

      <JigStatusDialog
        show={!!statusFor}
        jig={statusFor}
        todayStr={today}
        busy={busy}
        // ปุ่มพรีวิวยิง /schedule/replan (ADMIN/PLANNER) — MFG แจ้งสถานะได้แต่ดูพรีวิวไม่ได้
        canPreview={canEditRegistry}
        onSave={saveStatus}
        onPreview={openPreview}
        onHide={() => setStatusFor(null)}
      />

      {/* พรีวิวใช้ไดอะล็อกตัวเดียวกับหน้า Orders — ยืนยันแล้วบันทึกแค่สถานะ jig ไม่บันทึกแผน */}
      <PlanPreviewDialog
        show={!!preview}
        mode="jig"
        diff={preview?.diff}
        detail={preview?.detail}
        machineSchedule={preview?.machineSchedule}
        capacityWarning={preview?.capacityWarning}
        blockedSteps={preview?.blockedSteps ?? []}
        unplanned={preview?.unplanned ?? []}
        todayStr={today}
        loading={!!preview?.loading}
        onConfirm={async () => {
          const pending = preview?.pendingForm;
          setPreview(null);
          if (pending) await saveStatus(pending);
        }}
        onHide={() => setPreview(null)}
      />

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default JigMasterPage;
