// PlanRunsDialog — "ประวัติแผน": รุ่นของแผนที่ถูกบันทึกจริง (RUN / REPLAN / ROLLBACK) จาก plan_runs
//
// เลือกรุ่น → OrderControlTower โหลด GET /schedule/runs/:id แล้วเปิด PlanPreviewDialog (mode='rollback')
// ให้เทียบกับแผนปัจจุบันก่อน — การย้อนจริงเกิดตอนกดยืนยันในไดอะล็อกนั้นเท่านั้น ไม่ใช่ที่นี่
// ไม่มีตาราง (503) → โชว์ข้อความจาก backend ตรง ๆ (บอกให้ไปรัน DDL ใน CHANGELOG.md)
import React, { useState, useEffect } from 'react';
import { Modal, Table, Button, Spinner, Alert } from 'react-bootstrap';
import { apiCall } from '../../api/client';

const KIND_META = {
  RUN: { label: 'Run', chip: 'chip-info' },
  REPLAN: { label: 'Replan', chip: 'chip-info' },
  ROLLBACK: { label: 'ย้อนกลับ', chip: 'chip-warn' },
};

const fmtWhen = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '-');

const PlanRunsDialog = ({ show, onHide, onPick, canRollback }) => {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!show) return;
    let alive = true;
    setLoading(true);
    setError('');
    apiCall('/schedule/runs')
      .then((data) => { if (alive) setRuns(Array.isArray(data) ? data : []); })
      .catch((err) => { if (alive) { setRuns([]); setError(err.message); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [show]);

  return (
    <Modal show={show} onHide={onHide} size="lg" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
          <i className="bi bi-clock-history me-2" aria-hidden="true" />
          ประวัติแผน
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <div className="text-center py-4"><Spinner animation="border" /></div>
        ) : error ? (
          <Alert variant="warning" className="mb-0">{error}</Alert>
        ) : runs.length === 0 ? (
          <div className="text-center text-muted py-4">ยังไม่มีประวัติ — ประวัติเริ่มเก็บตั้งแต่ Replan ครั้งถัดไป</div>
        ) : (
          <>
            <Table size="sm" bordered hover responsive className="mb-2">
              <thead>
                <tr>
                  <th>#</th>
                  <th>เวลา</th>
                  <th>โดย</th>
                  <th>ชนิด</th>
                  <th className="text-end">Batch</th>
                  <th className="text-end">ช้า</th>
                  <th className="text-end">วางไม่ลง</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => {
                  const k = KIND_META[r.kind] || { label: r.kind, chip: 'chip-muted' };
                  return (
                    <tr key={r.id}>
                      <td className="num">{r.id}</td>
                      <td className="num">{fmtWhen(r.created_at)}</td>
                      <td>{r.created_by || '-'}</td>
                      <td>
                        <span className={`chip ${k.chip}`}>{k.label}</span>
                        {r.restored_from ? <span className="small text-muted ms-1">จาก #{r.restored_from}</span> : null}
                        {i === 0 ? <span className="chip chip-ok ms-1">ปัจจุบัน</span> : null}
                      </td>
                      <td className="num text-end">{r.batch_count}</td>
                      <td className={`num text-end ${r.late_count > 0 ? 'text-danger' : ''}`}>{r.late_count}</td>
                      <td className={`num text-end ${r.unplanned_count > 0 ? 'text-danger fw-bold' : ''}`}>{r.unplanned_count}</td>
                      <td className="text-end">
                        {i > 0 && (
                          <Button size="sm" variant="outline-warning" onClick={() => onPick(r)}>
                            <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                            {canRollback ? 'เทียบ / ย้อนกลับ' : 'เทียบ'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="small text-muted">
              ย้อนกลับ = เขียนแผนรุ่นนั้นกลับเป็นแผนปัจจุบัน (ไม่รัน engine ใหม่) · ออเดอร์ที่ปิดไปแล้วจะถูกตัดออก
              · ออเดอร์ที่เพิ่มหลังจากรุ่นนั้นจะไม่มีแผนจนกว่าจะ Replan
            </div>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default PlanRunsDialog;
