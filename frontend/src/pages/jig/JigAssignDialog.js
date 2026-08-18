// JigAssignDialog — "jig ตัวนี้ใช้กับเครื่องไหน ขั้นตอนไหนบ้าง" ดู/ถอด/เพิ่ม แล้วบันทึกทีเดียว
// (ADMIN/PLANNER แก้ได้ — MFG เปิดดูได้อย่างเดียว เพราะเป็นการแก้ routing ที่กระทบแผน)
//
// ตรรกะทั้งหมดอยู่ใน jigAssign.js (pure) ไฟล์นี้วาด + คุม state ของการติ๊กเท่านั้น
// ตัวเลือกในแท็บ "เพิ่มรายการ" เรนเดอร์จาก buildRoutingTree ตัวเดียวกับหน้า Routing Config
// และป้ายคำ (สายการผลิต/ขั้นที่/เครื่องหลัก) มาจาก routingEdits.js ที่เดียวกับหน้านั้น —
// สองหน้าจอต้องเรียกของสิ่งเดียวกันด้วยคำเดียวกัน
//
// สามมุมมอง:
//   current = รายการที่ใช้อยู่จริงตอนนี้ (ทุกโมเดล) ← ค่าเริ่มต้น
//   add     = ค้นโมเดลแล้วติ๊กเพิ่ม
//   review  = สรุปก่อนบันทึก · **ขั้นนี้ยังบังคับ** เพราะแท็บ add ติ๊กสะสมข้ามโมเดลได้
//             แถวที่ติ๊กไว้ในโมเดลที่เดินออกมาแล้วมองไม่เห็นบนจอ ที่นี่คือที่เดียวที่เห็นครบ
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Form, Table, Spinner, Badge, Nav } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { buildRoutingTree } from '../routingConfig/routingTree';
import { flowLabel, stepLabel as stepPosLabel, machineRoleLabel } from '../routingConfig/routingEdits';
import { jigListOfRow } from '../routingConfig/jigNaming';
import ConfirmModal from '../../components/shared/ConfirmModal';
import {
  buildAssignDiff, summarizeSelection, overwriteWarnings, sharedMismatch, stepLabel,
  groupAssignmentsByModel, canDeleteAssignment, pendingUnassign,
} from './jigAssign';

const rowLabel = (r) => `${r.model} · ${stepLabel(r)} · ${r.machine}`;

