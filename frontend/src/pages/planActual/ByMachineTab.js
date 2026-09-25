// By Machine — งานทุก batch บนเครื่องเดียว แผนเทียบผลจริงรายวัน (เดิม MATRIX PRODUCTION DASHBOARD /
// dashboard_plan_actual_machine.dart) · transform อยู่ใน planActual.js (ตรรกะเดิม)
// เครื่องที่เลือกถือไว้ที่ PlanActualPage — แท็บสรุปรายเครื่องกดส่งมาเปิดที่นี่ได้
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Form, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { transformByMachine, summarize, rowProgress, lotQty, flattenDaily, attainmentTone } from './planActual';
import { PlanCell, dateColClass } from './matrixCells';
import { kpiItems } from './ByBatchTab';
import { KpiStrip, ReportActions, PrintHeader, DateRangeFilter } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';
import { addDays, diffDays, isWeekend, shortDateLabel } from '../../utils/dates';

const PRINT_MAX_DAYS = 7;
const FROZEN = [
  { key: 'no', label: '#', left: 0, width: 40 },
  { key: 'batch', label: 'Batch', left: 40, width: 120 },
  { key: 'model', label: 'Model', left: 160, width: 110 },
  { key: 'step', label: 'Step', left: 270, width: 120 },
  { key: 'lot', label: 'Lot', left: 390, width: 60 },
  { key: 'ok', label: 'OK สะสม', left: 450, width: 70 },
];
const frozenStyle = (i) => ({ left: FROZEN[i].left, minWidth: FROZEN[i].width, maxWidth: FROZEN[i].width });
const trunc = (v) => Math.trunc(Number(v) || 0);
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

