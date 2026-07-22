import React, { useState, useEffect, useCallback } from 'react';
import { Card, Form, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import Dialogue1 from './Dialogue1';

// Production Daily Result — port จาก production_daily_screen.dart
// matrix transpose: 3 แถว metric (คอลัมน์แรก sticky) × คอลัมน์วัน 1..วันสุดท้ายของเดือน
const pad2 = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

const DailyResultPage = () => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [machine, setMachine] = useState('All');
  const [machines, setMachines] = useState(['All']);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [d1Ctx, setD1Ctx] = useState(null);
  const { toast, showToast, hideToast } = useToast();

  const years = Array.from({ length: 10 }, (_, i) => now.getFullYear() - 5 + i);

  const fetchSummary = useCallback(async (y, m, mc) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: y, month: m, machine: mc });
      const res = await apiCall(`/daily-result/summary?${params.toString()}`);
      setSummary(res.data || []);
    } catch (err) {
      showToast(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`, 'danger');
      setSummary([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    apiCall('/daily-result/machines')
      .then((res) => setMachines(['All', ...(res.data || [])]))
      .catch(() => setMachines(['All']));
    fetchSummary(now.getFullYear(), now.getMonth() + 1, 'All');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSummary]);

  // day → summary row (sparse — วันไม่มียอดไม่ส่งมา)
  const dayMap = {};
  for (const r of summary) dayMap[r.day] = r;
  const days = Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1);

  const yieldOf = (row) =>
    row && row.ttl_input > 0 ? `${((row.ttl_output / row.ttl_input) * 100).toFixed(2)}%` : '-';

  const openDialogue1 = (day) => {
    const row = dayMap[day];
    if (!row || !(row.ttl_input > 0)) return;
    setD1Ctx({ targetDate: row.date, machine });
  };

  const headCell = {
    minWidth: 70,
    textAlign: 'center',
    border: '1px solid #dee2e6',
    padding: '6px 4px',
  };
  const stickyCell = {
    position: 'sticky',
    left: 0,
    minWidth: 150,
    backgroundColor: '#f8f9fa',
    fontWeight: 'bold',
    border: '1px solid #dee2e6',
    padding: '6px 8px',
    zIndex: 1,
  };

  const metricRows = [
    { label: 'TTL. Input', value: (row) => (row ? row.ttl_input : '-') },
    { label: 'TTL. Output', value: (row) => (row ? row.ttl_output : '-') },
    { label: 'Yield', value: (row) => yieldOf(row) },
  ];

  return (
    <div className="container-fluid py-3">
      <PageHeader
        icon="bi-clipboard-data"
        title="Daily Result"
        subtitle="ยอดรับเข้า ยอดผลิต และ Yield รายวันของแต่ละเครื่องจักร"
      />
      <Card className="shadow-sm mb-3" style={{ backgroundColor: 'var(--mse-warn-bg)' }}>
        <Card.Body className="py-2">
          <div className="d-flex flex-wrap align-items-end gap-2">
            <Form.Group>
              <Form.Label className="small mb-0">ปี</Form.Label>
              <Form.Select
                size="sm"
                value={year}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setYear(y);
                  fetchSummary(y, month, machine);
                }}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-0">เดือน</Form.Label>
              <Form.Select
                size="sm"
                value={month}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setMonth(m);
                  fetchSummary(year, m, machine);
                }}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {pad2(m)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small mb-0">เครื่องจักร</Form.Label>
              <Form.Select
                size="sm"
                value={machine}
                onChange={(e) => {
                  const mc = e.target.value;
                  setMachine(mc);
                  fetchSummary(year, month, mc);
                }}
              >
                {machines.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Button
              size="sm"
              className="btn-mse"
              onClick={() => fetchSummary(year, month, machine)}
            >
              <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
              รีเฟรช
            </Button>
            {loading && <Spinner animation="border" size="sm" />}
          </div>
        </Card.Body>
      </Card>

      <div className="matrix-scroll bg-white rounded shadow-sm">
        <table style={{ borderCollapse: 'collapse', width: 'max-content' }}>
          <thead>
            <tr>
              <th style={{ ...stickyCell, backgroundColor: '#e9ecef' }}>Date</th>
              {days.map((day) => {
                const clickable = dayMap[day] && dayMap[day].ttl_input > 0;
                return (
                  <th
                    key={day}
                    style={{
                      ...headCell,
                      backgroundColor: '#e9ecef',
                      ...(clickable
                        ? {
                            color: '#1565c0',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                          }
                        : { color: '#adb5bd' }),
                    }}
                    onClick={() => openDialogue1(day)}
                  >
                    {day}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((mr) => (
              <tr key={mr.label}>
                <td style={stickyCell}>{mr.label}</td>
                {days.map((day) => (
                  <td key={day} style={headCell}>
                    {mr.value(dayMap[day])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialogue1 show={!!d1Ctx} ctx={d1Ctx} onHide={() => setD1Ctx(null)} />

      <ToastHost toast={toast} onClose={hideToast} />
    </div>
  );
};

export default DailyResultPage;
