// Delivery — วันเสร็จของแต่ละ batch เทียบแผนก่อน (เดิม "Shipment Date" / ReportTab port จาก report_tab.dart)
// ตรรกะ before/after อยู่ใน delivery.js (analyzeRow ยกมาจากเดิม)
import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';
import {
  buildDeliveryRows, countDelivery, matchesDeliveryFilter, DELIVERY_FILTERS, diffLabel,
} from './delivery';
import { deliverySheet } from './planReport';
import { ReportActions, PrintHeader } from '../../components/report';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';

const DeliveryTab = ({ reportData, previousReportData, today, asOf }) => {
  const [statusFilter, setStatusFilter] = useState(null);
  const [search, setSearch] = useState('');
  const allRows = useMemo(() => buildDeliveryRows(reportData, previousReportData), [reportData, previousReportData]);
  const counts = useMemo(() => countDelivery(allRows), [allRows]);
  const hasPrev = (previousReportData ?? []).length > 0;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => matchesDeliveryFilter(r, statusFilter)
      && (!q || String(r.row.Batch ?? '').toLowerCase().includes(q) || String(r.row.Model ?? '').toLowerCase().includes(q)));
  }, [allRows, statusFilter, search]);

  const filters = [
    statusFilter ? DELIVERY_FILTERS.find((f) => f.id === statusFilter).label : 'ทุกสถานะ',
    search.trim() ? `ค้นหา "${search.trim()}"` : null,
  ].filter(Boolean).join(' · ');

  const handleExport = () => exportWorkbook(
    stampedFilename('delivery', today),
    [deliverySheet(rows)],
    { title: 'Delivery — วันเสร็จเทียบกำหนดส่ง', filters, asOf },
  );

  if (allRows.length === 0) {
    return <div className="empty-state"><i className="bi bi-truck" aria-hidden="true" /><div>ไม่มีข้อมูล</div></div>;
  }

  return (
    <div>
      <PrintHeader title="Delivery — วันเสร็จเทียบกำหนดส่ง" filters={filters} asOf={asOf} />
      <div className="rpt-toolbar">
        {DELIVERY_FILTERS.filter((f) => hasPrev || !['better', 'worse'].includes(f.id)).map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip chip-${statusFilter === f.id ? f.tone : 'muted'} border-0`}
            onClick={() => setStatusFilter((cur) => (cur === f.id ? null : f.id))}
            title="กดเพื่อกรอง / กดซ้ำเพื่อยกเลิก"
          >
            {f.label} {counts[f.id]}
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
        {hasPrev
          ? 'เทียบกับแผนก่อนหน้าที่รันในหน้าจอนี้ (refresh หน้าแล้วแผนก่อนหน้าจะหาย — ดูประวัติเต็มที่ Orders › ประวัติแผน)'
          : 'ยังไม่มีแผนก่อนหน้าให้เทียบใน session นี้'}
        {' · '}Due = due date ดิบของออเดอร์ (ไม่คิด Confirm date — ดูแท็บ Late / At-risk)
      </div>

      <div className="rpt-wrap">
        <table className="rpt-table">
          <thead>
            <tr>
              <th style={{ minWidth: 130 }}>Batch</th>
              <th style={{ minWidth: 120 }}>Model</th>
              <th className="text-end" style={{ minWidth: 60 }}>Qty</th>
              <th style={{ minWidth: 100 }}>Due Date</th>
              {hasPrev && <th style={{ minWidth: 110 }}>Finish (แผนก่อน)</th>}
              <th style={{ minWidth: 110 }}>Finish (แผนนี้)</th>
              {hasPrev && <th className="text-end" style={{ minWidth: 70 }}>ต่าง (วัน)</th>}
              <th style={{ minWidth: 90 }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.row.Batch)}>
                <td className="num">{String(r.row.Batch ?? '-')}</td>
                <td>{String(r.row.Model ?? '-')}</td>
                <td className="text-end num">{String(r.row.Qty ?? '-')}</td>
                <td className="num">{String(r.row.DueDate ?? '-')}</td>
                {hasPrev && (
                  <td className="num text-muted">
                    {r.beforeDate}
                    {r.beforeStatus === 'DELAY' && <span className="chip chip-ng ms-1">DELAY</span>}
                  </td>
                )}
                <td className={`num fw-bold ${r.isAfterDelay ? 'text-danger' : 'text-success'}`}>{r.afterDate}</td>
                {hasPrev && (
                  <td className={`text-end num fw-bold ${r.dayDiff > 0 ? 'text-danger' : r.dayDiff < 0 ? 'text-success' : ''}`}>
                    {diffLabel(r.dayDiff)}
                  </td>
                )}
                <td>
                  <span className={`chip ${r.isAfterDelay ? 'chip-ng' : 'chip-ok'}`}>{r.afterStatus}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

DeliveryTab.propTypes = {
  reportData: PropTypes.array.isRequired,
  previousReportData: PropTypes.array,
  today: PropTypes.string.isRequired,
  asOf: PropTypes.string,
};

export default DeliveryTab;
