import React, { useState, useEffect } from 'react';
import { Modal, Table, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import Dialogue2 from './Dialogue2';

// Dialogue 1 — เจาะรายวันระดับ batch/step (production_daily_screen.dart L127-264)
// ctx = { targetDate 'YYYY-MM-DD', machine }
const Dialogue1 = ({ show, ctx, onHide }) => {
  const [rows, setRows] = useState(null);
  const [d2Ctx, setD2Ctx] = useState(null);

  useEffect(() => {
    if (!show || !ctx) return;
    setRows(null);
    const params = new URLSearchParams({
      target_date: ctx.targetDate,
      machine: ctx.machine || 'All',
    });
    apiCall(`/daily-result/dialogue1?${params.toString()}`)
      .then((res) => setRows(res.data || []))
      .catch(() => setRows([]));
  }, [show, ctx]);

  const [y, m, d] = (ctx?.targetDate || '--').split('-');
  const ttlInput = (rows || []).reduce((s, r) => s + (r.input || 0), 0);
  const ttlOutput = (rows || []).reduce((s, r) => s + (r.output || 0), 0);
  const yieldStr = ttlInput > 0 ? `${((ttlOutput / ttlInput) * 100).toFixed(2)}%` : '-';

  return (
    <Modal show={show} onHide={onHide} size="xl">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.05rem' }}>
          รายละเอียดการผลิต วันที่ {d} - {m} - {y}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!rows ? (
          <div className="text-center py-3">
            <Spinner animation="border" />
          </div>
        ) : (
          <>
            <div
              className="d-flex gap-4 rounded px-3 py-2 mb-2"
              style={{ backgroundColor: '#e3f2fd' }}
            >
              <span>
                TTL. Input: <strong>{ttlInput}</strong>
              </span>
              <span>
                TTL. Output: <strong>{ttlOutput}</strong>
              </span>
              <span>
                Yield: <strong>{yieldStr}</strong>
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <Table bordered hover size="sm">
                <thead className="table-secondary">
                  <tr>
                    <th>Description</th>
                    <th>Model</th>
                    <th>Batch</th>
                    <th>Step</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Yield</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.description}</td>
                      <td>{r.model}</td>
                      <td>{r.batch}</td>
                      <td>
                        {r.step}
                        {r.is_force_closed && (
                          <span
                            className="chip chip-ng ms-2"
                            title={`ปิดจบงาน: ${r.force_close_reason || '-'}`}
                          >
                            <i className="bi bi-door-closed-fill me-1" aria-hidden="true" />
                            ปิดจบงาน{r.force_close_reason ? `: ${r.force_close_reason}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="text-end">{r.input}</td>
                      <td className="text-end">{r.output}</td>
                      <td className="text-end">
                        {r.input > 0 ? `${((r.output / r.input) * 100).toFixed(2)}%` : '-'}
                      </td>
                      <td>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-decoration-underline"
                          onClick={() =>
                            setD2Ctx({
                              targetDate: ctx.targetDate,
                              batch: r.batch,
                              step: r.step,
                              description: r.description,
                              model: r.model,
                              machineFilter: ctx.machine || 'All',
                            })
                          }
                        >
                          Click
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-muted">
                        ไม่มีข้อมูล
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
        <Button variant="secondary" onClick={onHide}>
          ปิดหน้าต่าง
        </Button>
      </Modal.Footer>

      <Dialogue2 show={!!d2Ctx} ctx={d2Ctx} onHide={() => setD2Ctx(null)} />
    </Modal>
  );
};

export default Dialogue1;
