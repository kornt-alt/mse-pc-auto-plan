import React, { useState, useEffect, useCallback } from 'react';
import { Table, Form, Button, Modal, Spinner, InputGroup } from 'react-bootstrap';
import { RefreshCw, Search } from 'lucide-react';
import { apiCall } from '../../api/client';

// Machine Queue — port จาก MachineQueueDashboard (shop_floor_screen.dart L2303-2972)
// + popup variant _showMachineQueueDialog (L309-473, แถว batch ที่สแกนอยู่ = "Processing")
// FIX: รายชื่อเครื่องดึงจาก GET /production/machines (เดิม hardcode ฝั่ง Flutter)

// จำเครื่องที่เลือกล่าสุดข้าม mount (port static savedMachine เดิม L2306)
let cachedMachine = '';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const formatUpdated = (d) =>
  `${pad2(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

// สถานะ + สีแถว (embedded L2872-2890 / popup L380-399)
const getStatus = (row, highlightBatch) => {
  const plan = parseFloat(row.qty_plan) || 0; // setup "Nm" parse ไม่ได้ = 0 (เหมือน tryParse เดิม)
  const ok = parseFloat(row.qty_ok) || 0;
  const ng = parseFloat(row.qty_ng) || 0;
  const done = ok + ng;
  if (highlightBatch && row.batch === highlightBatch) {
    return { text: 'Processing', bg: '#fff59d' };
  }
  if (row.is_setup) return { text: 'Setup Phase', bg: '#fff3e0' };
  if (row.is_force_closed) return { text: 'Finish (Force)', bg: '#c8e6c9' };
  if (done >= plan && plan > 0) return { text: 'Finish', bg: '#c8e6c9' };
  if (done > 0) return { text: `Run: ${done}, Bal: ${plan - done}`, bg: '#e3f2fd' };
  return { text: '-', bg: '' };
};

// fixedMachine: โหมด popup — ล็อกเครื่องตายตัว ไม่มี dropdown (port _showMachineQueueDialog)
const MachineQueuePanel = ({ embedded = false, highlightBatch = null, height, fixedMachine = null }) => {
  const [machines, setMachines] = useState([]);
  const [machine, setMachine] = useState(fixedMachine || cachedMachine);
  const [queueData, setQueueData] = useState([]);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailBatch, setDetailBatch] = useState(null); // batch ที่เปิด tracking dialog
  const [detailData, setDetailData] = useState(null);

  const fetchQueue = useCallback(async (m) => {
    if (!m) return;
    setLoading(true);
    try {
      const res = await apiCall(`/production/machine-queue/${encodeURIComponent(m)}`);
      setQueueData(res.data || []);
      setLastUpdated(formatUpdated(new Date()));
    } catch {
      setQueueData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fixedMachine) {
      fetchQueue(fixedMachine);
      return;
    }
    apiCall('/production/machines')
      .then((res) => setMachines(res.data || []))
      .catch(() => setMachines([]));
    if (cachedMachine) fetchQueue(cachedMachine);
  }, [fetchQueue, fixedMachine]);

  const handleMachineChange = (e) => {
    const m = e.target.value;
    setMachine(m);
    cachedMachine = m;
    fetchQueue(m);
  };

  // batch ที่ยังไม่จบ 100% (มีอย่างน้อย 1 แถวค้าง) — dart L2585-2618
  const activeBatches = new Set();
  for (const row of queueData) {
    const plan = parseFloat(row.qty_plan) || 0;
    const done = (parseFloat(row.qty_ok) || 0) + (parseFloat(row.qty_ng) || 0);
    const completed = row.is_force_closed || (!row.is_setup && done >= plan && plan > 0);
    if (!completed) activeBatches.add(String(row.batch));
  }
  const q = search.trim().toLowerCase();
  const filtered = queueData.filter((row) => {
    if (q) {
      // โหมดค้นหา: ดูทั้งหมดรวมที่จบแล้ว
      return (
        String(row.batch).toLowerCase().includes(q) ||
        String(row.model).toLowerCase().includes(q)
      );
    }
    return activeBatches.has(String(row.batch));
  });

  const openBatchDetail = async (batch) => {
    setDetailBatch(batch);
    setDetailData(null);
    try {
      const res = await apiCall(`/production/tracking/${encodeURIComponent(batch)}`);
      setDetailData(res);
    } catch (err) {
      setDetailData({ error: err.message });
    }
  };

  const table = (
    <div style={{ overflowX: 'auto', ...(height ? { maxHeight: height, overflowY: 'auto' } : {}) }}>
      <Table bordered hover size="sm" style={{ minWidth: 870 }}>
        <thead className="table-secondary" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Priority</th>
            <th>Date Plan</th>
            <th>Batch</th>
            <th>Model</th>
            <th>Step</th>
            <th>Plan</th>
            <th>OK</th>
            <th>NG</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, i) => {
            const st = getStatus(row, highlightBatch);
            const okVal = parseFloat(row.qty_ok) || 0;
            const ngVal = parseFloat(row.qty_ng) || 0;
            return (
              <tr key={`${row.priority}-${i}`} style={st.bg ? { backgroundColor: st.bg } : {}}>
                <td className="text-center">{row.priority}</td>
                <td>{row.date_plan}</td>
                <td>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 text-decoration-underline"
                    onClick={() => openBatchDetail(row.batch)}
                  >
                    {row.batch}
                  </Button>
                  {row.is_pack && (
                    <div className="small text-muted">📦 {row.parent_pack}</div>
                  )}
                </td>
                <td>{row.model}</td>
                <td>{row.step}</td>
                <td className="text-end">{row.qty_plan}</td>
                <td className="text-end" style={okVal > 0 ? { color: '#2e7d32', fontWeight: 'bold' } : {}}>
                  {row.is_setup ? '-' : row.qty_ok}
                </td>
                <td className="text-end" style={ngVal > 0 ? { color: '#c62828', fontWeight: 'bold' } : {}}>
                  {row.is_setup ? '-' : row.qty_ng}
                </td>
                <td>{st.text}</td>
              </tr>
            );
          })}
          {filtered.length === 0 && !loading && (
            <tr>
              <td colSpan={9} className="text-center text-muted py-3">
                ไม่มีแผนงาน หรือ ค้นหาไม่พบ 📭
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );

  return (
    <div className={embedded ? 'd-flex gap-3 align-items-start' : ''}>
      {!fixedMachine && (
        <div style={embedded ? { width: 220, flexShrink: 0 } : { marginBottom: 8 }}>
          <Form.Select value={machine} onChange={handleMachineChange}>
            <option value="">เลือกเครื่องจักร...</option>
            {machines.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Form.Select>
        </div>
      )}
      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <strong>Plan for {machine || '-'}</strong>
          <InputGroup size="sm" style={{ maxWidth: 260 }}>
            <InputGroup.Text>
              <Search size={14} />
            </InputGroup.Text>
            <Form.Control
              placeholder="🔍 ค้นหา Batch หรือ Model..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
          {lastUpdated && <span className="small text-muted">อัปเดตล่าสุด: {lastUpdated}</span>}
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => fetchQueue(machine)}
            disabled={!machine || loading}
          >
            <RefreshCw size={14} />
          </Button>
          {loading && <Spinner animation="border" size="sm" />}
        </div>
        {table}
      </div>

      {/* Tracking dialog ของ batch ที่คลิก (port _showBatchDetailsDialog L2453-2581) */}
      <Modal show={!!detailBatch} onHide={() => setDetailBatch(null)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1rem' }}>
            Tracking Batch: {detailBatch}
            {detailData && !detailData.error && (
              <div className="small text-muted">
                Model: {detailData.model} | Plan Qty: {detailData.qty}
              </div>
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!detailData ? (
            <div className="text-center py-3">
              <Spinner animation="border" />
            </div>
          ) : detailData.error ? (
            <div className="text-danger">{detailData.error}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <Table bordered size="sm">
                <thead className="table-secondary">
                  <tr>
                    <th>Process Step</th>
                    <th>Machine</th>
                    <th>Qty OK</th>
                    <th>Qty NG</th>
                    <th>Last Record</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailData.data || []).map((r, i) => (
                    <tr key={i}>
                      <td>{r.processStep}</td>
                      <td>{r.machine}</td>
                      <td className="text-end" style={{ color: '#2e7d32' }}>
                        {r.qtyOK ?? '-'}
                      </td>
                      <td className="text-end" style={{ color: '#c62828' }}>
                        {r.qtyNG ?? '-'}
                      </td>
                      <td>{r.lastRecord}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDetailBatch(null)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default MachineQueuePanel;