const ByMachineTab = ({ today, machine, onMachineChange }) => {
  const [machines, setMachines] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState({ from: addDays(today, -6), to: addDays(today, 7) });

  useEffect(() => {
    // FIX: ดึงจาก machine_config ผ่าน /production/machines (เดิม hardcode 8 ตัวฝั่ง Flutter)
    apiCall('/production/machines')
      .then((res) => setMachines(res.data || []))
      .catch(() => setMachines([]));
  }, []);

  const fetchPlanVsActual = useCallback(async (m) => {
    setLoading(true);
    try {
      const res = await apiCall(`/visualization/plan-vs-actual?machine=${encodeURIComponent(m)}`);
      setData(res.data || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (machine) fetchPlanVsActual(machine);
    else setData(null);
  }, [machine, fetchPlanVsActual]);

  const all = useMemo(() => transformByMachine(data ?? []), [data]);
  // ช่วงวัน: ตัดคอลัมน์วัน และแสดงเฉพาะแถวที่มีแผนในช่วง
  const dates = all.dates.filter((d) => inRange(d, range.from, range.to));
  const rows = useMemo(
    () => all.rows.filter((r) => Object.keys(r.dates).some((d) => inRange(d, range.from, range.to))),
    [all, range],
  );
  const summary = useMemo(() => summarize(rows, today), [rows, today]);
  const rangeText = range.from || range.to ? `${range.from || '…'} ถึง ${range.to || '…'}` : 'ทุกวัน';
  const title = `Plan & Actual — เครื่อง ${machine ?? ''}`;

  const span = range.from && range.to ? diffDays(range.from, range.to) + 1 : dates.length;
  const printWarning = Math.min(span, dates.length) > PRINT_MAX_DAYS
    ? `ช่วงที่เลือกมี ${Math.min(span, dates.length)} วัน — A4 แนวนอนพิมพ์ได้ราว ${PRINT_MAX_DAYS} วัน คอลัมน์ที่เกินจะถูกตัด แนะนำกด "7 วัน" ก่อนพิมพ์`
    : null;

  const handleExport = () => exportWorkbook(stampedFilename(`plan_actual_${machine}`, today), [
    {
      name: 'Summary',
      header: [
        { key: 'sub_batches', label: 'Batch' }, { key: 'parent_batch', label: 'Parent' }, { key: 'model', label: 'Model' },
        { key: 'step', label: 'Step' }, { key: 'lot', label: 'Lot', value: (r) => trunc(lotQty(r)) },
        { key: 'total_actual_ok', label: 'OK (total)', value: (r) => trunc(r.total_actual_ok) },
        { key: 'planToDate', label: 'Plan to date', value: (r) => rowProgress(r, today).planToDate },
        { key: 'pct', label: '% attainment', value: (r) => rowProgress(r, today).pct ?? '' },
      ],
      rows,
    },
    {
      name: 'Daily',
      header: [
        { key: 'sub_batches', label: 'Batch' }, { key: 'step', label: 'Step' }, { key: 'date', label: 'Date' },
        { key: 'plan', label: 'Plan' }, { key: 'ok', label: 'OK' }, { key: 'ng', label: 'NG' },
      ],
      rows: flattenDaily(rows, dates, ['sub_batches', 'step']),
    },
  ], { title, filters: rangeText, asOf: today });

  return (
    <div>
      <div className="rpt-toolbar">
        <Form.Select
          size="sm"
          style={{ width: 200 }}
          value={machine || ''}
          onChange={(e) => onMachineChange(e.target.value || null)}
          aria-label="เครื่องจักร"
        >
          <option value="">เลือกเครื่องจักร</option>
          {machines.map((m) => <option key={m} value={m}>{m}</option>)}
        </Form.Select>
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={!machine}
          onClick={() => fetchPlanVsActual(machine)}
          title="โหลดใหม่"
          aria-label="โหลดใหม่"
        >
          <i className="bi bi-arrow-clockwise" aria-hidden="true" />
        </Button>
        <DateRangeFilter from={range.from} to={range.to} today={today} onChange={setRange} />
        {machine && <ReportActions onExcel={handleExport} excelDisabled={rows.length === 0} printWarning={printWarning} />}
      </div>

      {!machine ? (
        <div className="empty-state">
          <i className="bi bi-building-gear" aria-hidden="true" />
          <div className="fw-bold">เลือกเครื่องจักรด้านบน หรือกดชื่อเครื่องในแท็บสรุปรายเครื่อง</div>
        </div>
      ) : loading ? (
        <div className="text-center py-5"><Spinner animation="border" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><i className="bi bi-inbox" aria-hidden="true" /><div>ไม่มีแผนของเครื่องนี้ในช่วงที่เลือก</div></div>
      ) : (
        <>
          <PrintHeader title={title} filters={rangeText} asOf={today} />
          <KpiStrip items={kpiItems(summary)} />
          <div className="rpt-note no-print">ช่องวัน = ได้ / แผน ของวันนั้น · OK สะสม = ยอด OK ทั้งหมดของ batch/step บนเครื่องนี้</div>
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
                    <tr key={`${row.parent_batch}|${row.sub_batches}|${row.step}`}>
                      <td className="frozen text-center text-muted" style={frozenStyle(0)}>{idx + 1}</td>
                      <td className="frozen num fw-bold text-truncate" style={frozenStyle(1)} title={`${row.sub_batches} (${row.description})`}>
                        {row.sub_batches ?? row.parent_batch}
                      </td>
                      <td className="frozen text-truncate" style={frozenStyle(2)} title={row.model}>{row.model}</td>
                      <td className="frozen text-truncate" style={frozenStyle(3)} title={row.step}>{row.step}</td>
                      <td className="frozen text-end num" style={frozenStyle(4)}>{trunc(lotQty(row))}</td>
                      <td
                        className={`frozen frozen-last text-end num fw-bold tone-${p.planToDate > 0 ? attainmentTone(p.pct) : 'muted'}`}
                        style={frozenStyle(5)}
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

ByMachineTab.propTypes = {
  today: PropTypes.string.isRequired,
  machine: PropTypes.string,
  onMachineChange: PropTypes.func.isRequired,
};

export default ByMachineTab;
