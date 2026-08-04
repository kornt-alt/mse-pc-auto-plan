import React, { useState, useEffect } from 'react';
import {
  Modal, Button, Spinner, Table, Form, Collapse,
} from 'react-bootstrap';

// PlanPreviewDialog — โชว์ diff "ก่อน → หลัง" ก่อนยืนยัน (Replan / เรียง Due Date / Drag / Lock / Unlock)
// props: show, mode('replan'|'sort'|'drag'|'lock'|'unlock'), diff({rows,summary}),
//        detail(buildPlanDetail: {batches,machineLoad}), capacityWarning({unplanned_count,last_calendar_date}|null),
//        settings, loading, onConfirm(() => Promise), onHide
// diff/detail มาจาก pure module — parent เป็นคนรัน sim + ยิง API จริงตอน onConfirm

// meta ของ changeType → ป้ายสี + ข้อความ (จัดกลุ่มให้เข้าใจง่าย)
const CHANGE_META = {
  'fell-out': { chip: 'chip-ng', icon: 'bi-x-octagon-fill', label: 'หลุดออกจากแผน' },
  'now-late': { chip: 'chip-ng', icon: 'bi-exclamation-triangle-fill', label: 'ล่าช้าขึ้น' },
  'fg-later': { chip: 'chip-warn', icon: 'bi-arrow-down', label: 'FG ช้าลง' },
  'newly-planned': { chip: 'chip-ok', icon: 'bi-plus-circle-fill', label: 'เข้าแผนใหม่' },
  'now-ontime': { chip: 'chip-ok', icon: 'bi-check-circle-fill', label: 'กลับมาตรงเวลา' },
  'fg-earlier': { chip: 'chip-ok', icon: 'bi-arrow-up', label: 'FG เร็วขึ้น' },
  'mode-changed': { chip: 'chip-info', icon: 'bi-lock-fill', label: 'เปลี่ยนสถานะล็อก' },
  'priority-changed': { chip: 'chip-info', icon: 'bi-arrow-down-up', label: 'เปลี่ยนลำดับ' },
  unchanged: { chip: '', icon: '', label: 'ไม่เปลี่ยน' },
};

const MODE_META = {
  replan: { title: 'ตรวจแผนก่อนยืนยัน Replan', icon: 'bi-magic', confirmLabel: 'ยืนยัน Replan', confirmVariant: 'info' },
  sort: { title: 'ตรวจผลก่อนเรียงตาม Due Date', icon: 'bi-arrow-down-up', confirmLabel: 'ยืนยันเรียงลำดับ', confirmVariant: 'primary' },
  drag: { title: 'ตรวจผลก่อนบันทึกลำดับ', icon: 'bi-grip-vertical', confirmLabel: 'บันทึกลำดับ', confirmVariant: 'primary' },
  lock: { title: 'ตรวจผลกระทบก่อนล็อกทั้งหมด (FIXED)', icon: 'bi-lock-fill', confirmLabel: 'ยืนยันล็อกทั้งหมด', confirmVariant: 'warning', note: 'FG ด้านล่างคือผลที่ Replan จะได้เมื่อทุกออเดอร์เป็น FIXED — การยืนยันจะเปลี่ยนแค่สถานะล็อก ยังไม่บันทึกแผน (กด Replan เองอีกที)' },
  unlock: { title: 'ตรวจผลกระทบก่อนปลดล็อกทั้งหมด (NEW)', icon: 'bi-unlock', confirmLabel: 'ยืนยันปลดล็อกทั้งหมด', confirmVariant: 'success', note: 'FG ด้านล่างคือผลที่ Replan จะได้เมื่อปลดล็อกทุกออเดอร์ — การยืนยันจะเปลี่ยนแค่สถานะล็อก ยังไม่บันทึกแผน (กด Replan เองอีกที)' },
};

const dash = (v) => (v == null || v === '' ? '-' : v);
const fmtMin = (m) => `${Math.round((Number(m) || 0) * 10) / 10} น.`;

