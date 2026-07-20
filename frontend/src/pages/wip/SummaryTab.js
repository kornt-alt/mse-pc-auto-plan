import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Form, Button, Table, Spinner, Toast, ToastContainer, InputGroup } from 'react-bootstrap';
import { RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiCall } from '../../api/client';

// WIP สรุปภาพรวม (Dashboard) — port จาก wip_summary_screen.dart
// แบ่งหน้า 15 แถว + คอลัมน์ WIP dynamic ตาม sorted_steps จาก backend
const PAGE_SIZE = 15;
const SEP = '   |   ';

// Status badge จาก due_date (dart L38-78) — ใช้เวลา local เหมือน Flutter DateTime.now()
const StatusBadge = ({ dueDateStr }) => {
  if (!dueDateStr || dueDateStr === '-' || dueDateStr === '9999-12-31') return <span>-</span>;
  const due = new Date(`${dueDateStr.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return <span>-</span>;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

  let text = 'Normal';
  let bg = '#C8E6C9';
  let color = '#2E7D32';
  if (diffDays < 0) {
    text = 'Overdue';
    bg = '#FFCDD2';
    color = '#C62828';
  } else if (diffDays <= 3) {
    text = `Urgent (${diffDays} วัน)`;
    bg = '#FFE0B2';
    color = '#E65100';
  }
  return (
    <span
      style={{
        backgroundColor: bg,
        color,
        padding: '2px 8px',
        borderRadius: 12,
        fontWeight: 'bold',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
};

const SummaryTab = () => {
  const [wipData, setWipData] = useState([]);
  const [processOrder, setProcessOrder] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLastPage, setIsLastPage] = useState(true);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [toast, setToast] = useState(null);
  const searchRef = useRef('');

  const fetchSummary = useCallback(async (page) => {
    setLoading(true);
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const q = encodeURIComponent(searchRef.current.trim());
      const res = await apiCall(`/wip-summary?limit=${PAGE_SIZE}&offset=${offset}&search=${q}`);
      setWipData(res.data || []);
      setCurrentPage(page);
      setIsLastPage(!(res.has_next ?? false));
      setProcessOrder((res.sorted_steps || []).map(String));
    } catch (err) {
      setToast({ message: `เชื่อมต่อ API ไม่ได้: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary(1);
    apiCall('/wip-summary/suggestions')
      .then((rows) => setSuggestions(Array.isArray(rows) ? rows : []))
      .catch(() => {}); // เดิมแค่ print
  }, [fetchSummary]);

  // ตัวเลือกค้นหา "batch   |   description" — fallback ใช้ข้อมูลบนจอเมื่อ suggestions ว่าง
  const searchOptions = (suggestions.length > 0
    ? suggestions
    : wipData.map((r) => ({ batch: r.batch, description: r.description }))
  ).map((s) => `${s.batch}${SEP}${s.description}`);

  const handleSearchChange = (value) => {
    // เลือกจาก datalist → ตัดเอาเฉพาะ batch แล้วค้นทันที (ตามเดิม onSelected)
    if (value.includes(SEP)) {
      const batchPart = value.split(SEP)[0].trim();
      setSearchText(batchPart);
      searchRef.current = batchPart;
      fetchSummary(1);
    } else {
      setSearchText(value);
      searchRef.current = value;
    }
  };

  const clearSearch = () => {
    setSearchText('');
    searchRef.current = '';
    fetchSummary(1);
  };

  return (
    <div>
      <div className="d-flex align-items-center mb-3">
        <div className="mx-auto" style={{ width: 380 }}>
          <InputGroup size="sm">
            <Form.Control
              list="wip-summary-suggestions"
              placeholder="ค้นหา Batch หรือ Description..."
              value={searchText}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fetchSummary(1);
              }}
            />
            {searchText && (
              <Button variant="outline-secondary" onClick={clearSearch}>
                <X size={14} />
              </Button>
            )}
          </InputGroup>
          <datalist id="wip-summary-suggestions">
            {searchOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <Button variant="link" className="text-mse fw-bold" onClick={() => fetchSummary(1)}>
          <RefreshCw size={14} className="me-1" />
          รีเฟรชข้อมูล
        </Button>
      </div>

      {loading && wipData.length === 0 ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : wipData.length === 0 ? (
        <div className="text-center py-5" style={{ color: '#9e9e9e', fontSize: 18 }}>
          ไม่มีข้อมูล WIP
        </div>
      ) : (
        <Card className="shadow-sm">
          <Card.Body className="p-2">
            <div className="matrix-scroll">
              <Table bordered hover size="sm" style={{ minWidth: 900 }}>
                <thead>
                  <tr style={{ backgroundColor: '#E8EAF6' }}>
                    <th className="text-center">No.</th>
                    <th>Batch</th>
                    <th>Description</th>
                    <th>Due Date</th>
                    <th>Status</th>
                    <th>Lot Qty</th>
                    <th className="text-center">Total NG</th>
                    {processOrder.map((step) => (
                      <th
                        key={step}
                        className="text-center"
                        style={{ color: '#C62828', fontSize: 13 }}
                      >
                        WIP
                        <br />
                        {step}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wipData.map((row, idx) => {
                    const totalNg = Number(row.total_ng ?? 0) || 0;
                    return (
                      <tr key={row.batch}>
                        <td className="text-center text-muted fw-bold">
                          {(currentPage - 1) * PAGE_SIZE + idx + 1}
                        </td>
                        <td className="fw-bold">{row.batch}</td>
                        <td>{row.description}</td>
                        <td className="fw-bold">{row.due_date}</td>
                        <td>
                          <StatusBadge dueDateStr={row.due_date} />
                        </td>
                        <td>
                          {row.is_missing_routing ? (
                            <span
                              style={{
                                backgroundColor: '#FFEBEE',
                                border: '1px solid #FF5252',
                                color: '#FF5252',
                                borderRadius: 4,
                                padding: '1px 6px',
                                fontSize: 12,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              No Routing
                            </span>
                          ) : (
                            String(row.qty)
                          )}
                        </td>
                        <td className="text-center">
                          {totalNg > 0 ? (
                            <span className="fw-bold" style={{ color: '#C62828' }}>
                              {Math.trunc(totalNg)}
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        {processOrder.map((step) => (
                          <td key={step} className="text-center">
                            {row.wips && step in row.wips ? (
                              <span
                                className="fw-bold"
                                style={{ color: '#C62828', fontSize: 15 }}
                              >
                                {Math.trunc(Number(row.wips[step]))}
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </Card.Body>
        </Card>
      )}

      <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
        <Button
          size="sm"
          style={{ backgroundColor: '#283593', border: 'none' }}
          disabled={currentPage <= 1 || loading}
          onClick={() => fetchSummary(currentPage - 1)}
        >
          <ChevronLeft size={14} className="me-1" />
          ก่อนหน้า
        </Button>
        {loading ? (
          <Spinner animation="border" size="sm" />
        ) : (
          <span className="fw-bold">หน้า {currentPage}</span>
        )}
        <Button
          size="sm"
          style={{ backgroundColor: '#283593', border: 'none' }}
          disabled={isLastPage || loading}
          onClick={() => fetchSummary(currentPage + 1)}
        >
          ถัดไป
          <ChevronRight size={14} className="ms-1" />
        </Button>
      </div>

      <ToastContainer position="bottom-end" className="p-3" style={{ zIndex: 2000 }}>
        <Toast show={!!toast} onClose={() => setToast(null)} delay={3500} autohide bg="danger">
          <Toast.Body className="text-white">{toast?.message}</Toast.Body>
        </Toast>
      </ToastContainer>
    </div>
  );
};

export default SummaryTab;
