import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal, Button, Spinner, Table, Form, Tabs, Tab,
} from 'react-bootstrap';
import { buildOrderRules } from './planRules';

// PlanPreviewDialog — ตอบ 4 คำถามก่อนยืนยันแผน (Replan / เรียง Due Date / Drag)
//   สรุป        : ความเสี่ยงที่ต้องรู้ก่อนกด (หลุดแผน / ล่าช้า / ปฏิทินไม่พอ / เครื่องคอขวด)
//   ความต่าง    : diff ก่อน→หลัง รายออเดอร์ + เจาะดูเครื่อง/เวลา/คนที่แย่งเครื่อง
//   เครื่องจักร : เครื่องไหนรัน batch ไหนบ้าง กี่นาที และวันไหนหนาสุด
//   กฎการคำนวณ : กฎที่ engine ใช้กับออเดอร์นี้จริง ๆ พร้อมค่าที่ป้อนเข้ากฎ
//
// props: show, mode('replan'|'sort'|'drag'|'lock'|'unlock'), diff({rows,summary}),
//        detail(buildPlanDetail: {batches,machineLoad}), machineSchedule(buildMachineSchedule: []),
//        capacityWarning({unplanned_count,last_calendar_date}|null),
//        settings, todayStr, loading, onConfirm(() => Promise), onHide
// diff/detail/machineSchedule มาจาก pure module — parent เป็นคนรัน sim + ยิง API จริงตอน onConfirm
// todayStr ฉีดมาจาก parent (todayDateStr ใน OrderControlTower) — dialog ไม่แตะนาฬิกาเอง
//
// ขอบเขตที่ตอบได้: กฎไหนถูกใช้ + ค่าที่ป้อนกฎนั้น. ตอบไม่ได้: ทำไม engine เลือกวัน/เครื่องนั้น
// (sim response ไม่มี causal trace — ดู planRules.js L6-8) อย่าทำ UI ให้ดูเหมือนตอบได้มากกว่านี้

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

// tone จาก planRules → คลาส chip ใน theme.css (map ที่เดียว)
const TONE_CHIP = { ok: 'chip-ok', ng: 'chip-ng', warn: 'chip-warn', info: 'chip-info' };

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