// แสดง before → after (ทั้งวันและ priority); ถ้าเท่ากันโชว์ค่าเดียว
const Delta = ({ before, after }) => {
  if (after === undefined) return <span className="num">{dash(before)}</span>;
  if (String(before) === String(after)) return <span className="num">{dash(before)}</span>;
  return (
    <span className="num">
      <span className="text-muted">{dash(before)}</span>
      <i className="bi bi-arrow-right mx-1" aria-hidden="true" />
      <span className="fw-bold">{dash(after)}</span>
    </span>
  );
};

// แถบ utilization สั้น ๆ (เปอร์เซ็นต์การใช้เครื่อง)
const UtilBar = ({ pct }) => {
  if (pct == null) return <span className="text-muted small">-</span>;
  const cls = pct >= 100 ? 'bg-danger' : pct >= 85 ? 'bg-warning' : 'bg-success';
  return (
    <span className="d-inline-flex align-items-center gap-2" title={`ใช้ไป ${pct}% ของเวลาเครื่อง`}>
      <span className="rounded" style={{ display: 'inline-block', width: 70, height: 8, background: 'var(--mse-border, #e0e0e0)' }}>
        <span className={`rounded ${cls}`} style={{ display: 'block', width: `${Math.min(100, pct)}%`, height: '100%' }} />
      </span>
      <span className="num small">{pct}%</span>
    </span>
  );
};

const SummaryChips = ({ summary }) => (
  <div className="d-flex flex-wrap gap-2">
    <span className="chip chip-info"><i className="bi bi-pencil-fill" aria-hidden="true" /> เปลี่ยน {summary.changed}</span>
    {summary.fellOut > 0 && (
      <span className="chip chip-ng"><i className="bi bi-x-octagon-fill" aria-hidden="true" /> หลุดแผน {summary.fellOut}</span>
    )}
    {summary.nowLate > 0 && (
      <span className="chip chip-ng"><i className="bi bi-exclamation-triangle-fill" aria-hidden="true" /> ล่าช้าขึ้น {summary.nowLate}</span>
    )}
    {summary.improved > 0 && (
      <span className="chip chip-ok"><i className="bi bi-check-circle-fill" aria-hidden="true" /> ดีขึ้น {summary.improved}</span>
    )}
    {summary.modeChanged > 0 && (
      <span className="chip chip-info"><i className="bi bi-lock-fill" aria-hidden="true" /> เปลี่ยนล็อก {summary.modeChanged}</span>
    )}
    <span className="chip"><i className="bi bi-dash-circle" aria-hidden="true" /> ไม่เปลี่ยน {summary.unchanged}</span>
  </div>
);

// legend อธิบายกฎ engine (จาก SCHEDULER_FLOW.md) + ค่าจริงจาก system_settings
const RuleLegend = ({ settings }) => {
  const s = settings || {};
  return (
    <ul className="mb-0 small text-muted ps-3">
      <li><strong>VIP (วัน Confirm)</strong> — ออเดอร์ที่ตั้งวัน Confirm จะถูกจัดก่อน และใช้วัน Confirm แทน Due Date</li>
      <li><strong>FIXED</strong> — ออเดอร์ที่ล็อกไว้จะไม่ถูกขยับเวลา (เฉพาะ NEW เท่านั้นที่จัดใหม่)</li>
      <li><strong>วัตถุดิบพร้อม</strong> — เริ่มผลิตได้เร็วสุด = max(วัน Release, วันวัตถุดิบเข้า)</li>
      <li>
        <strong>รวมออเดอร์ (Pack)</strong> — มัดออเดอร์ที่ Due ใกล้กันภายใน {s.pack_window_days ?? 30} วัน เป็นก้อนเดียว
      </li>
      <li>
        <strong>อยู่เครื่องเดิม (Stickiness)</strong> — {s.enable_stickiness ? 'เปิด' : 'ปิด'}
        {' · '}<strong>Heat Deep Plan</strong> — {s.enable_heat_deep_plan ? 'เปิด' : 'ปิด'}
      </li>
    </ul>
  );
};

