import React, { useState, useEffect, useCallback } from 'react';
import { Card, Form, Button, Table, Spinner } from 'react-bootstrap';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import { apiCall } from '../../api/client';

// WIP ค้นหารายการ — port จาก wip_screen_batch.dart
const SearchTab = () => {
  const [options, setOptions] = useState({ batches: [], descriptions: [], models: [] });
  const [searchDesc, setSearchDesc] = useState('');
  const [searchBatch, setSearchBatch] = useState('');
  const [wipData, setWipData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast, showToast, hideToast } = useToast();

  useEffect(() => {
    apiCall('/wip/options')
      .then(setOptions)
      .catch(() => {}); // เดิมแค่ print ไม่แจ้งเตือน
  }, []);

  const combined = [...new Set([...(options.descriptions || []), ...(options.models || [])])].sort();

  const fetchWipData = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const params = new URLSearchParams();
      if (searchBatch.trim()) params.set('batch', searchBatch.trim());
      if (searchDesc.trim()) params.set('description', searchDesc.trim());
      const res = await apiCall(`/wip?${params.toString()}`);
      setWipData(res.data || []);
    } catch (err) {
      // apiCall รวม error ทุกแบบเป็น throw เดียว (ของเดิมแยก "เกิดข้อผิดพลาดจาก Server: {code}")
      showToast(`ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ${err.message}`, 'danger');
      setWipData([]);
    } finally {
      setLoading(false);
    }
  }, [searchBatch, searchDesc, showToast]);

  const resetSearch = () => {
    setSearchDesc('');
    setSearchBatch('');
    setWipData([]);
    setHasSearched(false);
  };

  return (
    <div>
      <Card className="shadow-sm mb-3">
        <Card.Body className="py-2">
          <Form
            className="d-flex flex-wrap align-items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              fetchWipData();
            }}
          >
            <Form.Group style={{ minWidth: 260, flex: 1 }}>
              <Form.Label className="small mb-0">Search Description / Model</Form.Label>
              <Form.Control
                size="sm"
                list="wip-desc-options"
                value={searchDesc}
                onChange={(e) => setSearchDesc(e.target.value)}
              />
              <datalist id="wip-desc-options">
                {combined.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Form.Group>
            <Form.Group style={{ minWidth: 220, flex: 1 }}>
              <Form.Label className="small mb-0">Search Batch</Form.Label>
              <Form.Control
                size="sm"
                list="wip-batch-options"
                value={searchBatch}
                onChange={(e) => setSearchBatch(e.target.value)}
              />
              <datalist id="wip-batch-options">
                {(options.batches || []).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Form.Group>
            <Button type="submit" size="sm" className="btn-mse">
              <i className="bi bi-search me-1" aria-hidden="true" />
              ค้นหา
            </Button>
            <Button type="button" size="sm" variant="outline-secondary" onClick={resetSearch}>
              <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
              ล้างคำค้นหา
            </Button>
          </Form>
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Body>
          {loading ? (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          ) : !hasSearched ? (
            <div className="empty-state">
              <i className="bi bi-search" aria-hidden="true" />
              <div>พิมพ์คำค้นหาเพื่อดูข้อมูล WIP</div>
            </div>
          ) : wipData.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-inbox" aria-hidden="true" />
              <div>ไม่พบข้อมูลที่ค้นหา</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <Table bordered hover size="sm">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Model</th>
                    <th>Batch</th>
                    <th>Step</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {wipData.map((row, i) => (
                    <tr key={i}>
                      <td>{row.description}</td>
                      <td>{row.model}</td>
                      <td>{row.batch}</td>
                      <td>{row.step}</td>
                      <td className="fw-bold num" style={{ color: 'var(--mse-info)' }}>
                        {row.qty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      <ToastHost toast={toast} onClose={hideToast} />
    </div>
  );
};

export default SearchTab;
