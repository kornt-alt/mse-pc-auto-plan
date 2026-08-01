// Shipment Date — เทียบแผน before/after จับคู่ด้วย Batch (port 1:1 จาก report_tab.dart)
import React, { useCallback } from 'react';
import { Button } from 'react-bootstrap';
import { exportCsv } from '../../utils/csvExport';

// วิเคราะห์แถว: ข้อมูลเก่า (before), สถานะ, ส่วนต่างวัน (report_tab.dart L307-362)
const analyzeRow = (row, previousReportData) => {
  const oldData = previousReportData.find((old) => old.Batch === row.Batch) ?? null;

  const beforeDate = oldData ? String(oldData.FinishDate ?? '-') : '-';
  const isBeforeDelay = oldData ? oldData.Delay === 'Yes' || oldData.Delay === true : false;
  const beforeStatus = oldData ? (isBeforeDelay ? 'DELAY' : 'ON TIME') : '-';

  const afterDate = String(row.FinishDate ?? '-');
  const isAfterDelay = row.Delay === 'Yes' || row.Delay === true;
  const afterStatus = isAfterDelay ? 'DELAY' : 'ON TIME';

  let dayDiff = null;
  if (oldData && beforeDate !== '-' && afterDate !== '-' && beforeDate !== afterDate) {
    const before = new Date(`${beforeDate}T00:00:00`);
    const after = new Date(`${afterDate}T00:00:00`);
    if (!Number.isNaN(before.getTime()) && !Number.isNaN(after.getTime())) {
      const diff = Math.round((after - before) / 86400000);
      if (diff !== 0) dayDiff = diff;
    }
  }

  // สีวันที่ After: แดงเมื่อ delay — เน้นเขียว/แดงขึ้นเมื่อสถานะพลิก
  let afterDateColor = isAfterDelay ? '#f44336' : '#2e7d32';
  if (oldData && beforeDate !== afterDate) {
    if (isBeforeDelay && !isAfterDelay) afterDateColor = '#4caf50';
    else if (!isBeforeDelay && isAfterDelay) afterDateColor = '#ff5252';
  }

  return { beforeDate, beforeStatus, afterDate, afterStatus, isAfterDelay, dayDiff, afterDateColor };
};

const ReportTab = ({ reportData, previousReportData }) => {
  const handleExport = useCallback(() => {
    if (reportData.length === 0) return;
    const rows = reportData.map((row) => {
      const a = analyzeRow(row, previousReportData);
      let diffStr = '';
      if (a.dayDiff !== null) diffStr = a.dayDiff > 0 ? `+${a.dayDiff}` : `${a.dayDiff}`;
      return [
        row.Batch ?? '-', row.Model ?? '-', row.Qty ?? '-', row.DueDate ?? '-',
        a.beforeDate, a.beforeStatus, a.afterDate, a.afterStatus, diffStr,
      ];
    });
    const today = new Date().toISOString().slice(0, 10);
    exportCsv(
      `Shipment_Report_${today}.csv`,
      ['Batch', 'Model', 'Qty', 'Due Date', 'Finish (Before)', 'Status (Before)', 'Finish (After)', 'Status (After)', 'Diff (Days)'],
      rows,
    );
  }, [reportData, previousReportData]);

  if (reportData.length === 0) {
    return <div className="text-center py-5 text-muted">ไม่มีข้อมูล</div>;
  }

  return (
    <div className="d-flex flex-column align-items-center">
      <div className="py-2">
        <Button variant="success" size="sm" onClick={handleExport}>
          <i className="bi bi-download me-1" aria-hidden="true" />
          Export CSV
        </Button>
      </div>
      <div className="planning-table-wrap" style={{ maxWidth: '100%' }}>
        <table className="planning-table">
          <thead>
            <tr>
              <th style={{ width: 120, minWidth: 120 }}>Batch</th>
              <th style={{ width: 100, minWidth: 100 }}>Model</th>
              <th style={{ width: 60, minWidth: 60 }}>Qty</th>
              <th style={{ width: 90, minWidth: 90 }}>Due Date</th>
              <th style={{ width: 110, minWidth: 110 }}>Finish (Before)</th>
              <th style={{ width: 100, minWidth: 100 }}>Status (Before)</th>
              <th style={{ width: 170, minWidth: 170 }}>Finish (After)</th>
              <th style={{ width: 100, minWidth: 100 }}>Status (After)</th>
            </tr>
          </thead>
          <tbody>
            {reportData.map((row, i) => {
              const a = analyzeRow(row, previousReportData);
              const bg = a.isAfterDelay ? '#ffebee' : '#e8f5e9'; // red.shade50 / green.shade50
              return (
                <tr key={i}>
                  <td style={{ background: bg }}>{String(row.Batch ?? '-')}</td>
                  <td style={{ background: bg }}>{String(row.Model ?? '-')}</td>
                  <td style={{ background: bg }}>{String(row.Qty ?? '-')}</td>
                  <td style={{ background: bg }}>{String(row.DueDate ?? '-')}</td>
                  <td style={{ background: bg, color: '#9e9e9e' }}>{a.beforeDate}</td>
                  <td style={{ background: bg }}>
                    <span style={{ fontSize: 10, color: '#9e9e9e', fontWeight: 'bold' }}>
                      {a.beforeStatus}
                    </span>
                  </td>
                  <td style={{ background: bg }}>
                    <span style={{ color: a.afterDateColor, fontWeight: 'bold', fontSize: 12 }}>
                      {a.afterDate}
                    </span>
                    {a.dayDiff !== null && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 'bold',
                          marginLeft: 4,
                          color: a.dayDiff > 0 ? '#ff9800' : '#4caf50',
                        }}
                      >
                        {a.dayDiff > 0 ? (
                          <i className="bi bi-arrow-up" style={{ fontSize: '0.75rem' }} aria-hidden="true" />
                        ) : (
                          <i className="bi bi-arrow-down" style={{ fontSize: '0.75rem' }} aria-hidden="true" />
                        )}
                        {a.dayDiff > 0 ? ` (+${a.dayDiff} วัน)` : ` (-${Math.abs(a.dayDiff)} วัน)`}
                      </span>
                    )}
                  </td>
                  <td style={{ background: bg }}>
                    <span
                      className="px-2 py-0"
                      style={{
                        background: a.isAfterDelay ? '#f44336' : '#4caf50',
                        color: '#fff',
                        fontSize: 10,
                        borderRadius: 4,
                        padding: '2px 8px',
                      }}
                    >
                      {a.afterStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReportTab;