// สรุปโหลดเครื่อง (คอขวด) ทั้งแผน — ตอบ "เครื่องไหนเป็นตัวกระทบ"
const MachineLoad = ({ machineLoad }) => {
  if (!machineLoad || machineLoad.length === 0) return <div className="text-muted small">ไม่มีข้อมูลการใช้เครื่อง</div>;
  return (
    <Table size="sm" borderless className="mb-0 align-middle">
      <thead>
        <tr className="small text-muted">
          <th>เครื่อง</th><th className="text-end">ใช้ไป (น.)</th><th className="text-end">มีทั้งหมด (น.)</th>
          <th>การใช้งาน</th><th className="text-end">วัน</th>
        </tr>
      </thead>
      <tbody>
        {machineLoad.slice(0, 10).map((m) => (
          <tr key={m.machine}>
            <td className="num fw-bold">{m.machine}</td>
            <td className="num text-end">{m.used}</td>
            <td className="num text-end text-muted">{m.available || '-'}</td>
            <td><UtilBar pct={m.pct} /></td>
            <td className="num text-end">{m.days}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

// รายละเอียดเชิงลึกต่อ batch: เครื่อง/process กินเวลาเท่าไหร่ + แย่งเครื่องกับใคร
const BatchDetail = ({ info }) => {
  if (!info) {
    return <div className="text-muted small py-2">ไม่มีการจองเครื่องในแผนนี้ (หลุดออกจากแผน หรือยังไม่ถูกจัด)</div>;
  }
  const contended = info.cells.filter((c) => c.others.length > 0);
  return (
    <div className="p-2 small">
      <div className="mb-2">
        <i className="bi bi-hdd-stack me-1" aria-hidden="true" />
        รวม <strong className="num">{fmtMin(info.totalMin)}</strong> ใน {info.machines.length} เครื่อง
      </div>

      {/* เครื่อง/process กินเวลาเท่าไหร่ */}
      <div className="mb-2">
        {info.machines.map((m) => (
          <div key={m.machine} className="mb-1">
            <span className="chip chip-info me-2"><i className="bi bi-cpu" aria-hidden="true" /> {m.machine}</span>
            <span className="num me-2">{fmtMin(m.total)}</span>
            <span className="text-muted">
              (งาน {fmtMin(m.run)}{m.setup > 0 ? ` + setup ${fmtMin(m.setup)}` : ''})
            </span>
            <div className="ps-4 text-muted">
              {m.steps.map((s) => (
                <span key={s.step} className="me-3 text-nowrap">
                  <i className="bi bi-dot" aria-hidden="true" />{s.step}: <span className="num">{fmtMin(s.min)}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ทำไมกระทบกัน: เครื่อง-วันที่แย่งกับ batch อื่น */}
      {contended.length > 0 && (
        <div className="border-top pt-2">
          <div className="fw-bold mb-1"><i className="bi bi-people-fill me-1" aria-hidden="true" />แย่งเครื่องกับออเดอร์อื่น</div>
          {contended.slice(0, 6).map((c) => (
            <div key={`${c.machine}|${c.date}`} className="mb-1 d-flex flex-wrap align-items-center gap-2">
              <span className="num text-nowrap">{c.machine} @ {c.date}</span>
              <UtilBar pct={c.pct} />
              <span className="text-muted">
                งานนี้ {fmtMin(c.ownMin)} · แย่งกับ{' '}
                {c.others.slice(0, 4).map((o, i) => (
                  <span key={o.batch}>
                    {i > 0 && ', '}
                    <span className="fw-bold">{o.batch}</span> ({fmtMin(o.min)})
                  </span>
                ))}
                {c.others.length > 4 ? ` +${c.others.length - 4}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PlanPreviewDialog = ({ show, mode = 'replan', diff, detail, capacityWarning, settings, loading, onConfirm, onHide }) => {
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (show) {
      setOnlyChanged(true);
      setShowLegend(false);
      setShowLoad(false);
      setExpanded(new Set());
      setSaving(false);
    }
  }, [show]);

  const meta = MODE_META[mode] || MODE_META.replan;
  const rows = diff ? diff.rows : [];
  const visibleRows = onlyChanged ? rows.filter((r) => r.changeType !== 'unchanged') : rows;
  const hasFg = rows.some((r) => r.fgAfter !== undefined);
  const batches = detail ? detail.batches : null;
  const colCount = 3 + (hasFg ? 1 : 0) + 3; // expand + Batch + Model + Priority [+FG] + สถานะ + เงื่อนไข

  const toggleRow = (batch) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(batch)) next.delete(batch); else next.add(batch);
    return next;
  });

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving;

  return (
    <Modal show={show} onHide={busy ? undefined : onHide} size="xl" centered scrollable>
      <Modal.Header closeButton={!busy}>
        <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
          <i className={`bi ${meta.icon} me-2`} aria-hidden="true" />
          {meta.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" />
            <div className="text-muted mt-2">กำลังจำลองแผน (ยังไม่บันทึก)...</div>
          </div>
        ) : !diff || diff.rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-inbox" aria-hidden="true" />
            <div>ไม่มีข้อมูลให้เปรียบเทียบ</div>
          </div>
        ) : (
          <>
            {capacityWarning && (
              <div className="alert alert-warning py-2 d-flex align-items-start gap-2 mb-2" role="alert">
                <i className="bi bi-calendar-x-fill mt-1" aria-hidden="true" />
                <span>
                  ปฏิทินถึงแค่ <strong className="num">{capacityWarning.last_calendar_date || '-'}</strong>
                  {' — มี '}
                  <strong>{capacityWarning.unplanned_count}</strong>
                  {' งานที่วางไม่ลง ควรสร้างปฏิทินเพิ่มก่อนยืนยัน'}
                </span>
              </div>
            )}
            {meta.note && (
              <div className="border rounded p-2 mb-2 small d-flex align-items-start gap-2" style={{ background: 'var(--mse-info-bg, #e7f1ff)' }}>
                <i className="bi bi-info-circle-fill text-info mt-1" aria-hidden="true" />
                <span>{meta.note}</span>
              </div>
            )}
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
              <SummaryChips summary={diff.summary} />
              <div className="d-flex align-items-center gap-3">
                <Form.Check
                  type="switch"
                  id="preview-only-changed"
                  label="แสดงเฉพาะที่เปลี่ยน"
                  checked={onlyChanged}
                  onChange={(e) => setOnlyChanged(e.target.checked)}
                />
                {batches && (
                  <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={() => setShowLoad((v) => !v)}>
                    <i className={`bi ${showLoad ? 'bi-chevron-up' : 'bi-hdd-stack'} me-1`} aria-hidden="true" />
                    โหลดเครื่อง
                  </Button>
                )}
                <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={() => setShowLegend((v) => !v)}>
                  <i className={`bi ${showLegend ? 'bi-chevron-up' : 'bi-info-circle'} me-1`} aria-hidden="true" />
                  กฎการจัดแผน
                </Button>
              </div>
            </div>

            <Collapse in={showLoad}>
              <div>
                <div className="border rounded bg-light p-2 mb-3">
                  <div className="small text-muted mb-1">เครื่องที่โหลดสูงสุด (เรียงตาม % การใช้งาน) — ตัวที่คิวชนกันมักเป็นคอขวด</div>
                  <MachineLoad machineLoad={detail ? detail.machineLoad : []} />
                </div>
              </div>
            </Collapse>

            <Collapse in={showLegend}>
              <div>
                <div className="border rounded bg-light p-2 mb-3">
                  <RuleLegend settings={settings} />
                </div>
              </div>
            </Collapse>

            <div className="matrix-scroll">
              <Table hover size="sm" className="align-middle bg-white mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Batch</th>
                    <th>Model</th>
                    <th className="text-center">Priority</th>
                    <th>Due Date</th>
                    {hasFg && <th>FG (ก่อน → หลัง)</th>}
                    <th>สถานะ</th>
                    <th>เงื่อนไข</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const cm = CHANGE_META[r.changeType] || CHANGE_META.unchanged;
                    const info = batches ? batches.get(r.batch) : null;
                    const isOpen = expanded.has(r.batch);
                    const modeFlipped = r.inputs.isFixedAfter !== undefined
                      && r.inputs.isFixedAfter !== r.inputs.isFixed;
                    return (
                      <React.Fragment key={r.batch}>
                        <tr>
                          <td className="text-center">
                            {batches && (
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 icon-btn"
                                title={isOpen ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียดเครื่อง/เวลา'}
                                aria-label="รายละเอียดเครื่อง"
                                onClick={() => toggleRow(r.batch)}
                              >
                                <i className={`bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} aria-hidden="true" />
                              </Button>
                            )}
                          </td>
                          <td className="num fw-bold">{r.batch}</td>
                          <td>{r.model}</td>
                          <td className="text-center">
                            <Delta before={r.priorityBefore} after={r.priorityAfter} />
                          </td>
                          <td className="num">{dash(r.dueDate)}</td>
                          {hasFg && (
                            <td><Delta before={r.fgBefore} after={r.fgAfter} /></td>
                          )}
                          <td>
                            {r.changeType === 'unchanged' ? (
                              <span className="text-muted small">{cm.label}</span>
                            ) : (
                              <span className={`chip ${cm.chip}`}>
                                <i className={`bi ${cm.icon}`} aria-hidden="true" /> {cm.label}
                              </span>
                            )}
                          </td>
                          <td className="text-nowrap">
                            {modeFlipped && (
                              <span className="me-2 num">
                                <i className={`bi ${r.inputs.isFixed ? 'bi-lock-fill' : 'bi-unlock'} text-muted`} aria-hidden="true" />
                                <i className="bi bi-arrow-right mx-1" aria-hidden="true" />
                                <i className={`bi ${r.inputs.isFixedAfter ? 'bi-lock-fill text-warning' : 'bi-unlock text-success'}`} aria-hidden="true" />
                              </span>
                            )}
                            {r.inputs.isVip && (
                              <i className="bi bi-star-fill text-mse me-1" title={`VIP · Confirm ${r.inputs.confirmDate}`} />
                            )}
                            {!modeFlipped && r.inputs.isFixed && (
                              <i className="bi bi-lock-fill text-warning me-1" title="FIXED (ล็อกเวลา)" />
                            )}
                            {r.inputs.programNotes === 'Please pull in material' && (
                              <i className="bi bi-exclamation-triangle-fill text-danger" title="วัตถุดิบเข้าช้ากว่าวันเริ่มผลิต" />
                            )}
                            {r.inputs.materialArrived && r.inputs.planningMode !== 'backward' && !r.inputs.isFixed && (
                              <span className="text-success ms-1" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                                <i className="bi bi-lightning-charge-fill" aria-hidden="true" />{' '}
                                วัตถุดิบพร้อม — เริ่มได้ทันที
                                {r.inputs.materialDate ? ` (ไม่รอถึง ${r.inputs.materialDate})` : ''}
                              </span>
                            )}
                          </td>
                        </tr>
                        {batches && isOpen && (
                          <tr className="bg-light">
                            <td />
                            <td colSpan={colCount - 1} className="p-0">
                              <BatchDetail info={info} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={colCount} className="text-center text-muted py-3">
                        ไม่มีรายการที่เปลี่ยนแปลง
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy}>
          ยกเลิก
        </Button>
        <Button
          variant={meta.confirmVariant}
          className={meta.confirmVariant === 'info' ? 'text-white' : undefined}
          onClick={confirm}
          disabled={busy || !diff || diff.rows.length === 0}
        >
          {saving ? <Spinner animation="border" size="sm" className="me-1" /> : <i className="bi bi-check-lg me-1" aria-hidden="true" />}
          {meta.confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default PlanPreviewDialog;
