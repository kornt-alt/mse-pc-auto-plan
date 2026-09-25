// LastRunAlert — แถบเตือน "แผนล่าสุดมีงานที่วางไม่ลง" บนหน้า Orders
//
// ทำไมต้องมี: รายการงานที่วางไม่ลง (unplanned) / capacity_warning เคยอยู่แค่ใน response ของ Replan
// ปิด PlanPreviewDialog หรือ refresh หน้าแล้วหาย — คนที่ไม่ได้เป็นคนกด Replan ไม่มีทางรู้เลย
// ตอนนี้ backend เก็บไว้ใน plan_runs แล้ว (DDL รันมือ) → แถบนี้อ่านจาก GET /schedule/runs?limit=1&detail=1
// ไม่มีตาราง (503) = ผู้เรียกเงียบ ไม่วาดอะไร (แบบเดียวกับ CalendarHorizonAlert)
//
// lastRunAlert() เป็น pure — ทดสอบใน __tests__/LastRunAlert.test.js
import React, { useState } from 'react';
import { Alert, Button, Modal, Table } from 'react-bootstrap';
import { reasonMeta } from './planOptions';

const fmtWhen = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');

// run = แถวแรกจาก GET /schedule/runs?detail=1 · null = ไม่ต้องวาดอะไร
export function lastRunAlert(run) {
  if (!run) return null;
  const n = Number(run.unplanned_count) || 0;
  const cw = run.capacity_warning;
  if (n === 0 && !cw) return null;
  const who = run.created_by ? ` · ${run.created_by}` : '';
  const when = `${fmtWhen(run.created_at)}${who}`;
  const count = n || (cw ? Number(cw.unplanned_count) || 0 : 0);
  return {
    variant: 'danger',
    icon: 'bi-exclamation-octagon-fill',
    title: `แผนล่าสุดมี ${count} batch ที่วางไม่ลง`,
    text: cw && cw.last_calendar_date
      ? `(${when}) ปฏิทินถึง ${cw.last_calendar_date} — งานเหล่านี้ไม่มีวันเริ่ม/วันเสร็จในแผน`
      : `(${when}) งานเหล่านี้ไม่มีวันเริ่ม/วันเสร็จในแผน`,
  };
}

const UnplannedModal = ({ show, onHide, rows }) => (
  <Modal show={show} onHide={onHide} size="lg" centered scrollable>
    <Modal.Header closeButton>
      <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
        <i className="bi bi-exclamation-octagon me-2" aria-hidden="true" />
        งานที่วางไม่ลงในแผนล่าสุด
      </Modal.Title>
    </Modal.Header>
    <Modal.Body>
      <Table size="sm" bordered hover responsive className="mb-0">
        <thead>
          <tr>
            <th>Batch</th>
            <th>Model</th>
            <th>Due</th>
            <th>เหตุผล</th>
            <th>ขั้นตอนที่ติด (เครื่องทางเลือก)</th>
            <th title="วันสุดท้ายของปฏิทินเลย Due ไปแล้วอย่างน้อยกี่วัน">เลย Due (วัน)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = reasonMeta(r.reason);
            return (
              <tr key={r.batch}>
                <td className="num">{r.batch}</td>
                <td>{r.model || '-'}</td>
                <td className="num">{r.dueDate || '-'}</td>
                <td>
                  <span className={`chip chip-${meta.tone}`}>
                    <i className={`bi ${meta.icon} me-1`} aria-hidden="true" />{meta.label}
                  </span>
                </td>
                <td className="small">
                  {(r.steps || []).length === 0 ? '-' : r.steps.map((s) => (
                    <div key={`${s.flowIndex}-${s.stepIndex}`}>
                      {s.step}
                      {s.candidates && s.candidates.length > 0 && (
                        <span className="text-muted"> ({s.candidates.map((c) => c.machine).join(', ')})</span>
                      )}
                    </div>
                  ))}
                </td>
                <td className="num">{r.daysPastDueAtHorizon ?? '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="small text-muted mt-2">
        รายละเอียดวิธีแก้ต่อเหตุผลดูได้ในแท็บ "ทางเลือก" ตอนกด Replan
      </div>
    </Modal.Body>
  </Modal>
);

const LastRunAlert = ({ run }) => {
  const [open, setOpen] = useState(false);
  const a = lastRunAlert(run);
  if (!a) return null;
  const rows = run.unplanned || [];

  return (
    <>
      <Alert variant={a.variant} className="py-2 d-flex flex-wrap align-items-center gap-2 mb-3">
        <i className={`bi ${a.icon}`} aria-hidden="true" />
        <strong>{a.title}</strong>
        <span className="small">{a.text}</span>
        {rows.length > 0 && (
          <Button variant="link" size="sm" className="p-0 ms-auto text-decoration-none" onClick={() => setOpen(true)}>
            ดูรายการ
          </Button>
        )}
      </Alert>
      <UnplannedModal show={open} onHide={() => setOpen(false)} rows={rows} />
    </>
  );
};

export default LastRunAlert;
