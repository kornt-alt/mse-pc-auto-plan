// สรุปรายเครื่อง — แผนสะสมถึงวันนี้เทียบยอดผลิตจริง ทุกเครื่องในตารางเดียว (ใหม่ — ไม่มีใน Flutter)
// เรียก GET /visualization/plan-vs-actual แบบไม่ใส่ filter (endpoint รองรับอยู่แล้ว: WHERE 1=1)
// ⚠️ query นี้อ่าน schedule_results ทั้งตาราง + production_records ทั้งตารางแบบ GROUP BY — ถ้าช้าบน DB จริง
//    ต้องเพิ่ม endpoint สรุปฝั่ง backend แทน (ยังไม่ได้วัดบน DB โรงงาน)
// คำนวณใน planActual.js machineSummary (ใช้ยอด OK/NG ที่ backend กระจายลงแถวแผนแล้ว)
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Spinner, Button } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { machineSummary, attainmentTone, ATTAINMENT_TONE } from './planActual';
import { KpiStrip, ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';

const trunc = (v) => Math.trunc(Number(v) || 0);
const TEXT_TONE = { ok: 'text-success', warn: 'text-warning', ng: 'text-danger', muted: 'text-muted' };

const MachineSummaryTab = ({ today, onOpenMachine }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setData(null);
    try {
      const res = await apiCall('/visualization/plan-vs-actual');
      setData(res.data || []);
    } catch (e) {
      setError(e.message || 'โหลดข้อมูลไม่สำเร็จ');
      setData([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => machineSummary(data ?? [], today), [data, today]);
  const totals = useMemo(() => {
    const t = { planToDate: 0, ok: 0, ng: 0, behind: 0, low: 0 };
    for (const r of rows) {
      t.planToDate += r.planToDate;
      t.ok += r.ok;
      t.ng += r.ng;
      t.behind += r.behind;
      if (r.pct != null && r.pct < ATTAINMENT_TONE.warn) t.low += 1;
    }
    t.pct = t.planToDate > 0 ? Math.round((t.ok / t.planToDate) * 1000) / 10 : null;
    return t;
  }, [rows]);

  const title = 'Plan & Actual — สรุปรายเครื่อง';
  const handleExport = () => exportWorkbook(stampedFilename('plan_actual_machines', today), [{
    name: 'By Machine',
    header: [
      { key: 'machine', label: 'Machine' },
      { key: 'batches', label: 'Batches' },
      { key: 'planToDate', label: 'Plan to date' },
      { key: 'planTotal', label: 'Plan total' },
      { key: 'ok', label: 'OK' },
      { key: 'ng', label: 'NG' },
      { key: 'pct', label: '% attainment', value: (r) => r.pct ?? '' },
      { key: 'ngPct', label: 'NG %', value: (r) => r.ngPct ?? '' },
      { key: 'behind', label: 'Rows behind' },
    ],
    rows,
  }], { title, filters: `แผนถึง ${today}`, asOf: today });

  if (data === null) return <div className="text-center py-5"><Spinner animation="border" className="text-mse" /></div>;

  return (
    <div>
      <PrintHeader title={title} filters={`แผนสะสมถึง ${today}`} asOf={today} />
      <KpiStrip items={[
        { id: 'machines', label: 'เครื่องที่มีแผน', value: rows.length, tone: 'info' },
        { id: 'plan', label: 'แผนถึงวันนี้ (ชิ้น)', value: trunc(totals.planToDate).toLocaleString() },
        { id: 'ok', label: 'ผลิตได้ (OK)', value: trunc(totals.ok).toLocaleString(), tone: 'ok' },
        { id: 'pct', label: '% ทำได้ตามแผน', value: totals.pct == null ? '-' : `${totals.pct}%`, tone: attainmentTone(totals.pct) },
        { id: 'low', label: `เครื่องต่ำกว่า ${ATTAINMENT_TONE.warn}%`, value: totals.low, tone: totals.low > 0 ? 'ng' : 'ok' },
        { id: 'ng', label: 'NG รวม', value: trunc(totals.ng).toLocaleString(), tone: totals.ng > 0 ? 'ng' : 'ok' },
      ]}
      />
      <div className="rpt-toolbar">
        <span className="small text-muted">
          % ทำได้ = OK ÷ แผนที่ถึงกำหนดแล้ว (ไม่นับ setup)
          <span className="chip chip-ok ms-2">≥ {ATTAINMENT_TONE.ok}%</span>
          <span className="chip chip-warn ms-1">{ATTAINMENT_TONE.warn}–{ATTAINMENT_TONE.ok}%</span>
          <span className="chip chip-ng ms-1">&lt; {ATTAINMENT_TONE.warn}%</span>
        </span>
        <ReportActions onExcel={handleExport} excelDisabled={rows.length === 0}>
          <Button size="sm" variant="outline-secondary" onClick={load}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />รีเฟรช
          </Button>
        </ReportActions>
      </div>
      {error && <div className="text-danger small mb-2">{error}</div>}

      {rows.length === 0 ? (
        <div className="empty-state"><i className="bi bi-inbox" aria-hidden="true" /><div>ไม่มีข้อมูลแผน</div></div>
      ) : (
        <div className="rpt-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                <th style={{ minWidth: 140 }}>Machine</th>
                <th className="text-end">Batch</th>
                <th className="text-end" style={{ minWidth: 100 }}>แผนถึงวันนี้</th>
                <th className="text-end" style={{ minWidth: 90 }}>แผนทั้งหมด</th>
                <th className="text-end" style={{ minWidth: 80 }}>OK</th>
                <th style={{ minWidth: 150 }}>% ทำได้ตามแผน</th>
                <th className="text-end" style={{ minWidth: 70 }}>NG</th>
                <th className="text-end" style={{ minWidth: 70 }}>NG %</th>
                <th className="text-end" style={{ minWidth: 90 }}>แถวตามหลัง</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = attainmentTone(r.pct);
                return (
                  <tr key={r.machine}>
                    <td>
                      <button type="button" className="btn btn-link p-0 fw-bold" onClick={() => onOpenMachine(r.machine)}>
                        {r.machine}
                      </button>
                    </td>
                    <td className="text-end num">{r.batches}</td>
                    <td className="text-end num">{trunc(r.planToDate).toLocaleString()}</td>
                    <td className="text-end num text-muted">{trunc(r.planTotal).toLocaleString()}</td>
                    <td className="text-end num">{trunc(r.ok).toLocaleString()}</td>
                    <td>
                      <span className={`num fw-bold ${TEXT_TONE[tone]}`}>{r.pct == null ? '-' : `${r.pct}%`}</span>
                      {r.pct != null && (
                        <div className={`mini-bar bar-${tone}`}><span style={{ width: `${Math.min(r.pct, 100)}%` }} /></div>
                      )}
                    </td>
                    <td className={`text-end num ${r.ng > 0 ? 'text-danger' : ''}`}>{trunc(r.ng).toLocaleString()}</td>
                    <td className="text-end num">{r.ngPct == null ? '-' : `${r.ngPct}%`}</td>
                    <td className={`text-end num ${r.behind > 0 ? 'text-danger fw-bold' : ''}`}>{r.behind}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

MachineSummaryTab.propTypes = {
  today: PropTypes.string.isRequired,
  onOpenMachine: PropTypes.func.isRequired,
};

export default MachineSummaryTab;
