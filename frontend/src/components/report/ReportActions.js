import React from 'react';
import PropTypes from 'prop-types';
import { Button } from 'react-bootstrap';

/**
 * ปุ่ม Excel / พิมพ์ ชุดเดียวกันทุกหน้ารายงาน
 * onExcel      — ไม่ส่ง = ไม่มีปุ่ม Excel
 * printWarning — ข้อความเตือนก่อนพิมพ์ (เช่น ช่วงวันกว้างเกิน A4) · ว่าง = พิมพ์ทันที
 * asOf         — "ข้อมูล ณ ..." แสดงข้างปุ่ม
 */
const ReportActions = ({ onExcel, excelLabel = 'Excel', excelDisabled, printWarning, asOf, children }) => {
  const handlePrint = () => {
    // eslint-disable-next-line no-alert
    if (printWarning && !window.confirm(`${printWarning}\n\nพิมพ์ต่อหรือไม่?`)) return;
    window.print();
  };
  return (
    <div className="report-actions no-print">
      {asOf && <span className="small text-muted num">ข้อมูล ณ {asOf}</span>}
      {children}
      {onExcel && (
        <Button size="sm" variant="outline-success" onClick={onExcel} disabled={excelDisabled}>
          <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
          {excelLabel}
        </Button>
      )}
      <Button size="sm" variant="outline-secondary" onClick={handlePrint}>
        <i className="bi bi-printer me-1" aria-hidden="true" />
        พิมพ์
      </Button>
    </div>
  );
};

ReportActions.propTypes = {
  onExcel: PropTypes.func,
  excelLabel: PropTypes.node,
  excelDisabled: PropTypes.bool,
  printWarning: PropTypes.string,
  asOf: PropTypes.node,
  children: PropTypes.node,
};

export default ReportActions;
