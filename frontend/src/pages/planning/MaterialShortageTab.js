// Material — รายการออเดอร์ที่ "ของยังไม่เข้า" สำหรับ Material Control (ไม่มีต้นฉบับใน Flutter)
// อ่านอย่างเดียว: orders (GET /orders ดึงครั้งเดียวที่ PlanningView) — กรองออเดอร์ปิด/ลบให้แล้วฝั่ง backend
// การแก้วัน material / dropdown Mat'l ยังอยู่ที่หน้า Orders ที่เดียว — กฎ "ของเข้าแล้ว" คือ effectiveArrived ตัวเดียวกัน
import React, { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';
import { buildShortageRows, countByReason, REASONS } from './materialShortage';
import { DEFAULT_MAT_WINDOW } from './planKpis';
import { materialSheet, matStatus, REASON_BY_ID } from './planReport';
import { ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';

const WINDOW_OPTIONS = [3, 7, 14];

const MaterialShortageTab = ({ orders, today, asOf }) => {
  const [windowDays, setWindowDays] = useState(DEFAULT_MAT_WINDOW);
  const [reasonFilter, setReasonFilter] = useState(null);
  const [search, setSearch] = useState('');

  const allRows = useMemo(() => buildShortageRows(orders ?? [], today, windowDays), [orders, today, windowDays]);
  const counts = useMemo(() => countByReason(allRows), [allRows]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) =>
      (!reasonFilter || r.reasons.includes(reasonFilter))
      && (!q || String(r.batch).toLowerCase().includes(q) || String(r.model ?? '').toLowerCase().includes(q)));
  }, [allRows, reasonFilter, search]);

  const title = 'Material — ออเดอร์ที่ของยังไม่พร้อม';
  const filters = [
    `เริ่มภายใน ${windowDays} วัน`,
    reasonFilter ? REASON_BY_ID[reasonFilter].label : null,
    search.trim() ? `ค้นหา "${search.trim()}"` : null,
  ].filter(Boolean).join(' · ');

  const handleExport = () => exportWorkbook(stampedFilename('material_shortage', today), [materialSheet(rows)], { title, filters, asOf });

  return (
    <div>
      <PrintHeader title={title} filters={filters} asOf={asOf} />
      <div className="rpt-toolbar">
        <span className="small text-muted">เริ่มภายใน</span>
        <Form.Select size="sm" style={{ width: 100 }} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
          {WINDOW_OPTIONS.map((n) => <option key={n} value={n}>{n} วัน</option>)}
        </Form.Select>
        {REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`chip chip-${reasonFilter === r.id ? r.tone : 'muted'} border-0`}
            onClick={() => setReasonFilter((cur) => (cur === r.id ? null : r.id))}
            title="กดเพื่อกรอง / กดซ้ำเพื่อยกเลิก"
          >
            {r.label} {counts[r.id]}
          </button>
        ))}
        <Form.Control
          size="sm"
          style={{ width: 200 }}
          placeholder="ค้นหา Batch / Model"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ReportActions onExcel={handleExport} excelDisabled={rows.length === 0} />
      </div>
      <div className="rpt-note no-print">
        ของ &quot;เข้าแล้ว&quot; ใช้กฎเดียวกับช่อง Mat&apos;l บนหน้า Orders (ยืนยันเอง หรือถึงวัน material แล้ว) — แก้สถานะได้ที่หน้า Orders
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-check-circle" aria-hidden="true" />
          <div>ไม่มีออเดอร์ที่ของยังไม่พร้อมตามเงื่อนไขนี้</div>
        </div>
      ) : (
        <div className="rpt-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                <th style={{ minWidth: 130 }}>Batch</th>
                <th style={{ minWidth: 120 }}>Model</th>
                <th className="text-end" style={{ minWidth: 60 }}>Qty</th>
                <th style={{ minWidth: 100 }}>Start (plan)</th>
                <th className="text-end" style={{ minWidth: 70 }}>อีก (วัน)</th>
                <th style={{ minWidth: 100 }}>Issue date</th>
                <th style={{ minWidth: 100 }}>Mat&apos;l date</th>
                <th style={{ minWidth: 120 }}>Mat&apos;l</th>
                <th style={{ minWidth: 100 }}>Due</th>
                <th style={{ minWidth: 200 }}>เหตุผล</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = matStatus(r);
                return (
                  <tr key={r.batch}>
                    <td className="num">{r.batch}</td>
                    <td>{r.model ?? '-'}</td>
                    <td className="text-end num">{r.qty ?? '-'}</td>
                    <td className="num">{r.startDate || '-'}</td>
                    <td className={`text-end num ${r.daysToStart !== null && r.daysToStart < 0 ? 'text-danger fw-bold' : ''}`}>
                      {r.daysToStart ?? '-'}
                    </td>
                    <td className="num">{r.issueDate || '-'}</td>
                    <td className="num">{r.materialDate || '-'}</td>
                    <td><span className={`chip chip-${st.tone}`}>{st.label}</span></td>
                    <td className="num">{r.dueDate || '-'}</td>
                    <td>
                      {r.reasons.map((id) => (
                        <span key={id} className={`chip chip-${REASON_BY_ID[id].tone} me-1`}>{REASON_BY_ID[id].label}</span>
                      ))}
                    </td>
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

MaterialShortageTab.propTypes = {
  orders: PropTypes.array,
  today: PropTypes.string.isRequired,
  asOf: PropTypes.string,
};

export default MaterialShortageTab;
