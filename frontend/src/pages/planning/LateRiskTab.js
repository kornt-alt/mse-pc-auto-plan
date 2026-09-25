// Late / At-risk — ออเดอร์ที่ช้า / หลุดแผน / เฉียดกำหนด จากแผนล่าสุด (ไม่มีต้นฉบับใน Flutter)
// FG มาจาก reportData ของ PlanDataContext · Due = confirm date ถ้ามี (ตรงกับ engine) จึงต้องใช้ GET /orders
// (orders ดึงครั้งเดียวที่ PlanningView แล้วส่งลงมา) · คำนวณใน lateRisk.js (pure) — อ่านอย่างเดียว
import React, { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';
import { buildLateRiskRows, countByStatus, STATUSES } from './lateRisk';
import { DEFAULT_RISK_DAYS } from './planKpis';
import { lateSheet } from './planReport';
import { ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';

const RISK_OPTIONS = [0, 2, 5];
const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
const gapLabel = (g) => (g == null ? '-' : g > 0 ? `+${g}` : String(g));

const LateRiskTab = ({ reportData, orders, today, asOf }) => {
  const [riskDays, setRiskDays] = useState(DEFAULT_RISK_DAYS);
  const [statusFilter, setStatusFilter] = useState(null);

  const allRows = useMemo(
    () => buildLateRiskRows(reportData, orders ?? [], today, riskDays),
    [reportData, orders, today, riskDays],
  );
  const counts = useMemo(() => countByStatus(allRows), [allRows]);
  const rows = statusFilter ? allRows.filter((r) => r.status === statusFilter) : allRows;
  const title = 'Late / At-risk — ออเดอร์ที่ต้องตาม';
  const filters = `เฉียดกำหนด ≤ ${riskDays} วัน${statusFilter ? ` · ${STATUS_BY_ID[statusFilter].label}` : ''}`;

  const handleExport = () => exportWorkbook(stampedFilename('late_at_risk', today), [lateSheet(rows)], { title, filters, asOf });

  return (
    <div>
      <PrintHeader title={title} filters={filters} asOf={asOf} />
      <div className="rpt-toolbar">
        <span className="small text-muted">เฉียดกำหนด = FG ห่าง Due ไม่เกิน</span>
        <Form.Select size="sm" style={{ width: 100 }} value={riskDays} onChange={(e) => setRiskDays(Number(e.target.value))}>
          {RISK_OPTIONS.map((n) => <option key={n} value={n}>{n} วัน</option>)}
        </Form.Select>
        {STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip chip-${statusFilter === s.id ? s.tone : 'muted'} border-0`}
            onClick={() => setStatusFilter((cur) => (cur === s.id ? null : s.id))}
            title="กดเพื่อกรอง / กดซ้ำเพื่อยกเลิก"
          >
            {s.label} {counts[s.id]}
          </button>
        ))}
        <ReportActions onExcel={handleExport} excelDisabled={rows.length === 0} />
      </div>
      <div className="rpt-note no-print">
        Due ที่ใช้ตัดสิน = Confirm date ถ้ามี (แบบเดียวกับที่ engine วางแผน) ไม่งั้นใช้ Due date · FG จากแผนล่าสุด · แก้ลำดับ/วันที่หน้า Orders
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-check-circle" aria-hidden="true" />
          <div>ไม่มีออเดอร์ที่ช้าหรือเฉียดกำหนดตามเงื่อนไขนี้</div>
        </div>
      ) : (
        <div className="rpt-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                <th style={{ minWidth: 130 }}>Batch</th>
                <th style={{ minWidth: 120 }}>Model</th>
                <th className="text-end" style={{ minWidth: 60 }}>Qty</th>
                <th style={{ minWidth: 110 }}>Due</th>
                <th style={{ minWidth: 100 }}>FG (plan)</th>
                <th className="text-end" style={{ minWidth: 70 }}>FG−Due</th>
                <th style={{ minWidth: 100 }}>Start</th>
                <th style={{ minWidth: 80 }}>Mat&apos;l</th>
                <th style={{ minWidth: 110 }}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = STATUS_BY_ID[r.status];
                return (
                  <tr key={r.batch}>
                    <td className="num">{r.batch}</td>
                    <td>{r.model ?? '-'}</td>
                    <td className="text-end num">{r.qty ?? '-'}</td>
                    <td className="num">
                      {r.dueDate || '-'}
                      {r.dueSource === 'confirm' && <span className="chip chip-info ms-1" title="Confirm date">C</span>}
                    </td>
                    <td className="num">{r.fgDate || '-'}</td>
                    <td className={`text-end num ${r.gap > 0 ? 'text-danger fw-bold' : ''}`}>{gapLabel(r.gap)}</td>
                    <td className="num">{r.startDate || '-'}</td>
                    <td>
                      <span className={`chip ${r.arrived ? 'chip-ok' : 'chip-ng'}`}>{r.arrived ? 'OK' : 'รอของ'}</span>
                    </td>
                    <td><span className={`chip chip-${s.tone}`}>{s.label}</span></td>
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

LateRiskTab.propTypes = {
  reportData: PropTypes.array.isRequired,
  orders: PropTypes.array,
  today: PropTypes.string.isRequired,
  asOf: PropTypes.string,
};

export default LateRiskTab;
