import React, { useState, useEffect } from 'react';
import { Modal, Table, Button, Form, Spinner, Alert, InputGroup } from 'react-bootstrap';
import { QrCode, Archive } from 'lucide-react';
import { apiCall } from '../../api/client';
import useScanInput from '../../components/shared/useScanInput';

// ประวัติจ๊อบที่ปิดแล้ว Top 20 + ช่องสแกน barcode เปิด tracking
const HistoryDialog = ({ show, onHide, onOpenTracking }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // สแกน barcode: ครบ 10 ตัวอักษรเปิด tracking ทันที (ตามหน้าจอเดิม)
  const scan = useScanInput(10, (batch) => openTracking(batch));

  useEffect(() => {
    if (!show) return;
    setLoading(true);
    setError('');
    scan.reset();
    apiCall('/orders/history')
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  function openTracking(batch) {
    scan.reset();
    onOpenTracking(batch);
  }

  const rowStyle = (color) => {
    if (color === 'RED') return { backgroundColor: '#ffcdd2' };
    if (color === 'YELLOW') return { backgroundColor: '#fff9c4' };
    return {};
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          <Archive size={18} className="me-2" />
          ประวัติการผลิต (Top 20 ล่าสุด)
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <InputGroup className="mb-3">
          <InputGroup.Text>
            <QrCode size={16} />
          </InputGroup.Text>
          <Form.Control
            placeholder="สแกน Batch Barcode"
            value={scan.value}
            onChange={scan.onChange}
            onKeyDown={scan.onKeyDown}
            autoFocus
          />
        </InputGroup>

        {error && <Alert variant="danger">{error}</Alert>}
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table bordered hover size="sm">
              <thead className="table-secondary">
                <tr>
                  <th>Batch ID</th>
                  <th>Model</th>
                  <th>QtyLot</th>
                  <th>QtyFG</th>
                  <th>Due Date</th>
                  <th>Finish Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.batch} style={rowStyle(item.row_color)}>
                    <td>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 fw-bold text-decoration-underline"
                        onClick={() => openTracking(item.batch)}
                      >
                        {item.batch}
                      </Button>
                    </td>
                    <td>{item.model}</td>
                    <td>{item.qty_lot}</td>
                    <td>{item.qty_fg}</td>
                    <td>{item.due_date}</td>
                    <td>{item.finish_date}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted">
                      ยังไม่มีประวัติ
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="danger" onClick={onHide}>
          ปิด
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default HistoryDialog;
