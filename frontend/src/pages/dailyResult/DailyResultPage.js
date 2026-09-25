import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Form, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import ToastHost, { useToast } from '../../components/shared/ToastHost';
import { KpiStrip, ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';
import { todayBangkok } from '../../utils/dates';
import { buildDailySummary, halves, dayLetter, yieldLabel } from './dailySummary';
import Dialogue1 from './Dialogue1';

// Production Daily Result — เดิม port จาก production_daily_screen.dart (matrix 3 แถว metric × วันของเดือน)
// ปรับใหม่ 2026-09-25: KPI ของเดือน, แถว NG, คอลัมน์รวม, ตารางสรุปรายสัปดาห์, Excel, พิมพ์ (แยกครึ่งเดือนให้พอดี A4)
// กดหัววันที่มียอด = เปิด Dialogue1 เหมือนเดิม
const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (v) => Math.trunc(Number(v) || 0).toLocaleString();

const METRICS = [
  { key: 'input', label: 'TTL. Input', value: (d) => (d.hasData ? fmt(d.input) : '-') },
  { key: 'output', label: 'TTL. Output', value: (d) => (d.hasData ? fmt(d.output) : '-') },
  { key: 'ng', label: 'NG', value: (d) => (d.hasData ? fmt(d.ng) : '-'), cls: (d) => (d.ng > 0 ? 'text-danger' : '') },
  { key: 'yield', label: 'Yield', value: (d) => yieldLabel(d.yield) },
];

// matrix เมตริก × วัน (+ คอลัมน์รวม) — ใช้ทั้งจอ (ทั้งเดือน) และหน้าพิมพ์ (ครึ่งเดือน)
const DayMatrix = ({ days, total, today, onDayClick }) => (
  <table className="rpt-table">
    <thead>
      <tr>
        <th className="frozen frozen-last" style={{ left: 0, minWidth: 110 }}>วันที่</th>
        {days.map((d) => {
          const cls = ['col-date', d.weekend ? 'col-weekend' : '', d.date === today ? 'col-today' : ''].filter(Boolean).join(' ');
          return (
            <th key={d.day} className={cls} style={{ minWidth: 62 }}>
              {d.hasData && onDayClick ? (
                <button type="button" className="btn btn-link p-0 fw-bold" onClick={() => onDayClick(d)} title={`ดูรายละเอียด ${d.date}`}>
                  <div className="date-head">{d.day}<small>{dayLetter(d.date)}</small></div>
                </button>
              ) : (
                <div className={`date-head${d.hasData ? '' : ' text-muted'}`}>{d.day}<small>{dayLetter(d.date)}</small></div>
              )}
            </th>
          );
        })}
        {total && <th className="text-end" style={{ minWidth: 90 }}>รวม</th>}
      </tr>
    </thead>
    <tbody>
      {METRICS.map((m) => (
        <tr key={m.key}>
          <td className="frozen frozen-last fw-bold" style={{ left: 0, minWidth: 110 }}>{m.label}</td>
          {days.map((d) => {
            const cls = ['col-date num', d.weekend ? 'col-weekend' : '', d.date === today ? 'col-today' : '', m.cls ? m.cls(d) : '']
              .filter(Boolean).join(' ');
            return (
              <td key={d.day} className={cls}>
                {m.value(d)}
                {m.key === 'yield' && d.yield != null && (
                  <div className="mini-bar bar-info"><span style={{ width: `${Math.min(d.yield, 100)}%` }} /></div>
                )}
              </td>
            );
          })}
          {total && (
            <td className="text-end num fw-bold">
              {m.key === 'yield' ? yieldLabel(total.yield) : fmt(total[m.key])}
            </td>
          )}
        </tr>
      ))}
    </tbody>
  </table>
);

DayMatrix.propTypes = {
  days: PropTypes.array.isRequired,
  total: PropTypes.object,
  today: PropTypes.string.isRequired,
  onDayClick: PropTypes.func,
};

const DailyResultPage = () => {
  const today = todayBangkok();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [machine, setMachine] = useState('All');
  const [machines, setMachines] = useState(['All']);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [d1Ctx, setD1Ctx] = useState(null);
  const { toast, showToast, hideToast } = useToast();

  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 10 }, (_, i) => thisYear - 5 + i);

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
    fetchSummary(year, month, 'All');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSummary]);

  const { days, weeks, total } = useMemo(() => buildDailySummary(summary, year, month), [summary, year, month]);
  const [firstHalf, secondHalf] = halves(days);
  const period = `${year}-${pad2(month)}`;
  const filters = `เดือน ${period} · เครื่อง ${machine === 'All' ? 'ทั้งหมด' : machine}`;
  const title = 'Daily Result — ยอดผลิตรายวัน';

  const openDialogue1 = (d) => setD1Ctx({ targetDate: d.date, machine });

  const handleExport = () => exportWorkbook(stampedFilename(`daily_result_${period}${machine === 'All' ? '' : `_${machine}`}`, today), [
    {
      name: 'Daily',
      header: [
        { key: 'date', label: 'Date' },
        { key: 'input', label: 'TTL Input' },
        { key: 'output', label: 'TTL Output' },
        { key: 'ng', label: 'NG' },
        { key: 'yield', label: 'Yield %', value: (d) => d.yield ?? '' },
      ],
      rows: days,
    },
    {
      name: 'Weekly',
      header: [
        { key: 'label', label: 'Week' },
        { key: 'start', label: 'Week start (Mon)' },
        { key: 'input', label: 'TTL Input' },
        { key: 'output', label: 'TTL Output' },
        { key: 'yield', label: 'Yield %', value: (w) => w.yield ?? '' },
      ],
      rows: [...weeks, { label: 'รวมทั้งเดือน', start: '', ...total }],
    },
  ], { title, filters, asOf: today });

  const kpis = [
    { id: 'input', label: 'Input ทั้งเดือน', value: fmt(total.input), tone: 'info' },
    { id: 'output', label: 'Output ทั้งเดือน', value: fmt(total.output), sub: total.workDays ? `เฉลี่ย ${fmt(total.avgOutput)}/วัน` : null, tone: 'ok' },
    { id: 'ng', label: 'NG ทั้งเดือน', value: fmt(total.ng), tone: total.ng > 0 ? 'ng' : 'ok' },
    { id: 'yield', label: 'Yield ทั้งเดือน', value: yieldLabel(total.yield), tone: 'info' },
    { id: 'days', label: 'วันที่มียอด', value: total.workDays, tone: 'muted' },
    {
      id: 'worst',
      label: 'Yield ต่ำสุด',
      value: total.worstYield ? yieldLabel(total.worstYield.yield) : '-',
      sub: total.worstYield ? `วันที่ ${total.worstYield.day}` : null,
      tone: 'warn',
    },
  ];

  return (
    <div className="container-fluid py-3">
      <PageHeader
        icon="bi-clipboard-data"
        title="Daily Result"
        subtitle="ยอดรับเข้า ยอดผลิต NG และ Yield รายวันของแต่ละเครื่องจักร (วันโรงงาน 07:00–07:00)"
      />
      <PrintHeader title={title} filters={filters} asOf={today} />
      <div className="rpt-toolbar">
        <Form.Select
          size="sm"
          style={{ width: 100 }}
          value={year}
          aria-label="ปี"
          onChange={(e) => {
            const y = Number(e.target.value);
            setYear(y);
            fetchSummary(y, month, machine);
          }}
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Form.Select>
        <Form.Select
          size="sm"
          style={{ width: 80 }}
          value={month}
          aria-label="เดือน"
          onChange={(e) => {
            const m = Number(e.target.value);
            setMonth(m);
            fetchSummary(year, m, machine);
          }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{pad2(m)}</option>)}
        </Form.Select>
        <Form.Select
          size="sm"
          style={{ width: 180 }}
          value={machine}
          aria-label="เครื่องจักร"
          onChange={(e) => {
            const mc = e.target.value;
            setMachine(mc);
            fetchSummary(year, month, mc);
          }}
        >
          {machines.map((m) => <option key={m} value={m}>{m === 'All' ? 'ทุกเครื่อง' : m}</option>)}
        </Form.Select>
        {loading && <Spinner animation="border" size="sm" />}
        <ReportActions onExcel={handleExport} excelDisabled={total.workDays === 0}>
          <Button size="sm" variant="outline-secondary" onClick={() => fetchSummary(year, month, machine)}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />รีเฟรช
          </Button>
        </ReportActions>
      </div>

      <KpiStrip items={kpis} />

      <div className="rpt-note no-print">กดตัวเลขวันที่ (ที่มียอด) เพื่อดูรายละเอียดราย batch / step</div>
      <div className="rpt-wrap screen-only mb-3" style={{ minHeight: 0 }}>
        <DayMatrix days={days} total={total} today={today} onDayClick={openDialogue1} />
      </div>
      {/* ฉบับพิมพ์: แยกครึ่งเดือน — 31 คอลัมน์ไม่พอกระดาษ A4 */}
      <div className="print-split">
        <DayMatrix days={firstHalf} today={today} />
        <div style={{ height: 8 }} />
        <DayMatrix days={secondHalf} total={total} today={today} />
      </div>

      <h2 className="h6 fw-bold mt-3">สรุปรายสัปดาห์</h2>
      <div className="rpt-wrap" style={{ minHeight: 0 }}>
        <table className="rpt-table">
          <thead>
            <tr>
              <th style={{ minWidth: 120 }}>สัปดาห์ (วันที่)</th>
              <th className="text-end" style={{ minWidth: 100 }}>TTL. Input</th>
              <th className="text-end" style={{ minWidth: 100 }}>TTL. Output</th>
              <th className="text-end" style={{ minWidth: 80 }}>NG</th>
              <th style={{ minWidth: 140 }}>Yield</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}>
                <td>{w.label}</td>
                <td className="text-end num">{fmt(w.input)}</td>
                <td className="text-end num">{fmt(w.output)}</td>
                <td className={`text-end num ${w.input - w.output > 0 ? 'text-danger' : ''}`}>{fmt(w.input - w.output)}</td>
                <td className="num">
                  {yieldLabel(w.yield)}
                  {w.yield != null && <div className="mini-bar bar-info"><span style={{ width: `${Math.min(w.yield, 100)}%` }} /></div>}
                </td>
              </tr>
            ))}
            <tr className="group-row">
              <td>รวมทั้งเดือน</td>
              <td className="text-end num">{fmt(total.input)}</td>
              <td className="text-end num">{fmt(total.output)}</td>
              <td className="text-end num">{fmt(total.ng)}</td>
              <td className="num">{yieldLabel(total.yield)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Dialogue1 show={!!d1Ctx} ctx={d1Ctx} onHide={() => setD1Ctx(null)} />

      <ToastHost toast={toast} onClose={hideToast} />
    </div>
  );
};

export default DailyResultPage;
