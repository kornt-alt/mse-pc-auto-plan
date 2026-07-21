import React, { useState, useEffect } from 'react';
import { Modal, Table, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';

// Dialogue 2 — เจาะระดับเครื่องจักร/พนักงาน (production_daily_screen.dart L155-342)
// ctx = { targetDate, batch, step, description, model, machineFilter }
const Dialogue2 = ({ show, ctx, onHide }) => {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!show || !ctx) return;
    setRows(null);
    const params = new URLSearchParams({
      target_date: ctx.targetDate,
      batch: ctx.batch,
      step: ctx.step,
      machine_filter: ctx.machineFilter || 'All',
    });
    apiCall(`/daily-result/dialogue2?${params.toString()}`)
      .then((res) => setRows(res.data || []))
      .catch(() => setRows([]));
  }, [show, ctx]);

  const input = (rows || []).reduce((s, r) => s + (r.ttl_ok || 0) + (r.ttl_ng || 0), 0);
  const output = (rows || []).reduce((s, r) => s + (r.ttl_ok || 0), 0);

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.05rem' }}>รายละเอียดเครื่องจักรและพนักงาน</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!rows ? (
          <div className="text-center py-3">
            <Spinner animation="border" />
          </div>
        ) : (
          <>
            {/* แถวสรุปของ batch/step ที่เลือก (header ส้มตามเดิม) */}
            <div style={{ overflowX: 'auto' }}>
              <Table bordered size="sm">
                <thead style={{ backgroundColor: '#fff3e0' }}>
                  <tr>
                    <th>Description</th>
                    <th>Model</th>
                    <th>Batch</th>
                    <th>Step</th>
                    <th>Input</th>
                    <th>Output</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{ctx?.description}</td>
                    <td>{ctx?.model}</td>
                    <td>{ctx?.batch}</td>
                    <td>{ctx?.step}</td>
                    <td className="text-end">{input}</td>
                    <td className="text-end">{output}</td>
                  </tr>
                </tbody>
              </Table>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <Table bordered hover size="sm" className="mt-2">
                <thead className="table-secondary">
                  <tr>
                    <th>Machine</th>
                    <th>Employee</th>
                    <th>TTL qty_ok</th>
                    <th>TTL qty_ng</th>
                    <th>mode_ng</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.machine}</td>
                      <td>{r.employee}</td>
                      <td className="text-end">{r.ttl_ok}</td>
                      <td
                        className="text-end"
                        style={r.ttl_ng > 0 ? { color: '#c62828', fontWeight: 'bold' } : {}}
                      >
                        {r.ttl_ng}
                      </td>
                      <td>{r.mode_ng}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted">
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
    </Modal>
  );
};

export default Dialogue2;