// ⚠️ onSaved กับ onDeleted แยกกันโดยตั้งใจ — onSaved ของหน้า Jig Master **ปิดไดอะล็อก**
// (JigMasterPage.js:159-163 เรียก setAssignFor(null)) ซึ่งถูกต้องสำหรับการกดบันทึก เพราะนั่นคือจบงาน
// แต่การลบแถวเป็นแค่ขั้นระหว่างทาง ถ้าเรียก onSaved ไดอะล็อกจะปิดกลางคัน แล้วพอเปิดใหม่
// effect ตอน mount รันด้วย resetSelection = true = **ทิ้งรายการที่ปลดติ๊กค้างไว้ทั้งหมดเงียบ ๆ**
// ซึ่งเป็นสิ่งเดียวกับที่ loadAssignments(false) ตั้งใจปกป้องไว้
const JigAssignDialog = ({
  show, jig, busy, readOnly = false, onSaved, onDeleted, onError, onHide,
}) => {
  const jigId = jig?.jig_id ?? '';

  const [view, setView] = useState('current'); // 'current' | 'add' | 'review'
  const [originalRows, setOriginalRows] = useState([]); // ที่ผูกอยู่เดิม (ทุกโมเดล)
  const [selected, setSelected] = useState(() => new Set()); // machine_config.id
  const [rowById, setRowById] = useState(() => new Map()); // id -> แถว (สำหรับหน้าสรุป)
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // แถวที่กำลังจะลบออกจาก routing
  const [deletingId, setDeletingId] = useState(null);

  // ---- ค้นหาโมเดล ----
  const [keyword, setKeyword] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [model, setModel] = useState('');
  const [tree, setTree] = useState(null);
  const [loadingModel, setLoadingModel] = useState(false);

  // โหลดฝั่ง "ก่อน" ให้ครบทุกโมเดล
  // ⚠️ ต้องครบ ไม่งั้นการปลดติ๊กจะคำนวณไม่ได้สำหรับโมเดลที่ผู้ใช้ไม่ได้เปิดดู
  //
  // resetSelection: true ตอนเปิดไดอะล็อก (ติ๊กทุกแถวที่ผูกอยู่)
  //                 false ตอนโหลดซ้ำหลังลบแถว — ต้องไม่ล้างสิ่งที่ผู้ใช้ปลดติ๊กค้างไว้
  const loadAssignments = useCallback(
    async (resetSelection) => {
      setLoadingOriginal(true);
      try {
        const res = await apiCall(`/jig/${encodeURIComponent(jigId)}/assignments`);
        const rows = Array.isArray(res) ? res : [];
        setOriginalRows(rows);
        if (resetSelection) setSelected(new Set(rows.map((r) => r.id)));
        // merge ไม่ใช่แทนที่ — rowById ยังถือแถวจาก tree ของโมเดลที่ผู้ใช้เปิดดูในแท็บเพิ่มรายการอยู่
        setRowById((prev) => {
          const next = resetSelection ? new Map() : new Map(prev);
          for (const r of rows) next.set(r.id, r);
          return next;
        });
      } catch (err) {
        if (resetSelection) {
          setOriginalRows([]);
          setSelected(new Set());
          setRowById(new Map());
        }
        onError(err.message);
      } finally {
        setLoadingOriginal(false);
      }
    },
    [jigId, onError]
  );

  useEffect(() => {
    if (!show || !jigId) return;
    setView('current');
    setKeyword('');
    setSuggestions([]);
    setModel('');
    setTree(null);
    setConfirmDelete(null);
    loadAssignments(true);
  }, [show, jigId, loadAssignments]);

  // autocomplete เดียวกับ RoutingConfigPage (debounce 400 ms)
  useEffect(() => {
    const kw = keyword.trim();
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
  }, [keyword]);

  const loadModel = useCallback(
    async (m) => {
      const q = String(m || '').trim();
      if (!q) return;
      setLoadingModel(true);
      setModel(q);
      setSuggestions([]);
      try {
        const res = await apiCall(`/routing_machine_config?model=${encodeURIComponent(q)}`);
        const built = buildRoutingTree(res.routing || [], res.machine || []);
        setTree(built);

        // จำแถวไว้ให้หน้าสรุปอ้างถึงได้ แม้ผู้ใช้จะเปลี่ยนไปโมเดลอื่นแล้ว
        // ⚠️ ต้องเก็บ step_name จาก **tree** ไม่ใช่จาก res.machine — machine_config ไม่มีคอลัมน์นี้
        // ชื่อ step อยู่ใน routing_config ซึ่ง buildRoutingTree จับคู่ให้แล้ว
        // ถ้าเก็บแถวดิบ หน้าสรุปจะเรียกทุกแถวที่เพิ่งเพิ่มว่า "(ไม่มี Step รองรับ)" ทั้งที่มี step ปกติ
        setRowById((prev) => {
          const next = new Map(prev);
          for (const flow of built.flows) {
            for (const st of flow.steps) {
              for (const mc of st.machines) {
                next.set(mc.id, { ...mc.row, model: q, step_name: st.stepName });
              }
            }
          }
          // orphan ไม่มี step จริง ๆ — ปล่อย step_name ว่างไว้ให้ stepLabel ติดป้ายให้ถูกต้อง
          for (const mc of built.orphanMachines) {
            next.set(mc.id, { ...mc.row, model: q, step_name: '' });
          }
          return next;
        });
      } catch (err) {
        setTree(null);
        onError(err.message);
      } finally {
        setLoadingModel(false);
      }
    },
    [onError]
  );

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // แถวที่เลือกไว้ทั้งหมด (ข้ามโมเดล) — ใช้ทั้งตัวนับและหน้าสรุป
  const selectedRows = useMemo(
    () => [...selected].map((id) => rowById.get(id)).filter(Boolean),
    [selected, rowById]
  );
  const summary = useMemo(() => summarizeSelection(selectedRows), [selectedRows]);
  const diff = useMemo(() => buildAssignDiff(originalRows, selected), [originalRows, selected]);
  const overwrites = useMemo(() => {
    const added = new Set(diff.assign);
    return overwriteWarnings(selectedRows.filter((r) => added.has(r.id)), jigId);
  }, [selectedRows, diff.assign, jigId]);
  const mismatch = sharedMismatch(summary, jig);

  const grouped = useMemo(() => groupAssignmentsByModel(originalRows), [originalRows]);
  const pending = useMemo(() => pendingUnassign(originalRows, selected), [originalRows, selected]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiCall(`/jig/${encodeURIComponent(jigId)}/assignments`, {
        method: 'PUT',
        body: JSON.stringify({ assign: diff.assign, unassign: diff.unassign }),
      });
      onSaved(res.message || 'บันทึกแล้ว');
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ลบแถวเครื่องออกจาก routing — **มีผลทันที** ต่างจากการถอดจิ๊กที่รอกดบันทึก
  // ใช้ DELETE /machine_config/:id ตัวเดียวกับหน้า Routing Config (ADMIN/PLANNER เหมือนกัน)
  const runDelete = async (row) => {
    setDeletingId(row.id);
    try {
      await apiCall(`/machine_config/${row.id}`, { method: 'DELETE' });
      // ⚠️ ต้องเอา id ออกจาก selected/rowById ด้วย ไม่งั้น buildAssignDiff จะสั่ง assign
      // แถวที่ไม่มีอยู่แล้ว → backend ตอบ 409 ตอนกดบันทึก
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      setRowById((prev) => {
        const next = new Map(prev);
        next.delete(row.id);
        return next;
      });
      // ⚠️ โหลดใหม่ ไม่ใช่ตัดออกจาก state เอง — DELETE ขยับ alternative_index ของแถวที่เหลือ -1
      await loadAssignments(false);
      // ⚠️ ห้ามเรียก onSaved ที่นี่ — มันปิดไดอะล็อก แล้วของที่ปลดติ๊กค้างไว้จะหาย (ดูหัวคอมโพเนนต์)
      // onDeleted แค่เด้ง toast + โหลดตาราง /jig ใหม่ให้เลข "ใช้กับ" ตรงความจริง โดยไม่ปิดจอ
      if (onDeleted) onDeleted(`ลบ ${row.machine} ออกจาก ${row.model} แล้ว`);
    } catch (err) {
      onError(err.message);
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  const busyAny = busy || saving || loadingOriginal || deletingId !== null;
  const canEdit = !readOnly;

  // ---- แถวเครื่องในแท็บ "เพิ่มรายการ" (ติ๊กเลือก) ----
  const machineRow = (mc, stepName, altPos) => {
    const otherJig = String(mc.jigId ?? '').trim();
    const isThis = otherJig === jigId;
    return (
      <tr key={mc.id} className={mc.isActive ? undefined : 'opacity-50'}>
        <td style={{ width: 40 }}>
          <Form.Check
            type="checkbox"
            checked={selected.has(mc.id)}
            disabled={!canEdit}
            onChange={() => toggle(mc.id)}
            aria-label={`เลือก ${mc.machine} ของ ${stepName}`}
          />
        </td>
        <td>
          <span className="fw-semibold">{mc.machine}</span>
          {altPos ? (
            <span className="text-muted ms-2 small">{machineRoleLabel(altPos)}</span>
          ) : null}
          {!mc.isActive && <span className="chip chip-ng ms-2">ปิดใช้งาน</span>}
        </td>
        <td className="num small text-muted">
          {isThis ? <span className="chip chip-ok">jig นี้</span> : otherJig || '-'}
        </td>
      </tr>
    );
  };

  // ---- ตาราง "ใช้อยู่ตอนนี้" ----
  const currentTable = (
    <>
      <p className="text-muted small">
        {originalRows.length > 0 ? (
          <>
            jig นี้ถูกใช้อยู่ <strong>{originalRows.length}</strong> รายการ ใน{' '}
            <strong>{grouped.length}</strong> โมเดล — จัดการได้จากตรงนี้เลย
          </>
        ) : (
          'jig นี้ยังไม่ถูกใช้กับเครื่องไหนเลย — ไปที่แท็บ "เพิ่มรายการ" เพื่อผูกกับขั้นตอน'
        )}
      </p>

      {canEdit && originalRows.length > 0 && (
        <div className="alert alert-light py-2 small border">
          <div>
            <strong>ถอดจิ๊ก</strong> = แถวยังอยู่ใน routing แค่เลิกใช้จิ๊กตัวนี้
            (ระบบตั้งรหัสอัตโนมัติให้แทน) — <strong>สะสมไว้ มีผลตอนกดบันทึก</strong>
          </div>
          <div className="mt-1">
            <strong>ลบออกจาก routing</strong> = ลบแถวเครื่องทิ้งทั้งแถว เสียเวลาต่อชิ้น/ตั้งเครื่องที่ตั้งไว้
            — <strong>มีผลทันทีที่กดยืนยัน</strong>
          </div>
        </div>
      )}

      {grouped.map((g) => (
        <div className="mb-3" key={g.model}>
          <div className="fw-bold text-mse mb-1">
            {g.model}
            <span className="chip chip-muted ms-2">{g.rows.length} รายการ</span>
          </div>
          <Table size="sm" className="mb-0 align-middle">
            <thead className="table-light">
              <tr>
                <th>ขั้นตอน</th>
                <th>เครื่องจักร</th>
                <th>จิ๊กที่ต้องใช้</th>
                {canEdit && <th className="text-end" style={{ width: 190 }}>จัดการ</th>}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => {
                const isPending = pending.has(r.id);
                const deletable = canDeleteAssignment(r);
                const inactive = r.is_active === 0 || r.is_active === false;
                return (
                  <tr key={r.id} className={isPending ? 'opacity-50' : undefined}>
                    <td className={isPending ? 'text-decoration-line-through' : undefined}>
                      {stepLabel(r)}
                    </td>
                    <td className={isPending ? 'text-decoration-line-through' : undefined}>
                      <span className="fw-semibold">{r.machine}</span>
                      {inactive && <span className="chip chip-ng ms-2">ปิดใช้งาน</span>}
                      {isPending && <span className="chip chip-warn ms-2">จะถอด</span>}
                    </td>
                    {/* ⚠️ หนึ่งแถวใช้หลายจิ๊กพร้อมกันได้ (AND) — ต้องโชว์ทั้งชุด ไม่ใช่แค่ตัวที่เปิดดูอยู่
                        ไม่งั้นผู้ใช้กด "ถอดจิ๊ก" โดยไม่รู้ว่าแถวนี้ยังต้องใช้ตัวอื่นอยู่ */}
                    <td className="small">
                      {jigListOfRow(r).map((j) => (
                        <span
                          key={j}
                          className={`chip ${j === jigId ? 'chip-ok' : 'chip-muted'} me-1`}
                        >
                          {j}
                        </span>
                      ))}
                    </td>
                    {canEdit && (
                      <td className="text-end text-nowrap">
                        {isPending ? (
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 me-3"
                            onClick={() => toggle(r.id)}
                          >
                            เรียกคืน
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 me-3"
                            onClick={() => toggle(r.id)}
                            title={(() => {
                              const rest = jigListOfRow(r).filter((j) => j !== jigId);
                              return rest.length
                                ? `ถอด ${jigId} ออกจาก ${r.machine} — ยังต้องใช้ ${rest.join(', ')} อยู่ (มีผลตอนกดบันทึก)`
                                : `ถอดจิ๊กออกจาก ${r.machine} (มีผลตอนกดบันทึก)`;
                            })()}
                            aria-label={`ถอดจิ๊กออกจาก ${r.machine} ของ ${r.model} ${stepLabel(r)}`}
                          >
                            ถอดจิ๊ก
                          </Button>
                        )}
                        {/* ⚠️ ปิดปุ่มไว้ก่อนเมื่อเป็นเครื่องตัวสุดท้ายของขั้นตอน —
                            backend ปฏิเสธด้วยข้อความภาษาอังกฤษ ไม่ควรปล่อยให้ไปเจอ */}
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0 icon-btn text-danger"
                          disabled={!deletable || busyAny}
                          title={
                            deletable
                              ? `ลบ ${r.machine} ออกจาก routing ของ ${r.model} (มีผลทันที)`
                              : 'ลบไม่ได้ — เป็นเครื่องตัวสุดท้ายของขั้นตอนนี้ (แต่ละขั้นต้องมีอย่างน้อย 1 เครื่อง)'
                          }
                          aria-label={`ลบ ${r.machine} ของ ${r.model} ${stepLabel(r)} ออกจาก routing`}
                          onClick={() => setConfirmDelete(r)}
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ))}
    </>
  );

  // ---- แท็บ "เพิ่มรายการ" ----
  const addTab = (
    <>
      <p className="text-muted small">
        ค้นหาโมเดล แล้วติ๊กขั้นตอน/เครื่องที่ใช้ jig นี้ —
        เปลี่ยนโมเดลได้เรื่อย ๆ <strong>สิ่งที่ติ๊กไว้จะไม่หาย</strong> กดบันทึกครั้งเดียวตอนท้าย
      </p>

      <div className="position-relative mb-3">
        <Form.Control
          value={keyword}
          placeholder="พิมพ์ชื่อโมเดลหรือคำอธิบาย…"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              loadModel(keyword);
            }
          }}
        />
        {suggestions.length > 0 && (
          <div
            className="list-group position-absolute w-100 shadow"
            style={{ zIndex: 5, maxHeight: 220, overflowY: 'auto' }}
          >
            {suggestions.slice(0, 12).map((s) => (
              <button
                type="button"
                key={s.model}
                className="list-group-item list-group-item-action py-1"
                onClick={() => {
                  setKeyword(s.model);
                  loadModel(s.model);
                }}
              >
                <span className="fw-semibold">{s.model}</span>
                {s.description ? <span className="text-muted small ms-2">{s.description}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {loadingModel && (
        <div className="text-center my-3">
          <Spinner animation="border" size="sm" className="text-mse" />
        </div>
      )}

      {!loadingModel && tree && (
        <>
          {tree.flows.map((flow, flowPos) => (
            <div className="mb-3" key={flow.flowIndex}>
              <div className="fw-bold text-mse mb-1">
                {model} · {flowLabel(flowPos + 1)}
              </div>
              {flow.steps.map((st, stepPos) => (
                <div className="mb-2" key={st.id ?? `${flow.flowIndex}-${st.stepIndex}`}>
                  <div className="small text-muted">
                    {stepPosLabel(stepPos + 1)} — {st.stepName || '(ไม่มีชื่อ)'}
                  </div>
                  <Table size="sm" className="mb-0 align-middle">
                    <tbody>
                      {st.machines.length === 0 ? (
                        <tr>
                          <td className="text-muted small py-1">ยังไม่มีเครื่อง</td>
                        </tr>
                      ) : (
                        st.machines.map((mc, altPos) => machineRow(mc, st.stepName, altPos + 1))
                      )}
                    </tbody>
                  </Table>
                </div>
              ))}
            </div>
          ))}

          {/* orphan อยู่คนละ array ไม่ได้ซ้อนใต้ step — ต้องวาดแยกแต่ติ๊กด้วยตัวเดียวกัน
              ถ้าไม่วาด แถวพวกนี้จะผูก jig ไม่ได้เลยทั้งที่ engine ยังอ่านมันอยู่ */}
          {tree.orphanMachines.length > 0 && (
            <div className="border border-warning rounded p-2 mb-2">
              <div className="fw-bold small mb-1">
                <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true" />
                เครื่องที่ยังไม่ผูกกับขั้นตอนไหน ({tree.orphanMachines.length})
              </div>
              <Table size="sm" className="mb-0 align-middle">
                <tbody>
                  {tree.orphanMachines.map((mc) =>
                    machineRow(mc, `flow ${mc.flowIndex} / step ${mc.stepIndex}`, 0)
                  )}
                </tbody>
              </Table>
            </div>
          )}

          {tree.flows.length === 0 && tree.orphanMachines.length === 0 && (
            <div className="empty-state">
              <i className="bi bi-diagram-3" aria-hidden="true" />
              <div>Model นี้ยังไม่มีขั้นตอนการผลิต</div>
            </div>
          )}
        </>
      )}

      {!loadingModel && !tree && <div className="text-muted small">ยังไม่ได้เลือกโมเดล</div>}
    </>
  );

  // ---- ขั้นสรุป ----
  const reviewTab = (
    <>
      <p className="text-muted small">
        ตรวจรายการก่อนบันทึก — กระทบทั้งหมด {diff.addedCount + diff.removedCount} แถว
      </p>

      {diff.addedCount > 0 && (
        <>
          <div className="fw-bold text-success mb-1">เพิ่ม ({diff.addedCount})</div>
          <ul className="small mb-3">
            {diff.assign.map((id) => (
              <li key={id}>{rowById.get(id) ? rowLabel(rowById.get(id)) : `แถว #${id}`}</li>
            ))}
          </ul>
        </>
      )}

      {diff.removedCount > 0 && (
        <>
          <div className="fw-bold text-danger mb-1">ถอด ({diff.removedCount})</div>
          <ul className="small mb-3">
            {diff.unassign.map((u) => (
              <li key={u.id}>
                {rowById.get(u.id) ? rowLabel(rowById.get(u.id)) : `แถว #${u.id}`}
                <span className="text-muted"> → กลับไปเป็น {u.jig_id}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {overwrites.length > 0 && (
        <div className="alert alert-warning py-2 small">
          <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true" />
          <strong>จะทับ jig เดิมของ {overwrites.length} แถว:</strong>
          <ul className="mb-0 mt-1">
            {overwrites.map((r) => (
              <li key={r.id}>
                {rowLabel(r)} — <span className="num">{r.jig_id}</span> → <span className="num">{jigId}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* คำเตือนที่สำคัญที่สุดของไดอะล็อกนี้ — getSmartSetupTime (engine.js:138)
          ไม่เคยได้ทำงานมาก่อนเพราะ resolveJigId ตั้งชื่อไม่ซ้ำเสมอ การผูก jig เดียว
          ให้หลายแถวคือการเปิดสวิตช์นั้น = เปลี่ยนผลการคำนวณแผน ไม่ใช่แค่จัดระเบียบข้อมูล */}
      {diff.addedCount > 0 && (
        <div className="alert alert-info py-2 small">
          <i className="bi bi-info-circle me-1" aria-hidden="true" />
          งานที่ใช้ jig เดียวกัน <strong>ลงเครื่องเดียวกันติดกัน</strong> จะถูกคิดเวลา setup
          แบบสั้น (ค่า <strong>minor setup</strong> ในหน้าตั้งค่า) แทนเวลาเต็ม —
          ติ๊กเมื่อของจริง<strong>ไม่ต้องเปลี่ยน jig</strong>เท่านั้น
          ถ้าหน้างานยังต้องถอดเปลี่ยนอยู่ แผนจะสั้นกว่าความจริงโดยไม่มีคำเตือน
        </div>
      )}

      {mismatch && (
        <div className="alert alert-warning py-2 small">
          <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true" />
          เลือกไว้ {summary.modelCount} โมเดล ({summary.models.join(', ')}) แต่ทะเบียนยังตั้งไว้ว่า
          <strong> ใช้เฉพาะโมเดลเดียว</strong> — ถ้า jig ตัวนี้ถอดไปใช้ข้ามโมเดลได้จริง
          ให้ไปติ๊ก &quot;ใช้ข้ามโมเดลได้&quot; ที่ปุ่มแก้ไขทะเบียนด้วย (ระบบไม่แก้ให้อัตโนมัติ)
        </div>
      )}

      {diff.addedCount + diff.removedCount === 0 && (
        <div className="text-muted small">ไม่มีอะไรเปลี่ยนแปลง</div>
      )}
    </>
  );

  return (
    <>
      <Modal show={show} onHide={busyAny ? undefined : onHide} size="lg" centered scrollable>
        <Modal.Header closeButton={!busyAny}>
          <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
            <i className="bi bi-diagram-3 me-2" aria-hidden="true" />
            การใช้งานจิ๊ก — {jigId}
            {readOnly && <span className="chip chip-info ms-2">ดูอย่างเดียว</span>}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {loadingOriginal && originalRows.length === 0 ? (
            <div className="text-center py-5">
              <Spinner animation="border" className="text-mse" />
            </div>
          ) : view === 'review' ? (
            reviewTab
          ) : (
            <>
              <Nav variant="tabs" activeKey={view} className="mb-3" onSelect={(k) => setView(k)}>
                <Nav.Item>
                  <Nav.Link eventKey="current">
                    ใช้อยู่ตอนนี้{' '}
                    <Badge bg="secondary" pill>{originalRows.length}</Badge>
                  </Nav.Link>
                </Nav.Item>
                {canEdit && (
                  <Nav.Item>
                    <Nav.Link eventKey="add">เพิ่มรายการ</Nav.Link>
                  </Nav.Item>
                )}
              </Nav>
              {view === 'current' ? currentTable : addTab}
            </>
          )}
        </Modal.Body>

        <Modal.Footer className="d-flex justify-content-between">
          <div className="small text-muted">
            เลือกไว้{' '}
            <Badge bg="secondary">{summary.rowCount}</Badge> แถว ·{' '}
            <Badge bg="secondary">{summary.modelCount}</Badge> โมเดล ·{' '}
            <Badge bg="secondary">{summary.machineCount}</Badge> เครื่อง
          </div>
          <div>
            <Button variant="secondary" className="me-2" onClick={onHide} disabled={busyAny}>
              {canEdit ? 'ยกเลิก' : 'ปิด'}
            </Button>
            {canEdit && (view === 'review' ? (
              <>
                <Button
                  variant="outline-secondary"
                  className="me-2"
                  onClick={() => setView('current')}
                  disabled={busyAny}
                >
                  ย้อนกลับ
                </Button>
                <Button
                  className="btn-mse"
                  onClick={save}
                  disabled={busyAny || diff.addedCount + diff.removedCount === 0}
                >
                  บันทึก
                </Button>
              </>
            ) : (
              <Button className="btn-mse" onClick={() => setView('review')} disabled={busyAny}>
                ถัดไป — ตรวจรายการ
              </Button>
            ))}
          </div>
        </Modal.Footer>
      </Modal>

      {/* ลบแถวออกจาก routing — มีผลทันที จึงต้องบอกให้ชัดว่าต่างจาก "ถอดจิ๊ก" ยังไง */}
      <ConfirmModal
        confirm={
          confirmDelete && {
            title: 'ลบเครื่องออกจาก routing',
            body:
              `ลบ "${confirmDelete.machine}" ออกจาก ${confirmDelete.model} · ${stepLabel(confirmDelete)}?\n\n`
              + 'ขั้นตอนนี้จะไม่มีเครื่องตัวนี้เป็นทางเลือกอีกต่อไป และเวลาต่อชิ้น/เวลาตั้งเครื่องที่ตั้งไว้จะหายถาวร\n\n'
              + 'ถ้าแค่ต้องการเลิกใช้จิ๊กตัวนี้ ให้กด "ถอดจิ๊ก" แทน (แถวยังอยู่)\n'
              + 'ถ้าเครื่องนี้ทำโมเดลนี้ไม่ได้ถาวร ให้ปิดใช้งานที่หน้า Routing Config แทน\n\n'
              + 'การลบมีผลทันที ไม่ต้องกดบันทึก',
            confirmLabel: 'ลบเลย',
            variant: 'danger',
            onConfirm: () => runDelete(confirmDelete),
          }
        }
        onHide={() => setConfirmDelete(null)}
      />
    </>
  );
};

export default JigAssignDialog;
