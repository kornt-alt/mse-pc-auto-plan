import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Table, Button, Spinner, Alert } from 'react-bootstrap';
import { Info } from 'lucide-react';
import { apiCall } from '../../api/client';

// Dialog รายละเอียดการบันทึกราย step (จาก GET /orders/{batch}/tracking/{step})
const StepDetailDialog = ({ show, onHide, batchId, stepName }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!show || !batchId || !stepName) return;
    setLoading(true);
    setError('');
    apiCall(`/orders/${encodeURIComponent(batchId)}/tracking/${encodeURIComponent(stepName)}`)
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [show, batchId, stepName]);

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          🔍 รายละเอียด: {stepName} (Batch: {batchId})
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted text-center my-3">ไม่มีประวัติการบันทึกในขั้นตอนนี้</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table bordered hover size="sm">
              <thead className="table-light">
                <tr>
                  <th>เวลาบันทึก</th>
                  <th>ผู้บันทึก/พนักงาน</th>
                  <th>เครื่องจักร</th>
                  <th className="text-success">Qty OK</th>
                  <th className="text-danger">Qty NG</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.timestamp}</td>
                    <td>{r.operator}</td>
                    <td>{r.machine}</td>
                    <td className="text-success fw-bold">{r.qty_ok}</td>
                    <td className="text-danger fw-bold">{r.qty_ng}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          ปิด
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// Dialog สถานะการผลิตของ batch (จาก GET /orders/{batch}/tracking)
const TrackingDialog = ({ show, onHide, batchId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailStep, setDetailStep] = useState(null); // step_name ที่เปิดดูรายละเอียด

  const fetchTracking = useCallback(async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const result = await apiCall(`/orders/${encodeURIComponent(batchId)}/tracking`);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (show && batchId) fetchTracking();
  }, [show, batchId, fetchTracking]);

  // Batch ที่ migrate มาเป็น WIP — แสดงข้อความอย่างเดียว (ตามหน้าจอเดิม)
  if (data?.is_migrated_wip) {
    return (
      <Modal show={show} onHide={onHide}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>ข้อมูล WIP</Modal.Title>
        </Modal.Header>
        <Modal.Body>{data.migrated_message}</Modal.Body>
        <Modal.Footer>
          <Button className="btn-mse" onClick={onHide}>
            ตกลง
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }

  return (
    <>
      <Modal show={show} onHide={onHide} size="xl">
        <Modal.Header closeButton style={{ backgroundColor: '#ffe0b2' }}>
          <Modal.Title style={{ fontSize: '1rem' }}>
            Batch No: <span className="text-primary fw-bold">{batchId}</span>
            {data && (
              <>
                {'  ·  Model: '}
                <span className="text-primary fw-bold">{data.model}</span>
                {'  ·  Qty: '}
                <span className="text-primary fw-bold">{data.qty}</span>
              </>
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          {error && <Alert variant="danger" className="m-3">{error}</Alert>}
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" />
            </div>
          ) : data ? (
            <div style={{ overflowX: 'auto' }}>
              <Table hover size="sm" className="mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Process Step</th>
                    <th>Machine</th>
                    <th>Qty OK</th>
                    <th>Qty NG</th>
                    <th>Last Record</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.steps.map((s, i) => (
                    <tr key={s.step_name} style={i % 2 === 1 ? { backgroundColor: '#e8f5e9' } : {}}>
                      <td className="fw-bold">{s.step_name}</td>
                      <td className="text-muted">{s.machine}</td>
                      <td className="text-success fw-bold">{s.qty_ok}</td>
                      <td className="text-danger fw-bold">{s.qty_ng}</td>
                      <td>{s.last_record}</td>
                      <td className="text-center">
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0"
                          onClick={() => setDetailStep(s.step_name)}
                        >
                          <Info size={16} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="danger" onClick={onHide}>
            ปิด
          </Button>
        </Modal.Footer>
      </Modal>

      <StepDetailDialog
        show={!!detailStep}
        onHide={() => setDetailStep(null)}
        batchId={batchId}
        stepName={detailStep}
      />
    </>
  );
};

export default TrackingDialog;
