// By Batch — เส้นทางการผลิตของ batch เดียว แผนเทียบผลจริงรายวัน (เดิม ORDER TRACKING MATRIX /
// dashboard_plan_actual_batch.dart) · transform อยู่ใน planActual.js (ตรรกะเดิม)
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Form, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { transformByBatch, summarize, rowProgress, lotQty, flattenDaily, attainmentTone } from './planActual';
import { PlanCell, dateColClass } from './matrixCells';
import { KpiStrip, ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';
import { isWeekend, shortDateLabel } from '../../utils/dates';

const PRINT_MAX_DAYS = 7;
const FROZEN = [
  { key: 'no', label: '#', left: 0, width: 40 },
  { key: 'batch', label: 'Batch', left: 40, width: 120 },
  { key: 'step', label: 'Step', left: 160, width: 130 },
  { key: 'machine', label: 'Machine', left: 290, width: 90 },
  { key: 'lot', label: 'Lot', left: 380, width: 60 },
  { key: 'in', label: 'In', left: 440, width: 60 },
  { key: 'out', label: 'Out', left: 500, width: 60 },
];
const frozenStyle = (i) => ({ left: FROZEN[i].left, minWidth: FROZEN[i].width, maxWidth: FROZEN[i].width });
const trunc = (v) => Math.trunc(Number(v) || 0);

export const kpiItems = (s) => [
  { id: 'rows', label: 'แถว (step × เครื่อง)', value: s.rows, tone: 'info' },
  { id: 'plan', label: 'แผนถึงวันนี้', value: trunc(s.planToDate).toLocaleString(), sub: `ทั้งหมด ${trunc(s.planTotal).toLocaleString()}` },
  { id: 'ok', label: 'ผลิตได้ (OK)', value: trunc(s.ok).toLocaleString(), tone: 'ok' },
  { id: 'pct', label: '% ทำได้ตามแผน', value: s.pct == null ? '-' : `${s.pct}%`, tone: attainmentTone(s.pct) },
  { id: 'ng', label: 'NG', value: trunc(s.ng).toLocaleString(), sub: s.ngPct == null ? null : `${s.ngPct}%`, tone: s.ng > 0 ? 'ng' : 'ok' },
  { id: 'behind', label: 'แถวที่ตามหลังแผน', value: s.behind, tone: s.behind > 0 ? 'warn' : 'ok' },
];

const ByBatchTab = ({ today }) => {
  const [batchList, setBatchList] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchBatchList = useCallback(async () => {
    try {
      const orders = await apiCall('/orders');
      setBatchList([...new Set(orders.map((o) => String(o.batch)))].sort());
    } catch {
      setBatchList([]);
    }
  }, []);

  useEffect(() => { fetchBatchList(); }, [fetchBatchList]);

  const fetchPlanVsActual = useCallback(async (batch) => {
    setLoading(true);
    try {
      const res = await apiCall(`/visualization/plan-vs-actual?batch=${encodeURIComponent(batch)}`);
      setData(res.data || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const { rows, dates } = useMemo(() => transformByBatch(data ?? []), [data]);
  const summary = useMemo(() => summarize(rows, today), [rows, today]);

  const handleSelect = (value) => {
    setInputValue(value);
    if (batchList.includes(value)) {
      setSelectedBatch(value);
      fetchPlanVsActual(value);
    }
  };

  const title = `Plan & Actual — Batch ${selectedBatch ?? ''}`;
  const handleExport = () => exportWorkbook(stampedFilename(`plan_actual_${selectedBatch}`, today), [
    {
      name: 'Summary',
      header: [
        { key: 'batch', label: 'Batch' }, { key: 'model', label: 'Model' }, { key: 'step', label: 'Step' },
        { key: 'machine', label: 'Machine' }, { key: 'lot', label: 'Lot', value: (r) => trunc(lotQty(r)) },
        { key: 'in', label: 'In', value: (r) => trunc(r.total_actual_ok + r.total_actual_ng) },
        { key: 'out', label: 'Out', value: (r) => trunc(r.total_actual_ok) },
        { key: 'planToDate', label: 'Plan to date', value: (r) => rowProgress(r, today).planToDate },
        { key: 'pct', label: '% attainment', value: (r) => rowProgress(r, today).pct ?? '' },
      ],
      rows,
    },
    {
      name: 'Daily',
      header: ['batch', 'step', 'machine', 'date', 'plan', 'ok', 'ng'].map((k) => ({ key: k, label: k.toUpperCase() })),
      rows: flattenDaily(rows, dates, ['batch', 'step', 'machine']),
    },
  ], { title, filters: `Batch ${selectedBatch}`, asOf: today });

  const printWarning = dates.length > PRINT_MAX_DAYS
    ? `Batch นี้มีแผน ${dates.length} วัน — A4 แนวนอนพิมพ์ได้ราว ${PRINT_MAX_DAYS} วัน คอลัมน์ที่เกินจะถูกตัด (ใช้ Excel แทนได้)`
    : null;

  return (
    <div>
      <div className="rpt-toolbar">
        <Form.Control
          size="sm"
          style={{ width: 260 }}
          list="pa-batch-options"
          placeholder="พิมพ์เลข Batch เพื่อค้นหา..."
          value={inputValue}
          onChange={(e) => handleSelect(e.target.value)}
          aria-label="Batch"
        />
        <datalist id="pa-batch-options">
          {batchList.map((b) => <option key={b} value={b} />)}
        </datalist>
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={!selectedBatch}
          onClick={() => { fetchBatchList(); fetchPlanVsActual(selectedBatch); }}
          title="โหลดใหม่"
          aria-label="โหลดใหม่"
        >
          <i className="bi bi-arrow-clockwise" aria-hidden="true" />
        </Button>
        {selectedBatch && (
          <ReportActions onExcel={handleExport} excelDisabled={rows.length === 0} printWarning={printWarning} />
        )}
      </div>

      {!selectedBatch ? (
        <div className="empty-state">
          <i className="bi bi-signpost-split" aria-hidden="true" />
          <div className="fw-bold">พิมพ์ค้นหา Batch ด้านบนเพื่อดูเส้นทางการผลิต</div>
        </div>
      ) : loading ? (
        <div className="text-center py-5"><Spinner animation="border" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><i className="bi bi-inbox" aria-hidden="true" /><div>ไม่พบข้อมูลแผนการผลิตของ Batch นี้</div></div>
      ) : (
        <>
          <PrintHeader title={title} filters={`Model ${rows[0].model} · ${rows[0].description}`} asOf={today} />
          <KpiStrip items={kpiItems(summary)} />
          <div className="rpt-note no-print">
            Model {rows[0].model} · {rows[0].description} · ช่องวัน = ได้ / แผน · Lot = จำนวนสั่ง · In = OK+NG · Out = OK สะสม
          </div>
          <div className="rpt-wrap">
            <table className="rpt-table">
              <thead>
                <tr>
                  {FROZEN.map((c, i) => (
                    <th key={c.key} className={`frozen${i === FROZEN.length - 1 ? ' frozen-last' : ''}`} style={frozenStyle(i)}>
                      {c.label}
                    </th>
                  ))}
                  {dates.map((d) => {
                    const { label, day } = shortDateLabel(d);
                    return (
                      <th key={d} className={dateColClass(d, today, isWeekend)} style={{ minWidth: 90 }} title={d}>
                        <div className="date-head">{label}<small>{day}</small></div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const p = rowProgress(row, today);
                  return (
                    <tr key={`${row.batch}|${row.step}|${row.machine}`}>
                      <td className="frozen text-center text-muted" style={frozenStyle(0)}>{idx + 1}</td>
                      <td className="frozen num fw-bold text-truncate" style={frozenStyle(1)} title={row.batch}>{row.batch}</td>
                      <td className="frozen text-truncate" style={frozenStyle(2)} title={row.step}>{row.step}</td>
                      <td className="frozen" style={frozenStyle(3)}>{row.machine}</td>
                      <td className="frozen text-end num" style={frozenStyle(4)}>{trunc(lotQty(row))}</td>
                      <td className="frozen text-end num" style={frozenStyle(5)}>{trunc(row.total_actual_ok + row.total_actual_ng)}</td>
                      <td
                        className={`frozen frozen-last text-end num fw-bold tone-${p.planToDate > 0 ? attainmentTone(p.pct) : 'muted'}`}
                        style={frozenStyle(6)}
                      >
                        {trunc(row.total_actual_ok)}
                      </td>
                      {dates.map((d) => (
                        <td key={d} className={dateColClass(d, today, isWeekend)}>
                          <PlanCell dayData={row.dates[d]} date={d} today={today} />
                        </td>
                      ))}
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

ByBatchTab.propTypes = { today: PropTypes.string.isRequired };

export default ByBatchTab;
