import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Spinner, Table } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { fetchHanaOrders, hanaConfigStatus, HANA_DEFAULT_PLANT } from '../../utils/hanaApi';
import { groupBatchRanges, matchSapRows, buildRefreshRows, describeDiff } from '../../utils/hanaOrders';

// อัปเดต order ที่ติ๊กบนหน้า Orders ด้วยข้อมูลจาก SAP (Hana COOIS) — ADMIN/PLANNER
// props: show, orders (แถวจาก GET /orders ที่ถูกเลือก), onHide, onDone(msg)
//
// ⚠️ ยิง Hana จาก browser เท่านั้น (server อยู่ DMZ ไม่ถึง plb044) — ผ่าน utils/hanaApi.js (raw fetch, ไม่ใช่ apiCall)
// Hana กรองเลข order ได้เป็นช่วง → groupBatchRanges จัดกลุ่มเลขใกล้กัน 1 ช่วง = 1 request ยิงทีละช่วง
// บันทึกผ่าน PUT /upload/orders/refresh ตัวเดียวกับการ์ด Hana หน้า Import (ทับ model/description/qty/due/Mat'l
// เฉพาะใบที่ค่าต่าง · ไม่แตะ priority/WIP/วัน Mat'l-Confirm · backend markEdit ให้)
const SAMPLE_LIMIT = 50;

const SapRefreshDialog = ({ show, orders, onHide, onDone }) => {
  const [phase, setPhase] = useState('idle'); // idle | fetching | ready | error | saving
  const [progress, setProgress] = useState({ i: 0, n: 0 });
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { found, notFound, skipped }
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setResult(null);
    setError('');
    const cfg = hanaConfigStatus();
    if (!cfg.ok) {
      setPhase('error');
      setError(`ยังไม่ได้ตั้งค่า Hana API — ขาด ${cfg.missing.join(', ')} ใน frontend/.env`);
      return;
    }
    const { ranges, skipped } = groupBatchRanges(orders.map((o) => o.batch));
    setPhase('fetching');
    setProgress({ i: 0, n: ranges.length });
    try {
      const raw = [];
      for (let i = 0; i < ranges.length; i += 1) {
        const r = ranges[i];
        const filters = { orderNoFrom: r.from, orderNoTo: r.to };
        if (HANA_DEFAULT_PLANT) filters.plant = HANA_DEFAULT_PLANT;
        // ยิงทีละช่วงโดยตั้งใจ ไม่ถล่ม gateway
        raw.push(...await fetchHanaOrders(filters));
        if (seq !== reqSeq.current) return;
        setProgress({ i: i + 1, n: ranges.length });
      }
      const skippedSet = new Set(skipped);
      const { found, notFound } = matchSapRows(orders.filter((o) => !skippedSet.has(String(o.batch).trim())), raw);
      setResult({ found, notFound, skipped });
      setPhase('ready');
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setError(err.message);
      setPhase('error');
    }
  }, [orders]);

  useEffect(() => {
    if (show) load();
    else reqSeq.current += 1; // ปิดกลางทาง → ทิ้งผลที่ยังค้าง
  }, [show, load]);

  const changed = result ? result.found.filter((f) => f.diff.length > 0) : [];
  const unchanged = result ? result.found.length - changed.length : 0;

  const handleSave = async () => {
    const rows = buildRefreshRows(changed.map((f) => f.hanaRow), new Set(changed.map((f) => f.order.batch)));
    setPhase('saving');
    try {
      const data = await apiCall('/upload/orders/refresh', { method: 'PUT', body: JSON.stringify({ rows }) });
      onDone(data.message || `อัปเดต ${rows.length} ใบแล้ว`);
    } catch (err) {
      setError(err.message);
      setPhase('ready');
    }
  };

  const busy = phase === 'fetching' || phase === 'saving';

  return (
    <Modal show={show} onHide={busy ? undefined : onHide} centered size="lg">
      <Modal.Header closeButton={!busy}>
        <Modal.Title style={{ fontSize: 'var(--fs-section)' }}>
          <i className="bi bi-cloud-arrow-down me-2" aria-hidden="true" />
          อัปเดตจาก SAP — {orders.length} ใบที่เลือก
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {phase === 'fetching' && (
          <div className="text-muted">
            <Spinner size="sm" animation="border" className="me-2" />
            กำลังดึงข้อมูลจาก SAP {progress.n > 1 ? `(${progress.i}/${progress.n})` : ''}...
          </div>
        )}

        {error && (
          <div className="alert alert-danger py-2 small" role="alert">
            <i className="bi bi-x-circle-fill me-2" aria-hidden="true" />
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="d-flex flex-wrap gap-2 mb-2 small">
              <span className="chip chip-warn">ข้อมูลต่าง {changed.length} ใบ</span>
              <span className="chip chip-muted">ค่าเท่าเดิม {unchanged} ใบ</span>
              {result.notFound.length > 0 && <span className="chip chip-ng">ไม่พบใน SAP {result.notFound.length} ใบ</span>}
              {result.skipped.length > 0 && <span className="chip chip-muted">ไม่ใช่เลข SAP {result.skipped.length} ใบ</span>}
            </div>

            {changed.length > 0 ? (
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                <Table bordered size="sm" className="align-middle mb-1">
                  <thead className="table-light">
                    <tr><th>Batch</th><th>เปลี่ยน (เดิม → ใหม่)</th></tr>
                  </thead>
                  <tbody>
                    {changed.slice(0, SAMPLE_LIMIT).map((f) => (
                      <tr key={f.order.batch}>
                        <td className="num fw-bold align-top">{f.order.batch}</td>
                        <td className="small">
                          {f.diff.map((d) => <div key={d.field}>{describeDiff(d)}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {changed.length > SAMPLE_LIMIT && (
                  <div className="text-muted small">แสดง {SAMPLE_LIMIT} จาก {changed.length} ใบ (อัปเดตครบทุกใบ)</div>
                )}
              </div>
            ) : (
              <div className="text-muted">ทุกใบที่พบใน SAP มีค่าตรงกับในระบบแล้ว ไม่มีอะไรต้องอัปเดต</div>
            )}

            {(result.notFound.length > 0 || result.skipped.length > 0) && (
              <div className="small text-muted mt-2">
                {result.notFound.length > 0 && <div>ไม่พบใน SAP: <span className="num">{result.notFound.join(', ')}</span></div>}
                {result.skipped.length > 0 && <div>ไม่ใช่เลข order SAP (ข้าม): <span className="num">{result.skipped.join(', ')}</span></div>}
              </div>
            )}

            {changed.length > 0 && (
              <div className="small mt-2" style={{ color: 'var(--mse-ng)' }}>
                ทับ Model / Description / Qty / Due Date / Mat&apos;l No.-Name ด้วยค่าจาก SAP — ค่าที่เคยแก้มือจะหาย ·
                ไม่แตะ priority / WIP / วัน Material-Confirm · กด Replan หลังอัปเดต
              </div>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        {phase === 'error' && (
          <Button variant="outline-secondary" onClick={load}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" /> ลองใหม่
          </Button>
        )}
        <Button variant="secondary" onClick={onHide} disabled={busy}>ปิด</Button>
        <Button variant="warning" onClick={handleSave} disabled={busy || changed.length === 0}>
          {phase === 'saving' && <Spinner size="sm" animation="border" className="me-1" />}
          อัปเดต {changed.length} ใบ
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SapRefreshDialog;