// ห่างจาก Due กี่วัน — ถ้อยคำเต็มใช้ชุดเดียวกับ OrderFormDialog (เทียบ FG vs Due เหมือนกัน)
const gapWords = (d) => {
  if (d == null) return '-';
  if (d > 0) return `ช้ากว่า Due ${d} วัน`;
  if (d < 0) return `เร็วกว่า Due ${-d} วัน`;
  return 'ทันเวลาพอดี';
};
// ในตารางใช้แบบสั้นพอสแกนทั้งคอลัมน์ได้ (+2 / -3) แล้วเก็บถ้อยคำเต็มไว้ใน title
const gapShort = (d) => {
  if (d == null) return '-';
  if (d === 0) return 'ตรงวัน';
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} วัน`;
};
const gapClass = (d) => (d == null ? 'text-muted' : d > 0 ? 'text-danger fw-bold' : d < 0 ? 'text-success' : '');

// ช่อง "ห่าง Due": โชว์ค่าหลังแผนใหม่ และถ้าก่อน→หลังต่างกันให้เห็นว่าขยับกี่วัน
const GapCell = ({ before, after }) => {
  const has = after !== undefined && after !== null;
  const shown = has ? after : before;
  const changed = after !== undefined && before != null && after != null && after !== before;
  if (changed) {
    return (
      <span className="num text-nowrap" title={`${gapWords(before)} → ${gapWords(after)}`}>
        <span className="text-muted">{gapShort(before)}</span>
        <i className="bi bi-arrow-right mx-1" aria-hidden="true" />
        <span className={gapClass(after)}>{gapShort(after)}</span>
      </span>
    );
  }
  return <span className={`num text-nowrap ${gapClass(shown)}`} title={gapWords(shown)}>{gapShort(shown)}</span>;
};

// แถบ utilization สั้น ๆ (เปอร์เซ็นต์การใช้เครื่อง) — pct null = ปฏิทินไม่ครอบคลุมวันนั้น
const UtilBar = ({ pct }) => {
  if (pct == null) {
    return <span className="text-muted small" title="ไม่มีข้อมูลปฏิทินสำหรับช่วงนี้">-</span>;
  }
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

// กฎที่ engine ใช้กับออเดอร์นี้ (planRules.buildOrderRules) — ค่าจริง ไม่ใช่ legend รวม
const RuleList = ({ rules }) => (
  <div className="d-flex flex-column gap-1">
    {rules.map((r) => (
      <div key={r.id} className="d-flex flex-wrap align-items-baseline gap-2">
        <span className={`chip ${TONE_CHIP[r.tone] || ''}`} style={{ minWidth: 118, justifyContent: 'center' }}>
          {r.label}
        </span>
        <span className="num fw-bold">{r.value}</span>
        <span className="text-muted small">{r.detail}</span>
      </div>
    ))}
  </div>
);

// รายละเอียดเชิงลึกต่อ batch: กฎที่ใช้ + เครื่อง/process กินเวลาเท่าไหร่ + แย่งเครื่องกับใคร
const BatchDetail = ({ info, rules }) => {
  const contended = info ? info.cells.filter((c) => c.others.length > 0) : [];
  return (
    <div className="p-2 small">
      {rules && rules.length > 0 && (
        <div className="mb-2 pb-2 border-bottom">
          <div className="fw-bold mb-1">
            <i className="bi bi-sliders me-1" aria-hidden="true" />กฎที่ใช้กับออเดอร์นี้
          </div>
          <RuleList rules={rules} />
        </div>
      )}

      {!info ? (
        <div className="text-muted">ไม่มีการจองเครื่องในแผนนี้ (หลุดออกจากแผน หรือยังไม่ถูกจัด)</div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
};

// ---- แท็บ "สรุป": นำด้วยความเสี่ยง แล้วค่อยตามด้วยคอขวด ----
const RiskLine = ({ tone, icon, label, children }) => (
  <div className="d-flex align-items-start gap-2 py-1">
    <span className={`chip ${TONE_CHIP[tone] || ''}`} style={{ minWidth: 104, justifyContent: 'center' }}>
      <i className={`bi ${icon}`} aria-hidden="true" /> {label}
    </span>
    <div className="small pt-1">{children}</div>
  </div>
);

const SummaryTab = ({ diff, machineSchedule, capacityWarning, onGoTo }) => {
  const rows = diff.rows;
  const fellOut = rows.filter((r) => r.changeType === 'fell-out');
  const nowLate = rows.filter((r) => r.changeType === 'now-late');
  const improved = rows.filter((r) => ['fg-earlier', 'now-ontime', 'newly-planned'].includes(r.changeType));

  // งานที่ยังส่งไม่ทันหลังแผนใหม่ (ไม่ใช่แค่ "แย่ลง") — ตัวเลขที่ผู้วางแผนต้องตอบให้ได้
  const lateAfter = rows.filter((r) => r.delayAfter === 'late');
  const lateBefore = rows.filter((r) => r.delayBefore === 'late');
  // makespan = FG ช้าสุดในแผนใหม่
  const makespan = rows.reduce((mx, r) => (r.fgAfter && r.fgAfter > mx ? r.fgAfter : mx), '');
  const noCalendar = machineSchedule.filter((m) => m.pct == null);
  const top = machineSchedule.filter((m) => m.pct != null).slice(0, 3);

  const list = (arr, n = 8) => arr.slice(0, n).map((r) => r.batch).join(', ')
    + (arr.length > n ? ` +${arr.length - n}` : '');

  return (
    <div className="pt-3">
      <div className="mb-3">
        <div className="fw-bold mb-2"><i className="bi bi-exclamation-diamond me-1" aria-hidden="true" />สิ่งที่ต้องตัดสินใจ</div>

        {fellOut.length > 0 && (
          <RiskLine tone="ng" icon="bi-x-octagon-fill" label={`หลุดแผน ${fellOut.length}`}>
            <span className="num">{list(fellOut)}</span>
            <div className="text-muted">วางไม่ลงในปฏิทินที่มี — ยืนยันแล้วงานเหล่านี้จะไม่มีวัน FG</div>
          </RiskLine>
        )}

        {nowLate.length > 0 && (
          <RiskLine tone="ng" icon="bi-exclamation-triangle-fill" label={`ล่าช้าขึ้น ${nowLate.length}`}>
            <span className="num">{list(nowLate)}</span>
            <div className="text-muted">เดิมทันกำหนด แผนใหม่เลยกำหนด</div>
          </RiskLine>
        )}

        <RiskLine
          tone={lateAfter.length > lateBefore.length ? 'warn' : lateAfter.length === 0 ? 'ok' : 'info'}
          icon="bi-calendar-check"
          label="ส่งไม่ทัน"
        >
          <span className="num">{lateBefore.length}</span>
          <i className="bi bi-arrow-right mx-1" aria-hidden="true" />
          <span className="num fw-bold">{lateAfter.length}</span> งาน
          <span className="text-muted"> (นับจากงานทั้งหมด {rows.length})</span>
        </RiskLine>

        {improved.length > 0 && (
          <RiskLine tone="ok" icon="bi-check-circle-fill" label={`ดีขึ้น ${improved.length}`}>
            <span className="num">{list(improved)}</span>
          </RiskLine>
        )}

        {makespan && (
          <RiskLine tone="info" icon="bi-flag" label="งานสุดท้ายเสร็จ">
            <span className="num fw-bold">{makespan}</span>
            <span className="text-muted"> — วัน FG ที่ช้าที่สุดในแผนนี้</span>
          </RiskLine>
        )}
      </div>

      {(top.length > 0 || noCalendar.length > 0) && (
        <div>
          <div className="fw-bold mb-2">
            <i className="bi bi-hdd-stack me-1" aria-hidden="true" />เครื่องที่เป็นคอขวด
            <Button variant="link" size="sm" className="p-0 ms-2 text-decoration-none" onClick={() => onGoTo('machines')}>
              ดูทั้งหมด
            </Button>
          </div>
          {top.map((m) => (
            <div key={m.machine} className="d-flex flex-wrap align-items-center gap-2 py-1 small">
              <span className="num fw-bold" style={{ minWidth: 70 }}>{m.machine}</span>
              <UtilBar pct={m.pct} />
              <span className="text-muted">
                {fmtMin(m.used)} / {fmtMin(m.available)} · {m.days} วัน · {m.batches.length} งาน
                {m.peakDay ? ` · หนาสุด ${m.peakDay.date}` : ''}
              </span>
            </div>
          ))}
          {noCalendar.length > 0 && (
            <div className="small text-muted mt-1">
              <i className="bi bi-calendar-x me-1" aria-hidden="true" />
              ไม่มีข้อมูลปฏิทินสำหรับ{' '}
              <span className="num">{noCalendar.map((m) => m.machine).join(', ')}</span>
              {' '}— คำนวณ % การใช้งานไม่ได้
            </div>
          )}
        </div>
      )}

      {capacityWarning && (
        <div className="small text-muted mt-2">
          <i className="bi bi-info-circle me-1" aria-hidden="true" />
          ปฏิทินถึงแค่ {capacityWarning.last_calendar_date || '-'} — สร้างปฏิทินเพิ่มแล้ว Replan ใหม่จะช่วยงานที่วางไม่ลงได้
        </div>
      )}
    </div>
  );
};

// ---- แท็บ "เครื่องจักร": เครื่องไหนรัน batch ไหนบ้าง กี่นาที ----
const MachineTab = ({ machineSchedule, modelByBatch }) => {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (machine) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(machine)) next.delete(machine); else next.add(machine);
    return next;
  });

  if (!machineSchedule || machineSchedule.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-hdd-stack" aria-hidden="true" />
        <div>ไม่มีข้อมูลการใช้เครื่องในแผนนี้</div>
      </div>
    );
  }

  return (
    <div className="pt-3">
      <div className="small text-muted mb-2">
        เรียงตาม % การใช้งาน — กดที่เครื่องเพื่อดูว่ารัน batch ไหนบ้าง
      </div>
      <div className="matrix-scroll">
        <Table hover size="sm" className="align-middle bg-white mb-0">
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              <th>เครื่อง</th>
              <th className="text-end">ใช้ไป</th>
              <th className="text-end">มีทั้งหมด</th>
              <th>การใช้งาน</th>
              <th className="text-end">วัน</th>
              <th className="text-end">งาน</th>
              <th>วันหนาสุด</th>
            </tr>
          </thead>
          <tbody>
            {machineSchedule.map((m) => {
              const isOpen = open.has(m.machine);
              return (
                <React.Fragment key={m.machine}>
                  <tr>
                    <td className="text-center">
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 icon-btn"
                        title={isOpen ? 'ซ่อนรายการงาน' : 'ดูว่าเครื่องนี้รัน batch ไหนบ้าง'}
                        aria-label={`รายการงานของเครื่อง ${m.machine}`}
                        onClick={() => toggle(m.machine)}
                      >
                        <i className={`bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} aria-hidden="true" />
                      </Button>
                    </td>
                    <td className="num fw-bold">{m.machine}</td>
                    <td className="num text-end">{fmtMin(m.used)}</td>
                    <td className="num text-end text-muted">{m.available > 0 ? fmtMin(m.available) : '-'}</td>
                    <td><UtilBar pct={m.pct} /></td>
                    <td className="num text-end">{m.days}</td>
                    <td className="num text-end">{m.batches.length}</td>
                    <td className="num small">
                      {m.peakDay ? (
                        <>
                          {m.peakDay.date}
                          {m.peakDay.pct != null && (
                            <span className={m.peakDay.pct >= 100 ? 'text-danger ms-1' : 'text-muted ms-1'}>
                              ({m.peakDay.pct}%)
                            </span>
                          )}
                        </>
                      ) : '-'}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-light">
                      <td />
                      <td colSpan={7} className="p-2">
                        <Table size="sm" borderless className="mb-1 align-middle bg-transparent">
                          <thead>
                            <tr className="small text-muted">
                              <th>Batch</th><th>Model</th>
                              <th className="text-end">เวลา</th>
                              <th className="text-end">%เครื่อง</th>
                              <th>ช่วงวัน</th>
                              <th>Process</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.batches.map((b) => (
                              <tr key={b.batch}>
                                <td className="num fw-bold">{b.batch}</td>
                                <td className="small">{modelByBatch.get(b.batch) || '-'}</td>
                                <td className="num text-end">
                                  {fmtMin(b.totalMin)}
                                  {b.setup > 0 && (
                                    <span className="text-muted small"> (setup {fmtMin(b.setup)})</span>
                                  )}
                                </td>
                                <td className="num text-end">{b.sharePct == null ? '-' : `${b.sharePct}%`}</td>
                                <td className="num small text-nowrap">
                                  {b.firstDate === b.lastDate
                                    ? dash(b.firstDate)
                                    : `${dash(b.firstDate)} → ${dash(b.lastDate)}`}
                                </td>
                                <td className="small text-muted">
                                  {b.steps.slice(0, 3).map((s) => s.step).join(', ')}
                                  {b.steps.length > 3 ? ` +${b.steps.length - 3}` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                        {m.peakDay && m.peakDay.batches.length > 1 && (
                          <div className="small text-muted px-1">
                            <i className="bi bi-people-fill me-1" aria-hidden="true" />
                            วันหนาสุด <span className="num">{m.peakDay.date}</span>
                            {m.peakDay.pct != null && <> ({m.peakDay.pct}%)</>} — ชนกัน:{' '}
                            {m.peakDay.batches.slice(0, 5).map((b, i) => (
                              <span key={b.batch}>
                                {i > 0 && ', '}
                                <span className="fw-bold num">{b.batch}</span> ({fmtMin(b.min)})
                              </span>
                            ))}
                            {m.peakDay.batches.length > 5 ? ` +${m.peakDay.batches.length - 5}` : ''}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );
};

// ---- แท็บ "กฎการคำนวณ": กฎที่ใช้จริงรายออเดอร์ ----
const RulesTab = ({ rows, rulesByBatch, settings }) => {
  const s = settings || {};
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => r.batch.toLowerCase().includes(needle) || String(r.model).toLowerCase().includes(needle))
    : rows.slice(0, 40);

  return (
    <div className="pt-3">
      <div className="border rounded p-2 mb-3 small" style={{ background: 'var(--mse-canvas)' }}>
        <div className="mb-1">
          <i className="bi bi-info-circle-fill text-info me-1" aria-hidden="true" />
          ตารางนี้บอกว่า <strong>กฎไหนถูกใช้กับออเดอร์นี้ และค่าที่ป้อนกฎคืออะไร</strong>
          {' '}— ไม่ได้บอกว่าทำไม engine ถึงเลือกวันหรือเครื่องนั้น ๆ (ผลจำลองไม่มีข้อมูลเหตุผลนั้น)
        </div>
        <div className="text-muted">
          ค่าที่ใช้อยู่ตอนนี้: หน้าต่างรวมออเดอร์ {s.pack_window_days ?? 30} วัน
          {' · '}อยู่เครื่องเดิม (Stickiness) {s.enable_stickiness ? 'เปิด' : 'ปิด'}
          {' · '}Heat Deep Plan {s.enable_heat_deep_plan ? 'เปิด' : 'ปิด'}
        </div>
      </div>

      <Form.Control
        type="search"
        size="sm"
        className="mb-3"
        placeholder="ค้นหา Batch หรือ Model… (ว่างไว้ = แสดง 40 รายการแรก)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="ค้นหาออเดอร์เพื่อดูกฎที่ใช้"
      />

      {shown.length === 0 ? (
        <div className="empty-state"><i className="bi bi-search" aria-hidden="true" /><div>ไม่พบออเดอร์ที่ค้นหา</div></div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {shown.map((r) => (
            <div key={r.batch} className="border rounded p-2">
              <div className="mb-2">
                <span className="num fw-bold me-2">{r.batch}</span>
                <span className="text-muted small">{r.model}</span>
                <span className="text-muted small ms-2">· Due {dash(r.dueDate)}</span>
                {r.fgAfter !== undefined && (
                  <span className="ms-2 small">FG <Delta before={r.fgBefore} after={r.fgAfter} /></span>
                )}
              </div>
              <RuleList rules={rulesByBatch.get(r.batch) || []} />
            </div>
          ))}
          {!needle && rows.length > shown.length && (
            <div className="text-muted small text-center">
              แสดง {shown.length} จาก {rows.length} รายการ — พิมพ์ค้นหาเพื่อดูรายการอื่น
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PlanPreviewDialog = ({
  show, mode = 'replan', diff, detail, machineSchedule, capacityWarning,
  settings, todayStr, loading, onConfirm, onHide,
}) => {
  const [tab, setTab] = useState('summary');
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (show) {
      setTab('summary');
      setOnlyChanged(true);
      setExpanded(new Set());
      setSaving(false);
    }
  }, [show]);

  const rows = useMemo(() => (diff ? diff.rows : []), [diff]);
  const sched = useMemo(() => machineSchedule || [], [machineSchedule]);

  // decoded.data ไม่มี model (cleanDisplayData ตัดคีย์ _ ทิ้ง) → join จาก diff.rows ที่นี่
  const modelByBatch = useMemo(
    () => new Map(rows.map((r) => [r.batch, r.model])),
    [rows],
  );

  // กฎรายออเดอร์ — คำนวณครั้งเดียวต่อชุด diff (pure, ไม่มี side effect)
  const rulesByBatch = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.batch, buildOrderRules(r.inputs, { todayStr, settings }));
    return m;
  }, [rows, todayStr, settings]);

  const meta = MODE_META[mode] || MODE_META.replan;
  const visibleRows = onlyChanged ? rows.filter((r) => r.changeType !== 'unchanged') : rows;
  const hasFg = rows.some((r) => r.fgAfter !== undefined);
  const batches = detail ? detail.batches : null;
  // expand + Batch + Model + Priority + Due [+FG] + ห่าง Due + สถานะ + เงื่อนไข
  const colCount = 5 + (hasFg ? 1 : 0) + 3;

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
            {/* เตือนเรื่องปฏิทิน + โน้ตของโหมด อยู่เหนือแท็บเสมอ — ห้ามซ่อนไว้ในแท็บ */}
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

            <Tabs activeKey={tab} onSelect={(k) => setTab(k || 'summary')} className="mb-0">
              <Tab eventKey="summary" title={<span><i className="bi bi-clipboard-check me-1" aria-hidden="true" />สรุป</span>}>
                <SummaryTab
                  diff={diff}
                  machineSchedule={sched}
                  capacityWarning={capacityWarning}
                  onGoTo={setTab}
                />
              </Tab>

              <Tab
                eventKey="diff"
                title={(
                  <span>
                    <i className="bi bi-arrow-left-right me-1" aria-hidden="true" />
                    ความต่าง
                    {diff.summary.changed > 0 && (
                      <span className="badge bg-secondary ms-1">{diff.summary.changed}</span>
                    )}
                  </span>
                )}
              >
                <div className="pt-3">
                  <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                    <SummaryChips summary={diff.summary} />
                    <Form.Check
                      type="switch"
                      id="preview-only-changed"
                      label="แสดงเฉพาะที่เปลี่ยน"
                      checked={onlyChanged}
                      onChange={(e) => setOnlyChanged(e.target.checked)}
                    />
                  </div>

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
                          <th className="text-nowrap">ห่าง Due</th>
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
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="p-0 icon-btn"
                                    title={isOpen ? 'ซ่อนรายละเอียด' : 'ดูกฎที่ใช้ + เครื่อง/เวลา'}
                                    aria-label="รายละเอียดออเดอร์"
                                    onClick={() => toggleRow(r.batch)}
                                  >
                                    <i className={`bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'}`} aria-hidden="true" />
                                  </Button>
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
                                <td><GapCell before={r.gapBefore} after={r.gapAfter} /></td>
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
                              {isOpen && (
                                <tr className="bg-light">
                                  <td />
                                  <td colSpan={colCount - 1} className="p-0">
                                    <BatchDetail info={info} rules={rulesByBatch.get(r.batch)} />
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
                </div>
              </Tab>

              <Tab
                eventKey="machines"
                title={(
                  <span>
                    <i className="bi bi-cpu me-1" aria-hidden="true" />
                    เครื่องจักร
                    {sched.length > 0 && <span className="badge bg-secondary ms-1">{sched.length}</span>}
                  </span>
                )}
              >
                <MachineTab machineSchedule={sched} modelByBatch={modelByBatch} />
              </Tab>

              <Tab eventKey="rules" title={<span><i className="bi bi-sliders me-1" aria-hidden="true" />กฎการคำนวณ</span>}>
                <RulesTab rows={rows} rulesByBatch={rulesByBatch} settings={settings} />
              </Tab>
            </Tabs>
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
