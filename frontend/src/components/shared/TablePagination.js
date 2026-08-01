// แถบแบ่งหน้าของตารางที่กรองฝั่ง client — คู่กับ useTableFilter
// รูปแบบปุ่มยกมาจาก pages/wip/SummaryTab.js (ก่อนหน้า/ถัดไป + btn-mse)
import React from 'react';
import PropTypes from 'prop-types';
import { Form, Button } from 'react-bootstrap';
import { ALL_ROWS } from './useTableFilter';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const TablePagination = ({
  id,
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  from,
  to,
  filteredCount,
  total,
  unit = 'รายการ',
}) => (
  <div className="d-flex flex-wrap align-items-center gap-3 mt-3">
    <span className="text-muted small num">
      แสดง {from}-{to} จาก {filteredCount} {unit}
      {filteredCount !== total && ` (ทั้งหมด ${total})`}
    </span>

    <div className="d-flex align-items-center gap-2">
      <label htmlFor={`${id}-page-size`} className="text-muted small mb-0">
        แถวต่อหน้า
      </label>
      <Form.Select
        id={`${id}-page-size`}
        size="sm"
        style={{ width: 'auto' }}
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value={ALL_ROWS}>ทั้งหมด</option>
      </Form.Select>
    </div>

    {/* หน้าเดียวจบก็ไม่ต้องมีปุ่มที่กดไม่ได้ค้างไว้ */}
    {pageCount > 1 && (
      <div className="d-flex align-items-center gap-2 ms-auto">
        <Button
          size="sm"
          className="btn-mse"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <i className="bi bi-chevron-left me-1" aria-hidden="true" />
          ก่อนหน้า
        </Button>
        <span className="fw-bold num">
          หน้า {page} / {pageCount}
        </span>
        <Button
          size="sm"
          className="btn-mse"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          ถัดไป
          <i className="bi bi-chevron-right ms-1" aria-hidden="true" />
        </Button>
      </div>
    )}
  </div>
);

TablePagination.propTypes = {
  id: PropTypes.string.isRequired,
  page: PropTypes.number.isRequired,
  pageCount: PropTypes.number.isRequired,
  pageSize: PropTypes.number.isRequired,
  onPageChange: PropTypes.func.isRequired,
  onPageSizeChange: PropTypes.func.isRequired,
  from: PropTypes.number.isRequired,
  to: PropTypes.number.isRequired,
  filteredCount: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  unit: PropTypes.string,
};

export default TablePagination;
