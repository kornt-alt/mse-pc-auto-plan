// WIP สรุปภาพรวม — เดิม port จาก wip_summary_screen.dart (แบ่งหน้า 15 แถวฝั่ง backend)
// ปรับใหม่ 2026-09-25: โหลดทุกหน้าครั้งเดียว (ทีละ 200 — ดูหัว wipSummary.js) แล้วกรอง/ค้นหา/แบ่งหน้าฝั่ง client
// เพื่อให้ตัวเลข KPI และ Excel ครอบคลุมทุก batch ไม่ใช่แค่หน้าที่เห็น
// ตอนพิมพ์: คอลัมน์ step เยอะเกิน A4 จึงพิมพ์เป็นรายการต่อ batch ("step จำนวน") แทน matrix
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Form, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import {
  WIP_PAGE_SIZE, WIP_FILTERS, wipStatus, mergeStepOrders, wipTotal, matchesWipFilter,
  summarizeWip, countWipFilters, wipInline,
} from './wipSummary';
import { KpiStrip, ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';

const VIEW_PAGE = 50;
const MAX_PAGES = 50; // กันวนไม่จบถ้า backend ตอบ has_next ผิด (50 × 200 = 10,000 batch)

const SummaryTab = ({ today }) => {
  const [rows, setRows] = useState(null);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setRows(null);
    setError('');
    const all = [];
    const stepLists = [];
    try {
      for (let i = 0; i < MAX_PAGES; i += 1) {
        const res = await apiCall(`/wip-summary?limit=${WIP_PAGE_SIZE}&offset=${i * WIP_PAGE_SIZE}&search=`);
        all.push(...(res.data || []));
        stepLists.push((res.sorted_steps || []).map(String));
        if (!res.has_next) break;
      }
    } catch (err) {
      setError(`เชื่อมต่อ API ไม่ได้: ${err.message}`);
    }
    setRows(all);
    setSteps(mergeStepOrders(stepLists));
    setPage(1);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => matchesWipFilter(r, statusFilter, today)
      && (!q || String(r.batch).toLowerCase().includes(q) || String(r.description ?? '').toLowerCase().includes(q)));
  }, [rows, statusFilter, search, today]);
  const summary = useMemo(() => summarizeWip(rows ?? [], today), [rows, today]);
  const counts = useMemo(() => countWipFilters(rows ?? [], today), [rows, today]);
  // คอลัมน์ step เฉพาะที่มี WIP ในแถวที่กรองแล้ว (ลำดับตาม steps)
  const visibleSteps = useMemo(
    () => steps.filter((s) => filtered.some((r) => r.wips && s in r.wips)),
    [steps, filtered],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / VIEW_PAGE));
  const pageRows = filtered.slice((page - 1) * VIEW_PAGE, page * VIEW_PAGE);

  const filters = [
    statusFilter ? WIP_FILTERS.find((f) => f.id === statusFilter).label : 'ทุกสถานะ',
    search.trim() ? `ค้นหา "${search.trim()}"` : null,
  ].filter(Boolean).join(' · ');
  const title = 'WIP — งานระหว่างผลิตคงค้างรายขั้นตอน';

  const handleExport = () => exportWorkbook(stampedFilename('wip_summary', today), [{
    name: 'WIP',
    header: [
      { key: 'batch', label: 'Batch' },
      { key: 'description', label: 'Description' },
      { key: 'due_date', label: 'Due Date' },
      { key: 'status', label: 'Status', value: (r) => wipStatus(r.due_date, today).label },
      { key: 'qty', label: 'Lot Qty', value: (r) => (r.is_missing_routing ? 'No Routing' : r.qty) },
      { key: 'total_ng', label: 'Total NG', value: (r) => Math.trunc(Number(r.total_ng) || 0) },
      { key: 'wip_total', label: 'WIP รวม', value: (r) => Math.trunc(wipTotal(r)) },
      ...visibleSteps.map((s) => ({ key: s, label: `WIP ${s}`, value: (r) => (r.wips && s in r.wips ? Math.trunc(Number(r.wips[s])) : '') })),
    ],
    rows: filtered,
  }], { title, filters, asOf: today });

  if (rows === null) return <div className="text-center py-5"><Spinner animation="border" className="text-mse" /></div>;

  const kpis = [
    { id: 'all', label: 'Batch ที่เปิดอยู่', value: summary.batches, sub: `มี WIP ${summary.withWip}`, tone: 'info', selectable: false },
    { id: 'wip', label: 'WIP รวม (ชิ้น)', value: Math.trunc(summary.wipPcs).toLocaleString(), tone: 'info', selectable: false },
    { id: 'overdue', label: 'Overdue', value: summary.overdue, tone: summary.overdue > 0 ? 'ng' : 'ok' },
    { id: 'urgent', label: 'Urgent ≤ 3 วัน', value: summary.urgent, tone: summary.urgent > 0 ? 'warn' : 'ok' },
    { id: 'no-routing', label: 'No Routing', value: summary.noRouting, tone: summary.noRouting > 0 ? 'ng' : 'ok' },
    { id: 'ng', label: 'NG รวม', value: Math.trunc(summary.ng).toLocaleString(), tone: summary.ng > 0 ? 'ng' : 'ok', selectable: false },
  ];

  return (
    <div>
      <PrintHeader title={title} filters={filters} asOf={today} />
      <KpiStrip
        items={kpis}
        activeId={statusFilter}
        onSelect={(id) => { setStatusFilter((cur) => (cur === id ? null : id)); setPage(1); }}
      />
      <div className="rpt-toolbar">
        {WIP_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip chip-${statusFilter === f.id ? f.tone : 'muted'} border-0`}
            onClick={() => { setStatusFilter((cur) => (cur === f.id ? null : f.id)); setPage(1); }}
            title="กดเพื่อกรอง / กดซ้ำเพื่อยกเลิก"
          >
            {f.label} {counts[f.id]}
          </button>
        ))}
        <Form.Control
          size="sm"
          style={{ width: 240 }}
          placeholder="ค้นหา Batch หรือ Description"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <ReportActions onExcel={handleExport} excelDisabled={filtered.length === 0}>
          <Button size="sm" variant="outline-secondary" onClick={load}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />รีเฟรช
          </Button>
        </ReportActions>
      </div>
      {error && <div className="text-danger small mb-2">{error}</div>}

      {filtered.length === 0 ? (
        <div className="empty-state"><i className="bi bi-inbox" aria-hidden="true" /><div>ไม่มีข้อมูล WIP ตามเงื่อนไขนี้</div></div>
      ) : (
        <>
          <div className="rpt-wrap screen-only">
            <table className="rpt-table">
              <thead>
                <tr>
                  <th className="frozen text-center" style={{ left: 0, minWidth: 45 }}>#</th>
                  <th className="frozen frozen-last" style={{ left: 45, minWidth: 120 }}>Batch</th>
                  <th style={{ minWidth: 180 }}>Description</th>
                  <th style={{ minWidth: 95 }}>Due Date</th>
                  <th style={{ minWidth: 110 }}>Status</th>
                  <th className="text-end">Lot Qty</th>
                  <th className="text-end">NG</th>
                  <th className="text-end">WIP รวม</th>
                  {visibleSteps.map((s) => (
                    <th key={s} className="text-center" style={{ minWidth: 70 }} title={s}>
                      <div className="date-head"><small>WIP</small>{s}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, idx) => {
                  const st = wipStatus(row.due_date, today);
                  const ng = Math.trunc(Number(row.total_ng) || 0);
                  return (
                    <tr key={row.batch}>
                      <td className="frozen text-center text-muted" style={{ left: 0, minWidth: 45 }}>{(page - 1) * VIEW_PAGE + idx + 1}</td>
                      <td className="frozen frozen-last num fw-bold" style={{ left: 45, minWidth: 120 }}>{row.batch}</td>
                      <td className="text-truncate" style={{ maxWidth: 240 }} title={row.description}>{row.description}</td>
                      <td className="num">{row.due_date}</td>
                      <td><span className={`chip chip-${st.tone === 'muted' ? 'muted' : st.tone}`}>{st.label}</span></td>
                      <td className="text-end num">
                        {row.is_missing_routing ? <span className="chip chip-ng">No Routing</span> : String(row.qty)}
                      </td>
                      <td className={`text-end num ${ng > 0 ? 'text-danger fw-bold' : 'text-muted'}`}>{ng > 0 ? ng : '-'}</td>
                      <td className="text-end num fw-bold">{Math.trunc(wipTotal(row)) || '-'}</td>
                      {visibleSteps.map((s) => (
                        <td key={s} className={`text-center num ${row.wips && s in row.wips ? 'tone-warn fw-bold' : 'text-muted'}`}>
                          {row.wips && s in row.wips ? Math.trunc(Number(row.wips[s])) : '·'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="d-flex justify-content-center align-items-center gap-3 mt-2 no-print">
            <Button size="sm" className="btn-mse" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <i className="bi bi-chevron-left me-1" aria-hidden="true" />ก่อนหน้า
            </Button>
            <span className="small num">หน้า {page} / {pageCount} · {filtered.length} batch</span>
            <Button size="sm" className="btn-mse" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              ถัดไป<i className="bi bi-chevron-right ms-1" aria-hidden="true" />
            </Button>
          </div>

          {/* ฉบับพิมพ์: ทุกแถวที่กรองแล้ว (ไม่แบ่งหน้า) และ WIP เป็นข้อความต่อ batch */}
          <div className="print-split">
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>#</th><th>Batch</th><th>Description</th><th>Due</th><th>Status</th>
                  <th>Lot</th><th>NG</th><th>WIP รวม</th><th>WIP ตามขั้นตอน</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const st = wipStatus(row.due_date, today);
                  return (
                    <tr key={row.batch}>
                      <td>{idx + 1}</td>
                      <td className="num">{row.batch}</td>
                      <td>{row.description}</td>
                      <td className="num">{row.due_date}</td>
                      <td className={st.tone === 'muted' ? '' : `tone-${st.tone}`}>{st.label}</td>
                      <td className="num">{row.is_missing_routing ? 'No Routing' : String(row.qty)}</td>
                      <td className="num">{Math.trunc(Number(row.total_ng) || 0) || ''}</td>
                      <td className="num">{Math.trunc(wipTotal(row)) || ''}</td>
                      <td style={{ whiteSpace: 'normal' }}>{wipInline(row, steps)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

SummaryTab.propTypes = { today: PropTypes.string.isRequired };

export default SummaryTab;
